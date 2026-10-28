# 懂车帝 360° 图片助手

**版本 1.1.5** · [一键安装](https://raw.githubusercontent.com/Wutpeach/userscripts/main/scripts/dongchedi-360/dongchedi-360.user.js) · [反馈问题](https://github.com/Wutpeach/userscripts/issues) · [测试报告](TEST_REPORT.md)

在懂车帝外观 360° 视口的原生「全屏」右侧添加「视角 ▾」「下载 ▾」。支持八个预设方向，以及当前图片、四／八方向和完整 36 帧序列下载。直接控制原生旋转状态，不使用独立预览层；下载保留原始 WebP 数据。

## 运行环境与安装

- 桌面 Chrome / Edge + Tampermonkey。自动化测试使用 Edge；其他环境以实际使用验证为准。
- 登录懂车帝，进入具有完整 36 帧外观视口的车辆详情页。
- 无需后端、构建步骤或 Node.js；日常使用只需安装 .user.js 文件。

先安装 [Tampermonkey](https://www.tampermonkey.net/)，再点击上方「一键安装」并确认安装信息。如果浏览器没有唤起安装界面，可下载 [完整脚本](dongchedi-360.user.js)，在 Tampermonkey 管理面板从文件导入，或新建脚本后完整粘贴并保存。

更新时覆盖同一脚本，只保留一份启用的副本并刷新车辆页。正式版配置了 GitHub Raw 更新地址，可在 Tampermonkey 中「检查更新」。从无更新地址的旧本地版本迁移时，先覆盖安装一次正式版；原有 @name、@namespace 保持不变。

浏览器如提示，按 Tampermonkey 引导开启「允许运行用户脚本」等必要开关。脚本使用 GM_xmlhttpRequest 访问 dcarimg.com 及其子域名；扩展询问跨域访问时允许对应 CDN 即可。

## 使用方法

### 视角

- 将鼠标移入原生 360° 视口，等待完整序列及工具栏加载，两个按钮会出现在原生「全屏」右侧。
- 悬浮约 150ms 展开面板；点击一级按钮固定展开，再次点击关闭。点击外部或按 Esc 关闭；两个面板互斥。
- 视角面板只显示九宫格。点击外围方向切换对应帧，中间图标为装饰，当前匹配方向轻微高亮。
- 用户开始拖拽、移入视口或按键时中断自动切换，由原生交互接管。切换过程中暂时禁用「下载当前视角」。

默认方向对应以下原始帧，序号从 1 开始：

| 前左45°：1 | 正前方：5 | 前右45°：9 |
| --- | --- | --- |
| 正左侧：32 | 车辆图标 | 正右侧：14 |
| 后左45°：27 | 正后方：23 | 后右45°：19 |

四个标准方向最初由用户在奥迪 A6L 上验证，用户随后反馈其他车型也可使用。开发环境的独立真站验证使用 Jeep 页面，具体范围见测试报告。方向映射集中于 VIEW_PRESETS；其他车型如果存在起点偏移，需要另行校准。斜向使用接近 45° 的原始帧，不生成插值图片。

### 下载

| 选项 | 导出内容 | 图片命名 |
| --- | --- | --- |
| 当前视角 | 原生视口当前显示的 WebP | 匹配预设时如「懂车帝车辆_正后方.webp」；其他帧如「懂车帝车辆_002.webp」 |
| 四个标准视角 | 5、14、23、32，ZIP | 正前方.webp、正右侧.webp、正后方.webp、正左侧.webp |
| 八个预设视角 | 5、9、14、19、23、27、32、1，ZIP | 正前方.webp、前右45°.webp 等 |
| 完整 360° 序列 | DOM 顺序的全部 36 帧，ZIP | 001.webp 至 036.webp |

当前视角的方向名称由实际显示帧判断，通过原生鼠标拖拽到预设帧也适用。非预设帧不推测角度。车型及颜色字段尚未可靠适配，外层文件统一使用「懂车帝车辆」前缀。

- 不截图、不使用 Canvas、不转码，不更改图片尺寸后缀、画质或原文件 Alpha 数据。
- 最多 4 个并发；失败额外重试最多 2 次；单次请求超时 25 秒，并有扩展不回调时的独立超时保护。
- 验证 HTTP 状态、CDN、RIFF / WEBP 签名及声明长度。ZIP 使用内置 STORE 写入器，保留输入顺序、CRC32 和 UTF-8 文件名。
- 显示获取／打包进度，可取消；同一时间一个任务，任意图片失败都不保存残缺 ZIP。
- 任务固定开始时的 URL 快照，检测到视口、图片集合或路由变化时取消，避免向旧任务加入新数据。
- 成功时仅使用浏览器下载提示，不重复显示脚本成功通知。请在浏览器下载列表检查最终文件，浏览器仍可能显示保存提示或拦截自动下载。

图片和 ZIP 均在本地浏览器处理，不上传第三方打包服务。

## 界面展示

~~~text
全屏 | 视角 ▾ | 下载 ▾
~~~

视角为八方向九宫格，下载面板提供上述四项操作。目前没有收录适合公开发布的页面截图；assets/ 只保存维护所需的 Lucide 官方图标源文件，不包含下载的车辆图片或整套序列。

## 已知限制

1. 仅接受同一父容器恰好 36 个直接帧节点，类名前缀为 series-360-image_frame-wrapper，图片必须是互不相同的 dcarimg.com CDN WebP，当前显示帧唯一。缺帧、多个同时可见候选或找不到原生工具栏时隐藏 UI；真站可能在鼠标进入视口后才补齐帧。
2. 适配任务提供的外观帧结构，不支持内饰全景。若站点更改类名前缀、包装层级或拖拽逻辑，需要更新适配。原生模拟事件无响应或推进步长改变时明确报错，不伪造 opacity 切换，也不进入插件预览；同一序列失败后刷新可重新检测。
3. MutationObserver 合并结构和 URL 变化，不做高频全页面轮询。新序列等待约 320ms 稳定；仅凭 DOM 稳定不能排除间隔更长的分批车色替换。彻底消除该风险需要可靠的站点颜色／加载状态信号。
4. 面板随原生 Fullscreen API 移入全屏元素。本地标准全屏测试已覆盖，真站特殊全屏、iframe、封闭 Shadow DOM 及特殊 transform 场景未全面验证。
5. 真站颜色、配置、外观／内饰、站内路由和工具栏重绘尚未逐项全面验收；不要把本地模拟测试当作这些场景的真站结果。
6. ZIP32 总量上限约 4 GiB，浏览器内存可能更早成为限制；超限时可改为四／八方向下载。浏览器保存成功与否以其下载列表为准。

## 开发与测试

本目录是脚本的唯一维护位置。安装文件为完整单文件，修改后即可导入 Tampermonkey，无需构建。

从仓库根目录执行：

~~~sh
cd scripts/dongchedi-360
npm ci
npm run check
npm test
~~~

开发测试需要 Node.js 22 或更新版本及桌面 Edge。测试默认使用 Windows 的常规 Edge 安装位置；如果路径不同，通过 DCD360_BROWSER 指定浏览器可执行文件。JSZip 3.10.1 和 playwright-core 1.58.2 为固定版本的开发依赖，前者只用作独立 ZIP 读取器，后者驱动测试浏览器；它们都不会进入用户脚本。

模块包括 SiteAdapter、FrameManager、NativeDragController、ViewController、StoreZip、DownloadManager、ToolbarUI 和 Application。官方图标保存在 assets/lucide/；更改图标后运行 node tests/sync-icons.cjs 重新嵌入。

### 可选的真站验证

tests/verify-installed-native.cjs 和 tests/verify-installed-downloads.cjs 仅连接已运行的独立调试浏览器，不安装扩展或脚本，也不是 npm test 的前提。

先手动安装当前版本、登录并打开车辆页，再运行：

~~~sh
node tests/verify-installed-native.cjs --probe
node tests/verify-installed-downloads.cjs
~~~

连接地址通过 DCD360_CDP 配置，默认使用本机调试端口；不要将浏览器调试端口暴露到公共网络。测试会使用带 #dcd360-verification 标记的独立页面，结束后不关闭原有浏览器或用户标签；下载测试恢复默认下载行为。

新生成的验证记录和文件写入 test-results/，不会提交。tests/evidence/ 中保留少量已去除查询参数的历史 JSON 验证摘要，供 [TEST_REPORT.md](TEST_REPORT.md) 引用，不包含图片二进制。

## 许可证与第三方声明

本脚本采用 [MIT License](LICENSE)。界面使用 [Lucide 0.468.0](https://lucide.dev/) 官方 SVG，遵守其 ISC 许可证，完整声明保留在 assets/lucide/LICENSE 和安装脚本中。

脚本没有运行时外部库依赖；开发依赖及其许可证见 [ATTRIBUTIONS.md](ATTRIBUTIONS.md) 与 package-lock.json。第三方网站上的车辆图片不属于本项目的开源代码许可范围，使用下载内容时请遵守相应权利与网站规则。
