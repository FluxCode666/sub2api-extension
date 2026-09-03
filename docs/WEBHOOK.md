# 通用 Webhook 接入文档

通用 Webhook 用于把系统消息通知投递到自建服务、内部自动化平台或第三方中转服务。它是消息通知渠道的一种配置方式，和企业微信机器人、飞书机器人、钉钉机器人适配器相互独立。

## 1. 在管理端配置

进入管理端 `/admin/notifications`，点击“新增渠道”：

1. 渠道类型选择 **Webhook**。
2. 填写接收服务的 HTTPS URL。
3. 如接收端需要鉴权，可填写 `Authorization`。
4. 如需要共享密钥校验，可填写“请求头密钥”。系统会将它放在 `X-Webhook-Secret` 请求头中。
5. 保存渠道后，在具体业务事件（当前是“发票申请通知”）中勾选该渠道并保存事件配置。

通用 Webhook 不需要填写收件人邮箱。目标地址、鉴权信息和密钥保存在渠道配置中；事件配置只决定哪些消息发送到该渠道。

## 2. HTTP 协议

系统向配置的 URL 发起：

```http
POST https://notify.example.com/hooks/aux
Content-Type: application/json
Authorization: Bearer <your-token>
X-Webhook-Secret: <your-secret>
```

`Authorization` 和 `X-Webhook-Secret` 都是可选的；未填写时不会发送对应请求头。请求超时时间为 10 秒，系统不会因为通用 Webhook 的失败而回滚业务操作。

接收端返回任意 `2xx` 状态码即视为发送成功。返回 `4xx`、`5xx`、连接失败或超时会被记录为发送失败，响应体最多记录 300 个字符用于排查。通用 Webhook 的响应体不要求是 JSON，也可以为空。

## 3. 请求体

请求体是 JSON 对象，由业务事件决定字段。当前发票申请事件 `invoice.application.created` 的示例：

```json
{
  "event": "invoice.application.created",
  "invoice_request_id": 123,
  "user_email": "user@example.com",
  "invoice_title": "某某科技有限公司",
  "amount": 99.5,
  "status": "PENDING"
}
```

字段说明：

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `event` | string | 事件名称，当前为 `invoice.application.created` |
| `invoice_request_id` | number | 发票申请记录 ID |
| `user_email` | string | 申请人的邮箱 |
| `invoice_title` | string | 发票抬头 |
| `amount` | number | 发票金额 |
| `status` | string | 发票申请当前状态 |

后续事件可能增加或调整字段。接收端建议忽略未知字段，不要要求字段顺序固定，并根据 `event` 分发处理逻辑。

## 4. 接收端示例

### Node.js / Express

```js
import express from 'express'

const app = express()
app.use(express.json())

app.post('/hooks/aux', (req, res) => {
  if (req.get('X-Webhook-Secret') !== process.env.AUX_WEBHOOK_SECRET) {
    return res.status(401).json({ error: 'invalid webhook secret' })
  }

  const message = req.body
  if (message.event !== 'invoice.application.created') {
    return res.status(204).end()
  }

  // 先快速确认收到，再异步执行耗时任务。
  console.log('invoice application created:', message.invoice_request_id)
  return res.status(204).end()
})

app.listen(3000)
```

### Go / net/http

```go
func webhookHandler(w http.ResponseWriter, r *http.Request) {
	if r.Header.Get("X-Webhook-Secret") != os.Getenv("AUX_WEBHOOK_SECRET") {
		http.Error(w, "invalid webhook secret", http.StatusUnauthorized)
		return
	}
	defer r.Body.Close()

	var message struct {
		Event            string  `json:"event"`
		InvoiceRequestID int     `json:"invoice_request_id"`
		UserEmail        string  `json:"user_email"`
		InvoiceTitle     string  `json:"invoice_title"`
		Amount           float64 `json:"amount"`
		Status           string  `json:"status"`
	}
	if err := json.NewDecoder(r.Body).Decode(&message); err != nil {
		http.Error(w, "invalid json", http.StatusBadRequest)
		return
	}

	// 根据 message.Event 交给队列或后台任务处理。
	w.WriteHeader(http.StatusNoContent)
}
```

## 5. 可靠性与幂等建议

- 接收端应在 10 秒内返回 `2xx`，耗时处理放入队列或后台任务。
- 当前通用 Webhook 不自动重试；失败结果会写入系统消息通知日志，管理员可据此排查。
- 接收端应按业务唯一键去重。发票事件可使用 `event + invoice_request_id` 作为幂等键。
- 不要仅依赖来源 IP；优先校验 `X-Webhook-Secret` 或 `Authorization`，并使用 HTTPS。
- 密钥只在管理端保存，不要写入前端代码、Webhook URL 的公开文档、日志或错误响应。
- 建议记录请求接收时间、事件名和业务 ID，但不要记录完整的鉴权请求头。

## 6. 故障排查

在 `/admin/notifications` 的“系统消息通知日志”中查看发送结果：

- **发送成功**：接收端返回 `2xx`。
- **发送失败**：检查 URL、DNS、TLS 证书、网络访问权限和接收端 HTTP 状态码。
- **401/403**：检查 `Authorization` 或 `X-Webhook-Secret` 是否与接收端配置一致。
- **404**：检查路径是否包含完整的 Webhook 路由。
- **5xx/超时**：检查接收端服务是否可用，并确保先快速返回 `2xx`。

测试渠道按钮会发送一条 `notification.channel.test` 测试消息。通用 Webhook 测试消息的请求体示例：

```json
{
  "event": "notification.channel.test",
  "channel_id": 7,
  "channel_name": "内部自动化 Webhook",
  "channel_type": "webhook"
}
```
