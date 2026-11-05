// Administrative maintenance only: 把一份本机素材清单批量导入电商生图台模特库。This executable never starts generation workers.
//
// 每条素材走与后台上传相同的服务方法（校验、缩略图、本地专用资源、审计），按「类型 + 分类 + 名称」跳过已经导入过的条目，
// 可以重复执行。清单里的图片路径相对清单文件所在目录。人脸素材默认不上架、不标肖像授权；
// 只有操作者确认已取得清单里全部人脸的肖像使用授权时，才加 -face-consent-attested 让人脸带授权导入并上架。
package main

import (
	"encoding/json"
	"flag"
	"fmt"
	"log"
	"os"
	"path/filepath"
	"strings"
	"yingce/backend/internal/database"
	"yingce/backend/internal/model"
	"yingce/backend/internal/repository"
	"yingce/backend/internal/service"
)

type manifestItem struct {
	Kind      string   `json:"kind"`
	Name      string   `json:"name"`
	Category  string   `json:"category"`
	Gender    string   `json:"gender"`
	Tags      []string `json:"tags"`
	Prompt    string   `json:"prompt"`
	File      string   `json:"file"`
	Enabled   bool     `json:"enabled"`
	SortOrder int      `json:"sortOrder"`
}

type importManifest struct {
	Source string         `json:"source"`
	Items  []manifestItem `json:"items"`
}

type importFailure struct {
	Name  string `json:"name"`
	Error string `json:"error"`
}

func main() {
	manifestPath := flag.String("manifest", "", "import manifest (JSON); image paths are relative to it")
	adminID := flag.String("admin", "", "existing administrator ID, required")
	faceConsent := flag.Bool("face-consent-attested", false, "the operator holds portrait authorization for every face in the manifest")
	dryRun := flag.Bool("dry-run", false, "check the manifest and files without writing")
	flag.Parse()
	if *manifestPath == "" || *adminID == "" {
		log.Fatal("usage: studio-models-import -manifest path.json -admin ADMIN_ID [-face-consent-attested] [-dry-run]")
	}
	if os.Getenv("DATABASE_URL") == "" && os.Getenv("CANVAS_BACKEND_DATA_DIR") == "" {
		log.Fatal("explicit database location required")
	}
	raw, err := os.ReadFile(*manifestPath)
	if err != nil {
		log.Fatal(err)
	}
	var manifest importManifest
	if err := json.Unmarshal(raw, &manifest); err != nil {
		log.Fatalf("manifest: %v", err)
	}
	baseDir := filepath.Dir(*manifestPath)
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
	existing := map[string]map[string]bool{}
	report := map[string]int{"imported": 0, "skipped": 0, "failed": 0}
	failures := []importFailure{}
	for index, item := range manifest.Items {
		kind := strings.TrimSpace(item.Kind)
		if existing[kind] == nil {
			keys, err := svc.AdminStudioModelKeys(actor, kind)
			if err != nil {
				log.Fatal(err)
			}
			existing[kind] = keys
		}
		key := service.StudioModelKey(item.Category, item.Name)
		if existing[kind][key] {
			report["skipped"]++
			continue
		}
		face := kind == model.StudioModelKindFace
		sortOrder := item.SortOrder
		input := service.AdminStudioModelInput{
			Kind: kind, Name: item.Name, Category: item.Category, Gender: item.Gender, Tags: item.Tags, Prompt: item.Prompt,
			Consent: face && *faceConsent, Enabled: item.Enabled && (!face || *faceConsent), SortOrder: &sortOrder,
		}
		var data []byte
		if item.File != "" {
			path := filepath.Join(baseDir, filepath.FromSlash(item.File))
			if data, err = os.ReadFile(path); err != nil {
				report["failed"]++
				if len(failures) < 50 {
					failures = append(failures, importFailure{Name: item.Name, Error: err.Error()})
				}
				continue
			}
		}
		if *dryRun {
			report["imported"]++
			existing[kind][key] = true
			continue
		}
		if data == nil {
			_, err = svc.ImportStudioModel(actor, input, nil)
		} else {
			_, err = svc.ImportStudioModelImage(actor, input, filepath.Base(item.File), data)
		}
		if err != nil {
			report["failed"]++
			if len(failures) < 50 {
				failures = append(failures, importFailure{Name: item.Name, Error: err.Error()})
			}
			continue
		}
		report["imported"]++
		existing[kind][key] = true
		if (index+1)%100 == 0 {
			fmt.Fprintf(os.Stderr, "%d/%d\n", index+1, len(manifest.Items))
		}
	}
	if err := json.NewEncoder(os.Stdout).Encode(map[string]any{"source": manifest.Source, "dryRun": *dryRun, "report": report, "failures": failures}); err != nil {
		log.Fatal(err)
	}
	if report["failed"] > 0 {
		os.Exit(1)
	}
}
