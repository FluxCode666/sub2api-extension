import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import ContentExamplePage from './ContentExamplePage'

describe('ContentExamplePage', () => {
  it('renders structured static admin content without an API dependency', () => {
    render(<ContentExamplePage />)

    expect(
      screen.getByRole('heading', { name: '静态内容示例' }),
    ).toBeInTheDocument()
    expect(screen.getByText('系统状态')).toBeInTheDocument()
    expect(screen.getByText('管理端路由')).toBeInTheDocument()
    expect(screen.getByText('管理员权限')).toBeInTheDocument()
    expect(screen.getByText('页面 ID')).toBeInTheDocument()
    expect(screen.getByText('example-content')).toBeInTheDocument()
    expect(screen.getByText('数据来源')).toBeInTheDocument()
    expect(screen.getByText('本地静态内容')).toBeInTheDocument()
  })
})
