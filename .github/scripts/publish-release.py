"""只有应用和更新服务的多架构镜像均构建成功，才公开 Release。"""
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
    for key in ("APP_DIGEST", "UPDATER_DIGEST"):
        if not re.fullmatch(r"sha256:[0-9a-f]{64}", os.environ[key]):
            raise RuntimeError("镜像构建未返回有效摘要，禁止发布")
    Path("release-manifest.json").write_text(json.dumps({
        "schema": 1, "version": tag, "image": image,
        "digest": os.environ["APP_DIGEST"],
        "updaterDigest": os.environ["UPDATER_DIGEST"],
        "commit": os.environ["GITHUB_SHA"],
    }, indent=2) + "\n")
    existing = subprocess.run(["gh", "release", "view", tag, "--json", "isDraft"], capture_output=True, text=True)
    if existing.returncode == 0:
        if not json.loads(existing.stdout)["isDraft"]:
            raise RuntimeError("此版本已公开，不允许覆盖")
    else:
        run("gh", "release", "create", tag, "--verify-tag", "--draft", "--title", f"{tag} · Sub2API 扩展系统", "--notes-file", "release-notes.md")
    run("gh", "release", "edit", tag, "--notes-file", "release-notes.md", "--title", f"{tag} · Sub2API 扩展系统", f"--prerelease={os.environ['IS_PRERELEASE']}")
    run("gh", "release", "upload", tag, "release-manifest.json", "deploy/docker-compose.yml", "deploy/docker-compose.update.yml", "deploy/UPDATES.md", "--clobber")
    run("gh", "release", "edit", tag, "--draft=false", f"--latest={os.environ['IS_LATEST']}")
    with open(os.environ["GITHUB_STEP_SUMMARY"], "a") as output:
        output.write(f"## {tag} 发布完成\n\n- Docker 镜像：`{image}:{tag}`\n- 镜像摘要：`{os.environ['APP_DIGEST']}`\n- [查看中文 Release](https://github.com/{os.environ['GITHUB_REPOSITORY']}/releases/tag/{tag})\n- 服务器保持当前版本，更新由管理员主动发起。\n")


if __name__ == "__main__":
    main()
