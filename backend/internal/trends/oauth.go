package trends

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strconv"
	"strings"
	"time"
)

// OAuthToken follows the official ad_open_sdk_go token contracts. Secrets only
// cross the fixed HTTPS token endpoint in a POST body, never a redirect or URL.
type OAuthToken struct {
	AccessToken      string  `json:"access_token"`
	RefreshToken     string  `json:"refresh_token"`
	ExpiresIn        int64   `json:"expires_in"`
	RefreshExpiresIn int64   `json:"refresh_token_expires_in"`
	AdvertiserIDs    []int64 `json:"advertiser_ids"`
}

func ExchangeOAuth(ctx context.Context, appID, secret, code string, client *http.Client) (OAuthToken, error) {
	return fetchOAuthToken(ctx, "access_token", appID, secret, "auth_code", code, client)
}
func RefreshOAuth(ctx context.Context, appID, secret, refresh string, client *http.Client) (OAuthToken, error) {
	return fetchOAuthToken(ctx, "refresh_token", appID, secret, "refresh_token", refresh, client)
}
func fetchOAuthToken(ctx context.Context, endpoint, appID, secret, field, credential string, client *http.Client) (OAuthToken, error) {
	id, err := strconv.ParseInt(appID, 10, 64)
	if err != nil || id <= 0 || secret == "" || len(secret) > 4096 || credential == "" || len(credential) > 4096 || strings.ContainsAny(secret+credential, "\x00\r\n") {
		return OAuthToken{}, fmt.Errorf("授权应用或凭据无效")
	}
	body, _ := json.Marshal(map[string]any{"app_id": id, "secret": secret, field: credential})
	req, _ := http.NewRequestWithContext(ctx, http.MethodPost, "https://api.oceanengine.com/open_api/oauth2/"+endpoint+"/", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	secured := *client
	secured.CheckRedirect = func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse }
	res, err := secured.Do(req)
	if err != nil {
		return OAuthToken{}, fmt.Errorf("平台授权接口暂时无法连接")
	}
	defer res.Body.Close()
	if res.StatusCode != http.StatusOK {
		return OAuthToken{}, fmt.Errorf("平台授权接口返回HTTP %d", res.StatusCode)
	}
	raw, err := io.ReadAll(io.LimitReader(res.Body, (512<<10)+1))
	var result struct {
		Code *int        `json:"code"`
		Data *OAuthToken `json:"data"`
	}
	if err != nil || len(raw) > 512<<10 || json.Unmarshal(raw, &result) != nil || result.Code == nil {
		return OAuthToken{}, fmt.Errorf("平台授权响应格式无效")
	}
	if *result.Code != 0 {
		return OAuthToken{}, fmt.Errorf("平台拒绝授权（错误码%d），请检查应用权限或重新授权", *result.Code)
	}
	token := result.Data
	const maxLife = int64(10 * 365 * 24 * time.Hour / time.Second)
	if token == nil || token.AccessToken == "" || token.RefreshToken == "" || len(token.AccessToken) > 4096 || len(token.RefreshToken) > 4096 || strings.ContainsAny(token.AccessToken+token.RefreshToken, "\x00\r\n") || token.ExpiresIn <= 0 || token.ExpiresIn > maxLife || token.RefreshExpiresIn <= 0 || token.RefreshExpiresIn > maxLife || len(token.AdvertiserIDs) > 1000 {
		return OAuthToken{}, fmt.Errorf("平台没有返回完整有效的授权令牌")
	}
	for _, id := range token.AdvertiserIDs {
		if id <= 0 {
			return OAuthToken{}, fmt.Errorf("平台授权账户无效")
		}
	}
	return *token, nil
}
