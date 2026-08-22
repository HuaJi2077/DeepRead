<h1 align="center">DeepRead</h1>

<p align="center"><strong>
	This project is purely for entertainment and is not affiliated with DeepSeek. Contact us for removal in case of infringement. Fully open source, no commercial fees whatsoever.</strong>
</p>



## Introduction

[简体中文](README.md) | English

An e-book reader styled after the DeepSeek web page. Want to sneak in some reading at work? This software replicates the DeepSeek website 1:1 — it looks like you're chatting with an AI, while you're actually reading an e-book. A built-in boss key jumps straight to the DeepSeek official site with one click.

<img src="src\assets\image\screenshot-home.png" alt="home" style="zoom:50%;" />

A fully local, offline e-book reader: runs on the Web and on Windows; supports EPUB / PDF / TXT; features an innovative conversational reading mode — read books by chatting with them — plus a traditional reading mode; supports AI Q&A and Wiki search.

The code is 100% AI-coded — though architected, modified, reviewed, tested, and tidied by humans, retaining a touch of handcrafted flavor — so it is safe, reliable, and ready to use.

## Core Features

- **Chat Mode**: read books through conversation, interact via commands; optionally connect AI Q&A or Wiki search
- **Reading Mode**: traditional page-turning reading with automatic progress memory and TOC jumping
- **My Shelf**: imported e-books are backed up inside the app; supports EPUB / PDF / TXT
- **Conversation Search**: full-text search over chat history, stored in an SQLite database
- **User Settings**: dark mode (Beta), customizable boss key (default F3), AI API configuration (OpenAI-compatible), and more

## Development & Feedback

Feel free to report issues or submit improvements via Pull Request. **If you like this project, please give us a🌟.**

**Note: when submitting a PR, please include a description and verification results; AI-generated code is welcome, but it must be human-reviewed.**

QQ Group: 1106973682

BiliBili Video：https://www.bilibili.com/video/BV1fr8m6yEv3/?share_source=copy_web&vd_source=ee721aed908ac0ee05413780937947c9

## Getting Started

Requires Node.js ≥ 22 (`node:sqlite` dependency)

```powershell
npm install        # Install dependencies
npm run dev:all    # One-click start: backend 38617 + frontend 5173
```

Open http://localhost:5173 in your browser

### Development Commands

| Command | Description |
| --- | --- |
| `npm run dev:all` | One-click dev start (backend 38617 + frontend 5173 together) |
| `npm run dev` / `npm run server` | Start frontend / backend separately |
| `npm run dev:desktop` | Run the desktop dev version |
| `npm run build` | Build the frontend only into `dist/` |
| `scripts\start-prod.bat` | One-click launch of the production server (run `npm run build` first) |

### Packaging Commands

| Command | One-click script | Output & Notes |
| --- | --- | --- |
| `npm run build:desktop` | `scripts\build-desktop.bat` | `DeepRead-Desktop-x.x.x.zip` — Desktop, zero dependencies |
| `npm run build:web` | `scripts\build-web.bat` | `DeepRead-Web-Full-x.x.x.zip` — Full Web, bundles its own Node runtime, zero dependencies |
| `npm run build:web-lite` | `scripts\build-web-lite.bat` | `DeepRead-Web-Lite-x.x.x.zip` — Lite Web, requires Node.js ≥ 22, smaller size |

## Directory Structure

```
├─ data/            # All user data (shelf, books, covers, user settings, chat database)
├─ dist/            # Web build output (served directly by the backend)
├─ electron/        # Desktop main process (auto-starts backend + opens external links in system browser)
├─ scripts/         # One-click scripts (dev / build / package)
├─ server/          # Local backend (Express: shelf / chat / API + static hosting)
└─ src/             # Frontend (Vue 3 + Pinia + Vite)
```

## Tech Stack

**Frontend (src/)**

- Vue 3 (Composition API) + Vite (build & dev server)
- Pinia (state management) + Vue Router (hash routing)
- epubjs (EPUB rendering) + pdfjs-dist (PDF rendering)

**Backend (server/)**

- Node.js ≥ 22 + Express (local server & REST API)
- node:sqlite (chat history storage)
- jszip + @xmldom/xmldom (server-side EPUB unpacking)
- multer (book / cover upload) + pdf-to-img (PDF cover extraction)
- undici (proxy support for AI / Wiki requests)

**Desktop (electron/)**

- Electron + electron-builder (packaged as a portable, installation-free zip)

## License

[MIT](LICENSE)
