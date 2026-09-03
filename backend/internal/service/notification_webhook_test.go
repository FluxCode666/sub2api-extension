package service

import (
	"context"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"net/url"
	"strconv"
	"strings"
	"testing"
	"time"
)

func TestSendWebhookProviders(t *testing.T) {
	tests := []struct {
		name     string
		provider string
		secret   string
		response string
		assert   func(t *testing.T, request *http.Request, body map[string]interface{})
	}{
		{
			name:     "generic",
			provider: "generic",
			response: `{}`,
			assert: func(t *testing.T, request *http.Request, body map[string]interface{}) {
				if body["event"] != "invoice.application.created" {
					t.Fatalf("generic payload event = %v", body["event"])
				}
				if request.Header.Get("Authorization") != "Bearer test-token" || request.Header.Get("X-Webhook-Secret") != "header-secret" {
					t.Fatalf("generic headers not forwarded: %v", request.Header)
				}
			},
		},
		{
			name:     "wecom",
			provider: "wecom",
			response: `{"errcode":0,"errmsg":"ok"}`,
			assert: func(t *testing.T, request *http.Request, body map[string]interface{}) {
				if body["msgtype"] != "text" || body["text"].(map[string]interface{})["content"] != "测试主题\n测试正文" {
					t.Fatalf("unexpected wecom payload: %#v", body)
				}
			},
		},
		{
			name:     "feishu bot",
			provider: "feishu_bot",
			secret:   "feishu-secret",
			response: `{"code":0,"msg":"success"}`,
			assert: func(t *testing.T, request *http.Request, body map[string]interface{}) {
				if body["msg_type"] != "text" || body["content"].(map[string]interface{})["text"] != "测试主题\n测试正文" {
					t.Fatalf("unexpected feishu payload: %#v", body)
				}
				if _, ok := body["timestamp"].(string); !ok || body["sign"] == "" {
					t.Fatalf("feishu signature fields missing: %#v", body)
				}
			},
		},
		{
			name:     "dingtalk",
			provider: "dingtalk",
			secret:   "ding-secret",
			response: `{"errcode":0,"errmsg":"ok"}`,
			assert: func(t *testing.T, request *http.Request, body map[string]interface{}) {
				query := request.URL.Query()
				if query.Get("timestamp") == "" || query.Get("sign") == "" {
					t.Fatalf("dingtalk signature query missing: %v", query)
				}
				if body["msgtype"] != "text" {
					t.Fatalf("unexpected dingtalk payload: %#v", body)
				}
			},
		},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			server := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
				data, err := io.ReadAll(request.Body)
				if err != nil {
					t.Errorf("read request body: %v", err)
					return
				}
				var body map[string]interface{}
				if err := json.Unmarshal(data, &body); err != nil {
					t.Errorf("decode request body: %v", err)
					return
				}
				test.assert(t, request, body)
				writer.Header().Set("Content-Type", "application/json")
				_, _ = writer.Write([]byte(test.response))
			}))
			defer server.Close()

			cfg := map[string]interface{}{"provider": test.provider, "url": server.URL, "secret": test.secret, "authorization": "Bearer test-token"}
			if test.provider == "generic" {
				cfg["secret"] = "header-secret"
			}
			service := &NotificationService{httpClient: server.Client()}
			if err := service.sendWebhook(context.Background(), cfg, "测试主题", "测试正文", map[string]interface{}{"event": "invoice.application.created"}); err != nil {
				t.Fatalf("send webhook: %v", err)
			}
		})
	}
}

func TestSendWebhookProviderErrors(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
		writer.Header().Set("Content-Type", "application/json")
		_, _ = writer.Write([]byte(`{"errcode":93000,"errmsg":"invalid webhook"}`))
	}))
	defer server.Close()

	service := &NotificationService{httpClient: server.Client()}
	err := service.sendWebhook(context.Background(), map[string]interface{}{"provider": "wecom", "url": server.URL}, "subject", "body", nil)
	if err == nil || !strings.Contains(err.Error(), "企业微信发送失败") {
		t.Fatalf("expected provider error, got %v", err)
	}
}

func TestAddDingTalkSignaturePreservesQuery(t *testing.T) {
	timestamp := time.Now().UnixMilli()
	values, err := url.ParseQuery("access_token=token")
	if err != nil {
		t.Fatal(err)
	}
	result, err := url.ParseQuery(addDingTalkSignature(values, timestamp, "secret"))
	if err != nil {
		t.Fatal(err)
	}
	if result.Get("access_token") != "token" || result.Get("timestamp") != strconv.FormatInt(timestamp, 10) || result.Get("sign") == "" {
		t.Fatalf("unexpected signed query: %v", result)
	}
}
