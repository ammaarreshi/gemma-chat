<p align="center">
  <img src="src/renderer/src/assets/vibe-logo.png" alt="Vibe Chat" width="180" />
</p>

<h1 align="center">Vibe Chat</h1>

<p align="center">
  <strong>Vibe code locally or with your preferred AI provider.</strong><br/>
  Run Gemma 4 on-device via Apple's MLX framework, or use multi-provider mode through <code>@mariozechner/pi-ai</code>.<br/>
  Local mode stays offline. Provider mode keeps secrets in Electron main process.
</p>

---

<img width="960" height="593" alt="Vibe Chat screenshot" src="https://github.com/user-attachments/assets/b4149e63-48df-456e-8007-c607b7d46f37" />


## The Idea

What if you could vibe code from an airplane? Or use the same app with OpenAI, Anthropic, Gemini, Groq, OpenRouter, GitHub Copilot, OpenAI Codex, or your own OpenAI-compatible endpoint when you do want a provider-backed model?

**Vibe Chat** is an open-source Electron app that runs Gemma 4 natively on Apple Silicon, while also supporting a Pi AI provider mode powered by [`@mariozechner/pi-ai`](https://www.npmjs.com/package/@mariozechner/pi-ai). You describe what you want to build, and it writes the code — HTML, CSS, JavaScript, multi-file projects — with a live preview that updates as the model types.

Local MLX mode is still a proof-of-concept for **fully offline, local-first vibe coding** using a small open model. Pi AI mode is for users who want unified provider routing, streaming, model selection, and OAuth/API key auth without hand-written integrations for every provider.

## How It Works

1. **Describe what you want to build** — "A retro calculator app" or "A landing page for a coffee shop"
2. **Watch it code** — Vibe writes files character-by-character with a live preview
3. **Iterate** — Ask for changes, it edits the files and the preview updates in real-time

In Local MLX mode, everything happens locally. The model runs via [MLX-LM](https://github.com/ml-explore/mlx-examples/tree/main/llms/mlx_lm), Apple's framework for running LLMs on Apple Silicon. Your code, your prompts, your conversations — all on your machine.

In Pi AI mode, the Electron main process streams through `@mariozechner/pi-ai`. The renderer can choose providers and models, but it never reads back API keys, OAuth access tokens, OAuth refresh tokens, or the encrypted credential file.

## Features

- 🛠 **Build Mode** — Coding agent with a live preview canvas. Writes multi-file projects into a sandboxed workspace.
- 💬 **Chat Mode** — Conversational AI with tool use (web search, URL fetch, calculator, bash).
- 🔄 **Model Switching** — Hot-swap between 4 local model variants, or choose a Pi AI provider/model.
- 🌐 **Multi-Provider Mode** — OpenAI, Anthropic, Google/Gemini, Mistral, Groq, xAI, OpenRouter, Vercel AI Gateway, GitHub Copilot, OpenAI Codex, Bedrock, and OpenAI-compatible endpoints via `@mariozechner/pi-ai`.
- 🎤 **Voice Input** — Local speech-to-text via in-browser Whisper.
- ✈️ **Offline Local Mode** — After the one-time MLX model download, Local MLX mode runs without internet.
- 💾 **Zero Config** — Python venv + MLX runtime auto-provisions on first launch.

## Available Models

| Model | Size | Best For |
|---|---|---|
| Gemma 4 E2B | ~1.5 GB | Fast Q&A, simple tasks |
| **Gemma 4 E4B** | **~3 GB** | **Recommended.** Speed + capability balance |
| Gemma 4 27B MoE | ~8 GB | Stronger reasoning (needs 16 GB+ RAM) |
| Gemma 4 31B | ~18 GB | Maximum quality (needs 32 GB+ RAM) |

## Getting Started

**Requirements:** macOS on Apple Silicon, Python 3.10–3.13, Node 20+.

```bash
git clone https://github.com/ammaarreshi/vibe-chat-public.git
cd vibe-chat-public
npm install
npm run dev
```

First launch will auto-detect Python → create a venv → install MLX-LM → download the model (~3 GB) → ready to vibe code.

> **Tip:** Install Python via Homebrew if you don't have it: `brew install python@3.13`

You can also choose **Pi AI Provider** on the welcome screen. Pi AI mode does not require MLX, Python, or local model weights. It requires a valid provider/model and the right auth method.

## Multi-Provider Mode

Pi AI mode is powered by `@mariozechner/pi-ai`, which handles model catalog access, provider routing, streaming, environment key lookup, and supported OAuth token resolution in the Electron main process.

Example providers:

- OpenAI
- Anthropic
- Google / Gemini
- Google Vertex AI
- Mistral
- Groq
- xAI
- OpenRouter
- Vercel AI Gateway
- GitHub Copilot
- OpenAI Codex
- Amazon Bedrock
- Ollama, vLLM, LM Studio, and other OpenAI-compatible endpoints

Auth modes:

- **OpenAI API** uses an OpenAI API key and normal OpenAI API billing.
- **OpenAI Codex** is a separate `openai-codex` provider. It uses ChatGPT/Codex subscription OAuth, not OpenAI API key billing.
- **OpenRouter** uses an OpenRouter API key. OpenRouter OAuth PKCE can be added later as a separate flow that mints an OpenRouter API key.
- **Anthropic, GitHub Copilot, and OpenAI Codex OAuth** use the OAuth helpers exposed by `@mariozechner/pi-ai/oauth`.
- **Environment mode** reads supported provider env vars in Electron main process.
- **Custom OpenAI-compatible** endpoints support `baseUrl` plus compatibility settings for Ollama/vLLM/LM Studio-like servers.

Secrets are stored by the app under Electron `app.getPath('userData')`. When Electron `safeStorage` is available, credential file contents are encrypted with OS-backed storage. The renderer can submit an API key or start OAuth, but it cannot read stored keys, access tokens, refresh tokens, or the credential file. The app does not use the pi-ai CLI `auth.json` in the current directory.

### Building a Distributable

```bash
npm run dist
```

Produces a signed `.dmg` in `dist/`. Share it directly — recipients just drag to Applications.

## Tech Stack

| Layer | Tech |
|---|---|
| App Shell | Electron + Vite + React 19 + TypeScript + Tailwind |
| Model Runtime | MLX-LM for local mode; `@mariozechner/pi-ai` for provider mode |
| Speech-to-Text | transformers.js (Whisper, runs in-browser via WASM) |
| Workspace | Per-conversation sandboxed filesystem + local HTTP server |

## Architecture

```
src/
├── main/              Electron main process
│   ├── index.ts       Window + IPC + agent loop
│   ├── mlx.ts         MLX-LM venv install / server lifecycle / chat streaming
│   ├── providers/     Local MLX and Pi AI provider adapters
│   ├── auth/          Main-process credential storage + Pi AI auth helpers
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

**Agent Loop** — In Build mode, each assistant turn streams tokens from the selected runtime. XML `<action>` blocks are parsed from the stream, executed (file writes, bash commands, etc.), and results are fed back for the next turn. Up to 40 rounds per user message.

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

Pi AI mode intentionally keeps this XML protocol for now. It does not send pi-ai native tools or use `pi-agent-core` yet; internal tool results are converted into normal text context for provider compatibility.

## Troubleshooting

- **Invalid API key** — Clear credentials, paste the key again, and verify that the selected provider matches the key.
- **OAuth login failed** — Try signing in again. OAuth is currently supported for Anthropic, GitHub Copilot, and OpenAI Codex in the installed pi-ai version.
- **Token refresh failed** — Clear credentials and sign in again. Expired or revoked refresh tokens cannot be recovered.
- **Model not found** — Pick a catalog model or enter a custom model id manually.
- **Quota or rate limit** — Check the provider account, subscription, billing, and rate-limit dashboard.
- **Wrong `baseUrl`** — OpenAI-compatible endpoints should usually end in `/v1`.
- **Unsupported custom behavior** — Toggle compat flags such as no developer role, no reasoning effort, or `max_tokens` if using Ollama, vLLM, LM Studio, or a proxy.

## Credits

- [Gemma](https://ai.google.dev/gemma) by Google DeepMind
- [MLX](https://github.com/ml-explore/mlx) by Apple Machine Learning Research
- [transformers.js](https://github.com/huggingface/transformers.js) by Hugging Face

Created by [@ammaar](https://x.com/ammaar) and AI :) 

## License

MIT
