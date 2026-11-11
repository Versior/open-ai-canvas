package ecommerceagent

import (
	_ "embed"
	"encoding/json"
)

// StudioDesignCatalog is shared with the studio's TypeScript planner and controls.
// It contains original design methods; marketplace hard rules stay separate.
type StudioDesignCatalog struct {
	Version      string `json:"version"`
	Provenance   string `json:"provenance"`
	PosterDesign struct {
		Principles string `json:"principles"`
		Hero       string `json:"hero"`
		Editorial  string `json:"editorial"`
	} `json:"posterDesign"`
	Compositions map[string]struct {
		Label  string          `json:"label"`
		Render string          `json:"render"`
		Zone   json.RawMessage `json:"zone"`
	} `json:"compositions"`
	Layouts map[string]struct {
		Label  string `json:"label"`
		Use    string `json:"use"`
		Render string `json:"render"`
		Lines  string `json:"lines"`
	} `json:"layouts"`
	Platforms map[string]string `json:"platforms"`
}

//go:embed studio_design_catalog.json
var studioDesignCatalogJSON []byte

func ReadStudioDesignCatalog() (StudioDesignCatalog, error) {
	var catalog StudioDesignCatalog
	err := json.Unmarshal(studioDesignCatalogJSON, &catalog)
	return catalog, err
}
