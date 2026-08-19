/**
 * 动态 React 组件编译器
 *
 * 使用 Babel standalone 在浏览器中编译 JSX/TSX 代码为可执行的 React 组件。
 * Babel 通过 CDN 动态加载，避免增加主 bundle 体积。
 */

import React from 'react'

// Babel 类型定义
interface BabelStandalone {
  transform: (code: string, options: any) => { code: string }
}

let babelInstance: BabelStandalone | null = null

/**
 * 懒加载 Babel standalone (通过 CDN)
 */
async function loadBabel(): Promise<BabelStandalone> {
  if (babelInstance) {
    return babelInstance
  }

  // 从 CDN 加载 Babel standalone
  const script = document.createElement('script')
  script.src = 'https://unpkg.com/@babel/standalone@7.24.0/babel.min.js'

  const loaded = new Promise<void>((resolve, reject) => {
    script.onload = () => resolve()
    script.onerror = () => reject(new Error('Failed to load Babel'))
  })

  document.head.appendChild(script)
  await loaded

  // @ts-ignore - Babel 会挂载到 window.Babel
  babelInstance = window.Babel
  if (!babelInstance) {
    throw new Error('Babel not found on window')
  }

  return babelInstance
}

/**
 * 编译 TSX/JSX 代码为 ES5 代码
 */
export async function compileReactCode(tsxCode: string): Promise<string> {
  const babel = await loadBabel()

  try {
    // 预处理：将 export default 转换为 module.exports.default
    let processedCode = tsxCode.trim()

    // 移除 export default，我们会在后面手动处理
    // 支持多种形式：
    // 1. export default function Name() {}
    // 2. export default () => {}
    // 3. export default function() {}
    processedCode = processedCode.replace(/export\s+default\s+/g, '__exportDefault__ = ')

    const result = babel.transform(processedCode, {
      presets: ['react', 'typescript'],
      filename: 'dynamic-component.tsx',
    })

    return result.code
  } catch (error: any) {
    throw new Error(`编译失败: ${error.message}`)
  }
}

/**
 * 将编译后的代码转换为可执行的 React 组件
 *
 * 代码必须 export default 一个 React 组件函数
 */
export function createComponentFromCode(compiledCode: string): React.ComponentType {
  try {
    // 构造函数体，声明 __exportDefault__ 变量来接收组件
    const functionBody = `
      let __exportDefault__;
      ${compiledCode}
      return __exportDefault__;
    `

    // 创建函数并执行
    const factory = new Function('React', functionBody)
    const Component = factory(React)

    if (!Component) {
      throw new Error('组件必须使用 export default 导出')
    }

    if (typeof Component !== 'function') {
      throw new Error('导出的必须是一个函数组件')
    }

    return Component
  } catch (error: any) {
    throw new Error(`组件创建失败: ${error.message}`)
  }
}

/**
 * 完整流程：编译 TSX 代码并创建可执行组件
 */
export async function compileAndCreateComponent(tsxCode: string): Promise<React.ComponentType> {
  const compiledCode = await compileReactCode(tsxCode)
  return createComponentFromCode(compiledCode)
}
