<p align="center">
  <img src="gemma-extruded-app.png" alt="Gemma Chat" width="180" />
</p>

<h1 align="center">Gemma Chat</h1>

<p align="center">
  <strong>无需联网的 Vibe Coding。</strong><br/>
  由 Google Gemma 4 驱动的本地编码代理——通过 Apple 的 MLX 框架完全在你的 Mac 上运行。<br/>
  无需 API 密钥。无需云服务。无需 Wi-Fi。
</p>

---

<img width="960" height="593" alt="Gemma4-Vibecoding" src="https://github.com/user-attachments/assets/b4149e63-48df-456e-8007-c607b7d46f37" />


## 核心理念

如果你能在飞机上 vibe code 呢？或者在没有手机信号的小木屋里？或者只是……不需要把你的代码发送到别人的服务器？

**Gemma Chat** 是一个开源的 Electron 应用，在 Apple Silicon 上原生运行 Gemma 4。你描述想要构建什么，它就编写代码——HTML、CSS、JavaScript、多文件项目——并随着模型输入实时更新预览。初始模型下载后无需网络连接。

这是一个使用小型开放模型实现**完全离线、本地优先 vibe coding** 的概念验证。模型约 3 GB。整个应用在你的笔记本电脑上运行。

## 工作原理

1. **描述你想要构建什么** —— "一个复古计算器应用"或"一个咖啡店的着陆页"
2. **观看它编码** —— Gemma 逐字符编写文件，并实时预览
3. **迭代** —— 请求更改，它编辑文件并实时更新预览

一切都在本地发生。模型通过 [MLX-LM](https://github.com/ml-explore/mlx-examples/tree/main/llms/mlx_lm) 运行，这是 Apple 用于在 Apple Silicon 上运行 LLM 的框架。你的代码、你的提示、你的对话——全部在你的机器上。

## 功能特性

- 🛠 **构建模式** —— 带有实时预览画布的编码代理。将多文件项目写入沙箱工作区。
- 💬 **聊天模式** —— 支持工具使用的对话式 AI（网页搜索、URL 抓取、计算器、bash）。
- 🔄 **模型切换** —— 在 4 个 Gemma 变体之间即时切换。
- 🎤 **语音输入** —— 通过浏览器内 Whisper 实现本地语音转文字。
- ✈️ **离线工作** —— 一次性模型下载后，一切无需网络即可运行。
- 💾 **零配置** —— 首次启动时自动配置 Python venv + MLX 运行时。

## 可用模型

| 模型 | 大小 | 最佳用途 |
|---|---|---|
| Gemma 4 E2B | ~1.5 GB | 快速问答、简单任务 |
| **Gemma 4 E4B** | **~3 GB** | **推荐。** 速度与能力平衡 |
| Gemma 4 27B MoE | ~8 GB | 更强推理能力（需要 16 GB+ 内存） |
| Gemma 4 31B | ~18 GB | 最高质量（需要 32 GB+ 内存） |

## 快速开始

**要求：** macOS on Apple Silicon、Python 3.10–3.13、Node 20+。

```bash
git clone https://github.com/ammaarreshi/gemma-chat-public.git
cd gemma-chat-public
npm install
npm run dev
```

首次启动会自动检测 Python → 创建 venv → 安装 MLX-LM → 下载模型（~3 GB）→ 准备好 vibe code。

> **提示：** 如果没有 Python，通过 Homebrew 安装：`brew install python@3.13`

### 构建可分发版本

```bash
npm run dist
```

在 `dist/` 中生成签名的 `.dmg` 文件。直接分享——接收者只需拖到 Applications 即可。

## 技术栈

| 层级 | 技术 |
|---|---|
| 应用外壳 | Electron + Vite + React 19 + TypeScript + Tailwind |
| 模型运行时 | MLX-LM（自动安装到本地 venv） |
| 语音转文字 | transformers.js（Whisper，通过 WASM 在浏览器中运行） |
| 工作区 | 每个对话独立的沙箱文件系统 + 本地 HTTP 服务器 |

## 架构

```
src/
├── main/              Electron 主进程
│   ├── index.ts       窗口 + IPC + 代理循环
│   ├── mlx.ts         MLX-LM venv 安装 / 服务器生命周期 / 聊天流
│   ├── workspace.ts   每个对话的工作区 + 静态文件服务器
│   └── tools.ts       工具定义 + 系统提示 + XML 动作解析器
├── preload/           contextBridge API 表面
├── renderer/src/
│   ├── components/
│   │   ├── Setup.tsx      首次运行引导 + 下载进度
│   │   ├── Chat.tsx       主布局 + 模型切换器
│   │   ├── Canvas.tsx     预览 / 代码 / 文件标签页（构建模式）
│   │   ├── Message.tsx    聊天气泡 + 工具卡片 + 活动栏
│   │   ├── Composer.tsx   输入 + 麦克风按钮
│   │   └── Sidebar.tsx    对话列表
│   └── lib/whisper.ts     浏览器 Whisper 管道
└── shared/types.ts    IPC 类型 + 模型注册表
```

### 内部机制

**代理循环** —— 在构建模式下，每个助手回合从本地 MLX 服务器流式传输 token。从流中解析 XML `<action>` 块，执行（文件写入、bash 命令等），并将结果反馈给下一个回合。每个用户消息最多 40 轮。

**实时流式传输** —— 当模型生成文件内容时，部分写入每 ~450ms 刷新到磁盘。预览 iframe 实时重新加载，让你看着页面自己构建。

**工具协议** —— 小模型处理 XML 比 JSON 函数调用更可靠，因此工具通过基于 XML 的格式调用：

```xml
<action name="write_file">
<path>index.html</path>
<content>
<!doctype html>
...
</content>
</action>
```

## 致谢

- [Gemma](https://ai.google.dev/gemma) by Google DeepMind
- [MLX](https://github.com/ml-explore/mlx) by Apple Machine Learning Research
- [transformers.js](https://github.com/huggingface/transformers.js) by Hugging Face

由 [@ammaar](https://x.com/ammaar) 和 AI 创建 :)

## 许可证

MIT
