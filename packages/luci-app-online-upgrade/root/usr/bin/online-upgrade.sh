#!/bin/sh
set -eu
umask 077

SELF=/usr/bin/online-upgrade.sh
BUILD=/usr/share/online-upgrade/build.json
STATE=/var/run/online-upgrade
LOCK="$STATE/lock"
IMAGE="$STATE/firmware.img.gz"
MANIFEST="$STATE/manifest.json"

field() { jsonfilter -i "$1" -e "@.$2"; }
die() { echo "$*" >&2; exit 1; }
integer() { case "$1" in ''|*[!0-9]*) return 1;; esac; [ "${#1}" -le 12 ] && [ "$1" -gt 0 ]; }
safe_name() { printf '%s\n' "$1" | grep -Eq '^[A-Za-z0-9][A-Za-z0-9._+-]*$'; }
https_prefix() {
    case "$1" in *[[:space:]]*) return 1;; esac
    [ "${#1}" -le 512 ] && printf '%s\n' "$1" | grep -Eq '^https://[A-Za-z0-9]([A-Za-z0-9.-]*[A-Za-z0-9])?(:[0-9]{1,5})?(/[A-Za-z0-9._~%/-]*)?$'
}

load_transport() {
    local mirror
    mirror=$(uci -q get online-upgrade.main.download_mirror 2>/dev/null || true)
    case "$mirror" in
        ''|direct) DOWNLOAD_PREFIX='' ;;
        ghfast) DOWNLOAD_PREFIX='https://ghfast.top' ;;
        ghproxy) DOWNLOAD_PREFIX='https://gh-proxy.com' ;;
        custom)
            DOWNLOAD_PREFIX=$(uci -q get online-upgrade.main.custom_mirror 2>/dev/null || true)
            https_prefix "$DOWNLOAD_PREFIX" || die '自定义下载加速地址必须是有效的 HTTPS 前缀，不能包含账号、查询参数或片段。'
            ;;
        *) die '未知的下载镜像，请重新保存加速设置。' ;;
    esac
    API_PREFIX=$(uci -q get online-upgrade.main.api_mirror 2>/dev/null || true)
    if [ -n "$API_PREFIX" ]; then
        https_prefix "$API_PREFIX" || die 'API 加速地址必须是有效的 HTTPS 前缀。'
    fi
}

mkdir -p "$STATE"
chmod 0700 "$STATE"

state() (
    # jshn 会读取未初始化的变量；仅在状态生成子 shell 中关闭 nounset。
    set +u
    . /usr/share/libubox/jshn.sh
    json_init || exit 1
    json_add_string phase "$1"
    json_add_string message "$2"
    if [ -s "$MANIFEST" ]; then
        json_add_string include_docker "$(field "$MANIFEST" include_docker 2>/dev/null || true)"
        json_add_string version "$(field "$MANIFEST" version 2>/dev/null || true)"
        json_add_string filename "$(field "$MANIFEST" asset.name 2>/dev/null || true)"
        json_add_string sha256 "$(field "$MANIFEST" asset.sha256 2>/dev/null || true)"
        json_add_string release_tag "$(field "$MANIFEST" release_tag 2>/dev/null || true)"
        json_add_string size "$(field "$MANIFEST" asset.size 2>/dev/null || true)"
        json_add_string rootfs_partsize "$(field "$MANIFEST" rootfs_partsize 2>/dev/null || true)"
        json_add_string release_url "$(field "$MANIFEST" release_url 2>/dev/null || true)"
    fi
    json_add_boolean layout_changed "${LAYOUT_CHANGED:-0}"
    local allow_backup=0
    if [ -s "$STATE/validation.json" ] && [ "$(field "$STATE/validation.json" allow_backup)" = true ]; then allow_backup=1; fi
    json_add_boolean allow_backup "$allow_backup"
    json_dump > "$STATE/status.new" || exit 1
    mv "$STATE/status.new" "$STATE/status.json"
)

load_identity() {
    [ -s "$BUILD" ] || die '缺少本固件构建信息，请先手动刷入带在线更新功能的版本。'
    CURRENT=$(field "$BUILD" version)
    REPO=$(uci -q get online-upgrade.main.repository 2>/dev/null || true)
    [ -n "$REPO" ] || REPO=$(field "$BUILD" repository)
    printf '%s\n' "$REPO" | grep -Eq '^[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+$' || die 'GitHub 仓库格式应为 owner/repo。'
    printf '%s\n' "$CURRENT" | grep -Eq '^[1-9][0-9]{0,11}\.[0-9]{1,6}$' || die '当前构建编号无效。'
    [ "$(field "$BUILD" target)" = 'x86/64' ] || die '仅支持 x86-64 固件。'
    [ "$(uname -m)" = x86_64 ] || die '设备架构不匹配。'
    [ -d /sys/firmware/efi ] || die '当前版本仅支持以 EFI 启动的设备。'
    awk '$2 == "/rom" && $3 == "squashfs" { found=1 } END { exit !found }' /proc/mounts || die '当前版本仅支持 squashfs 固件。'
    load_transport
}

download() {
    local address="$1" prefix
    case "$address" in
        https://api.github.com/*) prefix="$API_PREFIX" ;;
        https://github.com/*) prefix="$DOWNLOAD_PREFIX" ;;
        *) die '不支持的 GitHub 下载地址。' ;;
    esac
    if [ -n "$prefix" ]; then address="${prefix%/}/$address"; fi
    curl --fail --location --silent --show-error --proto '=https' --proto-redir '=https' \
        --connect-timeout 15 --max-time "$3" --retry 2 --retry-delay 2 \
        --max-filesize "${4:-65536}" --output "$2" "$address"
    [ -s "$2" ] || die '下载结果为空。'
}

validate_manifest() {
    [ "$(field "$MANIFEST" schema)" = 1 ] || die '不支持的更新清单格式。'
    [ "$(field "$MANIFEST" target)" = x86/64 ] || die '更新目标不是 x86-64。'
    [ "$(field "$MANIFEST" profile)" = generic ] || die '设备型号不匹配。'
    [ "$(field "$MANIFEST" boot)" = efi ] || die '固件启动方式不匹配。'
    [ "$(field "$MANIFEST" filesystem)" = squashfs ] || die '固件文件系统不匹配。'
    case "$(field "$MANIFEST" include_docker)" in true|false) ;; *) die '固件配置标识无效。';; esac
    [ "$(field "$MANIFEST" repository)" = "$REPO" ] || die '清单中的仓库不匹配。'
    VERSION=$(field "$MANIFEST" version)
    printf '%s\n' "$VERSION" | grep -Eq '^[1-9][0-9]{0,11}\.[0-9]{1,6}$' || die '构建编号无效。'
    NAME=$(field "$MANIFEST" asset.name)
    safe_name "$NAME" || die '固件文件名无效。'
    case "$NAME" in immortalwrt-*-x86-64-generic-squashfs-combined-efi.img.gz) ;; *) die '未找到匹配的 squashfs EFI 镜像。';; esac
    RELEASE=$(field "$MANIFEST" release_tag)
    safe_name "$RELEASE" || die 'Release 标签无效。'
    case "$RELEASE" in x86-64-*) ;; *) die 'Release 不是 x86 发布。';; esac
    EXPECTED=$(field "$MANIFEST" asset.sha256)
    printf '%s\n' "$EXPECTED" | grep -Eq '^[a-f0-9]{64}$' || die '缺少有效 SHA256。'
    SIZE=$(field "$MANIFEST" asset.size)
    IMAGE_SIZE=$(field "$MANIFEST" asset.image_size)
    integer "$SIZE" && integer "$IMAGE_SIZE" || die '固件容量无效。'
    [ "$IMAGE_SIZE" -ge "$SIZE" ] || die '固件容量信息不一致。'
    URL="https://github.com/$REPO/releases/download/$RELEASE/$NAME"
    [ "$(field "$MANIFEST" asset.url)" = "$URL" ] || die '固件下载地址不属于所选仓库的 Release。'
    [ "$(field "$MANIFEST" release_url)" = "https://github.com/$REPO/releases/tag/$RELEASE" ] || die 'Release 页面地址不匹配。'
}


disk_bytes() (
    # 系统升级库允许未设置的变量，仅在这个子 shell 中关闭 nounset。
    set +u
    . /lib/functions.sh
    . /lib/functions/system.sh
    . /lib/upgrade/common.sh
    export_bootdevice && export_partdevice diskdev 0 || exit 1
    sectors=$(cat "/sys/class/block/$diskdev/size")
    echo "$((sectors * 512))"
)

verify_image() {
    [ -s "$IMAGE" ] || die '请先下载并校验固件。'
    [ "$(wc -c < "$IMAGE" | tr -d ' ')" = "$SIZE" ] || die '文件长度与清单不一致。'
    echo "$EXPECTED  $IMAGE" | sha256sum -c - || die 'SHA256 校验失败。'
    gzip -t "$IMAGE" || die '固件压缩文件损坏。'
    [ "$(gzip -dc "$IMAGE" | wc -c | tr -d ' ')" = "$IMAGE_SIZE" ] || die '解压后容量与清单不一致。'
    local capacity validation
    capacity=$(disk_bytes) || die '无法识别启动磁盘，已停止。'
    integer "$capacity" || die '启动磁盘容量无效。'
    [ "$IMAGE_SIZE" -le "$capacity" ] || die '新镜像超过当前虚拟磁盘容量，请先扩大磁盘。'
    validation=$(ubus call system validate_firmware_image "{\"path\":\"$IMAGE\"}") || die '系统镜像校验调用失败。'
    printf '%s\n' "$validation" > "$STATE/validation.json"
    [ "$(field "$STATE/validation.json" valid)" = true ] || die '系统不接受此镜像，已停止。'
    /sbin/sysupgrade --test "$IMAGE" > "$STATE/image-test.log" 2>&1 || {
        cat "$STATE/image-test.log"
        die 'sysupgrade 镜像检查失败。'
    }
    cat "$STATE/image-test.log"
    LAYOUT_CHANGED=0
    if grep -q 'Partition layout has changed' "$STATE/image-test.log"; then LAYOUT_CHANGED=1; fi
}

check_update() {
    rm -f "$MANIFEST" "$STATE/ready" "$IMAGE" "$STATE/validation.json" "$STATE/releases.json"
    state checking '正在获取 GitHub 固件列表…'
    download "https://api.github.com/repos/$REPO/releases?per_page=100" "$STATE/releases.part" 60 4194304
    # 确认返回的是 Release 数组；空列表允许展示为空，不误报为最新版本。
    jsonfilter -i "$STATE/releases.part" -e '@' > /dev/null || die '无法解析 Release 列表。'
    grep -Eq '^[[:space:]]*\[' "$STATE/releases.part" || die 'Release 列表格式无效。'
    jsonfilter -i "$STATE/releases.part" -e '@[*].tag_name' > "$STATE/tags" || true
    mv "$STATE/releases.part" "$STATE/releases.json"
    state listed '固件列表已刷新，默认选择最新可用版本。'
}

select_manifest() {
    safe_name "$1" || die '无效的 Release 标签。'
    [ -s "$STATE/releases.json" ] || die '请先刷新固件列表。'
    grep -Fxq -- "$1" "$STATE/tags" || die '所选固件不在本次查询的列表中。'
    rm -f "$MANIFEST" "$STATE/ready" "$IMAGE" "$STATE/validation.json"
    state selecting '正在读取所选固件的校验清单…'
    download "https://github.com/$REPO/releases/download/$1/x86-64-update.json" "$STATE/manifest.part" 60
    mv "$STATE/manifest.part" "$MANIFEST"
    validate_manifest
    [ "$RELEASE" = "$1" ] || die '清单与所选 Release 不一致。'
    state available '已选择固件，可下载并校验。'
}

prepare_image() {
    validate_manifest
    [ "$RELEASE" = "$1" ] || die '固件选择已改变，请刷新页面。'
    rm -f "$STATE/ready" "$IMAGE"
    local free
    free=$(df -Pk "$STATE" | awk 'END { print $4 }')
    integer "$free" || die '无法读取临时空间。'
    [ "$((free * 1024))" -ge "$((SIZE + 32 * 1024 * 1024))" ] || die '/tmp 临时空间不足，无法下载固件。'
    state downloading '正在下载镜像，请稍候…'
    download "$URL" "$STATE/firmware.part" 900 "$SIZE"
    mv "$STATE/firmware.part" "$IMAGE"
    state verifying '正在校验 SHA256、启动磁盘和镜像兼容性…'
    verify_image
    printf '%s\n' "$EXPECTED" > "$STATE/ready"
    state ready '固件已校验，等待你确认升级。'
}

upgrade_image() {
    case "$1" in keep|reset) ;; *) die '无效的配置保留选项。';; esac
    validate_manifest
    [ "$RELEASE" = "$2" ] && [ "$EXPECTED" = "$3" ] || die '已校验固件与确认内容不一致，请重新选择。'
    [ -s "$STATE/ready" ] && [ "$(cat "$STATE/ready")" = "$EXPECTED" ] || die '固件尚未完成校验。'
    state verifying '升级前再次检查固件…'
    verify_image
    if [ "$1" = keep ]; then
        [ "$(field "$STATE/validation.json" allow_backup)" = true ] || die '此镜像不支持保留配置。'
        /sbin/sysupgrade --create-backup "$STATE/config-backup.tar.gz" || die '配置备份失败。'
        [ -s "$STATE/config-backup.tar.gz" ] || die '配置备份为空。'
    fi
    state flashing '正在交给系统刷写并重启，请勿断电。'
    if [ "$1" = keep ]; then
        /sbin/sysupgrade -f "$STATE/config-backup.tar.gz" "$IMAGE"
    else
        /sbin/sysupgrade -n "$IMAGE"
    fi
    die 'sysupgrade 返回了，请查看日志确认失败原因。'
}

lock_alive() {
    local pid
    if [ -s "$LOCK/pid" ]; then
        read -r pid < "$LOCK/pid" || return 1
        case "$pid" in ''|*[!0-9]*) return 1;; esac
        kill -0 "$pid" 2>/dev/null || return 1
        # 避免 PID 被无关进程复用后一直误报忙碌。
        tr '\000' '\n' < "/proc/$pid/cmdline" 2>/dev/null | grep -Fxq -- "$SELF"
    elif [ -d "$LOCK" ]; then
        # mkdir 与写入 PID 之间给并发启动留出时间；旧版空锁会自动回收。
        [ "$(( $(date +%s) - $(stat -c %Y "$LOCK") ))" -lt 5 ]
    else
        return 1
    fi
}

start_worker() {
    if ! mkdir "$LOCK" 2>/dev/null; then
        lock_alive && die '已有检查或升级任务正在运行。'
        # 让并发恢复请求只能有一个移动旧锁，避免误移走新任务的锁。
        mkdir "$LOCK/reclaim" 2>/dev/null || die '任务锁正在恢复，请稍后重试；若持续出现，请重启设备。'
        trap 'rmdir "$LOCK/reclaim" 2>/dev/null || true' EXIT
        if [ -s "$LOCK/pid" ] && lock_alive; then die '已有检查或升级任务正在运行。'; fi
        local stale="$STATE/stale-lock-$$"
        mv "$LOCK" "$stale" 2>/dev/null || die '任务状态正在恢复，请重试。'
        rm -f "$stale/pid"
        rmdir "$stale/reclaim"
        rmdir "$stale"
        trap - EXIT
        mkdir "$LOCK" 2>/dev/null || die '已有检查或升级任务正在运行。'
    fi
    trap 'rm -f "$LOCK/pid"; rmdir "$LOCK" 2>/dev/null || true' EXIT
    printf '%s\n' "$$" > "$LOCK/pid"
    : > "$STATE/log"
    state "$1" "$2"
    worker="$3"
    shift 3
    setsid /bin/sh "$SELF" "$worker" "$@" </dev/null >> "$STATE/log" 2>&1 &
    printf '%s\n' "$!" > "$LOCK/pid"
    trap - EXIT
    echo '{"started":true}'
}

worker_exit() {
    result=$?
    trap - EXIT
    if [ "$result" -ne 0 ]; then state error '操作失败，请查看下方日志。' || true; fi
    rm -f "$STATE/firmware.part" "$STATE/manifest.part" "$STATE/releases.part"
    rm -f "$LOCK/pid"
    rmdir "$LOCK" || true
    exit "$result"
}

case "${1:-status}" in
    status)
        if [ -s "$STATE/status.json" ]; then
            phase=$(field "$STATE/status.json" phase 2>/dev/null || true)
            case "$phase" in
                checking|selecting|downloading|verifying|flashing)
                    if lock_alive; then cat "$STATE/status.json";
                    else echo '{"phase":"error","message":"上次任务已中断，可重新刷新固件列表。"}'; fi
                    ;;
                '') echo '{"phase":"error","message":"任务状态损坏，可重新刷新固件列表。"}' ;;
                *) cat "$STATE/status.json" ;;
            esac
        else
            echo '{"phase":"idle","message":"点击检查更新。"}'
        fi
        ;;
    releases) if [ -s "$STATE/releases.json" ]; then cat "$STATE/releases.json"; else echo '[]'; fi ;;
    log) tail -n 100 "$STATE/log" 2>/dev/null || true ;;
    check) start_worker checking '正在检查更新…' _check ;;
    select) safe_name "${2:-}" || die '请选择固件。'; start_worker selecting '正在选择固件…' _select "$2" ;;
    download) safe_name "${2:-}" || die '请选择固件。'; start_worker downloading '准备下载固件…' _download "$2" ;;
    upgrade)
        case "${2:-}" in keep|reset) ;; *) die '请选择保留或重置配置。';; esac
        safe_name "${3:-}" || die '缺少所选 Release。'
        printf '%s\n' "${4:-}" | grep -Eq '^[a-f0-9]{64}$' || die '缺少确认的 SHA256。'
        start_worker verifying '准备执行升级检查…' _upgrade "$2" "$3" "$4"
        ;;
    _check|_select|_download|_upgrade)
        [ -d "$LOCK" ] || die '任务锁不存在。'
        trap worker_exit EXIT
        trap 'exit 1' HUP INT TERM
        # 等待启动者交接 PID，避免快速失败后启动者重新留下 PID 文件。
        tries=0
        while [ "$(cat "$LOCK/pid" 2>/dev/null || true)" != "$$" ]; do
            tries=$((tries + 1))
            [ "$tries" -lt 5 ] || die '后台任务启动交接失败。'
            sleep 1
        done
        load_identity
        case "$1" in
            _check) check_update ;;
            _select) select_manifest "$2" ;;
            _download) prepare_image "$2" ;;
            _upgrade) upgrade_image "$2" "$3" "$4" ;;
        esac
        ;;
    *) die '未知操作。' ;;
esac
