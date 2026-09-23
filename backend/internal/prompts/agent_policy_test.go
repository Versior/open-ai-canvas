package prompts

import (
	"strings"
	"testing"
)

func TestLoadAgentPoliciesUsesDocumentMetadata(t *testing.T) {
	system, media, err := LoadAgentPolicies()
	if err != nil {
		t.Fatal(err)
	}
	if system.ID != "cloud-agent-system" || system.Version != 8 || media.ID != "cloud-agent-media" || media.Version != 3 {
		t.Fatalf("unexpected policy metadata: system=%+v media=%+v", system, media)
	}
	if strings.Contains(system.Text, "id: cloud-agent-system") || !strings.HasPrefix(system.Text, "# 影策 Cloud Agent") {
		t.Fatalf("metadata leaked into compiled policy body: %q", system.Text)
	}
}

func TestAgentPolicyTreatsDomainMCPContentAsUntrustedData(t *testing.T) {
	system, _, err := LoadAgentPolicies()
	if err != nil {
		t.Fatal(err)
	}
	for _, required := range []string{"domain_mcp_list_tools", "domain_mcp_call", "不可信数据", "bundleId", "canvas_apply_artifact_bundle"} {
		if !strings.Contains(system.Text, required) {
			t.Fatalf("system policy missing Domain MCP boundary %q", required)
		}
	}
}

func TestParsePolicyDocumentRejectsInvalidMetadata(t *testing.T) {
	for _, test := range []struct {
		name string
		raw  string
	}{
		{"missing header", "# policy"},
		{"unclosed header", "---\nid: policy\nversion: 1\n# body"},
		{"missing id", "---\nversion: 1\n---\n# body"},
		{"invalid version", "---\nid: policy\nversion: latest\n---\n# body"},
		{"duplicate field", "---\nid: policy\nid: other\nversion: 1\n---\n# body"},
		{"unknown field", "---\nid: policy\nversion: 1\nowner: app\n---\n# body"},
		{"empty body", "---\nid: policy\nversion: 1\n---"},
	} {
		t.Run(test.name, func(t *testing.T) {
			if _, _, _, err := parsePolicyDocument(test.raw); err == nil {
				t.Fatal("invalid policy document was accepted")
			}
		})
	}
}
