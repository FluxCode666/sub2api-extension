import { Component, type ReactNode } from 'react'
import { Button } from '@/components/ui/button'

type Props = { children: ReactNode; routeKey: string }

/** 分包下载失败时提供手动刷新入口，避免断网或版本更新后出现白屏。 */
export default class PageLoadBoundary extends Component<Props, { failed: boolean }> {
  state = { failed: false }

  static getDerivedStateFromError() {
    return { failed: true }
  }

  componentDidUpdate(previous: Props) {
    if (this.state.failed && previous.routeKey !== this.props.routeKey) {
      this.setState({ failed: false })
    }
  }

  render() {
    if (!this.state.failed) return this.props.children
    return <main className="aux-not-found" role="alert">
      <div className="max-w-md text-center">
        <h1>页面加载失败</h1>
        <p>请检查网络连接后重新加载页面。</p>
        <Button onClick={() => window.location.reload()}>重新加载</Button>
      </div>
    </main>
  }
}
