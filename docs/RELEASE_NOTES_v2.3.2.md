# Mineradio 2.3.2

- AI 播放改用安装包内的 MuQ-MuLan 离线模型，对当前歌单歌曲采样并缓存音频向量；不再调用 LLM 分析歌曲。
- 风格标签直接编码，场景标签自动扩充为“适合在开车时听的音乐”等描述；“必须”筛选候选，“偏好”参与排序。
- 播放栏展示下一首及更多首推荐歌曲。首次分析需等待模型加载和歌曲采样，之后复用本地缓存。
- 安装包约 1.66 GiB，包含离线推理程序和模型。MuQ 权重采用 CC BY-NC 4.0，商业使用或分发前需另行取得授权。

## 下载

- [GitHub Release 下载 Mineradio 2.3.2](https://github.com/WhatTheLuck/Mineradio/releases/tag/v2.3.2)

完整安装包：`Mineradio-2.3.2-Setup.exe`

SHA-256：`20330b09f0c27be2a834899551dc23b4b29796900d235c5e7086d2f79297bc34`。

<!-- mineradio-download-page: GitHub Release|https://github.com/WhatTheLuck/Mineradio/releases/tag/v2.3.2 -->
