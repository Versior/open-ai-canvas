package domainmcp

import (
	"errors"
	"strings"
	"testing"
	"time"
)

func TestValidateResultRequiresEvidenceForExternalFindings(t *testing.T) {
	result := Result{
		Summary: "公开市场信号",
		Findings: []Finding{{
			Title:      "搜索讨论增长",
			Detail:     "近期公开页面中出现频率上升",
			Confidence: 0.8,
			External:   true,
		}},
	}

	if err := ValidateResult(result); !errors.Is(err, ErrNoEvidence) {
		t.Fatalf("ValidateResult() error = %v, want ErrNoEvidence", err)
	}
}

func TestValidateResultAcceptsReferencedEvidenceAndKnownArtifact(t *testing.T) {
	now := time.Date(2026, 9, 22, 8, 0, 0, 0, time.UTC)
	result := Result{
		Summary: "已找到可追溯的公开市场信号",
		Findings: []Finding{{
			Title:       "用户关注轻薄",
			Detail:      "多个公开页面把轻薄作为核心体验描述",
			Confidence:  0.82,
			External:    true,
			EvidenceIDs: []string{"source-1"},
		}},
		Artifacts: []Artifact{{
			Type:    ArtifactCommerceProductReport,
			Title:   "商品洞察报告",
			Content: map[string]any{"productFacts": []string{"UPF50+"}},
		}},
		Sources: []Evidence{{
			ID:          "source-1",
			Title:       "公开商品页面",
			URL:         "https://example.com/products/sun-shirt",
			RetrievedAt: now,
		}},
		Warnings:    []string{"结果来自公网检索，不等同于平台官方热榜"},
		NextActions: []string{"核对商品检测报告"},
	}

	if err := ValidateResult(result); err != nil {
		t.Fatalf("ValidateResult() error = %v", err)
	}
}

func TestValidateResultRejectsUnknownEvidenceAndArtifactType(t *testing.T) {
	now := time.Now().UTC()
	tests := []struct {
		name   string
		result Result
	}{
		{
			name: "unknown evidence",
			result: Result{
				Summary:  "summary",
				Findings: []Finding{{Title: "finding", Detail: "detail", Confidence: 0.5, EvidenceIDs: []string{"missing"}}},
				Sources:  []Evidence{{ID: "source-1", Title: "source", URL: "https://example.com", RetrievedAt: now}},
			},
		},
		{
			name: "unknown artifact",
			result: Result{
				Summary:   "summary",
				Artifacts: []Artifact{{Type: "canvas.executable", Title: "unsafe", Content: map[string]any{"command": "run"}}},
			},
		},
		{
			name: "insecure source URL",
			result: Result{
				Summary: "summary",
				Sources: []Evidence{{ID: "source-1", Title: "source", URL: "http://example.com", RetrievedAt: now}},
			},
		},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			if err := ValidateResult(test.result); !errors.Is(err, ErrOutputInvalid) {
				t.Fatalf("ValidateResult() error = %v, want ErrOutputInvalid", err)
			}
		})
	}
}

func TestValidateResultBoundsCollectionsAndSerializedSize(t *testing.T) {
	tooManyFindings := make([]Finding, 101)
	for index := range tooManyFindings {
		tooManyFindings[index] = Finding{Title: "finding", Detail: "detail", Confidence: 0.5}
	}
	if err := ValidateResult(Result{Summary: "summary", Findings: tooManyFindings}); !errors.Is(err, ErrOutputInvalid) {
		t.Fatalf("collection limit error = %v", err)
	}

	large := strings.Repeat("x", 520<<10)
	if err := ValidateResult(Result{Summary: "summary", Warnings: []string{large}}); !errors.Is(err, ErrOutputInvalid) {
		t.Fatalf("serialized size error = %v", err)
	}
}

func TestDomainErrorMatchesByStableCodeWithoutLeakingCause(t *testing.T) {
	err := NewError(ErrorUpstreamAuth, "上游认证失败", errors.New("Bearer private-secret"))
	if !errors.Is(err, ErrUpstreamAuth) {
		t.Fatalf("errors.Is(%v, ErrUpstreamAuth) = false", err)
	}
	if strings.Contains(err.Error(), "private-secret") {
		t.Fatalf("public error leaked cause: %v", err)
	}
	if !errors.Is(errors.Unwrap(err), errors.New("Bearer private-secret")) && errors.Unwrap(err) == nil {
		t.Fatal("internal cause was not retained for controlled logging")
	}
}
