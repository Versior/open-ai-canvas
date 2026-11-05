package app

import (
	"context"
	"encoding/json"
	"fmt"
	"slices"
	"sort"
	"strings"
	"unicode/utf8"
)

// 模特库的内置来源：ai-pose-gallery-zh（https://github.com/anhao/ai-pose-gallery-zh），固定在一个提交上。
// 它的 LICENSE 只覆盖代码；img/、thumbs/、data/ 里的图片和数据归原作者ギア（@giaaibusi），标注非商用，
// 拉取前须取得权利人授权。取舍只留大众向的部分，18+ 分组一律不取：
//
//	姿势      全身单人・标准系（全部）+ 上半身单人 / 可爱系
//	模特人脸  人像库 / 正脸参考
//	模特样式  服装库里除内衣・睡衣、性感穿搭以外的
//
// 名称与分类决定去重键（类型 + 分类 + 名称），改规则会让已经导入的条目对不上，改之前先想清楚。
const (
	poseGalleryRevision = "488939139c69acfe078372b39d4bd0c457dc060e"
	poseGalleryRaw      = "https://raw.githubusercontent.com/anhao/ai-pose-gallery-zh/" + poseGalleryRevision + "/"
	poseGallerySource   = "ai-pose-gallery-zh@4889391（图片著作权归原作者ギア，非商用；导入方须取得授权）"
)

var (
	studioModelSources = []StudioModelSource{{
		ID:          "ai-pose-gallery-zh",
		Name:        "ai-pose-gallery-zh（固定提交 4889391）",
		Description: "姿势取全身单人・标准系和上半身单人 / 可爱系，人脸取人像库 / 正脸参考，模特样式取服装库里除内衣・睡衣、性感穿搭以外的，18+ 分组都不取。共约 2451 条、350 MB，从 GitHub 下载。",
		Notice:      "图片和数据的著作权归原作者ギア（@giaaibusi），标注非商用；拉取前须取得权利人授权。",
	}}
	poseGalleryAngles      = []string{"正面", "斜侧", "侧面", "俯视", "仰视"}
	poseGalleryHairLengths = []string{"短发", "中发", "中长发", "长发"}
	poseGalleryNoCostumes  = map[string]bool{"内衣・睡衣": true, "性感穿搭": true}
)

type poseGalleryPose struct {
	System   string `json:"体系"`
	Number   string `json:"姿势编号"`
	Category string `json:"分类"`
	Name     string `json:"姿势名称"`
	Angle    string `json:"角度"`
	Image    string `json:"原图"`
}

type poseGalleryPortrait struct {
	Zone       string `json:"分区"`
	HairLength string `json:"发长"`
	Hairstyle  string `json:"发型名称"`
	Title      string `json:"标题"`
	Featured   bool   `json:"精选"`
	Hot        bool   `json:"热门"`
	Image      string `json:"原图"`
}

type poseGalleryCostume struct {
	Category string   `json:"分类"`
	Name     string   `json:"服装名称"`
	Tags     []string `json:"标签"`
	Keywords string   `json:"关键词"`
	Image    string   `json:"原图"`
}

func poseGalleryManifest(ctx context.Context) (StudioModelManifest, error) {
	blobs := make([][]byte, 3)
	for index, name := range []string{"pose-zh.json", "portrait-zh.json", "costume-zh.json"} {
		data, err := DownloadStudioModelFile(ctx, poseGalleryRaw+"data/"+name, studioModelSourceDataBytes)
		if err != nil {
			return StudioModelManifest{}, fmt.Errorf("来源数据 %s 读取失败：%w", name, err)
		}
		blobs[index] = data
	}
	items, err := PoseGalleryItems(blobs[0], blobs[1], blobs[2])
	if err != nil {
		return StudioModelManifest{}, err
	}
	return StudioModelManifest{Source: poseGallerySource, Items: items}, nil
}

// numberDuplicates 给重复出现的显示名按出现顺序加「 01」「 02」，只出现一次的保持原样。
func numberDuplicates(labels []string) []string {
	total := map[string]int{}
	for _, label := range labels {
		total[label]++
	}
	seen := map[string]int{}
	names := make([]string, len(labels))
	for index, label := range labels {
		seen[label]++
		names[index] = label
		if total[label] > 1 {
			names[index] = fmt.Sprintf("%s %02d", label, seen[label])
		}
	}
	return names
}

func poseGalleryItem(kind, name, category, gender string, tags []string, prompt, image string, sortOrder int) StudioModelManifestItem {
	return StudioModelManifestItem{Kind: kind, Name: name, Category: category, Gender: gender, Tags: tags, Prompt: prompt, URL: poseGalleryRaw + image, File: image, Enabled: true, SortOrder: sortOrder}
}

// PoseGalleryItems 按取舍规则把来源的三份数据转成清单条目，顺序、名称和排序值与最初导入时一致。
func PoseGalleryItems(poseData, portraitData, costumeData []byte) ([]StudioModelManifestItem, error) {
	var poses []poseGalleryPose
	var portraits []poseGalleryPortrait
	var costumes []poseGalleryCostume
	for _, part := range []struct {
		data   []byte
		target any
		name   string
	}{{poseData, &poses, "姿势"}, {portraitData, &portraits, "人像"}, {costumeData, &costumes, "服装"}} {
		if err := json.Unmarshal(part.data, part.target); err != nil {
			return nil, fmt.Errorf("来源%s数据格式不对：%w", part.name, err)
		}
	}
	items := []StudioModelManifestItem{}

	standard, upper := []poseGalleryPose{}, []poseGalleryPose{}
	categories := []string{}
	for _, pose := range poses {
		switch {
		case pose.System == "全身单人・标准系":
			standard = append(standard, pose)
			if !slices.Contains(categories, pose.Category) {
				categories = append(categories, pose.Category)
			}
		case pose.System == "上半身单人" && pose.Category == "可爱系":
			upper = append(upper, pose)
		}
	}
	for _, pose := range append(append([]poseGalleryPose{}, standard...), upper...) {
		if !slices.Contains(poseGalleryAngles, pose.Angle) {
			return nil, fmt.Errorf("来源姿势「%s」的角度「%s」不认识", pose.Name, pose.Angle)
		}
	}
	byNumberAngle := func(list []poseGalleryPose, category bool) {
		sort.SliceStable(list, func(i, j int) bool {
			a, b := list[i], list[j]
			if category && a.Category != b.Category {
				return slices.Index(categories, a.Category) < slices.Index(categories, b.Category)
			}
			if a.Number != b.Number {
				return a.Number < b.Number
			}
			return slices.Index(poseGalleryAngles, a.Angle) < slices.Index(poseGalleryAngles, b.Angle)
		})
	}
	byNumberAngle(standard, true)
	byNumberAngle(upper, false)
	for index, pose := range append(standard, upper...) {
		whole := pose.System == "全身单人・标准系"
		category, scope, body := "半身・可爱", "半身", "上半身"
		if whole {
			category, scope, body = pose.Category, "全身", "全身"
		}
		items = append(items, poseGalleryItem("pose", pose.Name+" · "+pose.Angle, category, "", []string{scope, pose.Angle}, body+"姿势："+pose.Name+"，"+pose.Angle+"视角", pose.Image, 1000+index))
	}

	front := []poseGalleryPortrait{}
	for _, portrait := range portraits {
		if portrait.Zone != "正脸参考" {
			continue
		}
		if !slices.Contains(poseGalleryHairLengths, portrait.HairLength) {
			return nil, fmt.Errorf("来源人像「%s」的发长「%s」不认识", portrait.Title, portrait.HairLength)
		}
		front = append(front, portrait)
	}
	sort.SliceStable(front, func(i, j int) bool {
		a, b := !(front[i].Featured || front[i].Hot), !(front[j].Featured || front[j].Hot)
		if a != b {
			return !a
		}
		return slices.Index(poseGalleryHairLengths, front[i].HairLength) < slices.Index(poseGalleryHairLengths, front[j].HairLength)
	})
	titles := make([]string, len(front))
	for index, portrait := range front {
		titles[index] = portrait.Title
	}
	for index, name := range numberDuplicates(titles) {
		face := front[index]
		tags := []string{face.HairLength, "正脸"}
		if face.Featured {
			tags = append(tags, "精选")
		}
		if face.Hot {
			tags = append(tags, "热门")
		}
		if utf8.RuneCountInString(face.Hairstyle) <= 16 {
			tags = append(tags, face.Hairstyle)
		}
		items = append(items, poseGalleryItem("face", name, face.HairLength, "female", tags, face.HairLength+"，发型："+face.Hairstyle, face.Image, 1000+index))
	}

	wearable := []poseGalleryCostume{}
	for _, costume := range costumes {
		if !poseGalleryNoCostumes[costume.Category] {
			wearable = append(wearable, costume)
		}
	}
	names := make([]string, len(wearable))
	for index, costume := range wearable {
		names[index] = costume.Name
	}
	for index, name := range numberDuplicates(names) {
		costume := wearable[index]
		tags := costume.Tags
		if len(tags) > 12 {
			tags = tags[:12]
		}
		if tags == nil {
			tags = []string{}
		}
		items = append(items, poseGalleryItem("style", name, costume.Category, "female", tags, "穿搭："+strings.ReplaceAll(costume.Name, "・", "、")+"。英文关键词："+costume.Keywords, costume.Image, 1000+index))
	}
	return items, nil
}
