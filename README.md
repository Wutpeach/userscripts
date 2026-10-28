# Userscripts — 实用油猴脚本合集

收集和维护个人开发的 Tampermonkey 用户脚本。每个脚本独立安装、更新和测试，主要面向桌面 Chrome / Edge + Tampermonkey；具体兼容范围以各脚本说明为准。

## 脚本目录

| 脚本名称 | 功能简介 | 当前版本 | 安装入口 | 详细说明 |
| --- | --- | --- | --- | --- |
| 懂车帝 360° 图片助手 | 原生预设视角切换；当前图片复制；当前图片、四／八方向及完整 36 帧原始 WebP 导出 | 1.2.0 | [一键安装](https://raw.githubusercontent.com/Wutpeach/userscripts/main/scripts/dongchedi-360/dongchedi-360.user.js) | [使用说明](scripts/dongchedi-360/README.md) |

## 安装

1. 安装并启用 [Tampermonkey](https://www.tampermonkey.net/)。根据浏览器和扩展提示开启运行用户脚本所需的权限。
2. 点击上方「一键安装」，在 Tampermonkey 安装页面检查脚本信息并安装。
3. 刷新对应网站，按照该脚本说明使用。

如果浏览器将安装地址作为文本或文件打开，可下载 .user.js 后在 Tampermonkey 中从文件导入；也可以新建脚本，完整粘贴文件内容并保存。只保留一份启用的同名脚本。

## 更新

安装正式 GitHub 版本后，可通过 Tampermonkey「检查更新」获取 main 分支上的新版本。脚本使用固定的 GitHub Raw 安装及更新地址。

每个脚本独立维护版本号和更新地址，更新一个脚本不会更新其他脚本。原先从本地文件导入且没有更新地址的版本，需要先覆盖安装一次正式版本。

## 仓库结构与维护

~~~text
scripts/
  dongchedi-360/
    dongchedi-360.user.js
    README.md
    LICENSE
    ATTRIBUTIONS.md
    assets/
    tests/
    package.json
    package-lock.json
    TEST_REPORT.md
~~~

新增脚本的约定：

1. 放入 scripts/<slug>/，提供可独立安装的 .user.js 和使用说明。
2. 独立维护 @version、@updateURL、@downloadURL，更新地址指向该脚本的正式 Raw 文件。现有脚本保持 @name 和 @namespace 稳定。
3. 依赖、测试、素材、许可证保存在该脚本目录；按实际需要选择工具，不要求统一构建流程。
4. 同步更新本页脚本索引、版本和安装入口，不提前创建空目录。
5. 在脚本目录运行已有检查，审阅变更后提交，只将确认稳定的版本发布到 main。

维护懂车帝脚本时，在其目录执行 npm ci、npm run check 和 npm test；更新版本后同步 package.json、package-lock.json、本页索引及脚本说明。提交前检查 git status 与 git diff --cached，再推送 main。依赖目录、测试产物、本地配置和凭据不提交。

## 反馈与许可

问题与建议请提交到 [GitHub Issues](https://github.com/Wutpeach/userscripts/issues)，注明脚本名称、版本、浏览器及复现步骤。提交截图或日志前请移除账号、位置、Cookie 等个人信息。

各脚本的许可信息以其独立目录中的 LICENSE 为准，第三方组件另见对应 ATTRIBUTIONS.md。本仓库不对未来新增脚本统一指定许可证。当前懂车帝脚本采用 [MIT License](scripts/dongchedi-360/LICENSE)，Lucide 图标保留其 ISC 许可声明。
