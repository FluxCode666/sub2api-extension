"""验证不可变的 semver tag，并从 CHANGELOG.md 提取中文发布说明。"""
import datetime
import json
import os
from pathlib import Path
import re
import subprocess


def github(path):
    result = subprocess.run(["gh", "api", path], capture_output=True, text=True)
    if result.returncode:
        if re.search(r"\b404\b", result.stderr):
            return None
        raise RuntimeError("无法读取 GitHub 发布信息，请检查仓库权限和网络")
    return json.loads(result.stdout)


def main():
    tag = os.environ["RELEASE_TAG"]
    pattern = r"v?(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)(?:-((?:0|[1-9][0-9]*|[0-9]*[A-Za-z-][0-9A-Za-z-]*)(?:\.(?:0|[1-9][0-9]*|[0-9]*[A-Za-z-][0-9A-Za-z-]*))*))?"
    match = re.fullmatch(pattern, tag)
    if os.environ.get("GITHUB_REF_TYPE") != "tag" or not match or len(tag) > 110:
        raise RuntimeError("请通过有效的版本 tag 发布，例如 v0.6.0 或 v0.6.0-rc.1")
    repository = os.environ["GITHUB_REPOSITORY"]
    existing = github(f"repos/{repository}/releases/tags/{tag}")
    if existing and not existing["draft"]:
        raise RuntimeError("此版本已经发布，不允许覆盖；请创建新的版本 tag")
    latest = github(f"repos/{repository}/releases/latest")
    prerelease = match[4] is not None
    is_latest = not prerelease
    if latest and is_latest:
        previous = re.fullmatch(r"v?(\d+)\.(\d+)\.(\d+)", latest["tag_name"])
        if previous:
            is_latest = tuple(map(int, match.groups()[:3])) > tuple(map(int, previous.groups()))
    changelog = Path("CHANGELOG.md").read_text()
    sections = re.split(r"(?m)^## ", changelog)
    notes = next((section for section in sections[1:] if re.match(r"\[?" + re.escape(tag.lstrip("v")) + r"\]?(?:\s|$)", section) or re.match(r"\[?" + re.escape(tag) + r"\]?(?:\s|$)", section)), None)
    if not notes:
        raise RuntimeError(f"请先在 CHANGELOG.md 添加 ## [{tag}] 及本次中文变更说明")
    image = f"ghcr.io/{repository.split('/')[0].lower()}/sub2api-extension"
    Path("release-notes.md").write_text("## " + notes.strip() + f"\n\n### 镜像与更新\n\n- 应用镜像：`{image}:{tag}`\n- 更新服务镜像：`{image}:{tag}-updater`\n- 支持 `linux/amd64`、`linux/arm64`。\n- 本次发布不连接服务器、不自动部署；已启用更新服务的管理员可点击控制台左上角版本号更新。\n- 首次安装或启用更新服务，请查看 [更新指南](https://github.com/{repository}/blob/{tag}/deploy/UPDATES.md)。\n- 更新前备份数据库和上传资源；应用回退不会撤销数据库迁移。\n")
    with open(os.environ["GITHUB_OUTPUT"], "a") as output:
        output.write(f"image={image}\ndate={datetime.datetime.now(datetime.timezone.utc).isoformat()}\nlatest={str(is_latest).lower()}\nprerelease={str(prerelease).lower()}\n")


if __name__ == "__main__":
    main()
