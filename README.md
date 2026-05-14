<p align="center">
  <img src="gemma-extruded-app.png" alt="Gemma Chat" width="180" />
</p>

<h1 align="center">Gemma Chat</h1>

<p align="center">
  <strong>Vibe code without the internet.</strong><br/>
  A local coding agent powered by Google's Gemma 4 — runs entirely on your Mac via Apple's MLX framework.<br/>
  No API keys. No cloud. No Wi-Fi required.
</p>

---

<img width="960" height="593" alt="Gemma4-Vibecoding" src="https://github.com/user-attachments/assets/b4149e63-48df-456e-8007-c607b7d46f37" />


## The Idea

<img width="960" height="593" alt="Gemma4-Vibecoding" src="https://github.com/user-attachments/assets/4c45a83c-7c87-4c70-a293-fe475b7e34fa" />


What if you could vibe code from an airplane? Or a cabin with no cell signal? Or just... without sending your code to someone else's server?

**Gemma Chat** is an open-source Electron app that runs Gemma 4 natively on Apple Silicon. You describe what you want to build, and it writes the code — HTML, CSS, JavaScript, multi-file projects — with a live preview that updates as the model types. No internet connection needed after the initial model download.

It's a proof-of-concept for **fully offline, local-first vibe coding** using a small open model. The model is ~3 GB. The whole thing runs on your laptop.

## How It Works

1. **Describe what you want to build** — "A retro calculator app" or "A landing page for a coffee shop"
2. **Watch it code** — Gemma writes files character-by-character with a live preview
3. **Iterate** — Ask for changes, it edits the files and the preview updates in real-time

Everything happens locally. The model runs via [MLX-LM](https://github.com/ml-explore/mlx-examples/tree/main/llms/mlx_lm), Apple's framework for running LLMs on Apple Silicon. Your code, your prompts, your conversations — all on your machine.

## Features

- 🛠 **Build Mode** — Coding agent with a live preview canvas. Writes multi-file projects into a sandboxed workspace.
- 💬 **Chat Mode** — Conversational AI with tool use (web search, URL fetch, calculator, bash).
- 🔄 **Model Switching** — Hot-swap between 4 Gemma variants on the fly.
- ⚡ **Speculative Decoding** — Optionally pair your model with a small assistant drafter for accelerated generation.
- 🎤 **Voice Input** — Local speech-to-text via in-browser Whisper.
- ✈️ **Works Offline** — After the one-time model download, everything runs without internet.
- 💾 **Zero Config** — Python venv + MLX runtime auto-provisions on first launch.

## Available Models

| Model | Size | Draft Model | Best For |
|---|---|---|---|
| Gemma 4 E2B | ~1.5 GB | ⚡ +1 GB | Fast Q&A, simple tasks |
| **Gemma 4 E4B** | **~3 GB** | **⚡ +1 GB** | **Recommended.** Speed + capability balance |
| Gemma 4 27B MoE | ~16 GB | ⚡ +1 GB | Stronger reasoning (needs 16 GB+ RAM) |
| Gemma 4 31B | ~18 GB | ⚡ +1 GB | Maximum quality (needs 32 GB+ RAM) |

All models support optional [speculative decoding](#speculative-decoding) using a small Gemma 4 assistant drafter (~0.5B params, +1 GB download).

## Getting Started

**Requirements:** macOS on Apple Silicon, Python 3.10–3.13, Node 20+.

```bash
git clone https://github.com/ammaarreshi/gemma-chat-public.git
cd gemma-chat-public
npm install
npm run dev
```

First launch will auto-detect Python (including pyenv installs) → create a venv → install MLX-LM → download the model (~3 GB) → ready to vibe code.

> **Tip:** Install Python with Homebrew (`brew install python@3.13`) or pyenv (`pyenv install 3.13.3 && pyenv global 3.13.3`).

### Building a Distributable

```bash
npm run dist
```

Produces a signed `.dmg` in `dist/`. Share it directly — recipients just drag to Applications.

## Tech Stack

| Layer | Tech |
|---|---|
| App Shell | Electron + Vite + React 19 + TypeScript + Tailwind |
| Model Runtime | MLX-LM (auto-installed into a local venv), speculative decoding via `--draft-model` |
| Speech-to-Text | transformers.js (Whisper, runs in-browser via WASM) |
| Workspace | Per-conversation sandboxed filesystem + local HTTP server |

## Speculative Decoding

Gemma Chat supports **speculative decoding** using Gemma 4's Multi-Token Prediction (MTP) assistant drafters. When enabled, a small 4-layer drafter model (~0.5B params) generates several candidate tokens per round, while the full target model verifies them in a single forward pass. Accepted tokens are kept; rejected ones are discarded.

**How to enable:** In the model picker (welcome screen or in-chat header), toggle the "Speculative decoding" option for any model that has a known compatible drafter.

**Performance notes:**
- Greedy (temperature 0) output is byte-identical to non-draft generation.
- Speedups are most noticeable with batch processing and larger targets (MoE, 31B).
- Single-user interactive chat on smaller models (E2B, E4B) may see smaller or neutral gains due to drafter overhead.
- The drafter is downloaded alongside the target model on first use (~1 GB additional).

## Architecture

```
src/
├── main/              Electron main process
│   ├── index.ts       Window + IPC + agent loop
│   ├── mlx.ts         MLX-LM venv install / server lifecycle / chat streaming
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
└── shared/types.ts    IPC types, model registry, ModelConfig + draft pairs
```

### Under the Hood

**Agent Loop** — In Build mode, each assistant turn streams tokens from the local MLX server. XML `<action>` blocks are parsed from the stream, executed (file writes, bash commands, etc.), and results are fed back for the next turn. Up to 40 rounds per user message.

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

- [Gemma](https://ai.google.dev/gemma) by Google DeepMind
- [MLX](https://github.com/ml-explore/mlx) by Apple Machine Learning Research
- [transformers.js](https://github.com/huggingface/transformers.js) by Hugging Face

Created by [@ammaar](https://x.com/ammaar) and AI :) 

## License

MIT
