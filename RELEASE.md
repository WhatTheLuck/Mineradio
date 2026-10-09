# Mineradio 2.3.6 发布流程

## 发布边界

- 正式版本：`2.3.6`
- Git tag：`v2.3.6`
- Release 标题：`Mineradio 2.3.6`
- 安装包：`Mineradio-2.3.6-Setup.exe`
- 仅从当前可信源码完整构建，不复用旧安装包或旧 `dist/`。
- 正式 Release 不混入 Mineradio_Beat 产物。
- GitHub Release 只附带完整安装包和最小版本说明 `latest.yml`；不上传 blockmap、构建清单或内部测试产物。

## 公开更新说明

- 新增歌曲基因分析：180 种固定音乐风格，展示前 10 个相似标签、歌曲信息与动态基因标志；复用 MuQ 编码缓存。
- MuQ 编码状态以进度条、已处理数量和百分比显示，保留暂停/继续并单独报告失败数。
- AI 推荐榜首标注“下一首播放”，推荐列表的横向滚动条仅在滚动时显示。
- 星际磁流体内置初始参数更新为 2026-10-09 15:20 保存的最新 JSON，包含磁流体、音频和星空参数；用户保存参数仍优先加载。

## 下载入口

- GitHub Release：[下载 Mineradio 2.3.6](https://github.com/WhatTheLuck/Mineradio/releases/tag/v2.3.6)

<!-- mineradio-download-page: GitHub Release|https://github.com/WhatTheLuck/Mineradio/releases/tag/v2.3.6 -->

## 发布资产

GitHub Release 上传 `Mineradio-2.3.6-Setup.exe` 和 `docs/update/latest.yml`。版本说明仅包含 `version/releaseDate`，不得使用带安装包下载字段的构建工具清单。

安装包 SHA-256：`1d42d59f675a290bbefe9879349a2c9923ac420455791af5c46887e20a3d52b6`。

## 发布前检查

- 运行完整回归检查与 Electron 启动检查。
- 构建并检查 `win-unpacked/resources/app` 内容，核对正式版本、资源完整性和源码一致性。
- 启动安装包并确认进程正常响应；能读取原生界面时，再检查欢迎页、默认路径和目录选择页，不点击安装。
- 确认仓库与安装包不包含 Cookie、Token、凭据、缓存或本机日志。
- 核对安装包 SHA-256、Release 正文和软件更新入口。
