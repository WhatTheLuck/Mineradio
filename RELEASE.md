# Mineradio 2.3.1 发布流程

## 发布边界

- 正式版本：`2.3.1`
- Git tag：`v2.3.1`
- Release 标题：`Mineradio 2.3.1`
- 安装包：`Mineradio-2.3.1-Setup.exe`
- 仅从当前可信源码完整构建，不复用旧安装包或旧 `dist/`。
- 正式 Release 不混入 Mineradio_Beat 产物。
- GitHub Release 只附带完整安装包和最小版本说明 `latest.yml`；不上传 blockmap、构建清单或内部测试产物。

## 公开更新说明

- 随安装包提供 28 首本地 MP3，首次启动加入“本地音乐”歌单，断网时仍可播放。
- CyberRibbon、SpaceVenom 与 EmoMusic 使用最新保存预设对应的软件默认参数；用户保存的更新预设仍优先加载。

## 下载入口

- GitHub Release：[下载 Mineradio 2.3.1](https://github.com/WhatTheLuck/Mineradio/releases/tag/v2.3.1)

<!-- mineradio-download-page: GitHub Release|https://github.com/WhatTheLuck/Mineradio/releases/tag/v2.3.1 -->

## 发布资产

GitHub Release 上传 `dist/Mineradio-2.3.1-Setup.exe` 和 `docs/update/latest.yml`。版本说明仅包含 `version/releaseDate`，不得使用带安装包下载字段的构建工具清单。

安装包 SHA-256：`d444fa69e39af5c6f5d2564e8961340bb5f8f38fd19e51bb7a129ddab3ad2c9e`。

## 发布前检查

- 运行完整回归检查与 Electron 启动检查。
- 构建并检查 `win-unpacked/resources/app` 内容，核对正式版本、资源完整性和源码一致性。
- 启动安装包并确认进程正常响应；能读取原生界面时，再检查欢迎页、默认路径和目录选择页，不点击安装。
- 确认仓库与安装包不包含 Cookie、Token、凭据、缓存或本机日志。
- 核对安装包 SHA-256、Release 正文和软件更新入口。
