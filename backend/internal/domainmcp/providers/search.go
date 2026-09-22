package providers

import (
	"context"
	"time"
)

type SearchQuery struct {
	Query           string         `json:"query"`
	Domain          string         `json:"domain,omitempty"`
	SubDomain       string         `json:"subDomain,omitempty"`
	SubDomainParams map[string]any `json:"subDomainParams,omitempty"`
	Limit           int            `json:"limit,omitempty"`
}

type SearchHit struct {
	Title       string    `json:"title"`
	URL         string    `json:"url"`
	Snippet     string    `json:"snippet,omitempty"`
	PublishedAt string    `json:"publishedAt,omitempty"`
	RetrievedAt time.Time `json:"retrievedAt"`
}

type ExtractedPage struct {
	URL         string    `json:"url"`
	Markdown    string    `json:"markdown"`
	RetrievedAt time.Time `json:"retrievedAt"`
}

type SearchProvider interface {
	Search(context.Context, SearchQuery) ([]SearchHit, error)
	Extract(context.Context, string) (ExtractedPage, error)
}
