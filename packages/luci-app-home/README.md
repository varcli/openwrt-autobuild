# luci-app-home

本仓库的原生 LuCI 主页。页面、样式、菜单和只读 ACL 均位于 `root/`，不放入共享 `files/` 覆盖层。

两目标默认通过 `PACKAGES` 安装：

- x86 使用 ImageBuilder 自带的 `apk mkpkg` 生成 `luci-app-home-1.0.0.apk`。
- N1 使用 ImageBuilder 自带的 `scripts/ipkg-build` 生成 `luci-app-home_1.0.0_all.ipk`。
- 工作流只读挂载仓库 `packages/` 到容器 `package-sources/`，成品写入容器自身的 `packages/`。
- `shell/build-home.sh` 在第三方包整理后执行，打包失败立即停止构建，不需要 SDK。

依赖为 `luci-base`、`rpcd-mod-file`、`rpcd-mod-luci`；没有独立后台进程。
主页状态读取与网络向导使用独立 ACL，主页只读，向导仅写入 network、dhcp、firewall、home 的 UCI 配置。
菜单为 `/cgi-bin/luci/admin/home`，顺序为 1，保留原有状态概览。

主页显示当前网络配置、系统资源、根分区容量、LAN 接口收发及已安装应用入口。
CPU 与流量使用相邻采样差值，首次采样或读取失败时显示未知。
LAN 流量包含局域网通信，默认路由就绪不表示已验证互联网连通。
N1 没有 x86 更新插件的构建信息时正常降级。

## 首次配置向导

首次打开主页会进入 `admin/system/home-setup`。`etc/config/home` 记录完成状态，
保留配置升级时沿用；N1 ipk 将其列入 conffiles。暂时跳过仅记录在当前浏览器会话中。

向导支持旁路由与主路由，主路由上网方式包括 DHCP、PPPoE、静态地址。
页面和流程位于 `view/home-setup.js`，参数校验与配置方案位于 `home/setup.js`。
接口从设备实际返回的以太网接口中选择；已有 VLAN 过滤、其他网桥或网络占用时转用高级网络设置。
PPPoE 协议支持已包含在两个目标的现有配置中，向导不安装额外协议包。

进入确认步骤前只生成方案，不写 UCI；确认应用后检查会话没有其他待应用配置，再保存方案。
随后调用 `ui.changes.apply(true)`，由 LuCI 原生处理连接检查、确认及超时回滚。
不直接 commit 或重启网络，完成标记与网络配置在同一次应用事务中提交或回滚。
配置确认摘要不显示宽带密码。IPv4 LAN/WAN 网段不得重叠，DHCP 地址池按掩码计算并避开本机地址。

旁路由关闭 WAN、LAN DHCPv4/DHCPv6/RA/NDP 与 dnsmasq authoritative，保留 DNS；
主路由设置独立 LAN/WAN、DHCP、IPv6 通告及 LAN→WAN NAT/转发，WAN 入站拒绝。
系统、Docker、自定义防火墙规则及代理配置不属于向导维护范围。

卸载插件由对应包管理器管理文件；若在已运行设备上手工安装或卸载，需重新载入 LuCI 菜单并刷新 rpcd 权限。
