#!/bin/sh

# 设置默认防火墙规则，方便虚拟机首次访问 WebUI
uci set firewall.@zone[1].input='ACCEPT'

# 设置主机名映射
uci add dhcp domain
uci set dhcp.@domain[0].name='openwrt.lan'
uci set dhcp.@domain[0].ip='192.168.123.6'


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
  # uci set network.lan.proto='dhcp'
  uci set network.lan.proto='static'
	uci set network.lan.ipaddr='192.168.123.6'
	uci set network.lan.netmask='255.255.255.0'
	uci set network.lan.gateway='192.168.123.1'
	uci set network.lan.broadcast='192.168.123.255'
	uci set network.lan.dns='192.168.123.5'
elif [ "$network_count" -gt 1 ]; then
  uci set network.lan.ipaddr='192.168.100.1'
fi

# 设置所有网口可访问网页终端
uci delete ttyd.@ttyd[0].interface

# 设置所有网口可连接 SSH
uci set dropbear.@dropbear[0].Interface=''
uci commit

# 设置编译作者信息
FILE_PATH="/etc/openwrt_release"
NEW_DESCRIPTION="Compiled by GEOMCH"
sed -i "s/DISTRIB_DESCRIPTION='[^']*'/DISTRIB_DESCRIPTION='$NEW_DESCRIPTION'/" "$FILE_PATH"

exit 0
