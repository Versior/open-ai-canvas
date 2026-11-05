// Administrative maintenance only: 把素材清单或内置来源批量导入电商生图台模特库。This executable never starts generation workers.
//
// 三种用法：
//
//	-manifest path.json -admin ID   导入一份清单；条目的 file 相对清单所在目录，没有 file 时按 url 下载
//	-source ai-pose-gallery-zh -admin ID   直接从内置来源的固定提交下载并导入（后台「远程拉取」用的也是它）
//	-source ai-pose-gallery-zh -export DIR   只下载到 DIR 并写 DIR/manifest.json，给连不上外网的服务器离线导入
//
// 每条素材走与后台上传相同的服务方法（校验、缩略图、本地专用资源、审计），按「类型 + 分类 + 名称」跳过已经导入过的条目，
// 可以重复执行。人脸和全身模特默认不上架、不标肖像授权；只有操作者确认已取得全部肖像使用授权时，
// 才加 -face-consent-attested 让它们带授权导入并上架。导入前先停掉后端并备份数据库。
package main

import (
	"context"
	"encoding/json"
	"flag"
	"fmt"
	"log"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"sync/atomic"

	"yingce/backend/internal/database"
	"yingce/backend/internal/repository"
	"yingce/backend/internal/service"
)

const workers = 6

func main() {
	manifestPath := flag.String("manifest", "", "import manifest (JSON); file paths are relative to it, items without file are downloaded from url")
	sourceID := flag.String("source", "", "built-in source to download from, e.g. ai-pose-gallery-zh")
	exportDir := flag.String("export", "", "with -source: download the images into this directory and write manifest.json there, without touching any database")
	adminID := flag.String("admin", "", "existing administrator ID, required when importing")
	faceConsent := flag.Bool("face-consent-attested", false, "the operator holds portrait authorization for every face and full-body model in the manifest")
	dryRun := flag.Bool("dry-run", false, "check the manifest and images without writing")
	flag.Parse()
	ctx := context.Background()
	if (*manifestPath == "") == (*sourceID == "") {
		log.Fatal("usage: studio-models-import (-manifest path.json | -source ai-pose-gallery-zh) [-export DIR | -admin ADMIN_ID [-face-consent-attested] [-dry-run]]")
	}
	var manifest service.StudioModelManifest
	baseDir := ""
	if *sourceID != "" {
		value, err := service.FetchStudioModelSourceManifest(ctx, *sourceID)
		if err != nil {
			log.Fatal(err)
		}
		manifest = value
	} else {
		raw, err := os.ReadFile(*manifestPath)
		if err != nil {
			log.Fatal(err)
		}
		if err := json.Unmarshal(raw, &manifest); err != nil {
			log.Fatalf("manifest: %v", err)
		}
		baseDir = filepath.Dir(*manifestPath)
	}
	if *exportDir != "" {
		if *sourceID == "" {
			log.Fatal("-export only works with -source")
		}
		exportSource(ctx, manifest, *exportDir)
		return
	}
	if *adminID == "" {
		log.Fatal("-admin is required when importing")
	}
	if os.Getenv("DATABASE_URL") == "" && os.Getenv("CANVAS_BACKEND_DATA_DIR") == "" {
		log.Fatal("explicit database location required")
	}
	driver := os.Getenv("CANVAS_DATABASE_DRIVER")
	if driver == "" {
		driver = "sqlite"
	}
	dir := os.Getenv("CANVAS_BACKEND_DATA_DIR")
	db, err := database.Open(database.Config{Driver: driver, DSN: os.Getenv("DATABASE_URL"), DataDir: dir})
	if err != nil {
		log.Fatal(err)
	}
	if err := database.RequireSchemaVersion(db); err != nil {
		log.Fatal(err)
	}
	sqlDB, err := db.DB()
	if err != nil {
		log.Fatal(err)
	}
	defer sqlDB.Close()
	repo := repository.New(db)
	svc := service.New(repo, dir)
	defer svc.Close()
	actor, err := repo.User(*adminID)
	if err != nil || svc.RequireAdmin(actor) != nil {
		log.Fatal("an existing administrator is required")
	}
	lastPrinted := 0
	report, err := svc.ImportStudioModelManifest(ctx, actor, manifest.Items, service.StudioModelImportOptions{
		PortraitConsent: *faceConsent,
		DryRun:          *dryRun,
		Workers:         workers,
		Open: func(ctx context.Context, item service.StudioModelManifestItem) ([]byte, error) {
			if item.File != "" && baseDir != "" {
				return os.ReadFile(filepath.Join(baseDir, filepath.FromSlash(item.File)))
			}
			if item.URL != "" {
				return service.DownloadStudioModelFile(ctx, item.URL, service.StudioModelImportMaxBytes)
			}
			return nil, nil
		},
		Progress: func(report service.StudioModelImportReport) {
			if report.Done-lastPrinted >= 100 || report.Done == report.Total {
				lastPrinted = report.Done
				fmt.Fprintf(os.Stderr, "%d/%d\n", report.Done, report.Total)
			}
		},
	})
	if err != nil {
		log.Fatal(err)
	}
	if err := json.NewEncoder(os.Stdout).Encode(map[string]any{"source": manifest.Source, "dryRun": *dryRun, "report": report}); err != nil {
		log.Fatal(err)
	}
	if report.Failed > 0 {
		os.Exit(1)
	}
}

// exportSource 把内置来源下载到本机目录：图片按来源仓库里的相对路径存放，已经下载过且非空的跳过，最后写 manifest.json。
func exportSource(ctx context.Context, manifest service.StudioModelManifest, dir string) {
	root, err := filepath.Abs(dir)
	if err != nil {
		log.Fatal(err)
	}
	jobs := make(chan service.StudioModelManifestItem)
	var done, failed atomic.Int64
	var wg sync.WaitGroup
	for range workers {
		wg.Add(1)
		go func() {
			defer wg.Done()
			for item := range jobs {
				target := filepath.Join(root, filepath.FromSlash(item.File))
				if !strings.HasPrefix(target, root+string(filepath.Separator)) {
					failed.Add(1)
					log.Printf("%s: path escapes the export directory", item.File)
					continue
				}
				if info, err := os.Stat(target); err != nil || info.Size() == 0 {
					data, err := service.DownloadStudioModelFile(ctx, item.URL, service.StudioModelImportMaxBytes)
					if err == nil {
						err = os.MkdirAll(filepath.Dir(target), 0o755)
					}
					if err == nil {
						err = os.WriteFile(target, data, 0o644)
					}
					if err != nil {
						failed.Add(1)
						log.Printf("%s: %v", item.File, err)
						continue
					}
				}
				if count := done.Add(1); count%200 == 0 {
					fmt.Fprintf(os.Stderr, "%d/%d\n", count, len(manifest.Items))
				}
			}
		}()
	}
	for _, item := range manifest.Items {
		if item.File == "" || item.URL == "" {
			failed.Add(1)
			continue
		}
		jobs <- item
	}
	close(jobs)
	wg.Wait()
	raw, err := json.MarshalIndent(manifest, "", " ")
	if err != nil {
		log.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(root, "manifest.json"), raw, 0o644); err != nil {
		log.Fatal(err)
	}
	fmt.Printf("{\"items\":%d,\"saved\":%d,\"failed\":%d,\"manifest\":%q}\n", len(manifest.Items), done.Load(), failed.Load(), filepath.Join(root, "manifest.json"))
	if failed.Load() > 0 {
		os.Exit(1)
	}
}
