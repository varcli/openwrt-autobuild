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
shell/build-home.sh                  使用 ImageBuilder 自带工具打包主页 apk/ipk
shell/firmware-update.py             生成构建标识、更新清单与 SHA256
shell/prepare-n1-files.sh            暂存 N1 覆盖层并设置晶晨宝盒更新仓库
shell/prepare-n1-release.py          校验 N1 发布镜像名称、内核分支和压缩数据
packages/luci-app-online-upgrade/    x86 在线更新插件源码
packages/luci-app-home/              两目标共用的主页插件源码
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
- LAN 的 DHCPv4、DHCPv6、IPv6 RA、NDP 服务关闭，同时关闭 dnsmasq 的 authoritative（唯一授权），保留 DNS 服务。
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

## 设备主页

主页源码位于 `packages/luci-app-home/root/`，同时支持 x86 和 N1；菜单为 `admin/home`，顺序为 1。
两目标将仓库 `packages/` 只读挂载为容器 `package-sources/`；第三方包整理后执行 `shell/build-home.sh`，
x86 使用自带 `apk mkpkg`，N1 使用自带 `scripts/ipkg-build` 打包，再通过 `PACKAGES` 安装 `luci-app-home`。
主页文件不再进入共享 `files/` 覆盖层，不另引入 SDK；依赖为 luci-base、rpcd-mod-file、rpcd-mod-luci。
通过 LuCI 的系统、接口、网卡、挂载点与服务查询接口读取状态，不安装额外后端。

- ACL 文件 `packages/luci-app-home/root/usr/share/rpcd/acl.d/luci-app-home.json` 仅提供读取权限，不加入 exec 或写操作。
- CPU 和 LAN 收发速率取相邻采样差值；首次采样、计数回退或读取失败时显示未知，不伪造零值。
- 模式依据当前 LAN、DHCP 和 WAN 配置判定，不将固件默认值或网卡数量当成当前模式。
- 网关就绪仅表示存在 IPv4 默认路由，LAN 流量包含本地通信，不能表示互联网连通或测速结果。
- 常用应用从当前会话可访问的菜单中查找，不硬塞未安装的 Docker、Clashoo 或晶晨宝盒入口。
  procd 无状态信息时仅显示已安装，不能误报运行中；N1 缺少 x86 构建信息时正常降级。
- 所有样式限制在 `.owh-home` 下，兼容浅色、深色和窄屏，不引入在线字体或 CDN 依赖。
- 主页、网络向导和在线更新使用统一的暖灰文字、白色面板、细边框、深色主按钮与绿色状态，
  不增加英文装饰标题。更新插件样式独立维护于 `resources/online-upgrade/style.css`，不依赖主页包。
- 插件页头使用带自身类名的 div，避免 Argon 的全局 header/伪元素规则；根容器显式撑满父容器，
  标题须隔离主题的背景、阴影和行高覆盖。布局验证应包含实际主题 CSS，不能只依赖裸页面预览。

首次网络向导位于 `view/home-setup.js`，配置规划与校验位于 `home/setup.js`，样式作用域为 `.owh-setup`。
`/etc/config/home` 的 completed 标记控制首次入口；暂时跳过仅存当前浏览器会话，系统菜单保留向导入口。

- 向导使用独立 `luci-app-home-setup` ACL，仅写 network、dhcp、firewall、home，不给主页增加写权限。
- 先在内存中校验并生成配置方案，最终确认后检查会话待应用配置，再 `uci.save()` 和 `ui.changes.apply(true)`。
  禁止直接 commit 或重启网络绕过 LuCI 的连接确认、超时回滚；完成标记随同网络配置提交或回滚。
- 旁路由关闭 WAN、LAN 地址分配/IPv6 通告与 authoritative，保留 DNS；主路由须选择独立接口，
  支持 DHCP/PPPoE/静态上网，配置 LAN DHCP、WAN6、NAT/转发与 WAN 入站拒绝。
- 校验端口冲突、LAN/WAN 网段重叠、可用地址和网关，DHCP 池须避开本机并适配小网段。
  不拆解已有 VLAN 过滤网桥，不抢占其他网络或网桥的端口；复杂场景交给高级网络设置。
- 保留非向导维护的配置，不读写代理或 Docker 设置，确认摘要及日志不得包含宽带密码。

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
- 下载默认直连，可选 ghfast、ghproxy 或自定义 HTTPS 前缀，作用于清单和镜像；API 前缀独立设置，默认直连。
  前缀后拼接完整原始 URL，禁止账号、查询参数和片段，不静默切换服务；不得改写清单内的原始 GitHub URL。
- 更新信任来源是配置的 GitHub 仓库、所选镜像及 HTTPS；镜像可能同时提供清单和固件，SHA256 校验不等于独立固件签名。

## N1 发布与晶晨宝盒

- 默认固件仓库来自 `UPDATE_REPOSITORY`（workflow 中为 github.repository），Tags 关键字为
  phicomm-n1，后缀为 .img.gz。固件仓库与内核仓库是独立设置，不要同时改掉内核下载来源。
- `prepare-n1-files.sh` 将共享 files 复制到临时 N1 覆盖层，生成晶晨宝盒的首次启动配置。
  只替换插件自带的公共默认仓库及本仓库对应配置，保留用户另行指定的仓库，不修改共享 files。
- 发布标签使用 ASCII 的 phicomm-n1-日期-构建编号。镜像保留 flippy 原名，必须包含
  openwrt_s905d_n1_ 和完整的 k主版本.次版本.补丁版本，不能删掉板型或内核信息。
- `prepare-n1-release.py` 在发布前检查文件名、gzip 完整性和所选内核分支，生成 sha256sums；
  只发布验证过的 N1 镜像及校验文件，不发布 rootfs 中间包。
- 晶晨宝盒按最新匹配 Release 的 BOARD=n1 和所选内核分支查找附件；如果最新 Release
  没有某分支，需在插件中选择实际提供的分支，不能仅看仓库历史上是否存在该内核。

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

本地 `tests/` 已被 Git 忽略，不随仓库分发。若工作区存在这些离线用例，可运行以下命令；
新检出的仓库按实际文件完成语法检查和 CI 验证，不假定测试目录存在。

- `python -X utf8 -m unittest discover -s tests -v` 检查清单生成和后端失败处理。
- `node tests/test_online_upgrade_ui.js` 检查页面权限、下载/确认分离及分区变更提示。
- `node tests/test_home_ui.js` 检查主页模式、菜单过滤、计数差值、失败降级与只读权限。
- `node tests/test_home_setup.js` 检查网络方案、模式切换、DHCP 地址池、参数冲突与安全应用流程。
- `python -X utf8 -m unittest discover -s tests -p test_home_packaging.py -v` 检查主页打包；N1 实包用例需要本地准备官方 ipkg-build。
- `python -X utf8 -m unittest discover -s tests -p test_n1_release.py -v` 检查 N1 镜像发布和默认仓库配置。
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
