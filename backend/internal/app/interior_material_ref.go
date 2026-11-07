package app

import (
	"encoding/json"

	"yingce/backend/internal/interior"
)

func (s *Service) validateInteriorMaterialRef(userID, document string) error {
	var doc struct {
		Professional *interior.RenovationSpec `json:"professional"`
		Rounds       []struct {
			Professional *interior.RenovationSpec `json:"professional"`
		} `json:"rounds"`
	}
	if err := json.Unmarshal([]byte(document), &doc); err != nil {
		return BadAuthRequest("装修方案格式无效")
	}
	specs := []*interior.RenovationSpec{doc.Professional}
	for _, round := range doc.Rounds {
		specs = append(specs, round.Professional)
	}
	seen := map[string]bool{}
	for _, spec := range specs {
		if spec == nil || spec.Texture == nil || seen[spec.Texture.ResourceID] {
			continue
		}
		if _, err := s.interiorReferenceImages(userID, nil, spec.Texture.ResourceID, nil); err != nil {
			return BadAuthRequest("石材照片不存在、尚未就绪或不属于当前用户")
		}
		seen[spec.Texture.ResourceID] = true
	}
	return nil
}
