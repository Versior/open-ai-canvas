package handler

import (
	"encoding/json"
	"net/http"
	"testing"
)

func TestTaskAdmissionErrorStatus(t *testing.T) {
	for _, tc := range []struct {
		name, body, reason string
		drain              bool
		status             int
	}{
		{"maintenance", `{"type":"canvas_image","prompt":"test"}`, "service_unavailable", true, http.StatusServiceUnavailable},
		{"missing type", `{"prompt":"test"}`, "invalid_argument", false, http.StatusBadRequest},
		{"unsupported type", `{"type":"unknown","prompt":"test"}`, "invalid_argument", false, http.StatusBadRequest},
		{"missing prompt", `{"type":"canvas_image"}`, "invalid_argument", false, http.StatusBadRequest},
	} {
		t.Run(tc.name, func(t *testing.T) {
			router, _, cookie := profileHandlerFixture(t)
			RegisterTaskRoutes(router.Group("/api"), runtimeService)
			if tc.drain {
				runtimeService.BeginDrain()
			}
			response := profileRequest(router, http.MethodPost, "/api/tasks", tc.body, cookie)
			var body struct {
				Reason string `json:"reason"`
			}
			if err := json.Unmarshal(response.Body.Bytes(), &body); err != nil {
				t.Fatal(err)
			}
			if response.Code != tc.status || body.Reason != tc.reason {
				t.Fatalf("status=%d reason=%s, want %d %s", response.Code, body.Reason, tc.status, tc.reason)
			}
		})
	}
}
