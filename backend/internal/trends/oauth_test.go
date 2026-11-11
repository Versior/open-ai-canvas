package trends

import (
	"context"
	"encoding/json"
	"io"
	"net/http"
	"strings"
	"testing"
)

type oauthTransport func(*http.Request) (*http.Response, error)

func (f oauthTransport) RoundTrip(r *http.Request) (*http.Response, error) { return f(r) }

func TestOAuthTokenOfficialContractAndNoSecretURL(t *testing.T) {
	for _, kind := range []string{"access_token", "refresh_token"} {
		client := &http.Client{Transport: oauthTransport(func(req *http.Request) (*http.Response, error) {
			if req.Method != http.MethodPost || req.URL.String() != "https://api.oceanengine.com/open_api/oauth2/"+kind+"/" {
				t.Fatal("invalid OAuth endpoint")
			}
			var body map[string]any
			if json.NewDecoder(req.Body).Decode(&body) != nil || body["app_id"] != float64(123) || body["secret"] != "EXAMPLE_APP_SECRET" || len(body) != 3 {
				t.Fatal("invalid OAuth body")
			}
			field := "auth_code"
			if kind == "refresh_token" {
				field = "refresh_token"
			}
			if body[field] != "EXAMPLE_CREDENTIAL" {
				t.Fatal("missing OAuth credential")
			}
			return &http.Response{StatusCode: 200, Body: io.NopCloser(strings.NewReader(`{"code":0,"data":{"access_token":"EXAMPLE_ACCESS","refresh_token":"EXAMPLE_REFRESH","expires_in":7200,"refresh_token_expires_in":2592000,"advertiser_ids":[456]}}`))}, nil
		})}
		var token OAuthToken
		var err error
		if kind == "access_token" {
			token, err = ExchangeOAuth(context.Background(), "123", "EXAMPLE_APP_SECRET", "EXAMPLE_CREDENTIAL", client)
		} else {
			token, err = RefreshOAuth(context.Background(), "123", "EXAMPLE_APP_SECRET", "EXAMPLE_CREDENTIAL", client)
		}
		if err != nil || token.ExpiresIn != 7200 || len(token.AdvertiserIDs) != 1 {
			t.Fatal("OAuth token contract rejected")
		}
	}
}
func TestOAuthDenialMalformedAndRedirectNeverLeakCredentials(t *testing.T) {
	for _, raw := range []string{`{"code":401,"message":"EXAMPLE_APP_SECRET"}`, `{"code":0,"data":{"access_token":"EXAMPLE_ACCESS"}}`, `{"data":{}}`} {
		client := &http.Client{Transport: oauthTransport(func(*http.Request) (*http.Response, error) {
			return &http.Response{StatusCode: 200, Body: io.NopCloser(strings.NewReader(raw))}, nil
		})}
		_, err := ExchangeOAuth(context.Background(), "123", "EXAMPLE_APP_SECRET", "EXAMPLE_CREDENTIAL", client)
		if err == nil || strings.Contains(err.Error(), "EXAMPLE_") {
			t.Fatal("invalid OAuth response accepted or leaked")
		}
	}
	requests := 0
	client := &http.Client{Transport: oauthTransport(func(req *http.Request) (*http.Response, error) {
		requests++
		return &http.Response{StatusCode: 302, Header: http.Header{"Location": []string{"https://evil.example/"}}, Body: io.NopCloser(strings.NewReader("")), Request: req}, nil
	})}
	if _, err := ExchangeOAuth(context.Background(), "123", "EXAMPLE_APP_SECRET", "EXAMPLE_CREDENTIAL", client); err == nil || requests != 1 {
		t.Fatal("OAuth credentials followed redirect")
	}
}
