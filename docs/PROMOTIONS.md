# 促销活动

促销活动数据属于附属系统。管理员在 `/admin/promotions` 创建活动，返利规则支持：

用户端页面顶部展示名称读取自系统配置中的“网站名称”（兼容旧配置的 `heroTitle`），无需在促销页面单独维护品牌名称。

- `FIXED`：每笔符合条件的已完成余额充值订单返固定金额。
- `PERCENTAGE`：按订单支付金额乘以百分比计算，结果保留两位小数，比例不能超过 100%。
- 订单的支付时间必须落在活动开始时间（含）至结束时间（不含）的范围内；未设置某一端时间时，该端不设限制。

用户端 `/promotions` 通过 Sub2API `custom_menu_items` 以 iframe 打开，侧边栏同时展示进行中和已结束的已上架活动；已结束活动默认折叠，并按结束时间倒序排列。所有订单请求经过 `UserGuard`，订单归属由后端从 Sub2API 数据库重新校验。一个充值订单在所有促销活动中只能领取一次，领取记录使用 `payment_order_id` 全局唯一索引；重复领取返回 409。

切换活动时，右侧保留当前活动说明、返利规则和订单，显示正在加载的目标活动名称；请求成功后整体更新，避免列表先清空再出现。加载期间或请求失败时禁止选择和领取旧订单，失败后可直接重试。快速切换只采用最后一次请求的结果，重复点击当前活动不会重新加载或清空已选订单。领取提交期间暂时禁止切换活动和修改订单选择。

管理员接口（均需 `X-Aux-Session`）：

- `GET/POST /api/aux/admin/promotions`
- `GET/PUT/DELETE /api/aux/admin/promotions/:id`
- `GET /api/aux/admin/promotions/:id/stats`
- `GET/PUT /api/aux/admin/promotions/config`，控制用户端页面是否上架
- `PUT /api/aux/admin/promotions/:id/publish`，请求体为 `{"published":true|false}`

用户接口（均需 `X-Aux-Token`，由 `UserGuard` 验证）：

- `GET /api/aux/promotions`
- `GET /api/aux/promotions/:id/orders`
- `POST /api/aux/promotions/:id/claim`，请求体为 `{"order_ids":[...]}`
- `GET /api/aux/promotions/claims`

发布开关会同步 Sub2API `settings.custom_menu_items` 中稳定 ID 为 `aux-promotions` 的用户菜单。未配置 Sub2API 数据库或扩展公网地址时，活动数据仍可保存，但菜单同步会返回警告。

返利领取会同时完成两步：在 Sub2API 数据库事务中原子增加当前用户的 `users.balance` 与 `total_recharged`，并写入 `payment_audit_logs`；在附属系统保存 `promotion_claims` 发放记录。余额入账使用充值订单 ID 的事务级全局幂等键，扩展记录落库失败后的重试不会重复增加余额。Sub2API 数据库不可用或余额更新失败时，领取接口返回 503，不能产生已领取记录。

为让 Sub2API 网关立即看到新余额，生产环境还应配置 `SUB2API_REDIS_HOST`（以及需要的
`SUB2API_REDIS_PORT`、`SUB2API_REDIS_USERNAME`、`SUB2API_REDIS_PASSWORD`、`SUB2API_REDIS_DB`、
`SUB2API_REDIS_ENABLE_TLS`）。扩展会在入账提交后删除 `billing:balance:<userID>`，并在支持
`auth_cache_invalidation_outbox` 的 Sub2API 数据库中排队失效该用户的 API Key 认证缓存。未配置
Redis 时数据库余额仍会正确更新，但网关缓存可能要等其 TTL 到期后才显示新值。
