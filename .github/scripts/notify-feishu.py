"""向飞书机器人发送 GitHub Release 工作流结果。"""

import base64
import hashlib
import hmac
import json
import os
import sys
import time
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen


def sign(timestamp: int, secret: str) -> str:
    """Return the signature required by Feishu custom bots."""
    string_to_sign = f"{timestamp}\n{secret}".encode("utf-8")
    digest = hmac.new(string_to_sign, b"", hashlib.sha256).digest()
    return base64.b64encode(digest).decode("ascii")


def response_error(data: bytes) -> str:
    if not data:
        return "飞书返回空响应"
    try:
        payload = json.loads(data)
    except json.JSONDecodeError:
        return f"飞书返回无效响应：{data[:300].decode('utf-8', errors='replace')}"
    code = payload.get("code", payload.get("StatusCode", 0))
    if code not in (0, None):
        message = payload.get("msg", payload.get("StatusMessage", "未知错误"))
        return f"飞书返回错误：{message} (code={code})"
    return ""


def main() -> int:
    webhook_url = os.environ.get("FEISHU_RELEASE_WEBHOOK_URL", "").strip()
    if not webhook_url:
        print("FEISHU_RELEASE_WEBHOOK_URL 未配置，跳过飞书通知。")
        return 0

    release_result = os.environ.get("RELEASE_RESULT", "unknown")
    quality_result = os.environ.get("QUALITY_GATE_RESULT", "unknown")
    success = release_result == "success" and quality_result == "success"
    status = "发布成功" if success else "发布失败"
    tag = os.environ.get("RELEASE_TAG", "unknown")
    repository = os.environ.get("GITHUB_REPOSITORY", "unknown/unknown")
    release_url = os.environ.get(
        "RELEASE_URL",
        f"https://github.com/{repository}/releases/tag/{tag}",
    )
    actions_url = os.environ.get(
        "ACTIONS_URL",
        f"https://github.com/{repository}/actions/runs/{os.environ.get('GITHUB_RUN_ID', '')}",
    )
    text = "\n".join(
        [
            f"GitHub Release {status}",
            f"仓库：{repository}",
            f"版本：{tag}",
            f"质量检查：{quality_result}",
            f"发布任务：{release_result}",
            f"Release：{release_url}",
            f"Actions：{actions_url}",
        ]
    )
    payload = {"msg_type": "text", "content": {"text": text}}
    secret = os.environ.get("FEISHU_RELEASE_WEBHOOK_SECRET", "").strip()
    if secret:
        timestamp = int(time.time())
        payload["timestamp"] = str(timestamp)
        payload["sign"] = sign(timestamp, secret)

    request = Request(
        webhook_url,
        data=json.dumps(payload, ensure_ascii=False).encode("utf-8"),
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    try:
        with urlopen(request, timeout=10) as response:
            error = response_error(response.read())
            if error:
                print(error, file=sys.stderr)
                return 1
    except HTTPError as error:
        body = error.read()
        detail = response_error(body) or str(error)
        print(f"飞书通知 HTTP 请求失败：{detail}", file=sys.stderr)
        return 1
    except (URLError, TimeoutError, OSError) as error:
        print(f"飞书通知网络请求失败：{error}", file=sys.stderr)
        return 1

    print(f"已发送 GitHub Release {tag} 的飞书通知。")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
