#!/bin/bash
# source from phicomm-n1/build.sh after downloading its overlay files.
set -eo pipefail

update_repository="${UPDATE_REPOSITORY:-varcli/openwrt-autobuild}"
if [[ ! "$update_repository" =~ ^[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+$ ]]; then
    echo '错误：UPDATE_REPOSITORY 必须为 owner/repo' >&2
    exit 1
fi

# N1 专用覆盖层单独暂存，不把晶晨宝盒配置写入共享 files/ 或 x86 固件。
N1_FILES="$BUILD_TMP_DIR/n1-files"
cp -a files "$N1_FILES"
mkdir -p "$N1_FILES/etc/uci-defaults"
cat > "$N1_FILES/etc/uci-defaults/zz-amlogic-repository" <<EOF
#!/bin/sh
uci -q get amlogic.config >/dev/null || exit 1
repository='https://github.com/$update_repository'
current=\$(uci -q get amlogic.config.amlogic_firmware_repo)
# 替换包自带的公共默认仓库，保留用户另行指定的仓库。
case "\$current" in
    ''|https://github.com/breakingbadboy/OpenWrt|https://github.com/ophub/amlogic-s9xxx-openwrt|"\$repository")
        uci set amlogic.config.amlogic_firmware_repo="\$repository" || exit 1
        uci set amlogic.config.amlogic_firmware_tag='phicomm-n1' || exit 1
        uci set amlogic.config.amlogic_firmware_suffix='.img.gz' || exit 1
        uci commit amlogic || exit 1
        ;;
esac
exit 0
EOF
chmod 0755 "$N1_FILES/etc/uci-defaults/zz-amlogic-repository"
