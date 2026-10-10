# AI Commit Generator

使用任意兼容 OpenAI 的大模型，读取**已暂存**的代码差异（diff），自动生成 Git 提交信息并填入源代码管理输入框。

A VSCode extension that reads your staged diff and auto-generates a commit message using any OpenAI-compatible LLM — filling it directly into the Source Control input box.

🔗 **Marketplace:** https://marketplace.visualstudio.com/items?itemName=u7pi.ai-commit-generator
🐙 **GitHub:** https://github.com/u7pi/ai-commit-generator
🍴 Forked from [humaid24/ai-commit-generator](https://github.com/humaid24/ai-commit-generator)（MIT）

---

## ✨ 功能 / Features

- **一键生成**：点击源代码管理面板标题栏的 ✨ 按钮，自动生成符合 Conventional Commits 规范的提交信息
- **仅分析已暂存内容**：不会替你执行 `git add`，只基于你手动暂存的 diff 生成，提交范围完全可控
- **空状态智能提示**：没有已暂存更改时直接在输入框显示提示，**不调用 AI、不消耗 token**
- **默认中文**：界面提示跟随 VS Code 显示语言，生成内容语言跟随 diff（判断不了时默认中文）
- **可定制提示词**：默认输出 `<type>(<scope>): 摘要` + 分条正文格式，可在设置中改成团队规范
- **任意 OpenAI 兼容接口**：OpenAI、DeepSeek、Anthropic、Gemini、Ollama 本地模型等均可接入
- **diff 自动截断**：超长 diff 按行数截断，避免超出模型上下文限制

---

## 使用方法 / Usage

1. 编写代码，并在源代码管理面板中**暂存更改**（点击 `+` 或 `git add`）
2. 点击标题栏的 **✨ sparkle 按钮**
3. 审查自动填入的提交信息
4. 点击 **Commit ✓** 提交

---

## 安装 / Installation

**从应用市场（Marketplace）：**

1. 打开 VSCode，进入扩展面板（`Ctrl + Shift + X`）
2. 搜索 `AI Commit Generator`
3. 点击 **Install**

**手动安装 VSIX：**

```bash
code --install-extension ai-commit-generator-*.vsix
```

---

## 设置 / Settings

打开设置（`Ctrl + ,`）搜索 `aiCommit`：

| 设置项 Setting | 说明 Description | 示例 Example |
| ----------------------- | --------------------------------------- | ---------------------------------- |
| `aiCommit.apiBaseUrl`   | 兼容 OpenAI 的 API 接口地址             | `https://api.deepseek.com/v1`      |
| `aiCommit.apiKey`       | 所配置接口的 API Key                    | `sk-...`                           |
| `aiCommit.model`        | 模型名称                                | `deepseek-chat`                    |
| `aiCommit.systemPrompt` | 系统提示词，决定提交信息格式            | （见默认值）                       |
| `aiCommit.maxDiffLines` | diff 截断行数，防止超出 token 限制      | `500`                              |
| `aiCommit.gitPath`      | git 可执行文件路径（git 不在 PATH 时）  | `C:\Program Files\Git\bin\git.exe` |

---

## 接口配置示例 / Provider Examples

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

**本地 Ollama / Local Ollama**

```
apiBaseUrl: http://localhost:11434/v1
model: llama3
apiKey: (留空 / leave blank)
```

---

## 常见问题 / Troubleshooting

**Windows 上提示 `git is not recognized`**

VSCode 扩展进程可能没有继承系统的 PATH。将 `aiCommit.gitPath` 设置为 git 完整路径：

1. 打开设置（`Ctrl + ,`）→ 搜索 `aiCommit.gitPath`
2. 填入 git 路径，通常是 `C:\Program Files\Git\bin\git.exe`
   （也可在 Git Bash 中运行 `where git` 查看）

**生成的提交信息语言不符合预期**

生成语言默认跟随 diff 内容的主要语言（diff 全是英文则输出英文）。如需固定语言，修改 `aiCommit.systemPrompt`，例如加上"始终使用中文输出"。

**点击生成按钮没有反应？**

- 未暂存任何更改时，提示直接显示在输入框中，且不会调用 AI——请先暂存更改
- 需要认证的接口请配置 API Key；本地 Ollama 等无需认证的接口可留空，认证失败时会显示接口返回的错误

---

## 开发 / Development

```bash
git clone https://github.com/u7pi/ai-commit-generator
cd ai-commit-generator
npm install
npm run compile
# Press F5 in VSCode to launch the Extension Development Host
```

打包为 `.vsix`：

```bash
npx @vscode/vsce package
```

发布：

```bash
npx @vscode/vsce publish --no-dependencies
```

---

## 更新日志 / Changelog

详见 [CHANGELOG.md](./CHANGELOG.md)。

---

## 许可证 / License

MIT
