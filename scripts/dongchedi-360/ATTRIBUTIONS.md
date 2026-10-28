# 第三方来源

界面使用 [Lucide](https://lucide.dev/) 官方图标，固定版本 **0.468.0**：

- [compass](https://github.com/lucide-icons/lucide/blob/0.468.0/icons/compass.svg)：视角按钮。
- [download](https://github.com/lucide-icons/lucide/blob/0.468.0/icons/download.svg)：下载按钮。
- [copy](https://github.com/lucide-icons/lucide/blob/0.468.0/icons/copy.svg)：复制按钮。
- [car-front](https://github.com/lucide-icons/lucide/blob/0.468.0/icons/car-front.svg)：九宫格中心装饰。
- [chevron-down](https://github.com/lucide-icons/lucide/blob/0.468.0/icons/chevron-down.svg)：下拉标记。

官方 SVG 保存在 assets/lucide/，仅提取原始形状并嵌入用户脚本；线宽由界面统一设置。没有重新绘制图标，也不需要运行时访问图标服务。

Lucide 的 ISC 许可证保存在 [assets/lucide/LICENSE](assets/lucide/LICENSE)，完整文本也嵌入 .user.js。

[JSZip 3.10.1](https://github.com/Stuk/jszip/tree/v3.10.1)（MIT 或 GPLv3 双许可）仅作为开发测试依赖，独立解析及校验内置写入器生成的 ZIP，不随用户脚本加载。完整依赖及许可随 npm 安装包提供。
