# OpenWrt AutoBuild

基于 GitHub Actions 与 ImmortalWrt ImageBuilder 的固件自动构建项目，支持 **x86-64** 和 **斐讯 N1**。
根据识别到的网口数量应用网络默认配置，适用于单网口旁路由和多网口主路由场景。

[构建工作流](https://github.com/varcli/openwrt-autobuild/actions) · [固件下载](https://github.com/varcli/openwrt-autobuild/releases)

## 功能概览

- **自动构建与发布**：通过 GitHub Actions 生成固件并上传至 Releases。
- **识别网口数量**：单网口采用静态旁路由配置，多网口设置主路由 LAN 管理地址。
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

## x86 在线更新

x86 固件内置 **GitHub 固件更新**，入口为 **系统 → GitHub 固件更新**。
首次需手动刷入带此功能的新固件；之后可在页面检查更新、下载校验，并确认是否保留配置后升级。
当前适配 x86-64、EFI 启动、squashfs 镜像，N1 的更新方式保持原样。

更新仓库默认指向构建所在的 GitHub 公开仓库，也可在页面填写 `owner/repo` 更改；暂不支持私有仓库认证。
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
packages/            本仓库维护的 x86 内置插件源码
files/               固件文件覆盖层与首次启动配置
tests/               在线更新的离线回归测试
AGENTS.md            仓库维护约定
```

## 参考与鸣谢

- [ImmortalWrt](https://github.com/immortalwrt)
- [ImmortalWrt ImageBuilder](https://github.com/wukongdaily/ImmortalWrt-ImageBuilder)
- [AutoBuildImmortalWrt](https://github.com/wukongdaily/AutoBuildImmortalWrt)
- [flippy-openwrt-actions](https://github.com/ophub/flippy-openwrt-actions)
- 各插件、主题与软件包的开发者和维护者
