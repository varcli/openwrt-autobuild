# AGENTS.md

本文件面向在本仓库工作的 AI 编码助手，记录项目结构、改版约定与踩坑点。

## 项目概览

基于 GitHub Actions + ImmortalWrt 官方 **ImageBuilder** Docker 镜像的固件自动构建项目。
构建过程不在本机完成，而是在 CI 中挂载本仓库文件进容器执行。

固件内的首次启动脚本、插件清单、ImageBuilder 配置分别由 `files/`、`shell/`、`<target>/.config` 提供。

## 项目定位：旁路由（重要前提）

本仓库固件**主要作为旁路由使用**，这与上游参考项目 `wukongdaily/ImmortalWrt-ImageBuilder`
的定位**不同**，是理解本仓库所有"刻意差异"的前提。

旁路由的典型配置是同网段静态 IP + 网关/DNS 指向主路由。本仓库
`files/etc/uci-defaults/99-custom.sh` 单网口分支设的
`ipaddr=192.168.123.2` / `gateway=192.168.123.1` / `dns=192.168.123.1` 正是这个模式。

上游面向"开箱即用当主路由/客户端"，其脚本在单网口设备上设 `network.lan.proto='dhcp'`（当客户端），
**与旁路由需求相反**。因此涉及网络部分的改动，不要把上游那套当升级目标照搬。

## 目录结构与职责

```
<target>/build.sh      # 该机型在容器内执行的主脚本（组装 PACKAGES 并调用 make image）
<target>/.config       # ImageBuilder 的 .config，含 CONFIG_VERSION_REPO（决定软件源版本）
.github/workflows/     # 每个机型一个 workflow，负责挂载与发布
files/                 # 打进固件的文件树，与容器 /home/build/immortalwrt/files 同构
files/etc/uci-defaults/99-custom.sh   # 首次开机执行的定制脚本
shell/                 # 构建期脚本，与容器 /home/build/immortalwrt/shell 同构
README.md
```

## 两个构建目标（关键差异）

| | x86-64 | phicomm-n1 |
|---|---|---|
| workflow | `build-x86-64.yml` | `build-phicomm-n1.yml` |
| 镜像 | `x86-64-openwrt-<ver>` | `armsr-armv8-openwrt-<ver>` |
| 版本线 | 25.12.x | 24.10.x |
| 包格式 | **apk**（`.config` 中 `CONFIG_USE_APK=y`） | **ipk**（opkg） |
| 插件脚本 | `shell/apk-custom-packages.sh` | `shell/custom-packages.sh` |
| 打包脚本 | `shell/apk-prepare-packages.sh` | `shell/prepare-packages.sh` |
| 输出 | `*-squashfs-combined-efi.img.gz` | `rootfs.tar.gz` 再经 `flippy-openwrt-actions` 打成 N1 镜像 |

### 务必注意

- **`shell/` 下的两个 `custom-packages` 文件互不相干**：各自被对应机型的 `build.sh` `source`，
  改错文件不会报错，只是静默不生效。
- **`files/` 是共享的**，两个机型都会打入 —— 改 `99-custom.sh` 会同时影响 x86-64 和 N1。
- x86-64 与 N1 均为**单网口**，走旁路由静态 IP 分支；多网口分支仅在物理多网口机器上生效。

## 版本号一致性（最容易出错的地方）

改版本必须**同时**改两处，否则会出现配置文件版本与 ImageBuilder 版本不匹配：

1. `.github/workflows/build-<target>.yml` 顶部的 `ImageBuilderVersion`
2. `<target>/.config` 中的 `CONFIG_VERSION_REPO`

另外注意：

- **不要照搬上游参考仓库的 `.config`**：上游 `x86-64/imm25.config` 里写的是 `25.12.0-rc1`，
  比本仓库的正式版还旧，直接覆盖等于降级。只改版本行即可。
- N1 的版本线是 24.10.x，与 x86-64 不同步；`armsr-armv8-openwrt-24.10.6` 已是 Docker 上最新标签，
  不要想当然跟着 x86 一起升级。

### 改版检查清单

1. 确认 Docker 标签存在：`https://hub.docker.com/v2/repositories/immortalwrt/imagebuilder/tags?name=<前缀>`
2. 改上述两处版本号
3. **核对包名是否仍存在**（跨版本会掉包，掉包将直接导致构建失败）：
   - 25.12.x（apk）：列目录 `releases/<ver>/packages/x86_64/<feed>/` 的 `.apk` 文件名
   - 24.10.x（ipk）：列目录 `releases/<ver>/packages/aarch64_generic/<feed>/` 的 `.ipk` 文件名
   - feed 有 `base` / `luci` / `packages` / `routing` / `telephony`，外加 `targets/<board>/<sub>/packages/`
4. **内核模块不在 `packages/` 里**：`kmod-*` 位于
   `targets/<board>/<sub>/kmods/<kernel-ver>-<hash>/`，漏查会误判为"包缺失"。
5. 需要核对的包来自三处：`build.sh` 的 `PACKAGES`、`shell/*custom-packages.sh` 中**未注释**的行、
   `.config` 中 `CONFIG_PACKAGE_*=y`
6. 末尾跑 `bash -n` 做语法检查

### 包来源速查

- ImmortalWrt 官方源：大部分 `luci-*`、内核模块、基础库
- 第三方 run/apk 仓库 `wukongdaily/apk`（x86-64 用 `run/x86`，N1 用 `wukongdaily/store` 的 `run/arm64`）：
  `luci-app-openclash`、`luci-app-passwall2`、`luci-app-partexp`、`bandix`、`clashoo`、`luci-app-rtp2httpd`
  —— 这些在官方源里查不到属正常，**不要**据此判定为掉包。

## 插件自定义方式

`shell/*custom-packages.sh` 本质是在拼接 `PACKAGES` 字符串：

- 注释掉某行 = 不集成该插件
- 行首是 `#CUSTOM_PACKAGES=` 的就是"备选清单"，按需打开注释
- 减号可排除依赖，例如 `-luci-app-argon-config`

已知互斥（见脚本内注释）：`clashoo` ↔ `nikki`；`quickfile` ↔ `luci-app-run`。

`build.sh` 中的内置逻辑：x86-64 在检测到 `luci-app-openclash` / `luci-app-ssr-plus` 时会下载
对应架构的 clash_meta / GeoIP / GeoSite / mihomo core 并塞进 `files/`。

## 与上游参考仓库的刻意差异

上游 `wukongdaily/ImmortalWrt-ImageBuilder` 是主要参考来源。本仓库有意**不**跟随的部分：

- `files/etc/uci-defaults/99-custom.sh`：**保留本仓库版本，这是有意为之，不是遗漏**。
  单网口使用静态 `192.168.123.2` + 网关/DNS 指向 `192.168.123.1`（旁路由模式），
  且署名 `Compiled by varcli`。上游版本会把单网口改为 DHCP（当客户端）并支持 PPPoE、
  自定义管理地址 —— 与旁路由定位冲突，属于**行为变更**，不采纳。
  后续若同步上游，**不要**把这部分"对齐"过去。
- 工作流结构：未引入上游的 `luci_version` 选择器、`custom_router_ip`、PPPoE 输入、`enable_store` 开关。
- `phicomm-n1/build.sh`：保留本仓库的 passwall / openclash / homeproxy 组合，
  未换成上游的 filebrowser-go / filemanager；x86-64 保留了 `qemu-ga`。
- 未引入上游的 `arch/`、`n1/banner`、`n1/99-banner.sh`、`n1/info.md`。

### 无害但存在的冗余

`x86-64/build.sh` 会写出 `files/etc/config/pppoe-settings`，但本仓库
`build-x86-64.yml` 不传 `ENABLE_PPPOE`，`99-custom.sh` 也不读取该文件 —— 当前是死代码，可忽略。

## 本次升级记录（2026-10-06）

范围：仅版本与配置，保持 x86-64 + N1 两个目标。

**版本**
- `x86-64/.config` — `CONFIG_VERSION_REPO` 25.12.0 → 25.12.2
- `.github/workflows/build-x86-64.yml` — `ImageBuilderVersion` → `x86-64-openwrt-25.12.2`
- N1 未改动（已是 `armsr-armv8-openwrt-24.10.6`，为最新标签）

**插件注释补充**（均为注释行，不影响构建产物）
- `shell/apk-custom-packages.sh` — 补 quickstart、luci-app-run、geoview（passwall / passwall2 / ssr-plus）、
  taskplan、mosdns、openclash 依赖组；补 clashoo↔nikki 冲突、openvpn-server 缺陷、daed 1.28.0 提示
- `shell/custom-packages.sh` — N1 侧同样条目（保留 CRLF 行尾）

**生效插件集合逐字节未变**，已核对 x86-64 的 9 行、N1 的 4 行 `CUSTOM_PACKAGES=`。

**已验证的包可用性**
- x86-64：`build.sh` 全部 11 个内置包在 25.12.2 存在；`kmod-nft-tproxy` / `kmod-nft-socket`
  在 kmods `6.12.103` feed；第三方插件由 `run/x86` 提供
- N1：`build.sh` 全部 23 个包在 24.10.6 存在（含 `kmod-brcmfmac`）
- 两个插件脚本 `bash -n` 通过

**未做**：`99-custom.sh` 逻辑、工作流结构、N1 与 x86-64 的 `build.sh` 包列表均保持原样。
其中 `99-custom.sh` 的旁路由网络配置为**有意保留**，见上文「与上游参考仓库的刻意差异」。
