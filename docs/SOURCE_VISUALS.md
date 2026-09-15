# 原项目视觉与参数保存

赛博丝带使用 WhatTheLuck/CyberRibbon 的原始 Three.js r134 场景、关节丝带、地形、星辰、镜头运动和后处理。来源提交：`44a74aec55a53aa5b2a2180359ecab14584da0b7`，初始预设 `4.json`。

磁流体使用 WhatTheLuck/SpaceVenom 的原始 WebGL 2 raymarch 着色器、Starfield、参数映射与 16 个磁流体预设。来源提交：`49bda2bf5779125977b47aad8225610072e61ae0`，初始磁流体 `Venom`，星空 `Star`。预设包括 Blood、Bubble、Water、Venom 多色版及随机变色版。

源码保存在 `public/vendor/source-visuals`。两套引擎在同源 iframe 中隔离运行，保留原始 Three.js/着色器版本，不依赖 CDN。原项目独立页面的录音、文件选择和预设 HTTP 服务由 Mineradio 音频桥和桌面 IPC 替换。丝带保留 30 Hz / 64×2 频谱输入；磁流体使用原始 RMS、分频加权和独立星空低频采样。分析器的 FFT 和平滑与 Mineradio 主视觉解耦。退出视觉时销毁 iframe，停止其动画循环。

控制台 → 动效 → 赛博丝带与星际磁流体：两栏分别提供原始预设、参数编辑、保存和加载。点击栏标题可预览对应效果。桌面宽屏并排，窄窗口改为纵向排列。

参数保存路径为软件目录下 `visual-presets/cyber/*.json` 与 `visual-presets/space/*.json`；开发模式软件目录为项目根目录，打包模式为 EXE 所在目录。每次保存创建新文件，启动时分别加载各自最新修改的文件。没有已保存文件时使用原始初始预设。文件夹不可写时界面显示实际错误，不静默换目录。

更新原项目副本：`node scripts/integrate-source-visuals.cjs <CyberRibbon目录> <SpaceVenom目录>`。该脚本生成独立页面和完整参数目录，桥接文件单独维护。原文件作者声明保留在副本中。

原代码含随机初值与时间动画；“相同效果”指使用同一算法、着色器、镜头、参数和音频映射，并不意味着两个不同时刻的随机画面逐像素相同。
