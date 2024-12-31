#!/bin/bash

# 输出调试信息
echo "$(date '+%Y-%m-%d %H:%M:%S') - 开始编译..."

# 定义固件型号
PROFILE="generic"

echo "$(date '+%Y-%m-%d %H:%M:%S') - 编译固件型号为: $PROFILE"

# 定义固件大小 传参进来
# ROOTFS_PARTSIZE=1024

echo "$(date '+%Y-%m-%d %H:%M:%S') - 编译固件大小为: $ROOTFS_PARTSIZE MB"

# 定义所需安装的包列表
PACKAGES=""
PACKAGES="$PACKAGES curl"
PACKAGES="$PACKAGES qemu-ga"
PACKAGES="$PACKAGES openssh-sftp-server"
PACKAGES="$PACKAGES luci-i18n-diskman-zh-cn"
PACKAGES="$PACKAGES luci-i18n-firewall-zh-cn"
PACKAGES="$PACKAGES luci-app-argon-config"
PACKAGES="$PACKAGES luci-i18n-argon-config-zh-cn"
PACKAGES="$PACKAGES luci-i18n-package-manager-zh-cn"
PACKAGES="$PACKAGES luci-i18n-attendedsysupgrade-zh-cn"
PACKAGES="$PACKAGES luci-i18n-ttyd-zh-cn"
PACKAGES="$PACKAGES luci-i18n-passwall-zh-cn"
PACKAGES="$PACKAGES luci-app-openclash"

echo "$(date '+%Y-%m-%d %H:%M:%S') - 编译自定义插件为：$PACKAGES"

# 构建镜像
make image PROFILE="$PROFILE" PACKAGES="$PACKAGES" FILES="/home/build/immortalwrt/files" ROOTFS_PARTSIZE=$ROOTFS_PARTSIZE

if [ $? -ne 0 ]; then
    echo "$(date '+%Y-%m-%d %H:%M:%S') - Error: 编译固件失败!"
    exit 1
fi

echo "$(date '+%Y-%m-%d %H:%M:%S') - 编译固件完成."
