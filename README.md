# OpenWrt AutoBuild

基于 GitHub Actions 与 ImmortalWrt ImageBuilder 的固件自动构建项目，支持 **x86-64** 和 **斐讯 N1**。
根据识别到的网口数量应用网络默认配置，适用于单网口旁路由和多网口主路由场景。

[构建工作流](https://github.com/varcli/openwrt-autobuild/actions) · [固件下载](https://github.com/varcli/openwrt-autobuild/releases)

## 功能概览

- **自动构建与发布**：通过 GitHub Actions 生成固件并上传至 Releases。
- **识别网口数量**：单网口采用静态旁路由配置，多网口设置主路由 LAN 管理地址。
- **设备主页**：集中查看网络路径、资源状态、LAN 流量和常用应用，支持 x86 与 N1。
- **按需集成插件**：通过插件清单选择代理、文件管理、流量监控等功能，可选集成 Docker。
- **虚拟机支持**：x86-64 集成 QEMU Guest Agent，便于虚拟化平台管理。
- **N1 镜像打包**：构建 ARM64 rootfs 后，使用 flippy 工作流打包设备镜像。

## 支持的设备

| 项目 | x86-64 | 斐讯 N1 |
| --- | --- | --- |
| ImmortalWrt 版本 | 25.12.2 | 24.10.6 |
| 软件包格式 | apk | ipk / opkg |
| 适用环境 | x86 设备、虚拟机 | 斐讯 N1 |
| 工作流 | `build-x86-64` | `build-phicomm-n1` |
| 默认集成 Docker | 否，可选开启 | 是，可选关闭 |
| 固件产物 | `*-squashfs-combined-efi.img.gz` 等镜像 | N1 `.img.gz` 镜像 |

版本以仓库当前配置为准，两个目标分别维护。

## 网络模式

首次启动时，脚本统计具有设备关联、名称以 `eth` 或 `en` 开头的网口，并按数量应用以下配置。

| 默认设置 | 单网口：旁路由 | 多网口：主路由 |
| --- | --- | --- |
| LAN 管理地址 | `192.168.123.2` | `192.168.100.1` |
| 子网掩码 | `255.255.255.0` | `255.255.255.0` |
| 默认网关 | `192.168.123.1` | 按 WAN 配置获取或设置 |
| 设备 DNS | `192.168.123.1` | 按系统及 WAN 配置 |
| LAN DHCPv4 | 关闭 | 沿用系统默认配置 |
| dnsmasq 唯一授权 | 关闭 | 沿用系统默认配置 |
| LAN DHCPv6 / RA / NDP | 关闭 | 沿用系统默认配置 |
| DNS 服务 | 保留 | 保留 |

默认登录用户名为 `root`，密码为空。登录后可自行设置密码和网络参数。

### 单网口旁路由

将设备接入主路由所在的局域网，主路由默认地址为 `192.168.123.1`。
打开 [192.168.123.2](http://192.168.123.2) 访问管理页面。

由主路由分配客户端地址，或手动配置同网段地址。仅在需要使用旁路由的客户端上修改：

| 客户端设置 | 配置值 |
| --- | --- |
| 网关 | `192.168.123.2` |
| DNS | 需要 DNS 经旁路由处理时，设为 `192.168.123.2` |

主路由的地址池应避免分配 `192.168.123.2`，其余客户端可继续通过主路由上网。
旁路由本身不向局域网分配地址。

### 多网口主路由

连接 LAN 后，打开 [192.168.100.1](http://192.168.100.1) 访问管理页面。
在网络设置中确认 WAN / LAN 对应的实际接口，并根据接入方式配置 WAN。

网口识别用于选择默认配置分支，不包含自动判断上联端口或自动填写宽带拨号信息。
多网口分支保留系统原有的 DHCP 与 IPv6 服务配置。

以上配置在全新刷入后的首次启动时应用。保留配置升级可能继续使用旧设置。
单网口关闭 IPv6 通告不会关闭整个局域网的 IPv6；手动设置 IPv4 网关也不会改变客户端的 IPv6 路由。

## 构建固件

1. Fork 本仓库，在自己的仓库中启用 GitHub Actions，并确保工作流具有发布 Release 的权限。
2. 打开 **Actions**，选择 `build-x86-64` 或 `build-phicomm-n1`。
3. 点击 **Run workflow**，按需设置参数后启动。
4. 构建成功后，在 **Releases** 下载对应设备的固件。

| 参数 | 说明 | 默认值 |
| --- | --- | --- |
| `rootfs_partsize` | ImageBuilder 软件包分区容量，正整数，单位 MB | `1024` |
| `include_docker` | 是否集成 Docker 插件，选择 `yes` / `no` | x86-64：`no`；N1：`yes` |
| `openwrt_kernel` | N1 打包使用的内核系列组合 | `6.1.y_6.6.y` |

容量参数不等于压缩固件文件大小，N1 最终磁盘布局由后续打包步骤决定。
工作流也支持 `repository_dispatch` 触发，无手动输入时采用上述默认值。

## 设备主页

固件内置原生 LuCI 主页，入口为左侧 **主页**，地址为 `/cgi-bin/luci/admin/home`。
主页排在菜单首位，标准 LuCI 登录入口会优先进入；原有“状态 → 概览”仍可访问。
x86 和 N1 共用 `packages/luci-app-home/` 插件源码，分别打包为 apk 和 ipk，通过包管理器安装。
不依赖 iStore、quickstart 后端或在线前端资源。

- **网络概览**：LAN 地址、当前 IPv4 默认网关、DNS 和 DHCPv4 配置；根据当前配置显示旁路由、主路由或自定义网络。
- **设备状态**：CPU、内存、根分区可用空间及运行时间。首次采样时 CPU 和流量暂不显示数值。
- **LAN 实时流量**：每 5 秒刷新，保留最近 30 次采样；统计包含本地通信，不代表互联网带宽或连通性。
- **出口 IP 与连通性**：手动查询国内腾讯、国外 ipify 和 ChatGPT 诊断接口的出口 IP，检测 Google、X 的跨域响应与 HTTP 耗时，支持隐藏 IP。
  请求从当前浏览器发起，遵循浏览器自身的网关、代理与分流规则；不代表路由器自身出口，也不保证账号登录或服务解锁可用。
  Google、X 不返回出口 IP，跨域响应不可读取 HTTP 状态；检测失败可能由超时、跨域策略或服务拒绝引起。
- **常用应用**：按当前可访问菜单展示 OpenClash、Clashoo、Docker、固件更新、晶晨宝盒、Bandix、文件管理和终端。
  服务状态能确认时显示运行情况，否则显示“已安装”，不把缺少状态信息当作服务正常。
- **网络接口与快捷入口**：查看接口地址与连接状态，进入网络、DHCP、防火墙、备份和详细状态页面。

主页仅申请读取权限，打开页面不会修改网络、启动服务或执行更新。
样式支持窄屏与深色主题；页面、样式、菜单和权限均位于 `packages/luci-app-home/root/`。
打包方式见 [主页插件说明](packages/luci-app-home/README.md)。

### 首次网络配置

首次打开主页时进入网络向导，按“选择模式 → 网络设置 → 确认配置”完成设置。
也可暂时保留现有配置进入主页，之后从 **系统 → 网络向导** 重新打开。

- **旁路由**：选择 LAN 网口、管理地址、掩码、主路由地址和 IPv4 DNS。关闭 WAN、LAN DHCPv4、
  DHCPv6、RA、NDP 及 dnsmasq 唯一授权，保留 DNS 服务；客户端仍需手动指定网关。
- **主路由**：分别选择 LAN 和 WAN 接口，上网方式支持 DHCP、PPPoE、静态地址。
  启用 LAN DHCP、LAN 到 WAN 转发与 NAT，WAN 入站设为拒绝；WAN6 自动获取，LAN 提供 DHCPv6/RA。
- 主路由要求独立的 LAN/WAN 接口。向导不创建 VLAN，不处理已有 VLAN 过滤网桥或复杂网络，
  这些场景使用“高级网络设置”。

应用前会检查网口冲突、地址、网段和网关，并展示最终配置与新管理地址。
应用使用 LuCI 原生的连接检查、确认和超时回滚；变更地址后按提示连接新地址完成确认。
当前会话已有未应用配置时，须先处理后再使用向导。
完成状态与网络配置一起应用并保存；保留配置升级会保留该状态。“暂时跳过”仅对当前浏览器会话生效。

## x86 在线更新

x86 固件内置 **GitHub 固件更新**，入口为 **系统 → GitHub 固件更新**。
首次需手动刷入带此功能的新固件；之后可在页面检查更新、下载校验，并确认是否保留配置后升级。
当前适配 x86-64、EFI 启动、squashfs 镜像。N1 使用下面的晶晨宝盒更新方式。

更新仓库默认指向构建所在的 GitHub 公开仓库，也可在页面填写 `owner/repo` 更改；暂不支持私有仓库认证。

下载默认直连，可选择 `ghfast.top`、`gh-proxy.com` 或自定义 HTTPS 镜像前缀，对更新清单和固件同时生效。
版本列表默认直连 GitHub API；如需加速，另填支持 GitHub API 的加速前缀。修改后点击“保存并检查”。
两类前缀均按 `https://镜像地址/完整原始URL` 拼接，例如 `https://mirror.example.com/https://github.com/...`。
镜像异常时可切回直连或其他镜像，不自动改用其他服务；镜像同时转发清单和固件，SHA256 校验不等于独立签名。
目标仓库须使用本项目的更新清单协议，任意固件 Release 地址不能直接通用。

页面列出最近 100 条发布中的 x86 固件，按发布时间排序，默认选择最新可在线更新的版本。
可自行选择历史版本、重装当前版本，或切换含 / 不含 Docker 的构建；Docker 仅作为固件信息展示。
旧 Release 如果没有更新清单，会在列表中标明，不能直接在线刷写。

每个 Release 同时保存镜像、`x86-64-update.json` 和 SHA256 校验文件，不再维护单独的更新通道。
下载前读取所选 Release 的清单，最终确认绑定该 Release 与镜像哈希。
插件仍校验设备类型、文件大小、SHA256、磁盘容量与系统升级兼容性，不自动定时刷写。
选择较早构建时会提示配置兼容性，并默认不保留配置；分区布局变化也会单独提示。
保留配置不等于保留整个 overlay、额外分区或 Docker 数据，升级前可下载系统配置备份。

插件源码及协议见 [packages/luci-app-online-upgrade](packages/luci-app-online-upgrade/README.md)。

## N1 晶晨宝盒更新

N1 通过 **系统 → 晶晨宝盒 → 在线下载更新** 更新固件。
新构建会将插件自带的公共默认更新仓库改为构建所在的仓库，Fork 后同样适用；用户另行指定的仓库会保留。
已有设备可在晶晨宝盒“插件设置”中手动填写：

| 配置项 | 本仓库设置 |
| --- | --- |
| OpenWrt 固件下载仓库 | `https://github.com/varcli/openwrt-autobuild` |
| Releases Tags 关键字 | `phicomm-n1` |
| 固件文件后缀 | `.img.gz` |

N1 发布标签使用 `phicomm-n1-日期-构建编号`，镜像保留 flippy 原文件名，例如
`openwrt_s905d_n1_R26.03.25_k6.6.120-flippy-94+.img.gz`，供插件按 `n1` 和内核分支识别。
发版前检查设备标识、压缩文件完整性和内核分支，并为镜像生成 `sha256sums`。

晶晨宝盒会在最新匹配的 N1 Release 中寻找所选内核分支。
因此，插件的内核分支设置需与该 Release 实际包含的分支一致；工作流默认打包 `6.1.y_6.6.y`。
此处修改的是固件下载配置，内核下载仓库及晶晨宝盒自身的升级方式沿用原设置。

## 自定义配置

### 插件选择

按目标编辑对应文件，取消某行注释即可集成该组插件，注释掉则不再主动选择该组插件。

| 目标 | 插件清单 |
| --- | --- |
| x86-64 | [shell/apk-custom-packages.sh](shell/apk-custom-packages.sh) |
| N1 | [shell/custom-packages.sh](shell/custom-packages.sh) |

当前 x86-64 集成 OpenClash、Clashoo、Bandix、rtp2httpd、分区扩容等功能；
N1 集成 OpenClash、Turbo ACC、应用过滤、分区扩容及用于写入 eMMC 的晶晨宝盒。
两目标均包含 Argon 主题、磁盘管理、网页终端与 SFTP 服务。

常用代理为 OpenClash 或 Clashoo，按需选择运行；同时集成多个插件不代表需要同时运行多个透明代理服务。
默认不集成 Passwall、Passwall2 或 HomeProxy。

编辑插件清单时，保留所选插件需要的依赖组。Clashoo 与 Nikki、Quickfile 与 luci-app-run
存在配置冲突，避免同时集成对应组合。

### 网络与文件覆盖

- [files/etc/uci-defaults/99-custom.sh](files/etc/uci-defaults/99-custom.sh)：首次启动配置。
  单网口地址由顶部的 `ROUTER_IP`、`MAIN_ROUTER_IP`、`NETMASK` 定义；多网口 LAN 地址在对应分支修改。
- [files/etc/banner](files/etc/banner)：终端欢迎信息。
- `files/`：需要写入固件的其他文件，按设备内的目录结构放置。

`files/` 由两个目标共享，修改后会同时影响两类固件。
更换默认地址后，同步调整客户端设置和工作流中的 Release 地址说明。

### 版本与软件包

升级版本时，同时修改对应 workflow 的 `ImageBuilderVersion` 和目标 `.config` 的
`CONFIG_VERSION_REPO`，并确认镜像标签和所选软件包可用。

软件包可从以下来源查询：

- [ImmortalWrt 官方软件源](https://downloads.immortalwrt.org/releases/)
- [x86 第三方 apk 仓库](https://github.com/wukongdaily/apk)
- [N1 第三方软件仓库](https://github.com/wukongdaily/store)

内核模块需查询目标平台的 kmods 索引；部分第三方插件不在官方软件源中。

## 项目结构

```text
.github/workflows/    GitHub Actions 构建与发布
x86-64/              x86 配置与构建脚本
phicomm-n1/          N1 配置与构建脚本
shell/               公共构建函数、插件清单、第三方包整理
packages/            本仓库维护的内置插件源码（主页、x86 在线更新）
files/               固件文件覆盖层与首次启动配置
tests/               本地离线回归测试（已被 Git 忽略）
AGENTS.md            仓库维护约定
```

## 参考与鸣谢

- [luci-app-myhome](https://github.com/qzrsa/luci-app-myhome) 与 [luci-app-quickstart](https://github.com/linkease/nas-packages-luci)：主页布局思路参考。
- [ImmortalWrt](https://github.com/immortalwrt)
- [ImmortalWrt ImageBuilder](https://github.com/wukongdaily/ImmortalWrt-ImageBuilder)
- [AutoBuildImmortalWrt](https://github.com/wukongdaily/AutoBuildImmortalWrt)
- [flippy-openwrt-actions](https://github.com/ophub/flippy-openwrt-actions)
- 各插件、主题与软件包的开发者和维护者
