# Sub2API Extension NGINX 生产配置

这套配置参考 `upstream-hub/deploy/nginx`，假设 NGINX 安装在宿主机，
`aux-backend` 由 `deploy/docker-compose.prod.yml` 运行在宿主机 `127.0.0.1:8787`。

## 安装

先将 `conf.d/sub2api-extension.conf` 中的 `aux.example.com` 替换为实际域名，
再将配置复制到 NGINX：

```bash
sudo install -Dm644 deploy/nginx/nginx.conf /etc/nginx/nginx.conf
sudo install -Dm644 deploy/nginx/conf.d/sub2api-extension.conf /etc/nginx/conf.d/sub2api-extension.conf
sudo install -Dm644 deploy/nginx/snippets/sub2api-extension-proxy.conf /etc/nginx/snippets/sub2api-extension-proxy.conf
```

证书统一放在 NGINX 配置目录下：

```text
/etc/nginx/certs/<你的域名>/fullchain.pem
/etc/nginx/certs/<你的域名>/privkey.pem
```

替换域名并准备证书后检查并加载：

```bash
sudo nginx -t
sudo systemctl reload nginx
```

## 部署顺序

```bash
cd deploy
cp .env.prod.example .env.prod
# 填写 AUX_IMAGE、DATABASE_*、SUB2API_BASE_URL、AUX_JWT_SECRET、AUX_PUBLIC_HOST
docker compose -f docker-compose.prod.yml --env-file .env.prod up -d

curl http://127.0.0.1:8787/health
curl -I https://<你的域名>/health
```

生产 Compose 默认将应用端口绑定到 `127.0.0.1`，避免绕过 HTTPS NGINX。
同一 `sub2api-network` 中的 sub2api 仍可以通过 `http://aux-backend:8787` 访问容器服务。

## iframe 与图片 URL

外部页面应使用浏览器可访问的完整 URL，例如：

```text
https://<你的域名>/p/home
https://<你的域名>/admin/dashboard
```

图片资源接口返回相对路径 `/api/aux/assets/:id`，管理端会基于当前浏览器的
`window.location.origin` 补全域名。因此通过 NGINX 域名访问资源页并复制 URL 时，
数据库元数据里应填写 `https://<你的域名>/api/aux/assets/:id`，不要填写容器名或 localhost。

配置没有添加 `X-Frame-Options`，以保留 sub2api 和其他宿主页面的 iframe 嵌入能力。
