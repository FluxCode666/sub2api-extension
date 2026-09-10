#!/usr/bin/env bash
set -euo pipefail

tag="${RELEASE_TAG:?RELEASE_TAG is required}"
commit="${GITHUB_SHA:?GITHUB_SHA is required}"
date_value="${RELEASE_DATE:?RELEASE_DATE is required}"
image="${RELEASE_IMAGE:?RELEASE_IMAGE is required}"

rm -rf release-assets release-root
mkdir -p release-assets release-root

# BuildKit exports the final image filesystem without running it. This lets the
# runner extract the already embedded frontend and the target-architecture
# binary even when the runner itself is amd64.
for arch in amd64 arm64; do
  root="release-root/${arch}"
  docker buildx build \
    --platform "linux/${arch}" \
    --target app \
    --output "type=local,dest=${root}" \
    --build-arg VERSION="${tag}" \
    --build-arg COMMIT="${commit}" \
    --build-arg DATE="${date_value}" \
    --build-arg RELEASE_IMAGE="${image}" \
    --build-arg TARGETOS=linux \
    --build-arg TARGETARCH="${arch}" \
    .

  test -x "${root}/app/aux-server"
  staging="release-root/staging-${arch}"
  mkdir -p "${staging}"
  cp "${root}/app/aux-server" "${staging}/aux-server"
  tar --sort=name --owner=0 --group=0 --numeric-owner \
    -C "${staging}" \
    -czf "release-assets/sub2api-extension_linux_${arch}.tar.gz" \
    aux-server
done

(cd release-assets && sha256sum sub2api-extension_linux_*.tar.gz > checksums.txt)
