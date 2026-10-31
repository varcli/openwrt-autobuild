#!/bin/bash
INCLUDE_DOCKER="${INCLUDE_DOCKER:-yes}"
source shell/build-common.sh
# Log file for debugging
source shell/custom-packages.sh
echo "第三方软件包: $CUSTOM_PACKAGES"
LOGFILE="/tmp/uci-defaults-log.txt"
echo "Starting 99-custom.sh at $(date)" >> $LOGFILE
# yml 传入的路由器型号 PROFILE
echo "Building for profile: $PROFILE"
# yml 传入的固件大小 ROOTFS_PARTSIZE
echo "Building for ROOTFS_PARTSIZE: $ROOTFS_PARTSIZE"
# 输出调试信息
echo "$(date '+%Y-%m-%d %H:%M:%S') - 开始构建arm64的rootfs.tar.gz"
# 定义所需安装的包列表 下列插件你都可以自行删减
PACKAGES=""
PACKAGES="$PACKAGES luci-app-home"
PACKAGES="$PACKAGES curl fdisk"
PACKAGES="$PACKAGES luci-i18n-diskman-zh-cn"
PACKAGES="$PACKAGES luci-i18n-package-manager-zh-cn"
PACKAGES="$PACKAGES luci-i18n-firewall-zh-cn"
PACKAGES="$PACKAGES luci-theme-argon"
PACKAGES="$PACKAGES luci-app-argon-config"
PACKAGES="$PACKAGES luci-i18n-argon-config-zh-cn"
PACKAGES="$PACKAGES luci-i18n-ttyd-zh-cn"
PACKAGES="$PACKAGES luci-app-openclash"
PACKAGES="$PACKAGES openssh-sftp-server"
# 判断是否需要编译 Docker 插件
if [ "$INCLUDE_DOCKER" = "yes" ]; then
    PACKAGES="$PACKAGES luci-i18n-dockerman-zh-cn"
    echo "✅ 已选择docker : luci-i18n-dockerman-zh-cn"
fi
# 斐讯N1 无线
PACKAGES="$PACKAGES kmod-brcmfmac wpad-basic-mbedtls iw iwinfo"
PACKAGES="$PACKAGES perlbase-base perlbase-file perlbase-time perlbase-utf8 perlbase-xsloader"
# 晶晨宝盒（追加第三方必备软件 用于写入emmc 请不要注释）
CUSTOM_PACKAGES="$CUSTOM_PACKAGES luci-app-amlogic luci-i18n-amlogic-zh-cn"

echo "🔄 正在同步第三方软件仓库 Cloning run file repo..."
clone_repository https://github.com/wukongdaily/store.git /tmp/store-run-repo
# 拷贝 run/arm64 下所有 run 文件和ipk文件 到 extra-packages 目录
mkdir -p /home/build/immortalwrt/extra-packages
cp -r /tmp/store-run-repo/run/arm64/* /home/build/immortalwrt/extra-packages/
echo "✅ Run files copied to extra-packages:"
ls -lah /home/build/immortalwrt/extra-packages/
# 解压并拷贝ipk到packages目录
sh shell/prepare-packages.sh
bash shell/build-home.sh ipk "$BUILD_TMP_DIR"
ls -lah /home/build/immortalwrt/packages/
# 添加架构优先级信息
sed -i '1i\
arch aarch64_generic 10\n\
arch aarch64_cortex-a53 15' repositories.conf

# ======== shell/custom-packages.sh =======
# 合并imm仓库以外的第三方插件
PACKAGES="$PACKAGES $CUSTOM_PACKAGES"

# 若构建openclash 则添加内核
if echo "$PACKAGES" | grep -q "luci-app-openclash"; then
    echo "✅ 已选择 luci-app-openclash，添加 openclash core"
    mkdir -p files/etc/openclash/core
    # Download clash_meta
    META_URL="https://raw.githubusercontent.com/vernesong/OpenClash/core/master/meta/clash-linux-arm64.tar.gz"
    install_core "$META_URL" files/etc/openclash/core/clash_meta tar.gz
    # Download GeoIP and GeoSite
    download_file https://github.com/Loyalsoldier/v2ray-rules-dat/releases/latest/download/geoip.dat files/etc/openclash/GeoIP.dat
    download_file https://github.com/Loyalsoldier/v2ray-rules-dat/releases/latest/download/geosite.dat files/etc/openclash/GeoSite.dat
else
    echo "⚪️ 未选择 luci-app-openclash"
fi


# 构建镜像
echo "$(date '+%Y-%m-%d %H:%M:%S') - 构建镜像，包含以下插件:"
echo "$PACKAGES"

source shell/prepare-n1-files.sh
if ! make image PROFILE="$PROFILE" PACKAGES="$PACKAGES" FILES="$N1_FILES" ROOTFS_PARTSIZE="$ROOTFS_PARTSIZE"; then
    echo "$(date '+%Y-%m-%d %H:%M:%S') - Error: 编译固件失败!"
    exit 1
fi

echo "$(date '+%Y-%m-%d %H:%M:%S') - 编译固件完成."
