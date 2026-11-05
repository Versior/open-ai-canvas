package app

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log"
	"net/http"
	"net/url"
	"path"
	"strings"
	"sync"
	"time"

	"yingce/backend/internal/model"
)

// 电商模特库的清单导入与远程拉取。
//
// 清单里每条素材的图片给 url（远程下载）或 file（命令行工具读本机文件，相对清单所在目录）。每条都走与后台上传
// 相同的校验、缩略图、存储和审计，按「类型 + 分类 + 名称」跳过已有的，可以重复执行。后台可以一键拉取内置来源，
// 也可以填一份清单地址；拉取在后台进程里跑，一次只跑一个，进度只存在本进程内存里，重启后再拉会跳过已导入的部分。
const (
	studioModelManifestMaxBytes = 8 << 20
	studioModelManifestMaxItems = 5000
	studioModelRemoteWorkers    = 4
	studioModelRemoteAttempts   = 3
	studioModelImportFailures   = 50
	studioModelSourceDataBytes  = 8 << 20
)

// StudioModelManifestItem 是素材清单里的一条。
type StudioModelManifestItem struct {
	Kind      string   `json:"kind"`
	Name      string   `json:"name"`
	Category  string   `json:"category"`
	Gender    string   `json:"gender"`
	Tags      []string `json:"tags"`
	Prompt    string   `json:"prompt"`
	URL       string   `json:"url,omitempty"`
	File      string   `json:"file,omitempty"`
	Enabled   bool     `json:"enabled"`
	SortOrder int      `json:"sortOrder"`
}

type StudioModelManifest struct {
	Source string                    `json:"source"`
	Items  []StudioModelManifestItem `json:"items"`
}

// StudioModelSource 是后台可以一键拉取的内置来源。
type StudioModelSource struct {
	ID          string `json:"id"`
	Name        string `json:"name"`
	Description string `json:"description"`
	Notice      string `json:"notice"`
}

type StudioModelImportFailure struct {
	Name  string `json:"name"`
	Error string `json:"error"`
}

// StudioModelImportReport 是一次清单导入的计数；Failures 只留前 50 条。
type StudioModelImportReport struct {
	Total    int                        `json:"total"`
	Done     int                        `json:"done"`
	Imported int                        `json:"imported"`
	Skipped  int                        `json:"skipped"`
	Failed   int                        `json:"failed"`
	Failures []StudioModelImportFailure `json:"failures"`
}

// StudioModelImportOptions 控制一次清单导入。PortraitConsent 为真时人脸和全身模特带肖像授权导入并按清单上架，
// 否则一律不上架、不标授权。Open 取到一条素材的图片字节，没有图片时返回 nil；可以并发调用。
type StudioModelImportOptions struct {
	PortraitConsent bool
	DryRun          bool
	Workers         int
	Open            func(ctx context.Context, item StudioModelManifestItem) ([]byte, error)
	Progress        func(StudioModelImportReport)
}

// StudioModelRemoteImportInput 是后台发起远程拉取：source 选内置来源，或 manifestUrl 给一份清单地址，二选一。
type StudioModelRemoteImportInput struct {
	Source              string `json:"source"`
	ManifestURL         string `json:"manifestUrl"`
	FaceConsentAttested bool   `json:"faceConsentAttested"`
}

// StudioModelRemoteImportView 是后台看到的拉取进度；status 为 idle / running / done / failed / cancelled。
type StudioModelRemoteImportView struct {
	Status     string                  `json:"status"`
	Source     string                  `json:"source"`
	StartedAt  string                  `json:"startedAt,omitempty"`
	FinishedAt string                  `json:"finishedAt,omitempty"`
	Error      string                  `json:"error,omitempty"`
	Report     StudioModelImportReport `json:"report"`
	Sources    []StudioModelSource     `json:"sources"`
}

type studioModelImportJob struct {
	mu     sync.Mutex
	view   StudioModelRemoteImportView
	cancel context.CancelFunc
}

func (job *studioModelImportJob) snapshot() StudioModelRemoteImportView {
	job.mu.Lock()
	defer job.mu.Unlock()
	view := job.view
	view.Report.Failures = append([]StudioModelImportFailure{}, job.view.Report.Failures...)
	return view
}

func (job *studioModelImportJob) running() bool {
	job.mu.Lock()
	defer job.mu.Unlock()
	return job.view.Status == "running"
}

func (job *studioModelImportJob) setReport(report StudioModelImportReport) {
	job.mu.Lock()
	defer job.mu.Unlock()
	job.view.Report = report
}

func (job *studioModelImportJob) finish(status, message string) {
	job.mu.Lock()
	defer job.mu.Unlock()
	job.view.Status, job.view.Error, job.view.FinishedAt = status, message, time.Now().UTC().Format(time.RFC3339)
}

func (report *StudioModelImportReport) fail(name string, err error) {
	report.Failed++
	if len(report.Failures) < studioModelImportFailures {
		report.Failures = append(report.Failures, StudioModelImportFailure{Name: name, Error: err.Error()})
	}
}

// ImportStudioModelManifest 逐条导入清单：已有的和清单里重复的跳过；图片由 Open 并发去取，写入按顺序一条一条做，
// 避免 SQLite 同时写。ctx 取消时停下并返回 ctx 的错误，已经导入的保留。
func (s *Service) ImportStudioModelManifest(ctx context.Context, actor *model.User, items []StudioModelManifestItem, options StudioModelImportOptions) (StudioModelImportReport, error) {
	report := StudioModelImportReport{Total: len(items), Failures: []StudioModelImportFailure{}}
	if err := s.RequireAdmin(actor); err != nil {
		return report, err
	}
	progress := func() {
		if options.Progress != nil {
			snapshot := report
			snapshot.Failures = append([]StudioModelImportFailure{}, report.Failures...)
			options.Progress(snapshot)
		}
	}
	existing := map[string]map[string]bool{}
	pending := []StudioModelManifestItem{}
	for _, item := range items {
		kind := strings.TrimSpace(item.Kind)
		if existing[kind] == nil {
			keys, err := s.AdminStudioModelKeys(actor, kind)
			if err != nil {
				return report, err
			}
			existing[kind] = keys
		}
		key := StudioModelKey(item.Category, item.Name)
		if existing[kind][key] {
			report.Skipped++
			report.Done++
			continue
		}
		existing[kind][key] = true
		pending = append(pending, item)
	}
	progress()

	type fetched struct {
		item StudioModelManifestItem
		data []byte
		err  error
	}
	workers := max(1, options.Workers)
	queue := make(chan StudioModelManifestItem)
	results := make(chan fetched)
	var wg sync.WaitGroup
	for range workers {
		wg.Add(1)
		go func() {
			defer wg.Done()
			for item := range queue {
				var result fetched
				result.item = item
				if options.Open != nil {
					result.data, result.err = options.Open(ctx, item)
				}
				select {
				case results <- result:
				case <-ctx.Done():
					return
				}
			}
		}()
	}
	go func() {
		defer func() {
			close(queue)
			wg.Wait()
			close(results)
		}()
		for _, item := range pending {
			select {
			case queue <- item:
			case <-ctx.Done():
				return
			}
		}
	}()
	for result := range results {
		if ctx.Err() != nil {
			break
		}
		item := result.item
		report.Done++
		if result.err != nil {
			report.fail(item.Name, result.err)
			progress()
			continue
		}
		portrait := StudioModelPortrait(strings.TrimSpace(item.Kind))
		sortOrder := item.SortOrder
		input := AdminStudioModelInput{
			Kind: item.Kind, Name: item.Name, Category: item.Category, Gender: item.Gender, Tags: item.Tags, Prompt: item.Prompt,
			Consent: portrait && options.PortraitConsent, Enabled: item.Enabled && (!portrait || options.PortraitConsent), SortOrder: &sortOrder,
		}
		var err error
		switch {
		case options.DryRun:
			_, err = normalizeStudioModelInput(input, result.data != nil)
		case result.data == nil:
			_, err = s.ImportStudioModel(actor, input, nil)
		default:
			_, err = s.ImportStudioModelImage(actor, input, studioModelFileName(item), result.data)
		}
		if err != nil {
			report.fail(item.Name, err)
		} else {
			report.Imported++
		}
		progress()
	}
	// 取消后后台 goroutine 自己退出；这里只把剩下的结果读空，免得它们卡在发送上。
	for range results {
	}
	return report, ctx.Err()
}

func studioModelFileName(item StudioModelManifestItem) string {
	if item.File != "" {
		return path.Base(item.File)
	}
	if parsed, err := url.Parse(item.URL); err == nil {
		if base := path.Base(parsed.Path); base != "." && base != "/" {
			return base
		}
	}
	return item.Name
}

// DownloadStudioModelFile 按出站安全规则下载一个文件（拒绝私网、限制重定向和大小），网络错误与 5xx、429 重试三次。
// 错误里不带地址本身，免得带签名的清单地址出现在后台和日志里。
func DownloadStudioModelFile(ctx context.Context, rawURL string, limit int64) ([]byte, error) {
	parsed, err := ValidateOutboundURL(rawURL)
	if err != nil {
		return nil, err
	}
	client := OutboundHTTPClient(2 * time.Minute)
	var last error
	for attempt := range studioModelRemoteAttempts {
		if attempt > 0 {
			select {
			case <-time.After(time.Duration(attempt) * 2 * time.Second):
			case <-ctx.Done():
				return nil, ctx.Err()
			}
		}
		req, err := http.NewRequestWithContext(ctx, http.MethodGet, parsed.String(), nil)
		if err != nil {
			return nil, err
		}
		ApplyDefaultOutboundHeaders(req)
		resp, err := client.Do(req)
		if err != nil {
			if ctx.Err() != nil {
				return nil, ctx.Err()
			}
			var urlErr *url.Error
			if errors.As(err, &urlErr) {
				err = urlErr.Err
			}
			last = err
			continue
		}
		data, readErr := io.ReadAll(io.LimitReader(resp.Body, limit+1))
		resp.Body.Close()
		switch {
		case resp.StatusCode >= 500 || resp.StatusCode == http.StatusTooManyRequests:
			last = fmt.Errorf("远程服务返回 %s", resp.Status)
			continue
		case resp.StatusCode < 200 || resp.StatusCode >= 300:
			return nil, fmt.Errorf("远程服务返回 %s", resp.Status)
		case readErr != nil:
			last = readErr
			continue
		case int64(len(data)) > limit:
			return nil, fmt.Errorf("文件超过 %d MiB", limit>>20)
		}
		return data, nil
	}
	return nil, fmt.Errorf("下载失败：%v", last)
}

// studioModelURLLabel 只留地址的主机和路径，进度、审计和日志里不出现查询串里可能带的签名。
func studioModelURLLabel(rawURL string) string {
	parsed, err := url.Parse(rawURL)
	if err != nil || parsed.Host == "" {
		return "清单地址"
	}
	return parsed.Scheme + "://" + parsed.Host + parsed.Path
}

// FetchStudioModelManifest 下载一份远程清单；远程清单里的图片必须给 url，file 只给命令行工具用。
func FetchStudioModelManifest(ctx context.Context, rawURL string) (StudioModelManifest, error) {
	var manifest StudioModelManifest
	data, err := DownloadStudioModelFile(ctx, rawURL, studioModelManifestMaxBytes)
	if err != nil {
		return manifest, fmt.Errorf("清单读取失败：%w", err)
	}
	if err := json.Unmarshal(data, &manifest); err != nil {
		return manifest, errors.New("清单不是有效的 JSON，格式见文档里的素材清单说明")
	}
	if len(manifest.Items) == 0 || len(manifest.Items) > studioModelManifestMaxItems {
		return manifest, fmt.Errorf("清单要有 1–%d 条素材", studioModelManifestMaxItems)
	}
	return manifest, nil
}

func studioModelSourceOf(id string) (StudioModelSource, bool) {
	for _, source := range studioModelSources {
		if source.ID == id {
			return source, true
		}
	}
	return StudioModelSource{}, false
}

// FetchStudioModelSourceManifest 生成内置来源的清单：图片地址指向来源的固定提交，file 是来源仓库里的相对路径。
func FetchStudioModelSourceManifest(ctx context.Context, id string) (StudioModelManifest, error) {
	if _, ok := studioModelSourceOf(id); !ok {
		return StudioModelManifest{}, BadAuthRequest("没有这个内置来源")
	}
	return poseGalleryManifest(ctx)
}

// StartStudioModelRemoteImport 在后台开始一次远程拉取；已经有一次在跑时返回 409。
func (s *Service) StartStudioModelRemoteImport(actor *model.User, input StudioModelRemoteImportInput) (*StudioModelRemoteImportView, error) {
	if err := s.RequireAdmin(actor); err != nil {
		return nil, err
	}
	source, manifestURL := strings.TrimSpace(input.Source), strings.TrimSpace(input.ManifestURL)
	var label string
	switch {
	case source != "" && manifestURL != "":
		return nil, BadAuthRequest("内置来源和清单地址只能选一个")
	case source != "":
		found, ok := studioModelSourceOf(source)
		if !ok {
			return nil, BadAuthRequest("没有这个内置来源")
		}
		label = found.Name
	case manifestURL != "":
		if len(manifestURL) > 2048 {
			return nil, BadAuthRequest("清单地址过长")
		}
		if _, err := ValidateOutboundURL(manifestURL); err != nil {
			return nil, err
		}
		label = studioModelURLLabel(manifestURL)
	default:
		return nil, BadAuthRequest("请选择内置来源或填写清单地址")
	}
	s.studioModelImportMu.Lock()
	defer s.studioModelImportMu.Unlock()
	if s.studioModelImport != nil && s.studioModelImport.running() {
		return nil, WrapAppError(http.StatusConflict, "已有一次拉取在进行，等它结束或先停止", nil)
	}
	if err := s.appendAdminAudit(actor, "studio_model.remote_import", "studio_model", "remote-import", "远程拉取模特库："+label, map[string]any{"source": source, "manifest": label, "portraitConsent": input.FaceConsentAttested}); err != nil {
		return nil, err
	}
	ctx, cancel := context.WithCancel(context.Background())
	job := &studioModelImportJob{cancel: cancel, view: StudioModelRemoteImportView{Status: "running", Source: label, StartedAt: time.Now().UTC().Format(time.RFC3339), Report: StudioModelImportReport{Failures: []StudioModelImportFailure{}}}}
	s.studioModelImport = job
	owner := *actor
	go s.runStudioModelRemoteImport(ctx, job, &owner, source, manifestURL, input.FaceConsentAttested)
	view := job.snapshot()
	view.Sources = studioModelSources
	return &view, nil
}

func (s *Service) runStudioModelRemoteImport(ctx context.Context, job *studioModelImportJob, actor *model.User, source, manifestURL string, consent bool) {
	defer job.cancel()
	var manifest StudioModelManifest
	var err error
	if source != "" {
		manifest, err = FetchStudioModelSourceManifest(ctx, source)
	} else {
		manifest, err = FetchStudioModelManifest(ctx, manifestURL)
	}
	if err != nil {
		status := "failed"
		if ctx.Err() != nil {
			status = "cancelled"
		}
		job.finish(status, err.Error())
		return
	}
	report, err := s.ImportStudioModelManifest(ctx, actor, manifest.Items, StudioModelImportOptions{
		PortraitConsent: consent,
		Workers:         studioModelRemoteWorkers,
		Progress:        job.setReport,
		Open: func(ctx context.Context, item StudioModelManifestItem) ([]byte, error) {
			if item.URL == "" {
				if item.File != "" {
					return nil, errors.New("远程清单里的图片要给 url")
				}
				return nil, nil
			}
			return DownloadStudioModelFile(ctx, item.URL, StudioModelImportMaxBytes)
		},
	})
	job.setReport(report)
	switch {
	case errors.Is(err, context.Canceled):
		job.finish("cancelled", "")
	case err != nil:
		job.finish("failed", err.Error())
	default:
		job.finish("done", "")
	}
	summary := fmt.Sprintf("远程拉取模特库结束：新增 %d 条，跳过 %d 条，失败 %d 条", report.Imported, report.Skipped, report.Failed)
	if auditErr := s.appendAdminAudit(actor, "studio_model.remote_import_done", "studio_model", "remote-import", summary, map[string]any{"imported": report.Imported, "skipped": report.Skipped, "failed": report.Failed}); auditErr != nil {
		log.Printf("studio model remote import audit failed: %v", auditErr)
	}
}

// StudioModelRemoteImportStatus 返回最近一次拉取的进度，以及可以拉取的内置来源。
func (s *Service) StudioModelRemoteImportStatus(actor *model.User) (*StudioModelRemoteImportView, error) {
	if err := s.RequireAdmin(actor); err != nil {
		return nil, err
	}
	s.studioModelImportMu.Lock()
	job := s.studioModelImport
	s.studioModelImportMu.Unlock()
	view := StudioModelRemoteImportView{Status: "idle", Report: StudioModelImportReport{Failures: []StudioModelImportFailure{}}}
	if job != nil {
		view = job.snapshot()
	}
	view.Sources = studioModelSources
	return &view, nil
}

// CancelStudioModelRemoteImport 停止正在进行的拉取；已经导入的保留，再拉会跳过它们。
func (s *Service) CancelStudioModelRemoteImport(actor *model.User) (*StudioModelRemoteImportView, error) {
	if err := s.RequireAdmin(actor); err != nil {
		return nil, err
	}
	s.studioModelImportMu.Lock()
	job := s.studioModelImport
	s.studioModelImportMu.Unlock()
	if job != nil && job.running() {
		job.cancel()
	}
	return s.StudioModelRemoteImportStatus(actor)
}
