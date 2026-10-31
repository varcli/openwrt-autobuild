#!/bin/sh
# 99-custom.sh 就是immortalwrt固件首次启动时运行的脚本 位于固件内的/etc/uci-defaults/99-custom.sh

# 单网口旁路由地址：客户端手动将网关指向 ROUTER_IP
ROUTER_IP='192.168.123.2'
MAIN_ROUTER_IP='192.168.123.1'
NETMASK='255.255.255.0'

# 设置默认防火墙规则，方便虚拟机首次访问 WebUI
uci set firewall.@zone[1].input='ACCEPT'

# 设置主机名映射
uci set dhcp.openwrt_lan=domain
uci set dhcp.openwrt_lan.name='openwrt.lan'
uci set dhcp.openwrt_lan.ip="$ROUTER_IP"


# 根据网卡数量配置网络
network_count=0
for iface in /sys/class/net/*; do
  iface_name=$(basename "$iface")
  # 检查是否为物理网卡（排除回环设备和无线设备）
  if [ -e "$iface/device" ] && echo "$iface_name" | grep -Eq '^eth|^en'; then
    network_count=$((network_count + 1))
  fi
done

# 网络设置
if [ "$network_count" -eq 1 ]; then
  uci set network.lan.proto='static'
  uci set network.lan.ipaddr="$ROUTER_IP"
  uci set network.lan.netmask="$NETMASK"
  uci set network.lan.gateway="$MAIN_ROUTER_IP"
  # 由 IP 和掩码自动计算广播地址，避免更换网段后遗留旧值
  uci -q delete network.lan.broadcast || true
  uci set network.lan.dns="$MAIN_ROUTER_IP"

  # 旁路由模式：客户端手动指定网关，地址分配由主路由负责
  # 保留 dnsmasq 的 DNS 服务，仅关闭 LAN 地址分配及 IPv6 通告/中继
  uci set dhcp.lan.ignore='1'
  uci set dhcp.lan.dhcpv6='disabled'
  uci set dhcp.lan.ra='disabled'
  uci set dhcp.lan.ndp='disabled'
elif [ "$network_count" -gt 1 ]; then
  uci set network.lan.ipaddr='192.168.100.1'
  uci set network.lan.netmask='255.255.255.0'
fi

# 若安装了dockerd 则设置docker的防火墙规则
# 扩大docker涵盖的子网范围 '172.16.0.0/12'
# 方便各类docker容器的端口顺利通过防火墙 
if command -v dockerd >/dev/null 2>&1; then
    echo "检测到 Docker，正在配置防火墙规则..."
    FW_FILE="/etc/config/firewall"

    # 删除所有名为 docker 的 zone
    uci delete firewall.docker

    # 先获取所有 forwarding 索引，倒序排列删除
    for idx in $(uci show firewall | grep "=forwarding" | cut -d[ -f2 | cut -d] -f1 | sort -rn); do
        src=$(uci get firewall.@forwarding[$idx].src 2>/dev/null)
        dest=$(uci get firewall.@forwarding[$idx].dest 2>/dev/null)
        echo "Checking forwarding index $idx: src=$src dest=$dest"
        if [ "$src" = "docker" ] || [ "$dest" = "docker" ]; then
            echo "Deleting forwarding @forwarding[$idx]"
            uci delete firewall.@forwarding[$idx]
        fi
    done
    # 提交删除
    uci commit firewall
    # 追加新的 zone + forwarding 配置
    cat <<EOF >>"$FW_FILE"

config zone 'docker'
  option input 'ACCEPT'
  option output 'ACCEPT'
  option forward 'ACCEPT'
  option name 'docker'
  list subnet '172.16.0.0/12'

config forwarding
  option src 'docker'
  option dest 'lan'

config forwarding
  option src 'docker'
  option dest 'wan'

config forwarding
  option src 'lan'
  option dest 'docker'
EOF

else
    echo "未检测到 Docker，跳过防火墙配置。"
fi

# 设置所有网口可访问网页终端
uci delete ttyd.@ttyd[0].interface

# 设置所有网口可连接 SSH
uci set dropbear.@dropbear[0].Interface=''
uci commit

# 设置编译作者信息
FILE_PATH="/etc/openwrt_release"
NEW_DESCRIPTION="Compiled by varcli"
sed -i "s/DISTRIB_DESCRIPTION='[^']*'/DISTRIB_DESCRIPTION='$NEW_DESCRIPTION'/" "$FILE_PATH"

exit 0
