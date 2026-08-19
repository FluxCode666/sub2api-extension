//go:build ignore

// 将 sub2api 官方首页的完整 HTML 写入动态页面数据库。
//
// 运行：
//
//	go run ./scripts/seed_sub2api_home.go
//
// 写入后访问：
//
//	/p/sub2api-home
//
// 页面内容存储在 pages.content_html，由 DynamicPage 通过 SandboxRenderer
// 从 API 读取并渲染。前端不注册该页面组件，因此修改页面内容只需更新数据库记录。
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
	// 无环境变量时使用本地开发 Makefile 的 sub2api-postgres(127.0.0.1:15432)。
	password := envOrAny("123456", "DATABASE_PASSWORD", "SUB2API_EXTENSION_POSTGRES_PASSWORD", "DEV_DATABASE_PASSWORD")
	dsn := fmt.Sprintf(
		"host=%s port=%s user=%s password=%s dbname=%s sslmode=disable",
		envOrAny("127.0.0.1", "DATABASE_HOST", "SUB2API_EXTENSION_POSTGRES_HOST"),
		envOrAny("15432", "DATABASE_PORT", "SUB2API_EXTENSION_POSTGRES_HOST_PORT"),
		envOrAny("sub2api", "DATABASE_USER", "SUB2API_EXTENSION_POSTGRES_USER"),
		password,
		envOrAny("sub2api", "DATABASE_DBNAME", "SUB2API_EXTENSION_POSTGRES_DB"),
	)

	client, err := ent.Open("postgres", dsn)
	if err != nil {
		log.Fatalf("打开数据库失败: %v", err)
	}
	defer func() { _ = client.Close() }()

	ctx := context.Background()
	const slug = "sub2api-home"
	homeHTML := sub2APIHomeHTML()
	metadata := map[string]interface{}{
		"full_bleed":    "true",
		"source":        "sub2api/frontend/src/views/HomeView.vue",
		"site_name":     "Sub2API",
		"site_subtitle": "AI API Gateway Platform",
	}

	existing, err := client.Page.Query().Where(page.SlugEQ(slug)).Only(ctx)
	if err == nil {
		updated, updateErr := existing.Update().
			SetTitle("Sub2API 官网").
			SetVisibility("public").
			SetContentType("html").
			SetContentHTML(homeHTML).
			ClearContentReact().
			SetMetadata(metadata).
			SetEnabled(true).
			Save(ctx)
		if updateErr != nil {
			log.Fatalf("更新动态首页失败: %v", updateErr)
		}
		log.Printf("动态首页已更新（id=%d，route=/p/%s，content=database）", updated.ID, slug)
		return
	}
	if !ent.IsNotFound(err) {
		log.Fatalf("查询动态首页失败: %v", err)
	}

	created, err := client.Page.Create().
		SetSlug(slug).
		SetTitle("Sub2API 官网").
		SetVisibility("public").
		SetContentType("html").
		SetContentHTML(homeHTML).
		SetMetadata(metadata).
		SetEnabled(true).
		Save(ctx)
	if err != nil {
		log.Fatalf("写入动态首页失败: %v", err)
	}

	log.Printf("动态首页写入成功: id=%d route=/p/%s content=database", created.ID, slug)
}

// sub2APIHomeHTML 是一次 seed 的初始内容。写入后页面由数据库记录驱动，
// 管理员可以直接在 /admin/pages 的 Monaco 编辑器中继续修改这段 HTML。
func sub2APIHomeHTML() string {
	return `
<style>
  :root {
    --s2-bg: #f5f7fb;
    --s2-surface: rgba(255, 255, 255, .82);
    --s2-surface-strong: #fff;
    --s2-ink: #121722;
    --s2-muted: #687386;
    --s2-subtle: #98a1b1;
    --s2-line: rgba(35, 47, 68, .12);
    --s2-accent: #5366d6;
    --s2-accent-soft: rgba(83, 102, 214, .12);
    --s2-shadow: rgba(58, 71, 105, .13);
  }
  .s2-page[data-theme="dark"] {
    --s2-bg: #0d1119;
    --s2-surface: rgba(22, 28, 40, .84);
    --s2-surface-strong: #171e2c;
    --s2-ink: #eef1f8;
    --s2-muted: #a2acc0;
    --s2-subtle: #79859a;
    --s2-line: rgba(226, 232, 247, .12);
    --s2-accent: #8997f0;
    --s2-accent-soft: rgba(137, 151, 240, .16);
    --s2-shadow: rgba(0, 0, 0, .32);
  }
  body { margin: 0 !important; padding: 0 !important; }
  .s2-page, .s2-page * { box-sizing: border-box; }
  .s2-page {
    min-height: 100vh;
    overflow: hidden;
    color: var(--s2-ink);
    background: radial-gradient(circle at 90% 0%, rgba(104, 125, 219, .16), transparent 28%), var(--s2-bg);
    font-family: Geist, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif;
  }
  .s2-page[data-theme="dark"] { background: radial-gradient(circle at 90% 0%, rgba(108, 122, 228, .2), transparent 28%), var(--s2-bg); }
  .s2-page a { color: inherit; text-decoration: none; }
  .s2-page button { font: inherit; }
  .s2-page :focus-visible { outline: 2px solid var(--s2-accent); outline-offset: 4px; }
  .s2-header { position: relative; z-index: 2; padding: 24px clamp(18px, 5vw, 72px); }
  .s2-nav { display: flex; max-width: 1240px; min-height: 48px; align-items: center; justify-content: space-between; margin: 0 auto; }
  .s2-brand { display: inline-flex; align-items: center; gap: 10px; font-size: 14px; font-weight: 760; letter-spacing: -.03em; }
  .s2-mark { display: grid; width: 34px; height: 34px; place-items: center; border: 1px solid var(--s2-line); border-radius: 11px; background: var(--s2-surface-strong); box-shadow: 0 8px 22px var(--s2-shadow); color: var(--s2-accent); font-size: 15px; font-weight: 800; }
  .s2-actions { display: flex; align-items: center; gap: 8px; }
  .s2-icon-button { display: grid; width: 38px; height: 38px; place-items: center; border: 1px solid transparent; border-radius: 12px; background: transparent; color: var(--s2-muted); cursor: pointer; transition: .2s ease; }
  .s2-icon-button:hover { border-color: var(--s2-line); background: var(--s2-surface); color: var(--s2-ink); }
  .s2-icon-button svg, .s2-button svg { width: 18px; height: 18px; fill: none; stroke: currentColor; stroke-linecap: round; stroke-linejoin: round; stroke-width: 1.7; }
  .s2-page a.s2-login { display: inline-flex; min-height: 38px; align-items: center; border-radius: 999px; background: var(--s2-ink); color: var(--s2-bg); padding: 0 16px; font-size: 12px; font-weight: 700; transition: transform .2s ease, background .2s ease; }
  .s2-login:hover { background: var(--s2-accent); color: #fff; transform: translateY(-2px); }
  .s2-main { position: relative; z-index: 1; width: min(100%, 1240px); margin: 0 auto; padding: clamp(54px, 8vw, 120px) clamp(18px, 5vw, 72px) 80px; }
  .s2-hero { display: grid; grid-template-columns: minmax(0, 1fr) minmax(340px, .9fr); gap: clamp(36px, 7vw, 104px); align-items: center; min-height: 500px; }
  .s2-copy { max-width: 690px; }
  .s2-copy h1 { max-width: 14ch; margin: 0; font-size: clamp(3.1rem, 7vw, 6.4rem); font-weight: 720; line-height: .94; letter-spacing: -.085em; }
  .s2-subtitle { max-width: 58ch; margin: 28px 0 0; color: var(--s2-muted); font-size: 15px; line-height: 1.85; }
  .s2-hero-actions { display: flex; flex-wrap: wrap; gap: 10px; margin-top: 32px; }
  .s2-button { display: inline-flex; min-height: 48px; align-items: center; justify-content: center; gap: 9px; border: 1px solid transparent; border-radius: 999px; padding: 0 19px; font-size: 12px; font-weight: 750; transition: transform .2s ease, border-color .2s ease, background .2s ease; }
  .s2-button:hover { transform: translateY(-2px); }
  .s2-page a.s2-button-primary { background: var(--s2-ink); color: var(--s2-bg); box-shadow: 0 14px 30px var(--s2-shadow); }
  .s2-button-primary:hover { background: var(--s2-accent); color: #fff; }
  .s2-button-secondary { border-color: var(--s2-line); background: var(--s2-surface); color: var(--s2-ink); }
  .s2-button-secondary:hover { border-color: var(--s2-accent); background: var(--s2-surface-strong); }
  .s2-terminal { overflow: hidden; border: 1px solid var(--s2-line); border-radius: 24px; background: color-mix(in srgb, var(--s2-surface-strong) 80%, transparent); box-shadow: 0 26px 70px var(--s2-shadow); backdrop-filter: blur(18px); transform: rotate(2deg); }
  .s2-terminal-bar { display: flex; align-items: center; gap: 7px; padding: 17px 18px; border-bottom: 1px solid var(--s2-line); color: var(--s2-subtle); font: 10px ui-monospace, SFMono-Regular, Consolas, monospace; }
  .s2-terminal-bar span { width: 8px; height: 8px; border-radius: 50%; background: #e9988e; }
  .s2-terminal-bar span:nth-child(2) { background: #e7c77b; }
  .s2-terminal-bar span:nth-child(3) { background: #78c99a; }
  .s2-terminal-bar b { margin-left: auto; font-weight: 500; }
  .s2-terminal-body { min-height: 245px; padding: 28px 24px; background: linear-gradient(135deg, color-mix(in srgb, var(--s2-accent) 8%, transparent), transparent); color: var(--s2-muted); font: 12px/2 ui-monospace, SFMono-Regular, Consolas, monospace; }
  .s2-terminal-body p { margin: 0; }
  .s2-terminal-body i { color: var(--s2-accent); font-style: normal; }
  .s2-terminal-body em { color: #bd8fd9; font-style: normal; }
  .s2-terminal-body strong { color: #4eaf79; font-weight: 700; }
  .s2-terminal-body code { color: var(--s2-ink); }
  .s2-cursor { display: inline-block; width: 7px; height: 15px; vertical-align: -3px; background: var(--s2-accent); animation: s2-blink 1.05s steps(2, start) infinite; }
  @keyframes s2-blink { 50% { opacity: .15; } }
  .s2-signal-row { display: grid; grid-template-columns: repeat(3, 1fr); gap: 10px; margin: 58px 0 112px; }
  .s2-signal { display: flex; min-height: 60px; align-items: center; gap: 12px; padding: 0 18px; border: 1px solid var(--s2-line); border-radius: 16px; background: var(--s2-surface); box-shadow: 0 12px 28px var(--s2-shadow); }
  .s2-signal svg { width: 19px; height: 19px; fill: none; stroke: var(--s2-accent); stroke-linecap: round; stroke-linejoin: round; stroke-width: 1.6; }
  .s2-signal strong { font-size: 12px; }
  .s2-feature-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 12px; }
  .s2-feature { min-height: 245px; padding: 25px; border: 1px solid var(--s2-line); border-radius: 22px; background: var(--s2-surface); box-shadow: 0 18px 44px var(--s2-shadow); cursor: pointer; transition: transform .25s ease, border-color .25s ease, background .25s ease; }
  .s2-feature:hover { border-color: color-mix(in srgb, var(--s2-accent) 50%, var(--s2-line)); background: var(--s2-surface-strong); transform: translateY(-5px); }
  .s2-feature-icon { display: grid; width: 42px; height: 42px; place-items: center; margin-bottom: 30px; border-radius: 14px; color: #fff; }
  .s2-feature-icon svg { width: 21px; height: 21px; fill: none; stroke: currentColor; stroke-linecap: round; stroke-linejoin: round; stroke-width: 1.5; }
  .s2-blue { background: linear-gradient(135deg, #4a83ec, #5d60cf); }
  .s2-violet { background: linear-gradient(135deg, #8e65df, #bd72c7); }
  .s2-rose { background: linear-gradient(135deg, #df7188, #ca62b0); }
  .s2-feature h2 { margin: 0; font-size: 17px; letter-spacing: -.04em; }
  .s2-feature p { max-width: 32ch; margin: 10px 0 0; color: var(--s2-muted); font-size: 13px; line-height: 1.7; }
  .s2-providers { margin-top: 112px; text-align: center; }
  .s2-providers h2 { margin: 0; font-size: clamp(2.2rem, 4vw, 4rem); font-weight: 700; line-height: 1; letter-spacing: -.075em; }
  .s2-providers p { margin: 15px 0 30px; color: var(--s2-muted); font-size: 13px; line-height: 1.75; }
  .s2-provider-list { display: flex; flex-wrap: wrap; justify-content: center; gap: 10px; }
  .s2-provider { display: inline-flex; min-height: 58px; align-items: center; gap: 10px; padding: 0 16px 0 10px; border: 1px solid color-mix(in srgb, var(--s2-accent) 30%, var(--s2-line)); border-radius: 16px; background: var(--s2-surface); box-shadow: 0 12px 28px var(--s2-shadow); }
  .s2-provider-muted { opacity: .62; }
  .s2-provider-mark { display: grid; width: 33px; height: 33px; place-items: center; border-radius: 10px; color: #fff; font-size: 12px; font-weight: 800; }
  .s2-orange { background: #e88949; }
  .s2-green { background: #49a879; }
  .s2-provider-blue { background: #4c86e9; }
  .s2-pink { background: #dc6b9a; }
  .s2-gray { background: #687181; }
  .s2-provider strong { font-size: 12px; }
  .s2-provider small { border-radius: 6px; background: var(--s2-accent-soft); color: var(--s2-accent); padding: 4px 7px; font-size: 9px; font-weight: 700; }
  .s2-footer { display: flex; max-width: 1240px; align-items: center; justify-content: space-between; gap: 18px; margin: 0 auto; padding: 24px clamp(18px, 5vw, 72px) 32px; border-top: 1px solid var(--s2-line); color: var(--s2-subtle); font-size: 11px; }
  .s2-footer-links { display: flex; gap: 18px; }
  .s2-footer a:hover { color: var(--s2-ink); }
  @media (max-width: 900px) {
    .s2-hero { grid-template-columns: 1fr; }
    .s2-terminal { width: min(100%, 560px); transform: none; }
    .s2-feature-grid { grid-template-columns: 1fr; }
    .s2-feature { min-height: 190px; }
    .s2-feature-icon { margin-bottom: 22px; }
  }
  @media (max-width: 560px) {
    .s2-header { padding: 16px 14px; }
    .s2-actions { gap: 2px; }
    .s2-main { padding: 46px 14px 60px; }
    .s2-copy h1 { font-size: clamp(3.2rem, 16vw, 5rem); }
    .s2-subtitle { font-size: 13px; }
    .s2-signal-row { grid-template-columns: 1fr; margin: 46px 0 82px; }
    .s2-providers { margin-top: 84px; }
    .s2-provider-list { display: grid; grid-template-columns: 1fr 1fr; }
    .s2-provider { min-width: 0; padding-right: 9px; }
    .s2-provider small { display: none; }
    .s2-footer { align-items: flex-start; flex-direction: column; padding-inline: 14px; }
  }
  @media (prefers-reduced-motion: reduce) { .s2-cursor, .s2-button, .s2-login, .s2-feature { animation: none; transition: none; } }
</style>

<div class="s2-page" id="top" aria-label="Sub2API 官网">
  <header class="s2-header">
    <nav class="s2-nav" aria-label="主导航">
      <a class="s2-brand" href="#top" data-feature-id="nav-home">
        <span class="s2-mark" aria-hidden="true">S</span>
        <span>Sub2API</span>
      </a>
      <div class="s2-actions">
        <button class="s2-icon-button" type="button" data-theme-toggle data-feature-id="theme-toggle" aria-label="切换主题" title="切换主题">
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M20.5 15.2A8.5 8.5 0 0 1 8.8 3.5 8.5 8.5 0 1 0 20.5 15.2z" /></svg>
        </button>
        <a class="s2-login" href="/login" target="_top" data-feature-id="nav-login">登录</a>
      </div>
    </nav>
  </header>

  <main class="s2-main">
    <section class="s2-hero" aria-labelledby="s2-hero-title">
      <div class="s2-copy">
        <h1 id="s2-hero-title">Sub2API</h1>
        <p class="s2-subtitle">AI API Gateway Platform</p>
        <div class="s2-hero-actions">
          <a class="s2-button s2-button-primary" href="/login" target="_top" data-feature-id="hero-get-started">立即开始 <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12h13M13 6l6 6-6 6" /></svg></a>
        </div>
      </div>

      <div class="s2-terminal" aria-label="API 调用示例">
        <div class="s2-terminal-bar"><span></span><span></span><span></span><b>terminal</b></div>
        <div class="s2-terminal-body">
          <p><i>$</i> curl -X POST <em>/v1/messages</em></p>
          <p># routing request to the best upstream...</p>
          <p><strong>200 OK</strong> <code>{ "content": "Hello!" }</code></p>
          <p><i>$</i> <span class="s2-cursor" aria-hidden="true"></span></p>
        </div>
      </div>
    </section>

    <section class="s2-signal-row" aria-label="平台特性">
      <div class="s2-signal"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7h13l-3-3M20 17H7l3 3" /></svg><strong>订阅转 API</strong></div>
      <div class="s2-signal"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3l7 3v5c0 4.4-2.8 8.1-7 10-4.2-1.9-7-5.6-7-10V6z" /><path d="M9 12l2 2 4-4" /></svg><strong>会话保持</strong></div>
      <div class="s2-signal"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 19V5M4 19h17M8 16v-4M12 16V8M16 16v-6M20 16v-9" /></svg><strong>按量计费</strong></div>
    </section>

    <section class="s2-feature-grid" aria-label="平台能力">
      <article class="s2-feature" tabindex="0" data-feature-id="feature-unified-gateway">
        <span class="s2-feature-icon s2-blue"><svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="4" width="18" height="15" rx="2" /><path d="M7 8h10M7 12h5M7 16h8" /></svg></span>
        <h2>一键接入</h2><p>获取一个 API 密钥，即可调用所有已接入的 AI 模型，无需分别申请。</p>
      </article>
      <article class="s2-feature" tabindex="0" data-feature-id="feature-account-pool">
        <span class="s2-feature-icon s2-violet"><svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="9" cy="8" r="3" /><path d="M3 20c.5-3.4 2.5-5 6-5s5.5 1.6 6 5M16 5.5a2.5 2.5 0 0 1 0 5M16 14c2.8.2 4.3 1.5 5 4" /></svg></span>
        <h2>稳定可靠</h2><p>智能调度多个上游账号，自动切换和负载均衡，告别频繁报错。</p>
      </article>
      <article class="s2-feature" tabindex="0" data-feature-id="feature-billing">
        <span class="s2-feature-icon s2-rose"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 19V5M4 19h17M8 16v-4M12 16V8M16 16v-6M20 16v-9" /></svg></span>
        <h2>用多少付多少</h2><p>按实际使用量计费，支持设置配额上限，团队用量一目了然。</p>
      </article>
    </section>

    <section class="s2-providers" aria-labelledby="s2-providers-title">
      <h2 id="s2-providers-title">已支持的 AI 模型</h2>
      <p>一个 API，多种选择</p>
      <div class="s2-provider-list">
        <div class="s2-provider"><span class="s2-provider-mark s2-orange">C</span><strong>Claude</strong><small>已支持</small></div>
        <div class="s2-provider"><span class="s2-provider-mark s2-green">G</span><strong>GPT</strong><small>已支持</small></div>
        <div class="s2-provider"><span class="s2-provider-mark s2-provider-blue">G</span><strong>Gemini</strong><small>已支持</small></div>
        <div class="s2-provider"><span class="s2-provider-mark s2-pink">A</span><strong>Antigravity</strong><small>已支持</small></div>
        <div class="s2-provider s2-provider-muted"><span class="s2-provider-mark s2-gray">+</span><strong>更多</strong><small>即将推出</small></div>
      </div>
    </section>
  </main>

  <footer class="s2-footer">
    <span>© 2026 Sub2API. 保留所有权利。</span>
    <div class="s2-footer-links"><a href="https://github.com/Wei-Shaw/sub2api" target="_top" data-feature-id="footer-github">GitHub</a></div>
  </footer>
</div>

<script>
(function () {
  var page = document.getElementById('top');
  var toggle = document.querySelector('[data-theme-toggle]');
  if (!page || !toggle) return;
  var saved = '';
  try { saved = window.localStorage.getItem('theme') || ''; } catch (_) {}
  if (saved === 'dark' || (!saved && window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches)) {
    page.setAttribute('data-theme', 'dark');
  }
  toggle.addEventListener('click', function () {
    var next = page.getAttribute('data-theme') === 'dark' ? 'light' : 'dark';
    page.setAttribute('data-theme', next);
    try { window.localStorage.setItem('theme', next); } catch (_) {}
  });
}());
</script>`
}
