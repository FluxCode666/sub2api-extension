#!/usr/bin/env python3
"""管理员动态页面 API 工具。

该工具只调用 sub2api-extension 已有的管理员 API，不直接访问数据库。
会话通过 POST /admin/login 临时换取，默认不会写入文件；也可以通过
--session-token 或 AUX_SESSION_TOKEN 复用一个已签发的附属会话。

示例:
  tools/page-admin.py list --base-url https://aux.example.com/api/aux
  tools/page-admin.py create --slug docs --title 文档 --content-file docs.html
  tools/page-admin.py update 12 --enabled false --metadata-file metadata.json
  tools/page-admin.py delete 12

环境变量:
  AUX_API_BASE_URL   默认 http://localhost:8787/api/aux
  AUX_SESSION_TOKEN  已有 X-Aux-Session，会优先于登录
  AUX_ADMIN_EMAIL    登录邮箱（未提供时交互式询问）
  AUX_ADMIN_PASSWORD 登录密码（未提供时使用隐藏输入询问）
"""

from __future__ import annotations

import argparse
import getpass
import json
import os
import sys
from pathlib import Path
from typing import Any
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen


DEFAULT_BASE_URL = "http://localhost:8787/api/aux"


class APIError(RuntimeError):
    """API 请求失败，message 中不包含凭据或完整 token。"""


def parse_bool(value: str) -> bool:
    normalized = value.strip().lower()
    if normalized in ("1", "true", "yes", "on"):
        return True
    if normalized in ("0", "false", "no", "off"):
        return False
    raise argparse.ArgumentTypeError("必须是 true/false")


def json_body(value: Any) -> bytes:
    return json.dumps(value, ensure_ascii=False).encode("utf-8")


def parse_json(raw: bytes) -> Any:
    if not raw:
        return None
    try:
        return json.loads(raw.decode("utf-8"))
    except (UnicodeDecodeError, json.JSONDecodeError):
        return raw.decode("utf-8", errors="replace")


def request(base_url: str, method: str, path: str, *, token: str | None = None, body: Any = None) -> Any:
    url = base_url.rstrip("/") + "/" + path.lstrip("/")
    headers = {"Accept": "application/json"}
    if token:
        headers["X-Aux-Session"] = token
    payload = None
    if body is not None:
        payload = json_body(body)
        headers["Content-Type"] = "application/json"
    req = Request(url, data=payload, headers=headers, method=method.upper())
    try:
        with urlopen(req, timeout=30) as response:
            result = parse_json(response.read())
    except HTTPError as exc:
        result = parse_json(exc.read())
        if isinstance(result, dict):
            message = result.get("message") or f"HTTP {exc.code}"
            reason = result.get("reason")
            if reason:
                message += f" ({reason})"
        else:
            message = f"HTTP {exc.code}: {result or exc.reason}"
        raise APIError(message) from None
    except URLError as exc:
        raise APIError(f"无法连接 {url}: {exc.reason}") from None
    if isinstance(result, dict) and result.get("code", 0) not in (0, None):
        raise APIError(str(result.get("message") or "API request failed"))
    return result


def require_data(result: Any) -> Any:
    if not isinstance(result, dict) or "data" not in result:
        raise APIError("API 返回格式无效")
    return result["data"]


def login(base_url: str, email: str | None, password: str | None) -> str:
    email = email or os.environ.get("AUX_ADMIN_EMAIL") or input("管理员邮箱: ").strip()
    password = password or os.environ.get("AUX_ADMIN_PASSWORD")
    if password is None:
        password = getpass.getpass("管理员密码: ")
    if not email or not password:
        raise APIError("管理员邮箱和密码不能为空")
    data = require_data(request(base_url, "POST", "/admin/login", body={"email": email, "password": password}))
    token = data.get("session_token") if isinstance(data, dict) else None
    if not token:
        raise APIError("登录响应未返回 session_token")
    return token


def read_text(path: str) -> str:
    try:
        return Path(path).read_text(encoding="utf-8")
    except OSError as exc:
        raise APIError(f"无法读取内容文件 {path}: {exc}") from None


def read_metadata(path: str | None) -> dict[str, Any] | None:
    if not path:
        return None
    try:
        value = json.loads(Path(path).read_text(encoding="utf-8"))
    except (OSError, UnicodeDecodeError, json.JSONDecodeError) as exc:
        raise APIError(f"metadata JSON 无效: {path}") from exc
    if not isinstance(value, dict):
        raise APIError("metadata 必须是 JSON object")
    return value


def add_common(parser: argparse.ArgumentParser) -> None:
    parser.add_argument("--base-url", default=os.environ.get("AUX_API_BASE_URL", DEFAULT_BASE_URL), help="API 根地址，例如 https://aux.example.com/api/aux")
    parser.add_argument("--session-token", default=os.environ.get("AUX_SESSION_TOKEN"), help="已有附属会话 JWT；不传则通过管理员登录换取")
    parser.add_argument("--email", help="管理员邮箱（也可使用 AUX_ADMIN_EMAIL）")


def add_page_fields(parser: argparse.ArgumentParser, *, required: bool) -> None:
    parser.add_argument("--slug", required=required, help="小写 slug，例如 docs")
    parser.add_argument("--title", required=required, help="页面标题")
    parser.add_argument("--visibility", choices=("public", "admin"), default=None)
    parser.add_argument("--content-type", choices=("html", "react"), default=None)
    parser.add_argument("--content-file", help="HTML 或 React 源文件路径")
    parser.add_argument("--metadata-file", help="metadata JSON object 文件路径")
    parser.add_argument("--enabled", type=parse_bool, default=None, help="true/false")


def build_page_body(args: argparse.Namespace, existing: dict[str, Any] | None = None) -> dict[str, Any]:
    existing = existing or {}
    content_type = args.content_type or (existing.get("content_type", "html") if existing else "html")
    existing_html = existing.get("content_html", "") if existing else ""
    existing_react = existing.get("content_react", "") if existing else ""
    if content_type == "react":
        content_html, content_react = "", existing_react
    else:
        content_html, content_react = existing_html, ""
    body = {
        "slug": args.slug if args.slug is not None else existing.get("slug", ""),
        "title": args.title if args.title is not None else existing.get("title", ""),
        "visibility": args.visibility or existing.get("visibility", "public"),
        "content_type": content_type,
        "content_html": content_html,
        "content_react": content_react,
        "metadata": existing.get("metadata", {}) if existing else {},
        "enabled": args.enabled if args.enabled is not None else (existing.get("enabled", True) if existing else True),
    }
    if args.content_file:
        content = read_text(args.content_file)
        if body["content_type"] == "react":
            body["content_react"], body["content_html"] = content, ""
        else:
            body["content_html"], body["content_react"] = content, ""
    metadata = read_metadata(args.metadata_file)
    if metadata is not None:
        body["metadata"] = metadata
    return body


def command(args: argparse.Namespace) -> Any:
    token = args.session_token or login(args.base_url, args.email, os.environ.get("AUX_ADMIN_PASSWORD"))
    if args.command == "list":
        return require_data(request(args.base_url, "GET", "/admin/pages", token=token))
    if args.command == "get":
        return require_data(request(args.base_url, "GET", f"/admin/pages/{args.id}", token=token))
    if args.command == "create":
        body = build_page_body(args)
        return require_data(request(args.base_url, "POST", "/admin/pages", token=token, body=body))
    if args.command == "update":
        existing = require_data(request(args.base_url, "GET", f"/admin/pages/{args.id}", token=token))
        body = build_page_body(args, existing)
        return require_data(request(args.base_url, "PUT", f"/admin/pages/{args.id}", token=token, body=body))
    if args.command in ("enable", "disable"):
        existing = require_data(request(args.base_url, "GET", f"/admin/pages/{args.id}", token=token))
        existing["enabled"] = args.command == "enable"
        return require_data(request(args.base_url, "PUT", f"/admin/pages/{args.id}", token=token, body=build_page_body(args, existing)))
    if args.command == "delete":
        return require_data(request(args.base_url, "DELETE", f"/admin/pages/{args.id}", token=token))
    raise APIError(f"未知命令: {args.command}")


def make_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="sub2api-extension 管理员动态页面 API 工具")
    sub = parser.add_subparsers(dest="command", required=True)
    list_parser = sub.add_parser("list", help="列出页面")
    get_parser = sub.add_parser("get", help="获取页面详情")
    get_parser.add_argument("id", type=int)
    create_parser = sub.add_parser("create", help="创建页面")
    add_page_fields(create_parser, required=True)
    update_parser = sub.add_parser("update", help="更新页面（未提供字段保持不变）")
    update_parser.add_argument("id", type=int)
    add_page_fields(update_parser, required=False)
    for name, help_text in (("enable", "启用页面"), ("disable", "停用页面")):
        toggle = sub.add_parser(name, help=help_text)
        toggle.add_argument("id", type=int)
        toggle.slug = None
        toggle.title = None
        toggle.visibility = None
        toggle.content_type = None
        toggle.content_file = None
        toggle.metadata_file = None
        toggle.enabled = None
    delete_parser = sub.add_parser("delete", help="删除页面（埋点历史会保留）")
    delete_parser.add_argument("id", type=int)
    for child in sub.choices.values():
        add_common(child)
    return parser


def main() -> int:
    args = make_parser().parse_args()
    try:
        result = command(args)
    except APIError as exc:
        print(f"错误: {exc}", file=sys.stderr)
        return 1
    print(json.dumps(result, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
