package main

import (
	"fmt"
	"strings"

	"github.com/gin-gonic/gin"
)

func configureTrustedProxies(router *gin.Engine, value string) error {
	proxies := []string{"127.0.0.1", "::1"}
	if strings.TrimSpace(value) != "" {
		proxies = nil
		for _, item := range strings.Split(value, ",") {
			proxies = append(proxies, strings.TrimSpace(item))
		}
	}
	if err := router.SetTrustedProxies(proxies); err != nil {
		return fmt.Errorf("invalid CANVAS_TRUSTED_PROXIES: %w", err)
	}
	return nil
}
