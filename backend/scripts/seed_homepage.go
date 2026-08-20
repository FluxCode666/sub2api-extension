// Package main 提供首页初始化脚本。
//
// 用途: 将首页内容插入到数据库中，作为 slug='home' 的动态页面。
// 运行: go run ./scripts/seed_homepage.go
//
// 前提: 数据库已通过 `go run ./cmd/server -migrate` 完成迁移。
package main

import (
	"context"
	"fmt"
	"log"
	"os"

	"sub2api-extension/ent"
	"sub2api-extension/ent/page"

	_ "github.com/lib/pq"
)

func envOrAny(fallback string, keys ...string) string {
	for _, key := range keys {
		if value := os.Getenv(key); value != "" {
			return value
		}
	}
	return fallback
}

func main() {
	// 优先使用与后端服务相同的 DATABASE_* 配置；SUB2API_EXTENSION_POSTGRES_* 用于开发 Compose。
	dsn := fmt.Sprintf(
		"host=%s port=%s user=%s password=%s dbname=%s sslmode=disable",
		envOrAny("127.0.0.1", "DATABASE_HOST", "SUB2API_EXTENSION_POSTGRES_HOST"),
		envOrAny("5432", "DATABASE_PORT", "SUB2API_EXTENSION_POSTGRES_HOST_PORT"),
		envOrAny("aux", "DATABASE_USER", "SUB2API_EXTENSION_POSTGRES_USER"),
		envOrAny("123456", "DATABASE_PASSWORD", "SUB2API_EXTENSION_POSTGRES_PASSWORD"),
		envOrAny("auxdb", "DATABASE_DBNAME", "SUB2API_EXTENSION_POSTGRES_DB"),
	)

	log.Printf("Connecting to database used by aux backend")

	client, err := ent.Open("postgres", dsn)
	if err != nil {
		log.Fatalf("Failed to open ent client: %v", err)
	}
	defer func() { _ = client.Close() }()

	ctx := context.Background()

	const slug = "home"
	homeHTML := getHomePageHTML()
	metadata := map[string]interface{}{
		"full_bleed": "true",
		"logo":       "",
		// frame 模式让动态官网在沙箱内部滚动，使 fixed 导航与内容处于同一滚动上下文。
		"scroll_mode":        "frame",
		"source":             "TERALEMO homepage implementation (migrated to database HTML)",
		"site_name":          "TERALEMO",
		"copyright_year":     "2026",
		"console_href":       "/admin/dashboard",
		"api_docs_href":      "",
		"usage_guide_href":   "",
		"contact_sales_href": "",
		"terms_href":         "",
		// trusted_partners 元数据示例（控制台页面管理中以字符串值保存 JSON）：
		// {"enabled":true,"items":[{"icon":"","name":"星辰互娱"}]}
		// enabled=false 或 items=[] 时，官网自动隐藏该板块；超过 5 项才开启循环。
		"trusted_partners": `{"enabled":true,"items":[{"icon":"","name":"星辰互娱"}]}`,
	}

	// 幂等写入：重复运行脚本会更新数据库页面，确保代码迁移后的内容可同步。
	existing, err := client.Page.Query().Where(page.SlugEQ(slug)).Only(ctx)

	if err == nil {
		updated, updateErr := existing.Update().
			SetTitle("TERALEMO 官网").
			SetVisibility("public").
			SetContentType("html").
			SetContentHTML(homeHTML).
			ClearContentReact().
			SetMetadata(metadata).
			SetEnabled(true).
			Save(ctx)
		if updateErr != nil {
			log.Fatalf("Failed to update home page: %v", updateErr)
		}
		log.Printf("Home page updated (id=%d, route=/p/%s, content=database)", updated.ID, slug)
		return
	}

	if err != nil && !ent.IsNotFound(err) {
		log.Fatalf("Failed to query existing home page: %v", err)
	}

	page, err := client.Page.Create().
		SetSlug(slug).
		SetTitle("TERALEMO 官网").
		SetVisibility("public").
		SetContentType("html").
		SetContentHTML(homeHTML).
		SetMetadata(metadata).
		SetEnabled(true).
		Save(ctx)

	if err != nil {
		log.Fatalf("Failed to create home page: %v", err)
	}

	log.Printf("Home page created successfully (id=%d, slug=%s)", page.ID, page.Slug)
	fmt.Println("✓ Homepage seed completed")
}

func getHomePageHTML() string {
	// TERALEMO 官网首页的完整 HTML 内容。
	// 这段内容只负责首次/幂等 seed；运行时页面始终从 pages.content_html 读取，
	// 管理员可以在 /admin/pages 中继续编辑，不依赖前端首页组件。
	return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>TERALEMO - 生产级 AI 网关</title>
  <style>
    :root {
      --home-surface: #05070C;
      --home-surface-1: #0A0D12;
      --home-surface-2: #0F131C;
      --home-surface-3: #161D2B;
      --home-surface-4: #1E2636;
      --home-accent: #6b7dd9;
      --home-accent-bright: #8d9df5;
      --home-text: #e8eaf0;
      --home-text-dim: #9ca3c0;
      --home-border: rgba(139, 148, 185, 0.12);
    }

    html[data-teralemo-theme="light"],
    html[data-teralemo-theme="light"] body {
      background: #F5F6FA;
    }

    .teralemo-page[data-theme="light"] {
      --home-surface: #F5F6FA;
      --home-surface-1: #FFFFFF;
      --home-surface-2: #EEF1F7;
      --home-surface-3: #E4E8F1;
      --home-surface-4: #D9DEEA;
      --home-accent: #5366D6;
      --home-accent-bright: #4054C7;
      --home-text: #151820;
      --home-text-dim: #667085;
      --home-border: rgba(27, 34, 48, 0.12);
      color-scheme: light;
    }

    * { margin: 0; padding: 0; box-sizing: border-box; }

    body {
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", "Helvetica Neue", Arial, sans-serif;
      background: var(--home-surface);
      color: var(--home-text);
      line-height: 1.6;
      overflow-x: hidden;
    }

    .teralemo-page {
      min-height: 0;
      background: var(--home-surface);
      color: var(--home-text);
      color-scheme: dark;
      transition: background-color .35s ease, color .35s ease;
    }

    /* 导航栏 */
    .teralemo-nav {
      position: fixed;
      top: 0;
      left: 0;
      right: 0;
      z-index: 100;
      padding: .65rem 1rem;
      background: transparent;
      pointer-events: none;
    }

    .teralemo-nav-frame {
      width: 100%;
      max-width: 1400px;
      min-height: 54px;
      margin: 0 auto;
      padding: .55rem 1rem;
      display: flex;
      align-items: center;
      gap: 2rem;
      border: 1px solid transparent;
      border-radius: 999px;
      pointer-events: auto;
      transition: max-width .5s cubic-bezier(.22, 1, .36, 1), padding .5s cubic-bezier(.22, 1, .36, 1), background-color .35s ease, border-color .35s ease, box-shadow .35s ease, backdrop-filter .35s ease;
    }

    .teralemo-nav.is-compact .teralemo-nav-frame {
      max-width: 900px;
      padding: .45rem .75rem;
      border-color: var(--home-border);
      background: color-mix(in srgb, var(--home-surface-1) 84%, transparent);
      box-shadow: 0 20px 55px rgba(0, 0, 0, .18), inset 0 1px rgba(255, 255, 255, .06);
      backdrop-filter: blur(18px) saturate(135%);
    }

    .teralemo-brand {
      display: flex;
      align-items: center;
      gap: 0.5rem;
      font-size: 1.25rem;
      font-weight: 700;
      color: var(--home-text);
      text-decoration: none;
      letter-spacing: -0.02em;
    }

    .teralemo-wordmark {
      display: inline-block;
      color: var(--home-text);
      /* 两个完全相同的色带首尾相接，动画重置时不会跳回第一帧。 */
      background-image: linear-gradient(90deg, #c18a63 0%, #6c9b92 12.5%, #9180a8 25%, #ad9760 37.5%, #c18a63 50%, #6c9b92 62.5%, #9180a8 75%, #ad9760 87.5%, #c18a63 100%);
      background-size: 200% 100%;
      background-position: 0% 50%;
      background-clip: text;
      -webkit-background-clip: text;
      -webkit-text-fill-color: transparent;
      animation: teralemo-brand-gradient 9s linear infinite;
    }

    .teralemo-mark {
      width: 32px;
      height: 32px;
      background: linear-gradient(135deg, var(--home-accent) 0%, var(--home-accent-bright) 100%);
      border-radius: 8px;
      display: flex;
      align-items: center;
      justify-content: center;
      font-weight: 800;
      color: var(--home-surface);
    }
    .teralemo-mark img { width: 100%; height: 100%; object-fit: contain; border-radius: inherit; }

    .teralemo-nav-links {
      display: flex;
      gap: 2rem;
      margin-left: auto;
    }

    .teralemo-nav-links a {
      color: var(--home-text-dim);
      text-decoration: none;
      font-size: 0.9375rem;
      transition: color 0.2s;
    }

    .teralemo-nav-links a:hover {
      color: var(--home-text);
    }

    .teralemo-nav-cta {
      padding: 0.5rem 1.25rem;
      background: var(--home-surface-3);
      border: 1px solid var(--home-border);
      border-radius: 999px;
      color: var(--home-text);
      text-decoration: none;
      font-size: 0.9375rem;
      font-weight: 500;
      transition: all 0.2s;
    }

    .teralemo-nav-cta:hover {
      background: var(--home-surface-4);
      border-color: var(--home-accent);
    }

    .teralemo-theme-toggle {
      display: grid;
      width: 34px;
      height: 34px;
      place-items: center;
      border: 1px solid var(--home-border);
      border-radius: 10px;
      background: var(--home-surface-2);
      color: var(--home-text-dim);
      cursor: pointer;
      transition: border-color .2s ease, background-color .2s ease, color .2s ease, transform .2s ease;
    }
    .teralemo-theme-toggle svg { width: 17px; height: 17px; fill: none; stroke: currentColor; stroke-linecap: round; stroke-linejoin: round; stroke-width: 1.8; }
    .teralemo-theme-toggle .teralemo-theme-sun { display: none; }
    .teralemo-page[data-theme="light"] .teralemo-theme-toggle .teralemo-theme-moon { display: none; }
    .teralemo-page[data-theme="light"] .teralemo-theme-toggle .teralemo-theme-sun { display: block; }
    .teralemo-theme-toggle:hover { border-color: var(--home-accent); color: var(--home-text); transform: rotate(10deg); }

    .teralemo-page[data-theme="light"] .teralemo-hero h1 {
      background: none;
      color: var(--home-text);
      -webkit-text-fill-color: initial;
    }

    /* Hero 区域 */
    .teralemo-hero {
      padding: 10rem 2rem 6rem;
      position: relative;
      overflow: hidden;
    }

    .teralemo-hero-inner {
      max-width: 900px;
      margin: 0 auto;
      text-align: center;
      position: relative;
      z-index: 10;
    }

    .teralemo-eyebrow {
      display: inline-block;
      padding: 0.5rem 1rem;
      background: var(--home-surface-2);
      border: 1px solid var(--home-border);
      border-radius: 999px;
      font-size: 0.875rem;
      color: var(--home-accent-bright);
      margin-bottom: 2rem;
      font-weight: 500;
    }

    .teralemo-hero h1 {
      font-size: clamp(3rem, 7vw, 5.5rem);
      font-weight: 800;
      letter-spacing: -0.03em;
      line-height: 1.1;
      margin-bottom: 1.5rem;
      color: var(--home-text);
      background: none;
      -webkit-text-fill-color: initial;
      background-clip: initial;
    }

    .teralemo-hero-copy {
      font-size: clamp(1.125rem, 2vw, 1.375rem);
      color: var(--home-text-dim);
      margin-bottom: 3rem;
      line-height: 1.7;
    }

    .teralemo-hero-actions {
      display: flex;
      gap: 1rem;
      justify-content: center;
      flex-wrap: wrap;
      margin-bottom: 4rem;
    }

    .teralemo-button {
      padding: 0.875rem 2rem;
      border-radius: 999px;
      font-size: 1rem;
      font-weight: 600;
      text-decoration: none;
      transition: all 0.2s;
      display: inline-block;
    }

    .teralemo-button--primary {
      background: linear-gradient(135deg, var(--home-accent) 0%, var(--home-accent-bright) 100%);
      color: var(--home-surface);
    }

    .teralemo-button--primary:hover {
      transform: translateY(-2px);
      box-shadow: 0 8px 24px rgba(107, 125, 217, 0.4);
    }

    .teralemo-button--secondary {
      background: var(--home-surface-2);
      border: 1px solid var(--home-border);
      color: var(--home-text);
    }

    .teralemo-button--secondary:hover {
      background: var(--home-surface-3);
      border-color: var(--home-accent);
    }

    .teralemo-hero-facts {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
      gap: 2rem;
      padding: 2rem;
      background: var(--home-surface-1);
      border: 1px solid var(--home-border);
      border-radius: 16px;
      margin-top: 3rem;
    }

    .teralemo-hero-facts > div {
      text-align: center;
    }

    .teralemo-hero-facts strong {
      display: block;
      font-size: 1.125rem;
      color: var(--home-accent-bright);
      margin-bottom: 0.25rem;
    }

    .teralemo-hero-facts span {
      font-size: 0.9375rem;
      color: var(--home-text-dim);
    }

    /* Section */
    .teralemo-section {
      padding: 6rem 2rem;
    }

    .teralemo-shell {
      max-width: 1200px;
      margin: 0 auto;
    }

    .teralemo-section-head {
      text-align: center;
      margin-bottom: 4rem;
    }

    .teralemo-section-head h2 {
      font-size: clamp(2rem, 4vw, 3rem);
      font-weight: 800;
      letter-spacing: -0.02em;
      margin-bottom: 1rem;
    }

    .teralemo-section-head p {
      font-size: 1.125rem;
      color: var(--home-text-dim);
      max-width: 700px;
      margin: 0 auto;
    }

    .teralemo-kicker {
      display: inline-block;
      font-size: 0.875rem;
      color: var(--home-accent-bright);
      font-weight: 600;
      text-transform: uppercase;
      letter-spacing: 0.05em;
      margin-bottom: 0.5rem;
    }

    /* Capabilities Grid */
    .teralemo-capability-grid {
      display: grid;
      grid-template-columns: repeat(12, minmax(0, 1fr));
      grid-auto-flow: dense;
      align-items: stretch;
      gap: 1.5rem;
    }

    .teralemo-capability {
      grid-column: span 4;
      display: flex;
      min-height: 220px;
      flex-direction: column;
      background: var(--home-surface-1);
      border: 1px solid var(--home-border);
      border-radius: 16px;
      padding: 2rem;
      transition: all 0.3s;
    }

    .teralemo-capability:nth-child(n + 4) {
      grid-column: span 6;
    }

    .teralemo-capability:hover {
      border-color: var(--home-accent);
      transform: translateY(-4px);
    }

    .teralemo-capability > span {
      display: block;
      font-size: 0.75rem;
      color: var(--home-accent);
      font-weight: 700;
      letter-spacing: 0.1em;
      margin-bottom: 1rem;
    }

    .teralemo-capability h3 {
      font-size: 1.25rem;
      font-weight: 700;
      margin-bottom: 0.75rem;
    }

    .teralemo-capability p {
      color: var(--home-text-dim);
      margin-bottom: 1rem;
      line-height: 1.6;
    }

    .teralemo-capability-tags {
      display: flex;
      gap: 0.5rem;
      flex-wrap: wrap;
      margin-top: auto;
    }

    .teralemo-capability-tags b {
      padding: 0.25rem 0.75rem;
      background: var(--home-surface-2);
      border-radius: 999px;
      font-size: 0.8125rem;
      font-weight: 500;
      color: var(--home-text-dim);
    }

    /* Contact */
    .teralemo-contact {
      padding: 6rem 2rem;
      text-align: center;
      background: var(--home-surface-1);
    }

    .teralemo-contact h2 {
      font-size: clamp(2rem, 4vw, 2.75rem);
      font-weight: 800;
      margin-bottom: 1rem;
    }

    .teralemo-contact p {
      font-size: 1.125rem;
      color: var(--home-text-dim);
      margin-bottom: 2rem;
      max-width: 700px;
      margin-left: auto;
      margin-right: auto;
    }

    /* Footer */
    .teralemo-footer {
      padding: 3.25rem 2rem 2.5rem;
      border-top: 1px solid var(--home-border);
      display: grid;
      grid-template-columns: 1.4fr repeat(3, 1fr);
      gap: 2rem;
    }

    .teralemo-footer strong {
      display: block;
      font-size: 0.875rem;
      color: var(--home-text);
      margin-bottom: 1rem;
      font-weight: 600;
    }

    .teralemo-footer p {
      font-size: 0.875rem;
      color: var(--home-text-dim);
      line-height: 1.6;
    }
    .teralemo-copyright {
      margin-top: 1rem;
      font-size: 0.75rem !important;
    }

    .teralemo-footer a {
      display: block;
      font-size: 0.875rem;
      color: var(--home-text-dim);
      text-decoration: none;
      margin-bottom: 0.5rem;
      transition: color 0.2s;
    }

    .teralemo-footer a:hover {
      color: var(--home-accent-bright);
    }

    .teralemo-network {
      position: absolute;
      inset: 0;
      opacity: .68;
      pointer-events: none;
      background: radial-gradient(circle at 50% 45%, rgba(107, 125, 217, .18), transparent 32%);
    }

    .teralemo-network svg { width: 100%; height: 100%; }
    .teralemo-network path {
      fill: none;
      stroke: url(#teralemo-network-gradient);
      stroke-width: 1.2;
      stroke-linecap: round;
      opacity: .7;
    }
    .teralemo-network path.is-emphasis { stroke-width: 2; opacity: 1; filter: drop-shadow(0 0 7px rgba(141, 157, 245, .45)); }
    .teralemo-network circle { fill: var(--home-accent-bright); filter: url(#teralemo-packet-glow); }
    .teralemo-trusted {
      padding: 5rem 2rem 5.5rem;
      background: var(--home-surface);
    }
    .teralemo-trusted-head { max-width: 700px; margin: 0 auto 2.25rem; text-align: center; }
    .teralemo-trusted-head h2 { margin: .4rem 0 .8rem; font-size: clamp(1.8rem, 3.4vw, 2.6rem); letter-spacing: -.04em; }
    .teralemo-trusted-head p:last-child { color: var(--home-text-dim); font-size: 1rem; }
    .teralemo-partner-viewport {
      position: relative;
      overflow: hidden;
      cursor: default;
      -webkit-mask-image: linear-gradient(90deg, transparent, #000 7%, #000 93%, transparent);
      mask-image: linear-gradient(90deg, transparent, #000 7%, #000 93%, transparent);
      user-select: none;
    }
    .teralemo-partner-viewport.is-looping { cursor: grab; }
    .teralemo-partner-viewport.is-looping.is-dragging { cursor: grabbing; }
    .teralemo-partner-track {
      display: flex;
      width: max-content;
      gap: clamp(2.5rem, 6vw, 6rem);
      padding: .75rem 1rem;
    }
    .teralemo-partner-viewport:not(.is-looping) .teralemo-partner-track {
      width: 100%;
      max-width: 100%;
      flex-wrap: wrap;
      justify-content: center;
    }
    .teralemo-partner-viewport.is-looping .teralemo-partner-track {
      animation: teralemo-partner-marquee 28s linear infinite;
    }
    .teralemo-partner-viewport.is-dragging .teralemo-partner-track { animation-play-state: paused; }
    .teralemo-partner {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      gap: .75rem;
      padding: .9rem .75rem;
      color: color-mix(in srgb, var(--home-text) 78%, var(--home-text-dim));
      font-family: "Geist", "SF Pro Display", "PingFang SC", "Microsoft YaHei", sans-serif;
      font-size: clamp(1.1rem, 1.5vw, 1.3rem);
      font-weight: 600;
      letter-spacing: .14em;
      line-height: 1;
      white-space: nowrap;
      transition: color .25s ease, opacity .25s ease;
    }
    .teralemo-partner > span {
      display: inline-block;
    }
    .teralemo-partner img {
      width: 30px;
      height: 30px;
      object-fit: contain;
      filter: grayscale(1);
      opacity: .78;
      transition: filter .25s ease, opacity .25s ease;
    }
    .teralemo-partner:hover img { filter: grayscale(0); opacity: 1; }
    @keyframes teralemo-brand-gradient {
      /* 背景图的后半段是前半段的副本，100% 与 0% 画面完全一致；反向移动让颜色从左向右流动。 */
      from { background-position: 100% 50%; }
      to { background-position: 0% 50%; }
    }
    @media (prefers-reduced-motion: reduce) {
      .teralemo-wordmark {
        animation: none;
        background: none;
        color: var(--home-text);
        -webkit-text-fill-color: initial;
      }
    }
    @keyframes teralemo-partner-marquee { from { transform: translate3d(0, 0, 0); } to { transform: translate3d(-50%, 0, 0); } }

    .teralemo-provider-list {
      display: grid;
      grid-template-columns: repeat(3, 1fr);
      gap: 1rem;
      margin-top: 2rem;
    }
    .teralemo-provider-list span {
      display: grid;
      min-height: 82px;
      place-items: center;
      border: 1px solid var(--home-border);
      border-radius: 14px;
      background: var(--home-surface-1);
      color: var(--home-text-dim);
      font-size: .95rem;
      font-weight: 650;
    }

    .teralemo-scenarios { background: linear-gradient(180deg, var(--home-surface), var(--home-surface-1)); }
    .teralemo-scenario-track { display: grid; grid-template-columns: repeat(3, 1fr); gap: 1rem; }
    .teralemo-scenario {
      min-height: 260px;
      padding: 1.75rem;
      border: 1px solid var(--home-border);
      border-radius: 16px;
      background: color-mix(in srgb, var(--home-surface-1) 82%, transparent);
      transition: transform .25s ease, border-color .25s ease, background .25s ease;
    }
    .teralemo-scenario:hover { transform: translateY(-5px); border-color: var(--home-accent); background: var(--home-surface-3); }
    .teralemo-scenario > span { color: var(--home-accent-bright); font: 700 .7rem ui-monospace, SFMono-Regular, Consolas, monospace; letter-spacing: .12em; }
    .teralemo-scenario h3 { margin: 5rem 0 .8rem; font-size: 1.5rem; letter-spacing: -.03em; }
    .teralemo-scenario p { color: var(--home-text-dim); line-height: 1.7; }

    .teralemo-developer { background: radial-gradient(circle at 75% 45%, rgba(107, 125, 217, .16), transparent 32%), var(--home-surface); }
    .teralemo-developer-grid { display: grid; grid-template-columns: .8fr 1.2fr; gap: 4rem; align-items: center; }
    .teralemo-developer-copy h2 { max-width: 10ch; font-size: clamp(2.2rem, 5vw, 4rem); line-height: 1; letter-spacing: -.05em; }
    .teralemo-developer-copy p { margin-top: 1rem; color: var(--home-text-dim); line-height: 1.75; }
    .teralemo-text-link { display: inline-block; margin-top: 1.5rem; color: var(--home-accent-bright); font-weight: 650; text-decoration: none; }
    .teralemo-code-block { overflow: hidden; border: 1px solid var(--home-border); border-radius: 16px; background: #080a0f; box-shadow: 0 24px 60px rgba(0,0,0,.32); }
    .teralemo-code-protocols, .teralemo-code-tabs { display: flex; gap: .35rem; overflow-x: auto; padding: .7rem; scrollbar-width: none; }
    .teralemo-code-protocols { border-bottom: 1px solid var(--home-border); }
    .teralemo-code-protocol, .teralemo-code-tab, .teralemo-code-copy {
      border: 1px solid transparent;
      border-radius: 8px;
      background: transparent;
      color: #8490aa;
      cursor: pointer;
      font: 700 .7rem ui-monospace, SFMono-Regular, Consolas, monospace;
      padding: .55rem .7rem;
      white-space: nowrap;
    }
    .teralemo-code-protocol:hover, .teralemo-code-tab:hover, .teralemo-code-copy:hover { border-color: var(--home-border); background: var(--home-surface-3); color: var(--home-text); }
    .teralemo-code-protocol.is-active, .teralemo-code-tab.is-active { border-color: var(--home-accent); background: var(--home-accent); color: #fff; }
    .teralemo-code-head { display: flex; align-items: center; justify-content: space-between; gap: .75rem; border-bottom: 1px solid var(--home-border); }
    .teralemo-code-tabs { min-width: 0; }
    .teralemo-code-copy { margin-right: .7rem; }
    .teralemo-code-caption { display: flex; justify-content: space-between; gap: 1rem; padding: 1rem 1.25rem 0; color: #69748c; font: .65rem ui-monospace, SFMono-Regular, Consolas, monospace; letter-spacing: .08em; }
    .teralemo-code-block pre { min-height: 280px; max-height: 420px; margin: 0; padding: 1rem 1.25rem 1.5rem; overflow: auto; color: #c2cae0; font: .75rem/1.75 ui-monospace, SFMono-Regular, Consolas, monospace; white-space: pre-wrap; overflow-wrap: anywhere; word-break: break-word; }
    .teralemo-page[data-theme="light"] .teralemo-code-block { background: var(--home-surface-1); box-shadow: 0 24px 60px rgba(61, 72, 100, .14); }
    .teralemo-page[data-theme="light"] .teralemo-code-block pre { color: #28334c; }
    .teralemo-page[data-theme="light"] .teralemo-code-protocol,
    .teralemo-page[data-theme="light"] .teralemo-code-tab,
    .teralemo-page[data-theme="light"] .teralemo-code-copy { color: #667085; }
    .teralemo-page[data-theme="light"] .teralemo-code-protocol.is-active,
    .teralemo-page[data-theme="light"] .teralemo-code-tab.is-active { color: #fff; }

    .teralemo-skip-link { position: fixed; left: 1rem; top: .75rem; z-index: 110; padding: .6rem .8rem; border-radius: .6rem; background: var(--home-text); color: var(--home-surface) !important; transform: translateY(-150%); }
    .teralemo-skip-link:focus { transform: translateY(0); }

    @media (max-width: 768px) {
      .teralemo-nav { padding: .5rem; }
      .teralemo-nav-frame { gap: .65rem; padding-inline: .65rem; }
      .teralemo-nav.is-compact .teralemo-nav-frame { max-width: calc(100vw - 1rem); }
      .teralemo-nav-links {
        display: none;
      }
      .teralemo-hero {
        padding: 8rem 1rem 4rem;
      }
      .teralemo-section {
        padding: 4rem 1rem;
      }
      .teralemo-provider-list, .teralemo-scenario-track, .teralemo-developer-grid { grid-template-columns: 1fr; }
      .teralemo-capability-grid { grid-template-columns: 1fr; }
      .teralemo-capability, .teralemo-capability:nth-child(n + 4) { grid-column: auto; }
      .teralemo-hero-facts { grid-template-columns: 1fr; }
      .teralemo-developer-grid { gap: 2.5rem; }
      .teralemo-developer-copy h2 { max-width: none; }
      .teralemo-code-block pre { font-size: .68rem; }
      .teralemo-footer { grid-template-columns: repeat(2, minmax(0, 1fr)); padding-inline: 1rem; }
      .teralemo-footer > div:first-child { grid-column: 1 / -1; }
    }
  </style>
</head>
<body>
  <div class="teralemo-page">
    <header class="teralemo-nav">
      <div class="teralemo-nav-frame">
          <a class="teralemo-brand" href="#top">
          <span class="teralemo-mark" data-brand-logo aria-hidden="true">T</span>
          <span class="teralemo-wordmark">TERALEMO</span>
        </a>
        <nav class="teralemo-nav-links">
          <a href="#platform">平台能力</a>
          <a href="#capabilities">治理能力</a>
          <a href="#developers">开发者文档</a>
          <a href="#contact">服务支持</a>
        </nav>
        <button class="teralemo-theme-toggle" type="button" aria-label="切换主题" data-theme-toggle>
          <svg class="teralemo-theme-moon" viewBox="0 0 24 24" aria-hidden="true"><path d="M20.1 15.2A8.4 8.4 0 0 1 8.8 3.9 8.5 8.5 0 1 0 20.1 15.2Z" /></svg>
          <svg class="teralemo-theme-sun" viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="3.5" /><path d="M12 2.5V5M12 19v2.5M2.5 12H5M19 12h2.5M5.3 5.3l1.8 1.8M16.9 16.9l1.8 1.8M18.7 5.3l-1.8 1.8M7.1 16.9l-1.8 1.8" /></svg>
        </button>
        <a class="teralemo-nav-cta" href="/admin" data-feature-id="nav-console" data-metadata-href="console_href">控制台</a>
      </div>
    </header>

    <main id="main-content">
      <section class="teralemo-hero" id="top">
        <div class="teralemo-network" aria-hidden="true">
          <svg viewBox="0 0 1200 620" preserveAspectRatio="none">
            <defs>
              <linearGradient id="teralemo-network-gradient" x1="0" y1="0" x2="1" y2="0"><stop offset="0%" stop-color="#5366d6" stop-opacity=".12" /><stop offset="50%" stop-color="#b184cb" stop-opacity=".92" /><stop offset="100%" stop-color="#5366d6" stop-opacity=".12" /></linearGradient>
              <filter id="teralemo-packet-glow" x="-300%" y="-300%" width="700%" height="700%"><feGaussianBlur in="SourceGraphic" stdDeviation="3" result="blur" /><feMerge><feMergeNode in="blur" /><feMergeNode in="SourceGraphic" /></feMerge></filter>
            </defs>
            <path d="M-40 90 C280 90 300 290 600 310 C900 330 920 90 1240 90" />
            <path d="M-40 180 C260 180 330 300 600 310 C870 320 940 180 1240 180" />
            <path d="M-40 270 C250 270 360 310 600 310 C840 310 950 270 1240 270" class="is-emphasis" />
            <path d="M-40 350 C250 350 360 320 600 310 C840 300 950 350 1240 350" class="is-emphasis" />
            <path d="M-40 440 C280 440 300 330 600 310 C900 290 920 440 1240 440" />
            <path d="M-40 530 C280 530 300 350 600 310 C900 270 920 530 1240 530" />
            <circle r="4"><animateMotion dur="3.8s" repeatCount="indefinite" path="M-40 270 C250 270 360 310 600 310 C840 310 950 270 1240 270" /></circle>
            <circle r="3"><animateMotion dur="4.6s" begin="-1.7s" repeatCount="indefinite" path="M-40 440 C280 440 300 330 600 310 C900 290 920 440 1240 440" /></circle>
          </svg>
        </div>
        <div class="teralemo-hero-inner">
          <span class="teralemo-eyebrow">面向生产环境的 AI 网关</span>
          <h1><span class="teralemo-wordmark">TERALEMO</span></h1>
          <p class="teralemo-hero-copy">将安全准入、智能路由、稳定保障、用量管理与运行观测统一到同一网关层。</p>
          <div class="teralemo-hero-actions">
            <a class="teralemo-button teralemo-button--primary" href="#contact" data-feature-id="hero-primary">
              获取接入方案
            </a>
            <a class="teralemo-button teralemo-button--secondary" href="#developers" data-feature-id="hero-docs">
              查看开发者文档
            </a>
          </div>
          <div class="teralemo-hero-facts">
            <div><strong>统一接入</strong><span>应用与 Agent</span></div>
            <div><strong>稳定路由</strong><span>模型与算力</span></div>
            <div><strong>可观测运营</strong><span>用量与成本</span></div>
          </div>
        </div>
      </section>

      <section class="teralemo-trusted" data-trusted-partners hidden>
        <div class="teralemo-shell">
          <div class="teralemo-trusted-head">
            <p class="teralemo-kicker">信赖的合作伙伴</p>
            <h2>与值得信赖的团队一起交付</h2>
            <p>从稳定接入到持续运营，和伙伴一起把 AI 能力带进真实业务。</p>
          </div>
          <div class="teralemo-partner-viewport" data-partner-viewport aria-label="信赖的合作伙伴">
            <div class="teralemo-partner-track" data-partner-track></div>
          </div>
        </div>
      </section>

      <section class="teralemo-section" id="platform">
        <div class="teralemo-shell">
          <div class="teralemo-section-head">
            <h2>与主流模型能力保持兼容</h2>
            <p>模型生态由网关统一管理，业务系统不需要分别维护多套连接关系。</p>
          </div>
          <div class="teralemo-provider-list" aria-label="模型生态">
            <span>OpenAI</span><span>Anthropic</span><span>更多</span>
          </div>
        </div>
      </section>

      <section class="teralemo-section teralemo-capabilities" id="capabilities">
        <div class="teralemo-shell">
          <div class="teralemo-section-head">
            <h2>为生产级 AI 网关而设计</h2>
            <p>从接入到运营，为生产环境提供一套完整的控制与运行能力。</p>
          </div>
          <div class="teralemo-capability-grid">
            <article class="teralemo-capability">
              <span>UNIFIED ACCESS</span>
              <h3>统一接入与身份边界</h3>
              <p>为产品、Agent 和内部系统提供一致入口。</p>
              <div class="teralemo-capability-tags">
                <b>协议兼容</b>
                <b>身份鉴权</b>
              </div>
            </article>
            <article class="teralemo-capability">
              <span>POLICY CONTROL</span>
              <h3>策略、安全与配额治理</h3>
              <p>集中管理访问范围、调用规则和团队边界。</p>
              <div class="teralemo-capability-tags">
                <b>权限</b>
                <b>配额</b>
                <b>审计</b>
              </div>
            </article>
            <article class="teralemo-capability">
              <span>OBSERVABILITY</span>
              <h3>调用、告警与成本视角</h3>
              <p>让问题定位、使用复盘和资源规划有据可循。</p>
              <div class="teralemo-capability-tags">
                <b>指标</b>
                <b>用量</b>
              </div>
            </article>
            <article class="teralemo-capability">
              <span>ROUTING</span>
              <h3>智能路由与稳定保障</h3>
              <p>在网关层处理模型选择、切换和异常处置。</p>
              <div class="teralemo-capability-tags">
                <b>路由</b>
                <b>容错</b>
              </div>
            </article>
            <article class="teralemo-capability">
              <span>DEVELOPER EXPERIENCE</span>
              <h3>保持熟悉的调用方式</h3>
              <p>兼容常用 SDK，减少业务接入成本。</p>
              <div class="teralemo-capability-tags">
                <b>API</b>
                <b>SDK</b>
              </div>
            </article>
          </div>
        </div>
      </section>

      <section class="teralemo-section teralemo-scenarios" id="scenarios">
        <div class="teralemo-shell">
          <div class="teralemo-section-head">
            <p class="teralemo-kicker">应用场景</p>
            <h2>服务不同角色与团队</h2>
            <p>同一套网关能力可以支撑产品交付、平台研发和组织级运营。</p>
          </div>
          <div class="teralemo-scenario-track">
            <article class="teralemo-scenario" data-feature-id="scenario-products"><span>AI PRODUCTS</span><h3>面向用户的 AI 产品</h3><p>让产品迭代不被底层模型和供应商变化牵动。</p></article>
            <article class="teralemo-scenario" data-feature-id="scenario-agents"><span>AGENT WORKFLOWS</span><h3>Agent 与自动化</h3><p>统一不同推理能力的调用、权限和运行策略。</p></article>
            <article class="teralemo-scenario" data-feature-id="scenario-platform"><span>PLATFORM ENGINEERING</span><h3>研发与平台团队</h3><p>为多个团队提供一致的接入规范和运行视角。</p></article>
          </div>
        </div>
      </section>

      <section class="teralemo-section teralemo-developer" id="developers">
        <div class="teralemo-shell teralemo-developer-grid">
          <div class="teralemo-developer-copy">
            <p class="teralemo-kicker">开发者体验</p>
            <h2>接入一次，网关持续演进。</h2>
            <p>应用侧保持熟悉的调用方式，策略、路由和治理能力由 TERALEMO 统一承接。</p>
            <a class="teralemo-text-link" href="#contact" data-feature-id="developer-docs" data-metadata-href="api_docs_href">查看 API 文档 ↗</a>
          </div>
          <div class="teralemo-code-block" aria-label="接口示例">
            <div class="teralemo-code-protocols" role="tablist" aria-label="接口协议">
              <button type="button" class="teralemo-code-protocol is-active" data-protocol="chat" role="tab" aria-selected="true">Chat Completions</button>
              <button type="button" class="teralemo-code-protocol" data-protocol="responses" role="tab" aria-selected="false">Responses API</button>
              <button type="button" class="teralemo-code-protocol" data-protocol="anthropic" role="tab" aria-selected="false">Anthropic Messages</button>
            </div>
            <div class="teralemo-code-head">
              <div class="teralemo-code-tabs" role="tablist" aria-label="代码示例语言">
                <button type="button" class="teralemo-code-tab is-active" data-language="curl" role="tab" aria-selected="true">cURL</button>
                <button type="button" class="teralemo-code-tab" data-language="python" role="tab" aria-selected="false">Python</button>
                <button type="button" class="teralemo-code-tab" data-language="go" role="tab" aria-selected="false">Go</button>
              </div>
              <button type="button" class="teralemo-code-copy" data-copy-code>复制</button>
            </div>
            <div class="teralemo-code-caption"><span data-code-caption>OPENAI-COMPATIBLE API</span><span data-code-file>request.sh</span></div>
            <pre id="teralemo-code-panel" role="tabpanel"><code data-code-output>export TERALEMO_API_KEY="your-api-key"\n\ncurl https://api.teralemo.com/v1/chat/completions \\\n  -H "Authorization: Bearer $TERALEMO_API_KEY" \\\n  -H "Content-Type: application/json" \\\n  -d '{\n    "model": "gpt-5.6-sol",\n    "messages": [\n      {\n        "role": "user",\n        "content": "你好，请介绍一下 TERALEMO。"\n      }\n    ]\n  }'</code></pre>
          </div>
        </div>
      </section>

      <section class="teralemo-contact" id="contact">
        <div class="teralemo-shell">
          <h2>规划 AI 网关与运行体系</h2>
          <p>告诉我们你的业务场景、接入规模和治理要求，我们将提供适合的对接建议。</p>
          <a class="teralemo-button teralemo-button--primary" href="mailto:service@teralemo.com" data-feature-id="contact-team">联系服务团队</a>
        </div>
      </section>
    </main>

    <footer class="teralemo-footer teralemo-shell">
      <div><strong class="teralemo-wordmark">TERALEMO</strong><p>生产级 AI 网关，为产品、Agent 和研发平台提供统一的接入、治理与运行能力。</p><p class="teralemo-copyright" data-copyright>© 2026 TERALEMO. 保留所有权利。</p></div>
      <div><strong>产品</strong><a href="#platform">平台能力</a><a href="#capabilities">治理能力</a></div>
      <div><strong>资源</strong><a href="#developers" data-metadata-href="api_docs_href">API 文档</a><a href="#developers" data-metadata-href="usage_guide_href">使用指南</a></div>
      <div><strong>服务支持</strong><a href="#contact" data-metadata-href="contact_sales_href">联系商务</a><a href="#contact" data-metadata-href="terms_href">服务条款</a></div>
    </footer>
  </div>
  <script>
  (function () {
    var page = document.querySelector('.teralemo-page');
    var nav = document.querySelector('.teralemo-nav');
    var themeButton = document.querySelector('[data-theme-toggle]');
    var storedTheme = null;
    try { storedTheme = localStorage.getItem('teralemo-theme'); } catch (_) {}
    var systemTheme = 'light';
    try {
      if (window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches) systemTheme = 'dark';
    } catch (_) {}
    var hasStoredTheme = storedTheme === 'light' || storedTheme === 'dark';
    var theme = hasStoredTheme ? storedTheme : systemTheme;
    function setTheme(next) {
      theme = next === 'light' ? 'light' : 'dark';
      if (page) page.setAttribute('data-theme', theme);
      document.documentElement.setAttribute('data-teralemo-theme', theme);
      try { localStorage.setItem('teralemo-theme', theme); } catch (_) {}
      if (themeButton) themeButton.setAttribute('aria-label', theme === 'dark' ? '切换到亮色主题' : '切换到暗色主题');
    }
    setTheme(theme);
    if (themeButton) themeButton.addEventListener('click', function () { setTheme(theme === 'dark' ? 'light' : 'dark'); });
    if (!hasStoredTheme && window.matchMedia) {
      try {
        var systemThemeQuery = window.matchMedia('(prefers-color-scheme: dark)');
        var handleSystemThemeChange = function (event) { setTheme(event.matches ? 'dark' : 'light'); };
        if (systemThemeQuery.addEventListener) systemThemeQuery.addEventListener('change', handleSystemThemeChange);
        else if (systemThemeQuery.addListener) systemThemeQuery.addListener(handleSystemThemeChange);
      } catch (_) {}
    }

    function updateNavigation(offset) {
      if (nav) nav.classList.toggle('is-compact', Number(offset) > 36);
    }
    updateNavigation(window.scrollY || 0);
    window.addEventListener('scroll', function () { updateNavigation(window.scrollY || 0); }, { passive: true });
    window.addEventListener('auxparentscroll', function (event) {
      updateNavigation(event && event.detail ? event.detail.offset : 0);
    });

    function escapeHTML(value) {
      return String(value == null ? '' : value)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
    }

    function renderBrandLogo() {
      var raw = (window.__AUX_METADATA__ || {}).logo;
      if (typeof raw !== 'string') return;
      var logo = raw.trim();
      var normalized = logo.toLowerCase();
      if (normalized.indexOf('http://') !== 0 && normalized.indexOf('https://') !== 0) return;
      document.querySelectorAll('[data-brand-logo]').forEach(function (el) {
        var image = document.createElement('img');
        image.src = logo;
        image.alt = '';
        image.loading = 'eager';
        image.addEventListener('error', function () { el.textContent = 'T'; });
        el.textContent = '';
        el.appendChild(image);
      });
    }

    function renderCopyright() {
      var metadata = window.__AUX_METADATA__ || {};
      var siteName = typeof metadata.site_name === 'string' ? metadata.site_name.trim() : '';
      var year = metadata.copyright_year == null ? '' : String(metadata.copyright_year).trim();
      if (!siteName) siteName = 'TERALEMO';
      if (!/^\d{4}$/.test(year)) year = String(new Date().getFullYear());

      document.querySelectorAll('.teralemo-wordmark').forEach(function (el) {
        el.textContent = siteName;
      });
      var copyright = document.querySelector('[data-copyright]');
      if (copyright) copyright.textContent = '© ' + year + ' ' + siteName + '. 保留所有权利。';
    }

    function isSafeNavigation(value) {
      var href = String(value == null ? '' : value).trim();
      if (!href || /^javascript:/i.test(href)) return false;
      if (/^(https?:|mailto:|tel:|\/|#)/i.test(href)) return true;
      return !/^[a-z][a-z0-9+.-]*:/i.test(href);
    }

    function renderMetadataLinks() {
      var metadata = window.__AUX_METADATA__ || {};
      document.querySelectorAll('[data-metadata-href]').forEach(function (el) {
        var key = el.getAttribute('data-metadata-href');
        if (!key) return;
        var value = metadata[key];
        if (value == null) return;
        value = String(value).trim();
        if (!value || !isSafeNavigation(value)) return;
        el.setAttribute('href', value);
      });
    }

    function parseTrustedPartners() {
      var raw = (window.__AUX_METADATA__ || {}).trusted_partners;
      if (!raw) return null;
      if (typeof raw === 'string') {
        try { raw = JSON.parse(raw); } catch (_) { return null; }
      }
      if (!raw || raw.enabled === false || !Array.isArray(raw.items)) return null;
      var items = raw.items.filter(function (item) {
        return item && typeof item.name === 'string' && item.name.trim();
      }).map(function (item) {
        return { name: item.name.trim(), icon: typeof item.icon === 'string' ? item.icon.trim() : '' };
      });
      return items.length ? items : null;
    }

    function renderTrustedPartners() {
      var section = document.querySelector('[data-trusted-partners]');
      var viewport = document.querySelector('[data-partner-viewport]');
      var track = document.querySelector('[data-partner-track]');
      var items = parseTrustedPartners();
      if (!section || !viewport || !track || !items) {
        if (section) section.hidden = true;
        return;
      }

      var cards = items.map(function (item) {
        var icon = item.icon ? '<img src="' + escapeHTML(item.icon) + '" alt="" loading="lazy" />' : '';
        return '<article class="teralemo-partner">' + icon + '<span>' + escapeHTML(item.name) + '</span></article>';
      }).join('');
      var looping = items.length > 5;
      section.hidden = false;
      track.innerHTML = looping ? cards + cards : cards;
      viewport.classList.toggle('is-looping', looping);
      if (!looping) return;

      var dragging = false;
      var startX = 0;
      viewport.addEventListener('pointerdown', function (event) {
        dragging = true;
        startX = event.clientX;
        viewport.classList.add('is-dragging');
        viewport.setPointerCapture(event.pointerId);
      });
      viewport.addEventListener('pointermove', function (event) {
        if (!dragging) return;
        track.style.transform = 'translate3d(' + (event.clientX - startX) + 'px, 0, 0)';
      });
      function stopDragging(event) {
        if (!dragging) return;
        dragging = false;
        viewport.classList.remove('is-dragging');
        track.style.transform = '';
        if (event && viewport.hasPointerCapture(event.pointerId)) viewport.releasePointerCapture(event.pointerId);
      }
      viewport.addEventListener('pointerup', stopDragging);
      viewport.addEventListener('pointercancel', stopDragging);
    }
    renderBrandLogo();
    renderCopyright();
    renderMetadataLinks();
    renderTrustedPartners();

    var examples = {
      chat: {
        caption: 'OPENAI-COMPATIBLE API', endpoint: '/v1/chat/completions',
        curl: 'export TERALEMO_API_KEY="your-api-key"\\n\\ncurl https://api.teralemo.com/v1/chat/completions \\\\n  -H "Authorization: Bearer $TERALEMO_API_KEY" \\\\n  -H "Content-Type: application/json" \\\\n  -d \'{\\n    "model": "gpt-5.6-sol",\\n    "messages": [\\n      {\\n        "role": "user",\\n        "content": "你好，请介绍一下 TERALEMO。"\\n      }\\n    ]\\n  }\'',
        python: 'import os\\nimport requests\\n\\nresponse = requests.post(\\n  "https://api.teralemo.com/v1/chat/completions",\\n  headers={\\n    "Authorization": f"Bearer {os.environ[\\"TERALEMO_API_KEY\\"]}",\\n    "Content-Type": "application/json",\\n  },\\n  json={\\n    "model": "gpt-5.6-sol",\\n    "messages": [\\n      {\\n        "role": "user",\\n        "content": "你好，请介绍一下 TERALEMO。",\\n      },\\n    ],\\n  },\\n  timeout=60,\\n)\\nprint(response.json())',
        go: 'package main\\n\\nimport (\\n  "bytes"\\n  "encoding/json"\\n  "net/http"\\n)\\n\\nfunc main() {\\n  payload := map[string]any{\\n    "model": "gpt-5.6-sol",\\n    "messages": []map[string]string{\\n      {\\n        "role": "user",\\n        "content": "你好，请介绍一下 TERALEMO。",\\n      },\\n    },\\n  }\\n  body, _ := json.Marshal(payload)\\n  req, _ := http.NewRequest(http.MethodPost, "https://api.teralemo.com/v1/chat/completions", bytes.NewReader(body))\\n  req.Header.Set("Authorization", "Bearer $TERALEMO_API_KEY")\\n  req.Header.Set("Content-Type", "application/json")\\n  http.DefaultClient.Do(req)\\n}'
      },
      responses: {
        caption: 'OPENAI RESPONSES API', endpoint: '/v1/responses',
        curl: 'export TERALEMO_API_KEY="your-api-key"\\n\\ncurl https://api.teralemo.com/v1/responses \\\\n  -H "Authorization: Bearer $TERALEMO_API_KEY" \\\\n  -H "Content-Type: application/json" \\\\n  -d \'{\\n    "model": "gpt-5.6-sol",\\n    "input": "你好，请介绍一下 TERALEMO。"\\n  }\'',
        python: 'import requests\\n\\nresponse = requests.post(\\n  "https://api.teralemo.com/v1/responses",\\n  headers={\\n    "Authorization": "Bearer " + "your-api-key",\\n    "Content-Type": "application/json",\\n  },\\n  json={\\n    "model": "gpt-5.6-sol",\\n    "input": "你好，请介绍一下 TERALEMO。",\\n  },\\n)\\nprint(response.json())',
        go: 'package main\\n\\nimport (\\n  "bytes"\\n  "encoding/json"\\n  "net/http"\\n)\\n\\nfunc main() {\\n  payload := map[string]any{\\n    "model": "gpt-5.6-sol",\\n    "input": "你好，请介绍一下 TERALEMO。",\\n  }\\n  body, _ := json.Marshal(payload)\\n  req, _ := http.NewRequest(http.MethodPost, "https://api.teralemo.com/v1/responses", bytes.NewReader(body))\\n  req.Header.Set("Authorization", "Bearer $TERALEMO_API_KEY")\\n  req.Header.Set("Content-Type", "application/json")\\n  http.DefaultClient.Do(req)\\n}'
      },
      anthropic: {
        caption: 'ANTHROPIC MESSAGES API', endpoint: '/v1/messages',
        curl: 'export TERALEMO_API_KEY="your-api-key"\\n\\ncurl https://api.teralemo.com/v1/messages \\\\n  -H "x-api-key: $TERALEMO_API_KEY" \\\\n  -H "anthropic-version: 2023-06-01" \\\\n  -H "content-type: application/json" \\\\n  -d \'{\\n    "model": "gpt-5.6-sol",\\n    "max_tokens": 1024,\\n    "messages": [\\n      {\\n        "role": "user",\\n        "content": "你好，请介绍一下 TERALEMO。"\\n      }\\n    ]\\n  }\'',
        python: 'import requests\\n\\nresponse = requests.post(\\n  "https://api.teralemo.com/v1/messages",\\n  headers={\\n    "x-api-key": "your-api-key",\\n    "anthropic-version": "2023-06-01",\\n    "content-type": "application/json",\\n  },\\n  json={\\n    "model": "gpt-5.6-sol",\\n    "max_tokens": 1024,\\n    "messages": [\\n      {\\n        "role": "user",\\n        "content": "你好，请介绍一下 TERALEMO。",\\n      },\\n    ],\\n  },\\n)\\nprint(response.json())',
        go: 'package main\\n\\nimport (\\n  "bytes"\\n  "encoding/json"\\n  "net/http"\\n)\\n\\nfunc main() {\\n  payload := map[string]any{\\n    "model": "gpt-5.6-sol",\\n    "max_tokens": 1024,\\n    "messages": []map[string]string{\\n      {\\n        "role": "user",\\n        "content": "你好，请介绍一下 TERALEMO。",\\n      },\\n    },\\n  }\\n  body, _ := json.Marshal(payload)\\n  req, _ := http.NewRequest(http.MethodPost, "https://api.teralemo.com/v1/messages", bytes.NewReader(body))\\n  req.Header.Set("x-api-key", "your-api-key")\\n  req.Header.Set("anthropic-version", "2023-06-01")\\n  req.Header.Set("content-type", "application/json")\\n  http.DefaultClient.Do(req)\\n}'
      }
    };
    var activeProtocol = 'chat';
    var activeLanguage = 'curl';
    var files = { curl: 'request.sh', python: 'main.py', go: 'main.go' };
    var protocolButtons = document.querySelectorAll('[data-protocol]');
    var languageButtons = document.querySelectorAll('[data-language]');
    var output = document.querySelector('[data-code-output]');
    var caption = document.querySelector('[data-code-caption]');
    var file = document.querySelector('[data-code-file]');
    function renderCode() {
      var sample = examples[activeProtocol];
      if (output) output.textContent = sample[activeLanguage].replace(/\\n/g, '\n');
      if (caption) caption.textContent = sample.caption;
      if (file) file.textContent = files[activeLanguage];
      protocolButtons.forEach(function (button) { var active = button.getAttribute('data-protocol') === activeProtocol; button.classList.toggle('is-active', active); button.setAttribute('aria-selected', String(active)); });
      languageButtons.forEach(function (button) { var active = button.getAttribute('data-language') === activeLanguage; button.classList.toggle('is-active', active); button.setAttribute('aria-selected', String(active)); });
    }
    protocolButtons.forEach(function (button) { button.addEventListener('click', function () { activeProtocol = button.getAttribute('data-protocol') || 'chat'; renderCode(); }); });
    languageButtons.forEach(function (button) { button.addEventListener('click', function () { activeLanguage = button.getAttribute('data-language') || 'curl'; renderCode(); }); });
    var copyButton = document.querySelector('[data-copy-code]');
    if (copyButton) copyButton.addEventListener('click', function () { var value = output ? output.textContent : ''; if (navigator.clipboard && navigator.clipboard.writeText) { navigator.clipboard.writeText(value); } copyButton.textContent = '已复制'; setTimeout(function () { copyButton.textContent = '复制'; }, 1600); });
    renderCode();
  })();
  </script>
</body>
</html>`
}
