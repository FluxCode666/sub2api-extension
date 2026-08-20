# Changelog

## [0.1.0] - 2026-08-20

### Added

- 增加 sub2api 附属管理端，根路径重定向到 `/admin/dashboard`。
- 增加数据库动态页面管理，支持 HTML、React/TSX、页面元数据、公开页和管理员页。
- 增加图片资源管理、动态菜单图标和动态页面管理员 API 工具。
- 增加页面访问量、功能点击埋点和分析仪表盘。
- 增加 `sub2api-extension-page-writer` 等项目协作 skill。

### Changed

- 将页面内容和配置统一落到附属系统自己的 PostgreSQL `pages` 表。
- 生产部署支持推送 semver tag 自动触发，并使用 tag 作为镜像版本号。

### Fixed

- 修复动态 HTML iframe 中非页内链接的顶层跳转，避免开发环境 `origin=null` 导致的空白页。
- 修复仪表盘布局、标题裁切和轨道节点动画视觉问题。
