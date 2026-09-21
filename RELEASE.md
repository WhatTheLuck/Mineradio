# Mineradio 2.3.0 发布流程

## 发布边界

- 正式版本：`2.3.0`
- Git tag：`v2.3.0`
- Release 标题：`Mineradio 2.3.0`
- 安装包：`Mineradio-2.3.0-Setup.exe`
- 仅从当前可信源码完整构建，不复用旧安装包或旧 `dist/`。
- 正式 Release 不混入 Mineradio_Beat 产物。
- GitHub Release 只附带完整安装包和最小版本说明 `latest.yml`；不上传 blockmap、构建清单或内部测试产物。

## 公开更新说明

- 新增 Smart Favorites：支持合并收藏、AI 标签分析与按偏好自动播放。
- 新增 CyberRibbon、SpaceVenom 与 EmoMusic 视觉预设及实时参数控制。
- EmoMusic 支持人脸、视线和音乐能量驱动；无人脸时会停止情绪生成并清除过期状态。
- LLM/VLM 请求统一通过 Electron 主进程安全调用，凭据不会进入渲染器或源码。
- 优化视觉默认值、歌词排布以及磁流体和星空的音频响应。

## 下载入口

- GitHub Release：[下载 Mineradio 2.3.0](https://github.com/WhatTheLuck/Mineradio/releases/tag/v2.3.0)

<!-- mineradio-download-page: GitHub Release|https://github.com/WhatTheLuck/Mineradio/releases/tag/v2.3.0 -->

## 发布资产

GitHub Release 上传 `dist/Mineradio-2.3.0-Setup.exe` 和 `docs/update/latest.yml`。版本说明仅包含 `version/releaseDate`，不得使用带安装包下载字段的构建工具清单。

安装包 SHA-256：`05b22ad12e1ff381f127aa43738c4fbfc67cb017be024ba5a570d473a6453fe2`。

## 发布前检查

- 运行完整回归检查与 Electron 启动检查。
- 构建并检查 `win-unpacked/resources/app` 内容，核对正式版本、资源完整性和源码一致性。
- 启动安装包并确认进程正常响应；能读取原生界面时，再检查欢迎页、默认路径和目录选择页，不点击安装。
- 确认仓库与安装包不包含 Cookie、Token、凭据、缓存或本机日志。
- 核对安装包 SHA-256、Release 正文和软件更新入口。
