<h1 align="center">DeepRead 深度阅读</h1>

<p align="center"><strong>
本项目纯属娱乐，与 DeepSeek 官方无关，如有侵权联系删除，本项目完全开源，无任何商业收费</strong></p>

<p align="center">
<strong>This project is purely for entertainment and is not affiliated with DeepSeek. Contact us for removal in case of infringement. Fully open source, no commercial fees whatsoever</strong></p>

## 项目介绍

**简体中文 | [English](README-EN.md) **

DeepSeek 网页样式的电子书阅读器。上班时想要摸鱼读电子书？本软件 1:1 复刻 DeepSeek 网页，看似在和 AI 对话，实则在摸鱼读书。内置老板键，可以一键跳转到 DeepSeek 官网。

An e-book reader styled after the DeepSeek web page. Want to sneak in some reading at work? This software replicates the DeepSeek website 1:1 — it looks like you're chatting with an AI, while you're actually reading an e-book. A built-in boss key jumps straight to the DeepSeek official site with one click.

<img src="src\assets\image\screenshot-home.png" alt="home" style="zoom:50%;" />

纯本地离线运行的电子书阅读器，支持 Web 端、Windows 端；支持 EPUB / PDF / TXT 格式；创新对话式阅读，用聊天的方式读书，也支持传统阅读模式；支持 AI 功能和 Wiki 搜索功能。

代码 100% AI Coding，当然经过了人工的架构、修改、审查、测试、整理，保留了一些手工代码的风味，所以安全可靠，可以放心使用。

## 核心功能

- **对话模式**：以聊天方式读书，通过指令进行交互；可以接入 AI 问答或者 Wiki 搜索
- **阅读模式**：传统的翻页阅读，自动记忆阅读进度，支持目录跳转
- **我的书架**：导入的电子书会备份在软件内，支持 EPUB / PDF / TXT 格式
- **对话搜索**：支持全文检索历史对话，使用 SQLite 数据库存储历史对话
- **用户设置**：暗黑模式（Beta）、绑定老板键（默认 F3 键）、AI 接口配置（OpenAI 兼容格式）

## 开发交流

欢迎大家通过 Issue 反馈问题，通过 Pull Request 提交改进，<strong>如果喜欢的话麻烦点一个<font color=orange>Star</font>🌟。</strong>

**注意：PR 代码时，请附上说明信息和验证结果；可以提交 AI 代码，但是务必经过人工审查。**

QQ 交流群：1106973682

## 快速开始

要求 Node.js ≥ 22（`node:sqlite` 依赖）

```powershell
npm install        # 安装依赖
npm run dev:all    # 一键启动：后端 38617 + 前端 5173
```

浏览器打开 http://localhost:5173 即可使用

### 开发命令

| 命令 | 说明 |
| --- | --- |
| `npm run dev:all` | 一键启动开发版（后端 38617 + 前端 5173 同时启动） |
| `npm run dev` / `npm run server` | 单独启动前端 / 后端 |
| `npm run dev:desktop` | 以桌面端开发版运行 |
| `npm run build` | 仅构建前端到 `dist/` |
| `scripts\start-prod.bat` | 一键拉起生产端（需要先执行： `npm run build`） |

### 打包命令

| 命令 | 一键脚本 | 产物与说明 |
| --- | --- | --- |
| `npm run build:desktop` | `scripts\build-desktop.bat` | `DeepRead-Desktop-x.x.x.zip` — 桌面版，零依赖 |
| `npm run build:web` | `scripts\build-web.bat` | `DeepRead-Web-Full-x.x.x.zip` — Web 完整版，自带 Node 运行时，零依赖 |
| `npm run build:web-lite` | `scripts\build-web-lite.bat` | `DeepRead-Web-Lite-x.x.x.zip` — Web 精简版，需自备 Node.js ≥ 22，包体更小 |

## 目录结构

```
├─ data/            # 全部用户数据（书架、书籍、封面、用户设置、对话数据库）
├─ dist/            # Web 构建产物（后端直接托管）
├─ electron/        # 桌面版主进程（自动拉起后端 + 外部链接转系统浏览器）
├─ scripts/         # 一键脚本（开发 / 构建 / 打包）
├─ server/          # 本地后端（Express：书架 / 对话 / API + 静态托管）
└─ src/             # 前端（Vue 3 + Pinia + Vite）
```

## 技术栈

**前端（src/）**

- Vue 3（Composition API）+ Vite（构建与开发服务器）
- Pinia（状态管理）+ Vue Router（hash 路由）
- epubjs（EPUB 渲染）+ pdfjs-dist（PDF 渲染）

**后端（server/）**

- Node.js ≥ 22 + Express（本地服务与 REST API）
- node:sqlite（历史对话存储）
- jszip + @xmldom/xmldom（服务端 EPUB 解包）
- multer（书籍 / 封面上传） + pdf-to-img（PDF 封面提取）
- undici（AI / Wiki 请求的网络代理支持）

**桌面端（electron/）**

- Electron + electron-builder（打包为绿色版免安装 zip）

## 许可证

[MIT](LICENSE)

