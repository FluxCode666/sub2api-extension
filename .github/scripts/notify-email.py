"""通过 SMTP 发送 GitHub Release 工作流结果。"""

import os
import re
import smtplib
import ssl
import sys
from email.message import EmailMessage
from email.utils import formataddr, parseaddr


def recipients(value: str) -> list[str]:
    """Parse and validate a comma/semicolon/whitespace-separated list."""
    values = [item.strip() for item in re.split(r"[,;\s]+", value) if item.strip()]
    result = []
    seen = set()
    for value in values:
        address = parseaddr(value)[1]
        if address != value or "@" not in address or address.startswith("@") or address.endswith("@"):
            raise ValueError(f"收件人邮箱无效：{value}")
        key = address.casefold()
        if key not in seen:
            result.append(address)
            seen.add(key)
    return result


def release_body() -> tuple[str, str]:
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
    subject = f"GitHub Release {status}：{tag}"
    body = "\n".join(
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
    return subject, body


def send_email(host: str, port: int, username: str, password: str, sender: str, to: list[str], subject: str, body: str) -> None:
    message = EmailMessage()
    message["From"] = formataddr(("GitHub Release", sender))
    message["To"] = ", ".join(to)
    message["Subject"] = subject
    message.set_content(body)
    context = ssl.create_default_context()
    if port == 465:
        with smtplib.SMTP_SSL(host, port, timeout=10, context=context) as client:
            if username:
                client.login(username, password)
            client.send_message(message)
        return
    with smtplib.SMTP(host, port, timeout=10) as client:
        client.ehlo()
        client.starttls(context=context)
        client.ehlo()
        if username:
            client.login(username, password)
        client.send_message(message)


def main() -> int:
    raw_to = os.environ.get("RELEASE_EMAIL_TO", "").strip()
    if not raw_to:
        print("RELEASE_EMAIL_TO 未配置，跳过邮件通知。")
        return 0

    host = os.environ.get("RELEASE_SMTP_HOST", "").strip()
    sender = os.environ.get("RELEASE_SMTP_FROM", "").strip()
    if not host or not sender:
        print("邮件通知需要同时配置 RELEASE_SMTP_HOST 和 RELEASE_SMTP_FROM。", file=sys.stderr)
        return 1
    try:
        port = int(os.environ.get("RELEASE_SMTP_PORT", "") or "587")
        to = recipients(raw_to)
        if not to:
            raise ValueError("至少需要一个收件人邮箱")
        subject, body = release_body()
        send_email(
            host,
            port,
            os.environ.get("RELEASE_SMTP_USERNAME", "").strip(),
            os.environ.get("RELEASE_SMTP_PASSWORD", ""),
            sender,
            to,
            subject,
            body,
        )
    except (ValueError, OSError, smtplib.SMTPException) as error:
        print(f"邮件通知发送失败：{error}", file=sys.stderr)
        return 1

    print(f"已发送 GitHub Release 邮件通知，收件人数量：{len(to)}。")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
