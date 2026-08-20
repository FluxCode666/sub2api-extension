//go:build ignore

// update_homepage_links 只更新现有 home 动态页的链接元数据和声明属性。
//
// 与 seed_homepage.go 不同，本脚本不会重写官网 HTML；它会保留数据库中
// 管理员已经编辑过的内容，只补齐 data-metadata-href 属性和缺失的元数据键。
// 运行：go run ./scripts/update_homepage_links.go
package main

import (
	"context"
	"fmt"
	"log"
	"os"
	"strings"

	"sub2api-extension/ent"
	"sub2api-extension/ent/page"

	_ "github.com/lib/pq"
)

func homepageEnv(fallback string, keys ...string) string {
	for _, key := range keys {
		if value := strings.TrimSpace(os.Getenv(key)); value != "" {
			return value
		}
	}
	return fallback
}

func main() {
	dsn := fmt.Sprintf(
		"host=%s port=%s user=%s password=%s dbname=%s sslmode=disable",
		homepageEnv("127.0.0.1", "DATABASE_HOST", "SUB2API_EXTENSION_POSTGRES_HOST", "DEV_DATABASE_HOST"),
		homepageEnv("15432", "DATABASE_PORT", "SUB2API_EXTENSION_POSTGRES_HOST_PORT", "DEV_DATABASE_PORT"),
		homepageEnv("sub2api", "DATABASE_USER", "SUB2API_EXTENSION_POSTGRES_USER", "DEV_DATABASE_USER"),
		homepageEnv("123456", "DATABASE_PASSWORD", "SUB2API_EXTENSION_POSTGRES_PASSWORD", "DEV_DATABASE_PASSWORD"),
		homepageEnv("sub2api", "DATABASE_DBNAME", "SUB2API_EXTENSION_POSTGRES_DB", "DEV_DATABASE_DBNAME"),
	)

	client, err := ent.Open("postgres", dsn)
	if err != nil {
		log.Fatalf("打开数据库失败: %v", err)
	}
	defer func() { _ = client.Close() }()

	ctx := context.Background()
	home, err := client.Page.Query().Where(page.SlugEQ("home")).Only(ctx)
	if err != nil {
		log.Fatalf("读取 home 动态页失败: %v", err)
	}

	metadata := make(map[string]interface{}, len(home.Metadata)+5)
	for key, value := range home.Metadata {
		metadata[key] = value
	}
	for key, value := range map[string]string{
		"console_href":       "/admin/dashboard",
		"api_docs_href":      "",
		"usage_guide_href":   "",
		"contact_sales_href": "",
		"terms_href":         "",
	} {
		if _, exists := metadata[key]; !exists {
			metadata[key] = value
		}
	}

	content := home.ContentHTML
	content = ensureMetadataAttribute(content, `data-feature-id="nav-console"`, `data-metadata-href="console_href"`)
	content = ensureMetadataAttribute(content, `data-feature-id="developer-docs"`, `data-metadata-href="api_docs_href"`)
	content = strings.ReplaceAll(content, `<a href="#developers">API 文档</a>`, `<a href="#developers" data-metadata-href="api_docs_href">API 文档</a>`)
	content = strings.ReplaceAll(content, `<a href="#developers">使用指南</a>`, `<a href="#developers" data-metadata-href="usage_guide_href">使用指南</a>`)
	content = strings.ReplaceAll(content, `<a href="#contact">联系商务</a>`, `<a href="#contact" data-metadata-href="contact_sales_href">联系商务</a>`)
	content = strings.ReplaceAll(content, `<a href="#contact">服务条款</a>`, `<a href="#contact" data-metadata-href="terms_href">服务条款</a>`)

	update := home.Update().SetMetadata(metadata)
	if content != home.ContentHTML {
		update.SetContentHTML(content)
	}
	updated, err := update.Save(ctx)
	if err != nil {
		log.Fatalf("更新 home 动态页失败: %v", err)
	}

	log.Printf("home 元数据链接已补齐（id=%d，新增字段: api_docs_href, usage_guide_href, contact_sales_href, terms_href）", updated.ID)
}

func ensureMetadataAttribute(content, marker, attribute string) string {
	if strings.Contains(content, attribute) {
		return content
	}
	index := strings.Index(content, marker)
	if index < 0 {
		return content
	}
	insertAt := index + len(marker)
	return content[:insertAt] + " " + attribute + content[insertAt:]
}
