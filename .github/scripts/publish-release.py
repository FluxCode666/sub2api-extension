"""发布应用镜像摘要和当前平台二进制更新包。"""
import json
import os
from pathlib import Path
import re
import subprocess


def run(*args):
    subprocess.run(args, check=True)


def main():
    tag = os.environ["RELEASE_TAG"]
    image = os.environ["RELEASE_IMAGE"]
    if not re.fullmatch(r"sha256:[0-9a-f]{64}", os.environ["APP_DIGEST"]):
        raise RuntimeError("镜像构建未返回有效摘要，禁止发布")
    assets = sorted(str(path) for path in Path("release-assets").glob("sub2api-extension_linux_*.tar.gz"))
    if len(assets) != 2 or not Path("release-assets/checksums.txt").is_file():
        raise RuntimeError("缺少 linux/amd64 和 linux/arm64 更新包或 checksums.txt")
    Path("release-manifest.json").write_text(json.dumps({
        "schema": 1, "version": tag, "image": image,
        "digest": os.environ["APP_DIGEST"],
        "commit": os.environ["GITHUB_SHA"],
    }, indent=2) + "\n")
    existing = subprocess.run(["gh", "release", "view", tag, "--json", "isDraft"], capture_output=True, text=True)
    if existing.returncode == 0:
        if not json.loads(existing.stdout)["isDraft"]:
            raise RuntimeError("此版本已公开，不允许覆盖")
    else:
        run("gh", "release", "create", tag, "--verify-tag", "--draft", "--title", f"{tag} · Sub2API 扩展系统", "--notes-file", "release-notes.md")
    run("gh", "release", "edit", tag, "--notes-file", "release-notes.md", "--title", f"{tag} · Sub2API 扩展系统", f"--prerelease={os.environ['IS_PRERELEASE']}")
    run("gh", "release", "upload", tag, "release-manifest.json", *assets, "release-assets/checksums.txt", "deploy/docker-compose.yml", "deploy/UPDATES.md", "--clobber")
    run("gh", "release", "edit", tag, "--draft=false", f"--latest={os.environ['IS_LATEST']}")
    with open(os.environ["GITHUB_STEP_SUMMARY"], "a") as output:
        output.write(f"## {tag} 发布完成\n\n- Docker 镜像：`{image}:{tag}`\n- 镜像摘要：`{os.environ['APP_DIGEST']}`\n- 二进制更新包：`linux/amd64`、`linux/arm64`\n- [查看中文 Release](https://github.com/{os.environ['GITHUB_REPOSITORY']}/releases/tag/{tag})\n- 更新由应用进程下载并原子替换，管理员完成后手动重启服务。\n")


if __name__ == "__main__":
    main()
