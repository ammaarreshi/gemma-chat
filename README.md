<p align="center">
  <img src="gemma-extruded-app.png" alt="Gemma Chat" width="180" />
</p>

<h1 align="center">Gemma Chat - (For Windows)</h1>

<p align="center">
  <strong>Vibe code without the internet.</strong><br/>
  A local coding agent powered by Google's Gemma 3 — runs entirely on your PC via Ollama.<br/>
  No API keys. No cloud. No Wi-Fi required after the first model download.
</p>

<p align="center">
  Original macOS / MLX project by <a href="https://github.com/ammaarreshi/gemma-chat">@ammaar</a> ·
  Windows port by <a href="https://github.com/revdarkness/gemma-chat">@revdarkness</a> ·
  <code>v0.1.0-win.1</code>
</p>

---

<img width="960" height="593" alt="Gemma-Vibecoding" src="https://github.com/user-attachments/assets/b4149e63-48df-456e-8007-c607b7d46f37" />


## The Idea

What if you could vibe code from an airplane? Or a cabin with no cell signal? Or just... without sending your code to someone else's server?

**Gemma Chat** is an open-source Electron app that runs Google's Gemma 3 natively on your Windows PC through [Ollama](https://ollama.com). You describe what you want to build, and it writes the code — HTML, CSS, JavaScript, multi-file projects — with a live preview that updates as the model types. No internet connection needed after the initial model download.

This Windows fork swaps the original Apple MLX backend for Ollama, so the same fully offline, local-first vibe coding experience now runs on Windows 10 / 11 (and, by extension, Linux and Intel/AMD Macs that Ollama supports).

## How It Works

1. **Describe what you want to build** — "A retro calculator app" or "A landing page for a coffee shop"
2. **Watch it code** — Gemma writes files character-by-character with a live preview
3. **Iterate** — Ask for changes, it edits the files and the preview updates in real-time

Everything happens locally. The model runs inside the Ollama background service on `127.0.0.1:11434`, and Gemma Chat talks to it over HTTP. Your code, your prompts, your conversations — all on your machine.

## Features

- 🛠 **Build Mode** — Coding agent with a live preview canvas. Writes multi-file projects into a sandboxed workspace.
- 💬 **Chat Mode** — Conversational AI with tool use (web search, URL fetch, calculator, bash/PowerShell).
- 🔄 **Model Switching** — Hot-swap between Gemma 3 variants on the fly.
- 🎤 **Voice Input** — Local speech-to-text via in-browser Whisper.
- ✈️ **Works Offline** — After the one-time model download, everything runs without internet.
- 💾 **Zero Config** — Ollama handles model download and lifecycle; no Python venv to manage.

## Available Models

| Model | Ollama tag | Size | Best for |
|---|---|---|---|
| Gemma 3 1B | `gemma3:1b` | ~815 MB | Tiny — works even without a GPU |
| **Gemma 3 4B** | **`gemma3:4b`** | **~3.3 GB** | **Recommended** — text + vision, 8 GB+ RAM |
| Gemma 3 12B | `gemma3:12b` | ~8.1 GB | Stronger reasoning, 16 GB+ RAM |
| Gemma 3 27B | `gemma3:27b` | ~17 GB | Maximum quality, 32 GB+ RAM or GPU |

## Requirements

- **Windows 10 (build 1909+) or Windows 11**
- **Ollama for Windows** — install from [ollama.com/download/windows](https://ollama.com/download/windows). After install, open a new PowerShell window and verify with:
  ```powershell
  ollama --version
  ```
  The Ollama daemon runs as a background service on port `11434` and starts automatically with Windows.
- **Node.js 20 LTS or newer** — [nodejs.org](https://nodejs.org/)
- **~4 GB free disk** for the default Gemma 3 4B model (more for the larger variants)
- **GPU optional but strongly recommended** for the 12B / 27B models — any modern NVIDIA card with 8 GB+ VRAM, or a recent AMD GPU via ROCm on Windows preview builds

## Quick Start

```powershell
# 1. Install Ollama from https://ollama.com/download/windows and let it start
# 2. Clone and run
git clone https://github.com/revdarkness/gemma-chat.git
cd gemma-chat
git checkout windows
npm install
npm run dev
```

First launch will pull `gemma3:4b` from the Ollama registry (~3.3 GB). Subsequent launches are instant.

## Building the Installer

**Windows (.exe, NSIS):**

```powershell
npm run dist:win
```

Produces `dist/gemma-chat-<version>-setup.exe` (NSIS installer, x64). SmartScreen will warn on first launch because the installer isn't code-signed — that's expected for community builds. Click **More info** → **Run anyway**.

**Linux (.AppImage + .deb, x64 + arm64):**

```bash
npm run dist:linux           # x64 AppImage + x64/arm64 .deb (run on x64 Linux)
npm run dist:linux:arm64     # arm64 .deb only (for Raspberry Pi)
```

Produces:
- `dist/gemma-chat-<version>-x86_64.AppImage` — universal Linux binary, works on any modern distro
- `dist/gemma-chat_<version>_amd64.deb` — for Debian, Ubuntu, Mint, Pop!_OS
- `dist/gemma-chat_<version>_arm64.deb` — for **Raspberry Pi 5** (or any aarch64 Linux), Pi 4 64-bit OS

The `.deb` declares `libnotify4`, `libxtst6`, and `libnss3` as runtime deps. Ollama itself is **not** an apt dependency — install it separately from https://ollama.com/download/linux (the install script supports Pi).

**Raspberry Pi notes:** Use **`gemma3:1b`** (815 MB) or **`gemma4:cloud`** (Ollama Turbo, inference happens on Ollama's servers). The local **`gemma4`** 8B is technically runnable on a Pi 5 16 GB but slow (~1 tok/s on CPU). The app's HTTP client doesn't care whether the model is local or `:cloud` — it just talks to whatever Ollama your `OLLAMA_HOST` points at.

## Configuration

Both settings are read from environment variables at launch.

- **`OLLAMA_HOST`** — point Gemma Chat at a non-default Ollama instance (for example, `OLLAMA_HOST=192.168.1.50:11434` to use an Ollama server running on another box on your LAN). Defaults to `127.0.0.1:11434`.
- **`GEMMA_SHELL=bash`** — if you've installed Git Bash and want the bash tool to use it instead of PowerShell.

## Differences from the macOS Original

- MLX backend replaced with an Ollama HTTP client (`src/main/ollama.ts`)
- No more Python venv auto-install — Ollama handles model management
- `wsRunBash` defaults to PowerShell on Windows (`PowerShell -NoProfile -NonInteractive -Command`)
- Standard Windows window chrome (no hidden title bar / vibrancy)
- Windows `.ico` generated, NSIS installer target added

## Roadmap

- **v0.2** — Optional bundled llama.cpp backend so users don't need to install Ollama at all
- **Pre-built release artifacts** — GitHub Releases with signed Windows installer + Linux AppImage + arm64 .deb so non-developers don't have to clone and build
- **`OLLAMA_API_KEY` first-class support** — for `:cloud` models without env-var fiddling

## Tech Stack

| Layer | Tech |
|---|---|
| App Shell | Electron + Vite + React 19 + TypeScript + Tailwind |
| Model Runtime | Ollama (system service) |
| Speech-to-Text | transformers.js (Whisper, runs in-browser via WASM) |
| Workspace | Per-conversation sandboxed filesystem + local HTTP server |

## Architecture

```
src/
├── main/              Electron main process
│   ├── index.ts       Window + IPC + agent loop
│   ├── ollama.ts      Ollama HTTP client (chat streaming, model pull, status)
│   ├── workspace.ts   Per-conversation workspace + static file server
│   └── tools.ts       Tool definitions + system prompts + XML action parser
├── preload/           contextBridge API surface
├── renderer/src/
│   ├── components/
│   │   ├── Setup.tsx      First-run onboarding + download progress
│   │   ├── Chat.tsx       Main layout + model switcher
│   │   ├── Canvas.tsx     Preview / Code / Files tabs (Build mode)
│   │   ├── Message.tsx    Chat bubbles + tool cards + activity bar
│   │   ├── Composer.tsx   Input + mic button
│   │   └── Sidebar.tsx    Conversation list
│   └── lib/whisper.ts     Browser Whisper pipeline
└── shared/types.ts    IPC types + model registry
```

### Under the Hood

**Agent Loop** — In Build mode, each assistant turn streams tokens from the local Ollama HTTP API. XML `<action>` blocks are parsed from the stream, executed (file writes, shell commands, etc.), and results are fed back for the next turn. Up to 40 rounds per user message.

**Live Streaming** — As the model generates file content, partial writes are flushed to disk every ~450ms. The preview iframe reloads in real-time so you watch the page build itself.

**Tool Protocol** — Small models handle XML more reliably than JSON function calling, so tools are invoked via an XML-based format:

```xml
<action name="write_file">
<path>index.html</path>
<content>
<!doctype html>
...
</content>
</action>
```

## Credits

- Original macOS / MLX implementation by Ammaar Reshi: [github.com/ammaarreshi/gemma-chat](https://github.com/ammaarreshi/gemma-chat). Windows port by [@revdarkness](https://github.com/revdarkness).
- [Gemma](https://ai.google.dev/gemma) by Google DeepMind
- [Ollama](https://ollama.com) — local LLM runtime
- [transformers.js](https://github.com/huggingface/transformers.js) by Hugging Face

Created by [@ammaar](https://x.com/ammaar) and AI :)
Windows port maintained by [@revdarkness](https://github.com/revdarkness).

## License

MIT
