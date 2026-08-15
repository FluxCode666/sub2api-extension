import React from 'react'
import ReactDOM from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import App from './App'
import { initEmbeddedContext } from '@/lib/embedded'
import { applyTheme } from '@/lib/theme'
import { initTelemetry } from '@/lib/telemetry-sdk'
import './index.css'

// 启动时解析 sub2api iframe 传入的查询参数,立即应用主题/语言。
// token 仅存内存,供 U3 上报鉴权使用。
const ctx = initEmbeddedContext(window.location.search)
applyTheme(ctx.theme)
// 语言随动占位:lang 值已解析到 ctx,U4 接入 i18n 时使用。
// if (ctx.lang) { ... }

// 初始化埋点 SDK(U5): 监听路由切换自动上报 page_view, 上报失败不阻塞页面。
initTelemetry()

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <BrowserRouter>
      <App />
    </BrowserRouter>
  </React.StrictMode>,
)
