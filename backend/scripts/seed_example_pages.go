//go:build ignore

// 将示例菜单页写入 pages 表。
//
// 这些页面故意使用数据库动态页面承载，便于在控制台直接编辑、启停和删除。
// 重复执行脚本会按 slug 幂等更新本地示例页面。
//
// 运行：go run ./scripts/seed_example_pages.go
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

type examplePage struct {
	slug        string
	title       string
	contentType string
	menuIcon    string
	html        string
	react       string
}

func envOr(fallback string, keys ...string) string {
	for _, key := range keys {
		if value := os.Getenv(key); value != "" {
			return value
		}
	}
	return fallback
}

func main() {
	dsn := fmt.Sprintf(
		"host=%s port=%s user=%s password=%s dbname=%s sslmode=disable",
		envOr("127.0.0.1", "DATABASE_HOST"),
		envOr("15432", "DATABASE_PORT"),
		envOr("sub2api", "DATABASE_USER"),
		envOr("123456", "DATABASE_PASSWORD"),
		envOr("sub2api", "DATABASE_DBNAME"),
	)

	client, err := ent.Open("postgres", dsn)
	if err != nil {
		log.Fatalf("打开数据库失败: %v", err)
	}
	defer func() {
		if closeErr := client.Close(); closeErr != nil {
			log.Printf("Failed to close ent client: %v", closeErr)
		}
	}()

	ctx := context.Background()
	pages := []examplePage{
		{
			slug:        "example-content",
			title:       "静态内容示例",
			contentType: "html",
			menuIcon:    "file-text",
			html:        staticContentHTML,
		},
		{
			slug:        "example-interaction",
			title:       "交互与埋点示例",
			contentType: "react",
			menuIcon:    "activity",
			react:       interactionReact,
		},
		{
			slug:        "example-api",
			title:       "API 请求示例",
			contentType: "react",
			menuIcon:    "bar-chart-3",
			react:       apiReact,
		},
		{
			slug:        "react-example",
			title:       "React 类型示例",
			contentType: "react",
			menuIcon:    "star",
			react:       reactExample,
		},
	}

	for _, item := range pages {
		if err := upsert(ctx, client, item); err != nil {
			log.Fatal(err)
		}
	}
	log.Printf("已写入 %d 个动态示例页面", len(pages))
}

func upsert(ctx context.Context, client *ent.Client, item examplePage) error {
	query := client.Page.Query().Where(page.SlugEQ(item.slug))
	existing, err := query.Only(ctx)
	if err != nil && !ent.IsNotFound(err) {
		return fmt.Errorf("查询页面 %s 失败: %w", item.slug, err)
	}

	contentHTML := item.html
	contentReact := item.react
	if item.contentType == "react" {
		contentHTML = ""
	} else {
		contentReact = ""
	}
	metadata := map[string]interface{}{"source": "seed:example-pages", "example": "true"}
	if item.menuIcon != "" {
		metadata["menu_icon"] = item.menuIcon
	}

	if existing != nil {
		_, err = existing.Update().
			SetTitle(item.title).
			SetVisibility("admin").
			SetContentType(item.contentType).
			SetContentHTML(contentHTML).
			SetContentReact(contentReact).
			SetMetadata(metadata).
			SetEnabled(true).
			Save(ctx)
		if err != nil {
			return fmt.Errorf("更新页面 %s 失败: %w", item.slug, err)
		}
		log.Printf("已更新动态页面 /admin/p/%s", item.slug)
		return nil
	}

	_, err = client.Page.Create().
		SetSlug(item.slug).
		SetTitle(item.title).
		SetVisibility("admin").
		SetContentType(item.contentType).
		SetContentHTML(contentHTML).
		SetContentReact(contentReact).
		SetMetadata(metadata).
		SetEnabled(true).
		Save(ctx)
	if err != nil {
		return fmt.Errorf("创建页面 %s 失败: %w", item.slug, err)
	}
	log.Printf("已创建动态页面 /admin/p/%s", item.slug)
	return nil
}

const staticContentHTML = `
<style>
  .aux-db-example { display: grid; gap: 1rem; max-width: 760px; margin: 0 auto; padding: 2rem; color: #1f2937; font-family: system-ui, sans-serif; }
  .aux-db-example header { border-bottom: 1px solid #e5e7eb; padding-bottom: 1.5rem; }
  .aux-db-example .kicker { color: #4f46e5; font-size: .75rem; font-weight: 700; letter-spacing: .12em; text-transform: uppercase; }
  .aux-db-example h1, .aux-db-example h2 { margin: .45rem 0; }
  .aux-db-example p { color: #6b7280; line-height: 1.7; }
  .aux-db-example section { border: 1px solid #e5e7eb; border-radius: 14px; padding: 1.5rem; background: #fff; }
  .aux-db-example dl, .aux-db-example ul { margin: 1rem 0 0; padding: 0; }
  .aux-db-example li, .aux-db-example dl > div { display: flex; justify-content: space-between; gap: 1rem; border-top: 1px solid #f0f1f3; padding: .8rem 0; }
  .aux-db-example dt { color: #6b7280; } .aux-db-example dd { margin: 0; font-weight: 600; }
</style>
<main class="aux-db-example">
  <header><span class="kicker">内容中心 · 数据库页面</span><h1>静态内容示例</h1><p>这是一个由 pages 表直接提供的 HTML 页面。管理员可以在页面管理中修改文案、启停页面或替换整段内容。</p></header>
  <section><h2>系统状态</h2><ul><li><span>管理端路由</span><strong>正常</strong></li><li><span>管理员权限</span><strong>已验证</strong></li><li><span>内容版本</span><strong>动态 HTML</strong></li></ul></section>
  <section><h2>内容元数据</h2><dl><div><dt>页面 ID</dt><dd>page:example-content</dd></div><div><dt>数据来源</dt><dd>PostgreSQL pages 表</dd></div></dl></section>
</main>`

const interactionReact = `
export default function InteractionExample({ pageId }) {
  const [count, setCount] = React.useState(0);
  function report(featureId) {
    try {
      let visitorId = localStorage.getItem('aux_visitor_id');
      if (!visitorId) { visitorId = 'dynamic-' + Date.now() + '-' + Math.random().toString(16).slice(2); localStorage.setItem('aux_visitor_id', visitorId); }
      fetch('/api/aux/telemetry/feature-click', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ page_id: pageId, feature_id: featureId, visitor_id: visitorId, is_admin: true }), keepalive: true }).catch(function (error) { console.error('[dynamic-page] feature telemetry failed', error); });
    } catch (error) { console.error('[dynamic-page] feature telemetry setup failed', error); }
  }
  function update(next, featureId) { setCount(next); report(featureId); }
  return <main style={{maxWidth: 760, margin: '0 auto', padding: 32, fontFamily: 'system-ui, sans-serif', color: '#1f2937'}}>
    <p style={{color: '#4f46e5', fontSize: 12, fontWeight: 700, letterSpacing: 2}}>操作台 · 动态 React 页面</p>
    <h1>交互与埋点示例</h1>
    <section style={{marginTop: 24, border: '1px solid #e5e7eb', borderRadius: 14, padding: 24, background: '#fff'}}>
      <h2 style={{fontSize: 16}}>当前计数</h2><output aria-label="当前计数" style={{display: 'block', margin: '12px 0 20px', fontSize: 52, fontWeight: 700}}>{count}</output>
      <div style={{display: 'flex', gap: 8}}><button type="button" aria-label="减少计数" onClick={() => update(count - 1, 'decrement-counter')} style={{height: 40, width: 40}}>-</button><button type="button" aria-label="增加计数" onClick={() => update(count + 1, 'increment-counter')} style={{height: 40, width: 40}}>+</button><button type="button" onClick={() => update(0, 'reset-counter')} style={{height: 40, padding: '0 14px'}}>重置计数</button></div>
    </section>
  </main>;
}`

const apiReact = `
export default function APIExample({ pageId }) {
  const [state, setState] = React.useState({ status: 'loading', data: null, message: '' });
  const getToken = function () { try { const raw = localStorage.getItem('aux_admin_session'); return raw ? JSON.parse(raw).token : ''; } catch (error) { console.error('[dynamic-page] failed to read admin session', error); return ''; } };
  const load = function (track) {
    if (track) { try { const raw = localStorage.getItem('aux_visitor_id') || 'dynamic-api-' + Date.now(); fetch('/api/aux/telemetry/feature-click', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ page_id: pageId, feature_id: 'refresh-status', visitor_id: raw, is_admin: true }), keepalive: true }).catch(function (error) { console.error('[dynamic-page] status telemetry failed', error); }); } catch (error) { console.error('[dynamic-page] status telemetry setup failed', error); } }
    setState({ status: 'loading', data: null, message: '' });
    fetch('/api/aux/admin/examples/status', { headers: { 'X-Aux-Session': getToken() } }).then(function (response) { return response.json(); }).then(function (envelope) { if (envelope.code !== 0 || !envelope.data) throw new Error(envelope.message || '服务返回的数据格式无效'); setState({ status: 'success', data: envelope.data, message: '' }); }).catch(function (error) { setState({ status: 'error', data: null, message: error && error.message ? error.message : '未知请求错误' }); });
  };
  React.useEffect(function () { load(false); }, []);
  return <main style={{maxWidth: 760, margin: '0 auto', padding: 32, fontFamily: 'system-ui, sans-serif', color: '#1f2937'}}>
    <header style={{display: 'flex', justifyContent: 'space-between', gap: 16, alignItems: 'center'}}><div><p style={{color: '#4f46e5', fontSize: 12, fontWeight: 700, letterSpacing: 2}}>服务诊断 · 动态 React 页面</p><h1>API 请求示例</h1></div><button type="button" onClick={() => load(true)} disabled={state.status === 'loading'}>刷新服务状态</button></header>
    {state.status === 'loading' && <p role="status" style={{marginTop: 32, color: '#6b7280'}}>正在读取服务状态…</p>}
    {state.status === 'error' && <section style={{marginTop: 24, border: '1px solid #fecaca', borderRadius: 14, padding: 24, color: '#b91c1c'}}><h2>服务状态暂不可用</h2><p>{state.message}</p><button type="button" onClick={() => load(true)}>重试请求</button></section>}
    {state.status === 'success' && <section style={{marginTop: 24, border: '1px solid #e5e7eb', borderRadius: 14, padding: 24, background: '#fff'}}><h2>服务响应</h2><dl style={{marginTop: 16}}><div><dt>服务</dt><dd>{state.data.service}</dd></div><div><dt>状态</dt><dd>{state.data.status}</dd></div><div><dt>服务器时间</dt><dd>{state.data.server_time}</dd></div></dl></section>}
  </main>;
}`

const reactExample = `
export default function ReactExample({ metadata, pageId }) {
  const [count, setCount] = React.useState(0);
  return <main style={{maxWidth: 760, margin: '0 auto', padding: 32, fontFamily: 'system-ui, sans-serif', color: '#1f2937'}}>
    <p style={{color: '#4f46e5', fontSize: 12, fontWeight: 700, letterSpacing: 2}}>React(v2) · 数据库动态页面</p>
    <h1>React 类型示例</h1><p>这个页面的 content_type 是 react，代码从数据库读取后在浏览器中编译并渲染。</p>
    <section style={{marginTop: 24, border: '1px solid #e5e7eb', borderRadius: 14, padding: 24, background: '#fff'}}><h2>组件状态</h2><p>页面 ID：{pageId}</p><p>当前值：<strong>{count}</strong></p><button type="button" onClick={() => setCount(count + 1)}>增加值</button><button type="button" onClick={() => setCount(0)} style={{marginLeft: 8}}>重置</button></section>
  </main>;
}`
