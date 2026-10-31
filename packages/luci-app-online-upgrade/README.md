# luci-app-online-upgrade — 本仓库 x86 适配版

## 构建

仅由 x86 工作流挂载到 ImageBuilder 的 `package-sources/`。
`shell/build-online-upgrade.sh` 使用 ImageBuilder 自带的 `staging_dir/host/bin/apk mkpkg`
生成原生 apk，再由 `make image PACKAGES=...` 安装。无需 SDK 或源码编译固件。
仓库的 `packages/` 为插件源码，容器的 `packages/` 为成品 apk，禁止将它们挂载到同一路径。

## 更新协议

- 构建信息保存在 `/usr/share/online-upgrade/build.json`，不从 UCI 中读取当前构建号。
- UCI 仅设置 GitHub 仓库，默认使用构建所在的仓库，支持 Fork。
- GitHub API 返回最近 100 条 Release，页面过滤 x86 squashfs EFI 镜像并按发布时间排序。
- 默认选择最新可用构建，可以手动选择历史版本、重装或切换 Docker 配置，不维护额外更新通道。
- 每个 Release 保存自己的 `x86-64-update.json`，镜像 URL 固定指向该 Release。
- 清单包含目标、EFI/squashfs 类型、构建编号、容量、Docker 配置和 SHA256。
- 没有清单的旧 Release 仅列出，不能在线刷写。所选标签必须来自本次查询，清单也必须对应该标签。
- Docker 标识只描述目标固件，不阻止切换；仍拒绝架构、启动方式或文件系统不匹配的镜像。
- 下载绑定标签，确认刷写绑定标签和哈希；回退旧构建时提示兼容性并默认不保留配置。

## 执行边界

页面通过认证后的 LuCI/rpcd 调用固定后端脚本，没有独立 CGI，也没有上传恢复或强制升级入口。
检查、下载和刷写分开；下载完成后必须手动确认是否保留配置，再次校验后交给系统 sysupgrade。
SHA256 用于验证与 GitHub HTTPS 更新清单的一致性，不是独立的固件签名体系。

后端有任务锁、HTTPS 下载超时及重试、临时空间、压缩文件、实际解压容量、启动磁盘容量、
系统镜像校验和 `sysupgrade --test` 检查。检测到分区布局变化时页面明确提示。
不使用 `--force`，不承诺保留额外分区、Docker 数据或整个 overlay。

配置保留由系统备份清单处理，附带保留 OpenClash 和 Clashoo 的常用配置目录，不包含代理内核、
GeoIP/GeoSite 数据或所有运行时文件。新增自定义文件需自行维护 `/etc/sysupgrade.conf`。
第一次须手动刷入带本插件的固件，后续才可在“系统 → GitHub 固件更新”中升级。
