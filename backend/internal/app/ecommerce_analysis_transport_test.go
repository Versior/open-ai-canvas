package app

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

// Exercise the worker boundary, including private instructions, protocol admission
// and media hydration. A protocol-only test cannot catch pre-submission rejection.
func TestEcommerceAnalysisWorkerReachesUpstream(t *testing.T) {
	t.Setenv("CANVAS_ALLOWED_PRIVATE_UPSTREAM_HOSTS", "127.0.0.1")
	for _, flow := range []string{"cap:planning", "detail"} {
		for _, route := range []struct{ name, protocol, format string }{
			{"gemini-3.8-flash-high", "newapi-chat", "openai"},
			{"deepseek-v4.1-flash", "newapi-chat", "openai"},
			{"qwen3.7-flash", "newapi-chat", "openai"},
			{"gemini-native", "gemini-generate-content", "gemini"},
		} {
			t.Run(flow+"/"+route.name, func(t *testing.T) {
				s, _, _, admin := newAdminStorageDeleteTestService(t)
				received := make(chan map[string]any, 1)
				server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
					var body map[string]any
					if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
						t.Error(err)
						w.WriteHeader(http.StatusBadRequest)
						return
					}
					received <- body
					w.Header().Set("Content-Type", "application/json")
					if route.format == "gemini" {
						if r.URL.Path != "/v1beta/models/gemini-native:generateContent" || r.Header.Get("x-goog-api-key") != "test-only" {
							t.Error("native Gemini path or authentication changed")
						}
						_, _ = w.Write([]byte(`{"candidates":[{"content":{"parts":[{"text":"planned successfully"}]}}]}`))
					} else {
						if r.URL.Path != "/v1/chat/completions" || body["model"] != route.name || r.Header.Get("Authorization") != "Bearer test-only" {
							t.Error("chat route, model or authentication changed")
						}
						_, _ = w.Write([]byte(`{"choices":[{"message":{"content":"planned successfully"}}]}`))
					}
				}))
				defer server.Close()
				stream := false
				input := canvasGenerationInput{
					Mode: "text", Prompt: "verified product facts",
					Config:          providerConfig{BaseURL: server.URL, APIKey: "test-only", Model: route.name, InterfaceType: route.protocol, APIFormat: route.format},
					ReferenceImages: []providerMedia{{DataURL: testGeminiReferenceImageDataURL}},
					Metadata:        map[string]any{"ecommerceAnalysisFlow": flow},
				}
				input.TextOptions.Stream = &stream
				if flow == "cap:planning" {
					input.Metadata["ecommerceCapability"] = "planning"
				}
				raw, err := json.Marshal(input)
				if err != nil {
					t.Fatal(err)
				}
				result, err := s.processCanvasGenerationTask(context.Background(), admin.ID, "", "canvas_text", "", string(raw))
				if err != nil {
					t.Fatalf("analysis stopped before completing upstream call: %v", err)
				}
				if result["text"] != "planned successfully" {
					t.Fatalf("analysis result = %#v", result)
				}
				select {
				case body := <-received:
					encoded, _ := json.Marshal(body)
					if !strings.Contains(string(encoded), "verified product facts") || !strings.Contains(string(encoded), "iVBORw0KGgo") {
						t.Fatal("upstream did not receive product prompt and image pixels")
					}
					if route.format == "gemini" {
						if body["systemInstruction"] == nil || !strings.Contains(string(encoded), "inlineData") {
							t.Fatal("Gemini lost private instruction or image structure")
						}
					} else if !strings.Contains(string(encoded), `"role":"system"`) {
						t.Fatal("chat request lost private instructions")
					}
				default:
					t.Fatal("mock upstream received no request")
				}
			})
		}
	}
}
