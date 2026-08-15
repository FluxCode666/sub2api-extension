/**
 * 附属后端 API 基础路径常量。
 *
 * 独立的无依赖叶子模块, 供 api-client.ts 与 admin-auth.ts 共享,
 * 避免两者互相导入产生循环依赖(api-client 导入 admin-auth 附加会话头,
 * admin-auth 需要基础路径发起会话换取)。
 */
export const AUX_API_BASE_URL = '/api/aux'
