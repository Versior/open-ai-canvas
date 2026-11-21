package handler

import (
	"encoding/json"
	"net/http"
	"testing"

	"yingce/backend/internal/model"
)

const canvasShareTestSession = "session.test-token"

func TestCanvasShareHTTPFirstSaveAndRevoke(t *testing.T) {
	router, db := newCanvasOperationsHTTPTest(t)
	const canvasPath = "/api/canvas-projects/canvas"
	const sharePath = canvasPath + "/share"
	if err := db.Create(&model.CanvasProject{ID: "other", UserID: "another-owner", PayloadJSON: `{}`}).Error; err != nil {
		t.Fatal(err)
	}
	for _, path := range []string{sharePath, "/api/canvas-projects/other/share"} {
		for _, method := range []string{http.MethodGet, http.MethodPost, http.MethodDelete} {
			body := ""
			if method == http.MethodPost {
				body = `{}`
			}
			result := profileRequest(router, method, path, body, canvasShareTestSession)
			response := decodeFailureEnvelope(t, result)
			if result.Code != http.StatusNotFound || response.Code != http.StatusNotFound || response.Msg != "画布不存在" {
				t.Fatalf("%s %s: missing and foreign canvases must be indistinguishable, got HTTP %d, code %d, msg %q", method, path, result.Code, response.Code, response.Msg)
			}
		}
	}
	const create = `{"mutationId":"first-save","operations":[{"type":"create_canvas","id":"canvas","patch":{"title":"待分享画布"}}]}`
	if result := profileRequest(router, http.MethodPatch, canvasPath+"/operations", create, canvasShareTestSession); result.Code != http.StatusOK {
		t.Fatalf("first cloud save: HTTP %d: %s", result.Code, result.Body.String())
	}
	readShare := func(method, body string, wantEnabled bool) string {
		t.Helper()
		result := profileRequest(router, method, sharePath, body, canvasShareTestSession)
		var response struct {
			Code int `json:"code"`
			Data struct {
				Share struct {
					Enabled *bool  `json:"enabled"`
					Token   string `json:"token"`
				} `json:"share"`
			} `json:"data"`
		}
		if err := json.Unmarshal(result.Body.Bytes(), &response); err != nil {
			t.Fatal(err)
		}
		share := response.Data.Share
		if result.Code != http.StatusOK || response.Code != 0 || share.Enabled == nil || *share.Enabled != wantEnabled || (share.Token != "") != wantEnabled {
			t.Fatalf("%s share: want enabled=%t and matching token presence, got HTTP %d, code %d", method, wantEnabled, result.Code, response.Code)
		}
		return share.Token
	}
	readShare(http.MethodGet, "", false)
	token := readShare(http.MethodPost, `{}`, true)
	if readShare(http.MethodGet, "", true) != token {
		t.Fatal("reading share status changed the token")
	}
	publicPath := "/api/public/canvas-shares/" + token
	result := profileRequest(router, http.MethodGet, publicPath, "", "")
	var public struct {
		Data struct {
			Project struct {
				Title string `json:"title"`
			} `json:"project"`
		} `json:"data"`
	}
	if err := json.Unmarshal(result.Body.Bytes(), &public); err != nil {
		t.Fatal(err)
	}
	if result.Code != http.StatusOK || public.Data.Project.Title != "待分享画布" {
		t.Fatalf("guest could not read saved canvas: HTTP %d", result.Code)
	}
	if result := profileRequest(router, http.MethodDelete, sharePath, "", canvasShareTestSession); result.Code != http.StatusOK {
		t.Fatalf("revoke: HTTP %d", result.Code)
	}
	readShare(http.MethodGet, "", false)
	if result := profileRequest(router, http.MethodGet, publicPath, "", ""); result.Code != http.StatusNotFound {
		t.Fatalf("revoked link: HTTP %d", result.Code)
	}
}

func TestCanvasShareStatusHTTPInternalFailures(t *testing.T) {
	router, db := newCanvasOperationsHTTPTest(t)
	const endpoint = "/api/canvas-projects/canvas/share"
	if err := db.Create(&model.CanvasProject{ID: "canvas", UserID: "user", PayloadJSON: `{}`}).Error; err != nil {
		t.Fatal(err)
	}
	if result := profileRequest(router, http.MethodPost, endpoint, `{}`, canvasShareTestSession); result.Code != http.StatusOK {
		t.Fatalf("could not create fixture share: HTTP %d", result.Code)
	}
	assertInternal := func(t *testing.T) {
		t.Helper()
		result := profileRequest(router, http.MethodGet, endpoint, "", canvasShareTestSession)
		response := decodeFailureEnvelope(t, result)
		if result.Code != http.StatusInternalServerError || response.Code != http.StatusInternalServerError || response.Msg != internalErrorMessage {
			t.Fatalf("private share error must be a generic 500, got HTTP %d, code %d, msg %q", result.Code, response.Code, response.Msg)
		}
	}
	t.Run("unreadable share token", func(t *testing.T) {
		if err := db.Exec("UPDATE canvas_shares SET token_cipher = token_cipher || '!' WHERE project_id = ?", "canvas").Error; err != nil {
			t.Fatal(err)
		}
		assertInternal(t)
	})
	t.Run("share storage unavailable", func(t *testing.T) {
		if err := db.Migrator().DropTable(&model.CanvasShare{}); err != nil {
			t.Fatal(err)
		}
		assertInternal(t)
	})
}
