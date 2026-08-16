# Agent Note: Windows 引导式安装程序

Status: implemented

[English](2026-08-16-guided-windows-installer.md) | 中文

## Problem

Windows Squirrel 安装程序自行选择安装位置，无法提供桌面用户熟悉的标准向导。其生成的快捷方式和应用的自定义波浪图标也不利于用户识别已安装的产品。

## Decision

Windows 发行版使用 electron-builder 的 NSIS 引导式构建目标。安装程序显示安装目录选择页，创建桌面和开始菜单快捷方式，并在安装完成后提供启动 DeepSeek Harness 的选项。macOS 打包继续使用 Electron Forge，因为其 DMG、ZIP、签名和公证流程具有不同的平台要求。

Windows 可执行文件、安装程序、卸载程序和快捷方式使用从官方 DeepSeek 鲸鱼矢量图生成的 ICO，并采用产品品牌蓝作为背景。图标生成器从同一个 SVG 源文件生成 16 至 256 像素的标准 Windows 尺寸。

桌面发行测试读取包 manifest（元数据清单）和 GitHub Actions 工作流，固定 Windows runner、上传的 EXE 路径、引导模式、目录选择、两类快捷方式、NSIS 命令和 Windows 图标路径。Windows job 验证构建的安装程序和内置的 `dsh-awiki` 版本，将 EXE 大小和 SHA-256 写入运行摘要，并将上传的 artifact（产物）保留 14 天。

## Alternatives considered

**保留 Squirrel。** 这样可以避免新增打包依赖，但 Squirrel 无法提供桌面流程所需的安装目录选择。

**使用一键式 NSIS。** 这种方案保留 NSIS 打包，但会移除本次变更所需的安装选项。

**使用 WiX MSI。** MSI 是受管 Windows 环境中熟悉的格式，但会引入更大的 Windows 专用工具链，且不能改善所需的引导式安装流程。

## Consequences

Windows 用户可以使用标准安装向导，并通过桌面和开始菜单中的固定入口启动应用。Windows 构建在依赖锁中增加 electron-builder 及其 NSIS 工具链。Windows 安装包仍未签名，因此在配置代码签名之前仍可能出现 SmartScreen 警告。
