package commerce

import "infinite-canvas/backend/internal/domainmcp"

const (
	PackIDProductInsight = "commerce.product-insight"
	ToolProductAnalyze   = "commerce.product_analyze"
)

func ProductInsightManifest() domainmcp.PackManifest {
	for _, pack := range domainmcp.BuiltinPacks() {
		if pack.ID == PackIDProductInsight {
			return pack
		}
	}
	return domainmcp.PackManifest{}
}

func productAnalyzeToolManifest() domainmcp.ToolManifest {
	for _, tool := range ProductInsightManifest().Tools {
		if tool.Name == ToolProductAnalyze {
			return tool
		}
	}
	return domainmcp.ToolManifest{}
}
