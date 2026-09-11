#!/bin/sh
set -eu

asset_dir="${SUB2API_EXTENSION_ASSET_DIR:-/app/data/assets}"

if [ "$(id -u)" -eq 0 ]; then
    case "$asset_dir" in
        /)
            echo "SUB2API_EXTENSION_ASSET_DIR must not be the filesystem root" >&2
            exit 1
            ;;
        /*) ;;
        *)
            echo "SUB2API_EXTENSION_ASSET_DIR must be an absolute path in the container" >&2
            exit 1
            ;;
    esac

    mkdir -p "$asset_dir/photos" "$asset_dir/invoices"
    chown aux:aux "$asset_dir" "$asset_dir/photos" "$asset_dir/invoices"
    case "$asset_dir" in
        /app/data|/app/data/*) chown aux:aux /app/data ;;
    esac
    exec su-exec aux:aux /app/aux-server "$@"
fi

exec /app/aux-server "$@"
