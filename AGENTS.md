# AGENTS.md

本文件供在本仓库工作的 AI 编码助手使用，描述当前实现和维护约束。历史变更查阅 Git 记录，不在此累积升级日志。

## 项目定位

本项目通过 GitHub Actions 和 ImmortalWrt 官方 ImageBuilder Docker 镜像打包固件，不从源码编译 OpenWrt。
实际构建在 CI 容器中完成，本机主要用于编辑、分析和检查。

主要用途是**单网口旁路由**：主路由负责地址分配，客户端手动指定网关。
x86-64 主要运行在虚拟机中，另一个目标为斐讯 N1。优化应保持已可用的旁路由行为与构建流程。

## 文件入口

```text
.github/workflows/build-<target>.yml  镜像选择、参数传递、文件挂载、固件发布
<target>/.config                     ImageBuilder 配置与软件源版本
<target>/build.sh                    组装包列表、下载代理组件、执行 make image
shell/build-common.sh               公共参数校验、错误处理、下载和克隆函数
shell/*custom-packages.sh            各目标插件清单
shell/*prepare-packages.sh           解包第三方 .run 并收集 apk/ipk
shell/build-online-upgrade.sh        使用 ImageBuilder 的 apk-tools 打包在线更新插件
shell/firmware-update.py             生成构建标识、更新清单与 SHA256
packages/luci-app-online-upgrade/    x86 在线更新插件源码
files/                              两目标共享的固件文件覆盖层
files/etc/uci-defaults/99-custom.sh   首次启动网络与服务默认值
files/etc/banner                    共享的静态终端欢迎信息
README.md                           面向使用者的构建与旁路由说明
```

工作流将仓库文件挂载到容器 `/home/build/immortalwrt/` 后执行目标脚本。
`files/` 直接进入固件，`shell/` 仅用于构建期。修改共享文件时必须评估两个目标。

## 构建目标

以下为仓库当前配置。升级前重新查询可用的镜像标签和软件包索引。

| 项目 | x86-64 | phicomm-n1 |
| --- | --- | --- |
| workflow | `build-x86-64.yml` | `build-phicomm-n1.yml` |
| Docker 标签 | `x86-64-openwrt-25.12.2` | `armsr-armv8-openwrt-24.10.6` |
| 包格式 | apk，`CONFIG_USE_APK=y` | ipk，opkg |
| 插件清单 | `shell/apk-custom-packages.sh` | `shell/custom-packages.sh` |
| 包整理 | `shell/apk-prepare-packages.sh` | `shell/prepare-packages.sh` |
| 第三方来源 | `wukongdaily/apk` 的 `run/x86` | `wukongdaily/store` 的 `run/arm64` |
| Docker 默认 | `no` | `yes` |
| 产物 | `*-squashfs-combined-efi.img.gz` | `rootfs.tar.gz`，随后由 flippy 打包为 N1 镜像 |

两个 custom-packages 脚本独立生效，改错文件不会报错，只会静默不生效。

## 旁路由约定

`99-custom.sh` 顶部集中定义单网口网段：

```sh
ROUTER_IP='192.168.123.2'
MAIN_ROUTER_IP='192.168.123.1'
NETMASK='255.255.255.0'
```

- 单网口 LAN 使用静态地址，网关和 DNS 指向主路由。
- LAN 的 DHCPv4、DHCPv6、IPv6 RA、NDP 服务关闭，保留 dnsmasq DNS 服务。
- 客户端手动将网关指向旁路由；需要 DNS 也经旁路由处理时，客户端 DNS 同样指向旁路由。
- `openwrt.lan` 使用固定名称 `dhcp.openwrt_lan`，地址引用 `ROUTER_IP`，避免匿名 section 索引误写。
- 广播地址由 IP 和掩码计算，不写死。更换网段时同步维护客户端设置和相关说明。
- 不全局禁用 IPv6；关闭旁路由 RA 不会阻止客户端从主路由获得 IPv6。
- 多网口分支保留 `192.168.100.1/24`，不套用单网口的 DHCP 关闭逻辑。

网卡计数依据 `/sys/class/net/` 中存在 device 且名称以 eth/en 开头的接口。
修改识别逻辑属于网络行为变更，应验证虚拟机和 N1 场景。

首次启动脚本还维护 Docker 防火墙、ttyd/SSH 监听及 `Compiled by varcli` 署名。
保留配置升级可能沿用旧设置，不能将首次启动默认值描述为对所有升级方式强制生效。

## 常用代理与运行环境

用户主要使用 **OpenClash 或 Clashoo**，插件选择按实际需求维护，不将现有代理组合固化为必须保留的功能。
当前 x86 同时集成两者，N1 集成 OpenClash；集成多个插件不代表要同时运行多个透明代理服务。

Passwall、Passwall2 和 HomeProxy 不默认集成，也不额外加入它们使用的 xray-core、sing-box、hysteria、
geoview 等组件。共享依赖应按仍在使用的插件判断，不能仅因也被 Passwall 使用就删除。
OpenClash 的完整依赖组由 apk 插件清单维护：

```text
luci-compat bash curl ip-full unzip kmod-tun kmod-inet-diag kmod-nft-tproxy kmod-nft-socket
```

构建脚本下载内核和规则文件不会自动补齐这些依赖，不能当作冗余删除；curl 的重复声明无害。
x86 按插件选择下载 OpenClash 内核、GeoIP、GeoSite、最新 apk，或 ssr-plus 所需的 mihomo。

x86 保留 `qemu-ga`，用于虚拟化平台管理来宾机；N1 集成写入 eMMC 所需的 amlogic 插件。
这些包与代理方案无关，精简代理组件时不要一并移除。

插件清单中有效的 `CUSTOM_PACKAGES=` 行表示启用，注释行表示备选，负包名用于排除包。
已知互斥：clashoo 与 nikki；quickfile 与 luci-app-run。

## 参数与可靠性

两个 build.sh 先设置各自的 `INCLUDE_DOCKER` 默认值，再 source `shell/build-common.sh`。

| 变量 | 含义 | 默认值 |
| --- | --- | --- |
| `ROOTFS_PARTSIZE` | ImageBuilder 分区容量，正整数 MB | `1024` |
| `PROFILE` | ImageBuilder 设备型号 | `generic` |
| `INCLUDE_DOCKER` | 是否集成 Docker，只接受 yes/no | 按目标设置 |
| `OPENWRT_KERNEL` | workflow 传给 N1 后续打包的内核选择 | `6.1.y_6.6.y` |

不要混用 PROFILE 和容量变量。N1 最终磁盘布局由 flippy 决定，容量参数不等于压缩镜像文件大小。
手动触发和 repository_dispatch 无 inputs 时都应有可用默认值；输入通过环境变量传给 shell。

公共脚本启用 `set -eo pipefail`，临时目录由退出 trap 清理：

- `download_file`：超时、有限重试、非空检查，成功后才替换目标文件。
- `install_core`：检查 tar.gz/gz 解包结果，成功后安装可执行内核。
- `clone_repository`：克隆超时与有限重试。

关键步骤失败必须终止构建。修改时注意条件语句、管道和函数调用对 `set -e` 的影响。
两个 prepare-packages 脚本使用 `/bin/sh`，保持 POSIX shell 兼容，收集解包所得包及
extra-packages 根目录、一级子目录的散包。解包和复制失败必须向上传递；
`find -exec ... \;` 内部复制失败不能简单视为 find 自身失败。

发布要求前序步骤成功且目标固件存在、非空。N1 额外检查 `PACKAGED_STATUS=success`
和文件整理步骤的 ready 输出。上传保持 `fail_on_unmatched_files: true`，防止无附件发布。

## x86 在线更新

仅 x86 集成 `luci-app-online-upgrade`，目前支持 EFI 启动与 squashfs 镜像。
`packages/` 是仓库源码目录，工作流挂载到容器 `package-sources/`；不能挂载到容器的成品 packages 目录。
第三方包整理后，使用 ImageBuilder 自带的 `staging_dir/host/bin/apk mkpkg` 生成原生 apk，
再通过 PACKAGES 安装，不额外引入 SDK。

- 每次构建写入不可变的构建标识、目标、容量和 Docker 配置到 `/usr/share/online-upgrade/build.json`。
  当前版本信息不能只存入会被保留配置覆盖的 UCI 文件。
- 每个历史 Release 附带该构建的镜像、更新清单和 SHA256，不维护额外固定通道。
- 页面从 GitHub API 获取最近 100 条发布中的 x86 固件，按发布时间排序，默认选择最新可用版本。
  可以选择历史版本、重装当前版本或切换 Docker 配置；Docker 标识只作描述，不作为兼容性限制。
- 没有更新清单的旧固件标记为不可在线刷写。所选 Release 必须在本次查询的列表中，且清单与标签一致。
- 下载请求绑定所选标签，最终刷写确认绑定标签与 SHA256，防止多个会话更改选择后刷错版本。
- 回退旧构建须明确提示配置兼容性，默认不保留配置；仍必须校验架构、启动方式和文件系统。
- 插件经认证后的 LuCI/rpcd 调用后端，无独立恢复 CGI；不提供强制刷写或定时自动刷写。
- 下载与刷写分开，必须明确确认；刷写前重新核对哈希、容量和系统镜像校验。
- 分区布局变化必须提示；保留配置通过系统备份清单处理，不承诺保留整个 overlay 或额外磁盘数据。
- 更新信任来源是配置的 GitHub 仓库及 HTTPS，SHA256 校验不等于独立固件签名。

## 版本与包维护

修改某个目标版本时同步更新 workflow 的 `ImageBuilderVersion`、对应 `.config` 的
`CONFIG_VERSION_REPO`，以及 README、本文件中的当前版本。版本升级优先只修改相关版本行，
保留其余配置；N1 与 x86 独立维护版本线。目前 N1 两处均为 24.10.6。

升级或新增包时：

1. 通过 Docker Hub API 确认标签存在：
   `https://hub.docker.com/v2/repositories/immortalwrt/imagebuilder/tags?name=<前缀>`。
2. 核对 build.sh 的 PACKAGES、对应插件清单的有效行、`.config` 启用的实际包。
   配置中的包功能子选项不是独立包名，依赖也可能由 Provides 提供。
3. 官方索引位于 `https://downloads.immortalwrt.org/releases/<版本>/`：
   通用包查询 `packages/x86_64/` 或 `packages/aarch64_generic/`，feed 包括
   base、luci、packages、routing、telephony。
4. 平台包另查 `targets/x86/64/packages/` 或 `targets/armsr/armv8/packages/`。
5. **kmod 包另查**相应 target 的 `kmods/<内核版本与哈希>/`，不要只查通用包目录。
6. OpenClash、partexp、bandix、clashoo、rtp2httpd 等还可能来自第三方源。
   官方查不到时检查目标实际使用的第三方目录，不要直接判定掉包。

源索引和 Docker 标签会变化，过去某次核对通过不能替代新一轮升级验证。

## 检查与交付

在线更新功能的离线测试位于 `tests/`，不会实际下载或刷写设备。按改动范围完成必要检查：

- `python -X utf8 -m unittest discover -s tests -v` 检查清单生成和后端失败处理。
- `node tests/test_online_upgrade_ui.js` 检查页面权限、下载/确认分离及分区变更提示。
- `git diff --check` 检查空白错误，并审阅实际 diff。
- shell 改动运行 `bash -n`；以 `/bin/sh` 执行的脚本另运行 `sh -n`。
- workflow 改动检查 YAML、内嵌 shell 语法、参数传递和成功/失败条件。
- 公共构建逻辑覆盖两个目标；必要时模拟下载失败、空文件、解包/复制失败及 make 失败。
- 网络改动检查单网口和多网口分支；本地模拟不能描述为实机验证。
- Windows 可使用 Git for Windows 自带 Bash。执行检查使用与 CI 一致的 LF 副本，
  保留未改文件的原有行尾，尤其不要无故重写插件清单。
- banner 保持窄终端可读，使用 ASCII 图形和基础 ANSI 颜色；不写死版本、IP 或虚构实时状态。

实际固件构建、N1 打包和首次启动效果由 CI 与设备验证。
交付说明应区分已完成的本地检查与尚未执行的实际构建、实机验证。
