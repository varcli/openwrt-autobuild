#!/bin/bash
# 在对应 ImageBuilder 中构建主页安装包；临时目录由 build-common.sh 管理。
set -eo pipefail

home_format="${1:?需要指定 apk 或 ipk}"
home_temporary="${2:?需要指定构建临时目录}"
home_root="$home_temporary/home-root"
home_version='1.0.0'
home_dependencies='luci-base rpcd-mod-file rpcd-mod-luci'

case "$home_format" in apk|ipk) ;; *) echo '错误：主页包格式仅支持 apk/ipk' >&2; exit 1;; esac
cp -a package-sources/luci-app-home/root "$home_root"
find "$home_root" -type d -exec chmod 0755 {} +
find "$home_root" -type f -exec chmod 0644 {} +
mkdir -p packages

case "$home_format" in
    apk)
        staging_dir/host/bin/apk mkpkg \
            --info 'name:luci-app-home' \
            --info "version:$home_version" \
            --info 'arch:noarch' \
            --info 'license:GPL-2.0-or-later' \
            --info 'description:OpenWrt device home page' \
            --info 'origin:luci-app-home' \
            --info 'url:https://github.com/varcli/openwrt-autobuild' \
            --info "depends:$home_dependencies" \
            --files "$home_root" \
            --output "packages/luci-app-home-$home_version.apk"
        home_output="packages/luci-app-home-$home_version.apk"
        ;;
    ipk)
        mkdir -p "$home_root/CONTROL"
        cat > "$home_root/CONTROL/control" <<EOF
Package: luci-app-home
Version: $home_version
Architecture: all
Maintainer: varcli
Section: luci
Priority: optional
Depends: ${home_dependencies// /, }
Installed-Size: 0
Description: OpenWrt device home page
EOF
        printf '/etc/config/home\n' > "$home_root/CONTROL/conffiles"
        bash scripts/ipkg-build "$home_root" "$(pwd)/packages"
        home_output="packages/luci-app-home_${home_version}_all.ipk"
        ;;
esac

test -s "$home_output" || { echo "错误：主页安装包不存在或为空：$home_output" >&2; exit 1; }
