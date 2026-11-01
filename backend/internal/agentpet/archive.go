package agentpet

import (
	"archive/zip"
	"bytes"
	"encoding/json"
	"io"
	"path"
	"strings"
	"unicode"

	"yingce/backend/internal/kernel"
)

const (
	MaxPackageBytes     int64 = 32 << 20
	maxPackageEntries         = 64
	maxManifestBytes          = 64 << 10
	MaxNameRunes              = 40
	MaxDescriptionRunes       = 200
)

// Package 是从上传文件里取出的形象：名称和简介来自 pet.json，其余字段一律忽略。
type Package struct {
	Name        string
	Description string
	Sheet       Sheet
	Data        []byte
}

type petManifest struct {
	DisplayName         string `json:"displayName"`
	Description         string `json:"description"`
	SpritesheetPath     string `json:"spritesheetPath"`
	SpriteVersionNumber *int   `json:"spriteVersionNumber"`
}

// ReadUpload 接收 Codex 宠物 ZIP（pet.json + 图集），或直接上传的 WebP / PNG 图集。
func ReadUpload(data []byte, fileName string) (Package, error) {
	if int64(len(data)) > MaxPackageBytes {
		return Package{}, kernel.BadAuthRequest("形象文件不能超过 32 MiB")
	}
	if len(data) >= 4 && string(data[:4]) == "PK\x03\x04" {
		return readPackage(data)
	}
	sheet, err := InspectSheet(data)
	if err != nil {
		return Package{}, err
	}
	base := path.Base(strings.ReplaceAll(fileName, "\\", "/"))
	return Package{Name: CleanText(strings.TrimSuffix(base, path.Ext(base)), MaxNameRunes), Sheet: sheet, Data: data}, nil
}

// readPackage 中 pet.json 可以在根目录或唯一一级文件夹里，图集路径相对 pet.json。
func readPackage(data []byte) (Package, error) {
	archive, err := zip.NewReader(bytes.NewReader(data), int64(len(data)))
	if err != nil {
		return Package{}, kernel.BadAuthRequest("ZIP 文件无法读取")
	}
	if len(archive.File) > maxPackageEntries {
		return Package{}, kernel.BadAuthRequest("ZIP 文件条目过多")
	}
	files := make(map[string]*zip.File, len(archive.File))
	manifestPath := ""
	for _, file := range archive.File {
		name := file.Name
		if file.FileInfo().IsDir() || ignoredPackageEntry(name) {
			continue
		}
		if !file.Mode().IsRegular() || !validPackagePath(name) {
			return Package{}, kernel.BadAuthRequest("ZIP 中包含不安全的路径或文件类型")
		}
		files[name] = file
		if path.Base(name) != "pet.json" {
			continue
		}
		if manifestPath != "" {
			return Package{}, kernel.BadAuthRequest("ZIP 中只能有一个 pet.json")
		}
		manifestPath = name
	}
	if manifestPath == "" || strings.Count(manifestPath, "/") > 1 {
		return Package{}, kernel.BadAuthRequest("ZIP 根目录或一级文件夹中需要 pet.json")
	}
	raw, err := readPackageEntry(files[manifestPath], maxManifestBytes)
	if err != nil {
		return Package{}, err
	}
	var manifest petManifest
	if err := json.Unmarshal(raw, &manifest); err != nil {
		return Package{}, kernel.BadAuthRequest("pet.json 格式无效")
	}
	sheetFile, err := packageSheetFile(files, path.Dir(manifestPath), strings.TrimSpace(manifest.SpritesheetPath))
	if err != nil {
		return Package{}, err
	}
	sheetData, err := readPackageEntry(sheetFile, MaxSheetBytes)
	if err != nil {
		return Package{}, err
	}
	sheet, err := InspectSheet(sheetData)
	if err != nil {
		return Package{}, err
	}
	if manifest.SpriteVersionNumber != nil && *manifest.SpriteVersionNumber != sheet.Version {
		return Package{}, kernel.BadAuthRequest("pet.json 声明的版本与图集尺寸不一致，仅支持 v1 / v2 布局")
	}
	return Package{Name: CleanText(manifest.DisplayName, MaxNameRunes), Description: CleanText(manifest.Description, MaxDescriptionRunes), Sheet: sheet, Data: sheetData}, nil
}

func packageSheetFile(files map[string]*zip.File, dir string, declared string) (*zip.File, error) {
	candidates := []string{declared}
	if declared == "" {
		candidates = []string{"spritesheet.webp", "spritesheet.png"}
	} else if !validPackagePath(declared) {
		return nil, kernel.BadAuthRequest("pet.json 中的图集路径不安全")
	}
	for _, candidate := range candidates {
		if file := files[path.Join(dir, candidate)]; file != nil {
			return file, nil
		}
	}
	return nil, kernel.BadAuthRequest("ZIP 中找不到 pet.json 指定的图集")
}

func readPackageEntry(file *zip.File, max int64) ([]byte, error) {
	if file.UncompressedSize64 > uint64(max) {
		return nil, kernel.BadAuthRequest("ZIP 中的文件过大")
	}
	reader, err := file.Open()
	if err != nil {
		return nil, kernel.BadAuthRequest("ZIP 中的文件无法读取")
	}
	defer reader.Close()
	data, err := io.ReadAll(io.LimitReader(reader, max+1))
	if err != nil || int64(len(data)) > max || uint64(len(data)) != file.UncompressedSize64 {
		return nil, kernel.BadAuthRequest("ZIP 中的文件已损坏")
	}
	return data, nil
}

func validPackagePath(name string) bool {
	if name == "" || len(name) > 200 || path.Clean(name) != name || path.IsAbs(name) || name == ".." || strings.HasPrefix(name, "../") || strings.ContainsAny(name, "\\:") {
		return false
	}
	return !strings.ContainsFunc(name, unicode.IsControl)
}

func ignoredPackageEntry(name string) bool {
	base := path.Base(name)
	return strings.HasPrefix(name, "__MACOSX/") || base == ".DS_Store" || strings.HasPrefix(base, "._")
}

// CleanText 去掉控制字符并压缩空白，按字符数截断。
func CleanText(value string, maxRunes int) string {
	value = strings.Join(strings.FieldsFunc(value, func(r rune) bool { return unicode.IsSpace(r) || unicode.IsControl(r) }), " ")
	runes := []rune(value)
	if len(runes) > maxRunes {
		runes = runes[:maxRunes]
	}
	return strings.TrimSpace(string(runes))
}
