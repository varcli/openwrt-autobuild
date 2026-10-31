#!/bin/bash
# 由两个目标的 build.sh source；关键步骤失败时立即停止构建。
set -eo pipefail

ROOTFS_PARTSIZE="${ROOTFS_PARTSIZE:-1024}"
PROFILE="${PROFILE:-generic}"
if [[ ! "$ROOTFS_PARTSIZE" =~ ^[0-9]+$ || ! "$ROOTFS_PARTSIZE" =~ [1-9] ]]; then
    echo "错误：ROOTFS_PARTSIZE 必须是正整数（MB）" >&2
    exit 1
fi
case "$INCLUDE_DOCKER" in
    yes|no) ;;
    *) echo "错误：INCLUDE_DOCKER 仅支持 yes/no" >&2; exit 1 ;;
esac

BUILD_TMP_DIR=$(mktemp -d)
trap 'rm -rf "$BUILD_TMP_DIR"' EXIT

# 下载到临时目录，成功且非空后才替换目标文件。
download_file() {
    local url="$1" destination="$2" temporary
    temporary=$(mktemp "$BUILD_TMP_DIR/download.XXXXXX")
    mkdir -p "$(dirname "$destination")"
    if ! curl --fail --location --show-error --silent \
        --connect-timeout 20 --max-time 300 --retry 3 --retry-delay 2 \
        --retry-all-errors --output "$temporary" "$url"; then
        echo "错误：下载失败：$url" >&2
        return 1
    fi
    if [ ! -s "$temporary" ]; then
        echo "错误：下载文件为空：$url" >&2
        return 1
    fi
    mv "$temporary" "$destination"
}

install_core() {
    local url="$1" destination="$2" format="$3" archive extracted
    archive=$(mktemp "$BUILD_TMP_DIR/archive.XXXXXX")
    extracted=$(mktemp "$BUILD_TMP_DIR/core.XXXXXX")
    download_file "$url" "$archive"
    case "$format" in
        tar.gz) tar -xzOf "$archive" > "$extracted" ;;
        gz) gzip -dc "$archive" > "$extracted" ;;
        *) echo "错误：未知内核压缩格式：$format" >&2; return 1 ;;
    esac
    if [ ! -s "$extracted" ]; then
        echo "错误：解压后的内核为空：$url" >&2
        return 1
    fi
    chmod +x "$extracted"
    mkdir -p "$(dirname "$destination")"
    mv "$extracted" "$destination"
}

clone_repository() {
    local url="$1" destination="$2" attempt temporary
    for attempt in 1 2 3; do
        temporary="$BUILD_TMP_DIR/repository-$attempt"
        if timeout 180 git -c http.lowSpeedLimit=1024 \
            -c http.lowSpeedTime=60 clone --depth=1 "$url" "$temporary"; then
            mv "$temporary" "$destination"
            return 0
        fi
        echo "仓库下载失败（$attempt/3）：$url" >&2
        if [ "$attempt" -lt 3 ]; then sleep 2; fi
    done
    return 1
}
