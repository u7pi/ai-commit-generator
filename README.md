# AI Commit Generator

A VSCode extension that reads your staged diff and auto-generates a commit message using any OpenAI-compatible LLM — filling it directly into the Source Control input box.

使用任意兼容 OpenAI 的大模型，读取已暂存的 diff 并自动生成 Git 提交信息，直接填入源代码管理输入框。

🔗 **Marketplace:** https://marketplace.visualstudio.com/items?itemName=humaid-abuzinjal.ai-commit-generator-humaid
🐙 **GitHub:** https://github.com/humaid24/ai-commit-generator

---

## How It Works

Instead of manually exporting your diff and pasting it into an AI chat, this extension does it all in one click:

1. Reads the staged diff (`git diff --cached`) — stage your changes first
2. Sends it to your configured LLM with your custom prompt
3. Auto-fills the commit message box in the Source Control panel

You just review and hit **Commit** ✓

---

## Usage

1. Write your code
2. Stage your changes in the Source Control panel
3. Click the **✨ sparkle button** in the Source Control panel title bar
4. Review the generated commit message
5. Press **Commit** ✓

---

## Installation

**From the Marketplace:**

1. Open VSCode
2. Go to Extensions (`Ctrl + Shift + X`)
3. Search `AI Commit Generator`
4. Click **Install**

**From VSIX (manual):**

```bash
code --install-extension ai-commit-generator-*.vsix
```

---

## Setup

Open **Settings** (`Cmd/Ctrl + ,`) and search for `aiCommit`:

| Setting                 | Description                             | Example                            |
| ----------------------- | --------------------------------------- | ---------------------------------- |
| `aiCommit.apiBaseUrl`   | Base URL of your LLM API                | `https://api.deepseek.com/v1`      |
| `aiCommit.apiKey`       | Your API key                            | `sk-...`                           |
| `aiCommit.model`        | Model name                              | `deepseek-chat`                    |
| `aiCommit.systemPrompt` | Your commit message format instructions | (see default)                      |
| `aiCommit.maxDiffLines` | Truncate diffs longer than this         | `500`                              |
| `aiCommit.gitPath`      | Full path to git executable             | `C:\Program Files\Git\bin\git.exe` |

---

## Provider Examples

**DeepSeek**

```
apiBaseUrl: https://api.deepseek.com/v1
model: deepseek-chat
```

**Anthropic**

```
apiBaseUrl: https://api.anthropic.com/v1
model: claude-sonnet-4-6
```

**OpenAI**

```
apiBaseUrl: https://api.openai.com/v1
model: gpt-4o
```

**Local Ollama**

```
apiBaseUrl: http://localhost:11434/v1
model: llama3
apiKey: (leave blank)
```

---

## Troubleshooting

**`git is not recognized` error on Windows**

VSCode extensions run in a process that may not have Git in its PATH. Fix it by setting the full path to your git executable:

1. Open Settings (`Ctrl + ,`) → search `aiCommit.gitPath`
2. Set it to your git path, usually:
   - `C:\Program Files\Git\bin\git.exe`
   - or find it by running `where git` in Git Bash

---

## Development

```bash
git clone https://github.com/humaid24/ai-commit-generator
cd ai-commit-generator
npm install
npm run compile
# Press F5 in VSCode to launch the Extension Development Host
```

To package as a `.vsix`:

```bash
npx @vscode/vsce package
```

To publish:

```bash
npx @vscode/vsce publish --no-dependencies
```

---

## License

MIT
