# Mineradio 2.3.5 发布流程

## 发布边界

- 正式版本：`2.3.5`
- Git tag：`v2.3.5`
- Release 标题：`Mineradio 2.3.5`
- 安装包：`Mineradio-2.3.5-Setup.exe`
- 仅从当前可信源码完整构建，不复用旧安装包或旧 `dist/`。
- 正式 Release 不混入 Mineradio_Beat 产物。
- GitHub Release 只附带完整安装包和最小版本说明 `latest.yml`；不上传 blockmap、构建清单或内部测试产物。

## 公开更新说明

- 安装器默认选择 `C:\Mineradio`，允许在受支持的 C 盘安装。
- 仍可选择其它受支持的本地磁盘，保留专属目录与云盘检查。

## 下载入口

- GitHub Release：[下载 Mineradio 2.3.5](https://github.com/WhatTheLuck/Mineradio/releases/tag/v2.3.5)

<!-- mineradio-download-page: GitHub Release|https://github.com/WhatTheLuck/Mineradio/releases/tag/v2.3.5 -->

## 发布资产

GitHub Release 上传 `Mineradio-2.3.5-Setup.exe` 和 `docs/update/latest.yml`。版本说明仅包含 `version/releaseDate`，不得使用带安装包下载字段的构建工具清单。

安装包 SHA-256：`29a3910da40fceb861c1b93d285adcc2560455ca8be1e2a1be8e8ecf00de1490`。

## 发布前检查

- 运行完整回归检查与 Electron 启动检查。
- 构建并检查 `win-unpacked/resources/app` 内容，核对正式版本、资源完整性和源码一致性。
- 启动安装包并确认进程正常响应；能读取原生界面时，再检查欢迎页、默认路径和目录选择页，不点击安装。
- 确认仓库与安装包不包含 Cookie、Token、凭据、缓存或本机日志。
- 核对安装包 SHA-256、Release 正文和软件更新入口。
