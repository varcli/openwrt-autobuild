#!/bin/bash
# 在 x86 ImageBuilder 容器中调用；使用其自带的 apk-tools 打包，无需 SDK。
set -eo pipefail

package_root="$BUILD_TMP_DIR/online-upgrade-root"
cp -a package-sources/luci-app-online-upgrade/root "$package_root"
mkdir -p "$package_root/usr/share/online-upgrade" packages
python3 shell/firmware-update.py build "$package_root/usr/share/online-upgrade/build.json"
sed -i "s#option repository .*#option repository '${UPDATE_REPOSITORY:-varcli/openwrt-autobuild}'#" "$package_root/etc/config/online-upgrade"
chmod 0755 "$package_root/usr/bin/online-upgrade.sh"
find "$package_root" -type d -exec chmod 0755 {} +

staging_dir/host/bin/apk mkpkg \
    --info 'name:luci-app-online-upgrade' \
    --info 'version:1.3.0-r1' \
    --info 'arch:noarch' \
    --info 'license:GPL-2.0-or-later' \
    --info 'description:GitHub firmware updates for this x86 ImageBuilder firmware' \
    --info 'origin:luci-app-online-upgrade' \
    --info 'url:https://github.com/varcli/openwrt-autobuild' \
    --info 'depends:luci-base rpcd-mod-file curl jsonfilter' \
    --files "$package_root" \
    --output packages/luci-app-online-upgrade-1.3.0-r1.apk
