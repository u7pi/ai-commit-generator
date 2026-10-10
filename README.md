# Simple AI Committer

A simple, practical way to generate Git commit messages from **staged changes** using an OpenAI-compatible LLM, then insert them directly into the VS Code Source Control input box.

[Marketplace](https://marketplace.visualstudio.com/items?itemName=u7pi.simple-ai-committer) · [GitHub](https://github.com/u7pi/ai-commit-generator) · [简体中文快速说明](#简体中文快速说明)

Forked from [humaid24/ai-commit-generator](https://github.com/humaid24/ai-commit-generator) under the MIT license.

## Features

- Generate Conventional Commits with the wand button in the Source Control title bar.
- Analyze only the changes you stage yourself. The extension never runs `git add` or commits for you.
- Skip the AI request when no changes are staged, with a hint explaining whether there are unstaged changes.
- Use English interface text and built-in prompts by default. With the Simplified Chinese (`zh-cn`) VS Code display language, use Chinese text and prompts.
- Customize `aiCommit.systemPrompt` to match your team's commit format and preferred output language.
- Connect to an OpenAI-compatible Chat Completions endpoint, including OpenAI, DeepSeek, Kimi, GLM, or local Ollama.
- Limit the diff by character count and cancel generation to abort the API request.
- Generate for the selected repository when using its Source Control title-bar command in a workspace with multiple repositories.

## Installation

### Marketplace

1. Open the Extensions view in VS Code (`Ctrl+Shift+X` on Windows/Linux or `Cmd+Shift+X` on macOS).
2. Search for **Simple AI Committer** by **u7pi**.
3. Click **Install**.

### Local VSIX

Use **Extensions: Install from VSIX...** from the Command Palette, or run:

```bash
code --install-extension simple-ai-committer-0.2.6.vsix
```

## Usage

1. Configure your API base URL, model, and API key if required by your provider.
2. Stage changes in Source Control using the `+` button or `git add`.
3. Click the wand button in the Source Control title bar, or run **Simple AI Committer: Generate Commit Message from Staged Changes** from the Command Palette.
4. Review and edit the generated message in the Source Control input box.
5. Commit when you are ready.

No staged changes means no AI request. If a Source Control repository is unavailable but generation succeeds, the message is copied to the clipboard.

## Settings

Open Settings and search for `aiCommit`.

| Setting | Description | Default |
| --- | --- | --- |
| `aiCommit.apiBaseUrl` | OpenAI-compatible API base URL, without `/chat/completions` | `https://api.openai.com/v1` |
| `aiCommit.apiKey` | API key for the endpoint; leave empty if authentication is not required | Empty |
| `aiCommit.model` | Model ID supported by your endpoint | `gpt-4o` |
| `aiCommit.systemPrompt` | Custom system prompt; leave empty to use the built-in language-specific prompt | Empty |
| `aiCommit.maxDiffChars` | Maximum diff characters sent to the API; excess is truncated | `6000` |
| `aiCommit.temperature` | Sampling temperature; set to `-1` to omit it for models that require a fixed temperature | `0.3` |
| `aiCommit.timeoutMs` | API request timeout in milliseconds | `30000` |
| `aiCommit.gitPath` | Git executable name or full path | `git` |

### Select an API base URL

Enter the URL in Settings or run **Simple AI Committer: Select API Base URL (Custom Input Supported)** from the Command Palette. The picker offers OpenAI, Kimi, DeepSeek, GLM, and Ollama presets. You can also type a complete `http://` or `https://` URL and press Enter.

If the current workspace already has an API base URL configured, the picker updates the workspace setting. Otherwise it updates the user setting. Selecting a URL does not change the model or API key.

### Commit format and language

The built-in prompt requests Conventional Commits:

```text
<type>(<scope>): <subject>

<body, when needed>
```

The subject and body are requested in English for all display languages except `zh-cn`, which requests Simplified Chinese. The output language follows the VS Code display language, regardless of the language in the diff. The type and scope remain in English.

A non-empty `aiCommit.systemPrompt` replaces the built-in prompt without modification. For example, use `Generate a Conventional Commit message from the diff. Always write the subject and body in English. Output only the commit message.` to request English with any display language.

An explicitly saved prompt from an older version is retained. Clear it to use the new built-in language selection.

## Provider examples

Use an endpoint that supports the OpenAI-compatible `/chat/completions` request format. Set the model and API key separately; model availability depends on your provider.

### OpenAI

```json
{
  "aiCommit.apiBaseUrl": "https://api.openai.com/v1",
  "aiCommit.model": "gpt-4o"
}
```

### DeepSeek

```json
{
  "aiCommit.apiBaseUrl": "https://api.deepseek.com/v1",
  "aiCommit.model": "deepseek-chat"
}
```

### Kimi and GLM

The API picker includes `https://api.moonshot.cn/v1` for Kimi and `https://open.bigmodel.cn/api/paas/v4` for GLM. Select a model supported by your account and configure its API key.

### Local Ollama

```json
{
  "aiCommit.apiBaseUrl": "http://localhost:11434/v1",
  "aiCommit.model": "llama3",
  "aiCommit.apiKey": ""
}
```

Start Ollama and ensure the selected model is installed. An API key can be left empty for a local endpoint that does not require authentication.

### Claude, Gemini, and other models

Use an OpenAI-compatible gateway or endpoint offered by your provider. The extension does not implement Anthropic's native Messages API or Google's native Gemini API. Enter the compatible base URL and the model ID accepted by that endpoint.

## Troubleshooting

### Git is not found on Windows

The VS Code extension process may not have Git in its `PATH`. Set `aiCommit.gitPath` to the full executable path, for example `C:\Program Files\Git\bin\git.exe`. Run `where.exe git` in PowerShell or Command Prompt to locate it.

### The commit message uses the wrong language

Leave `aiCommit.systemPrompt` empty to use the built-in display-language selection. If it has a saved value, edit its language instructions or clear it. Generated text is produced by the model and should always be reviewed.

### No message is generated

- Stage your changes first. Without a staged diff, the extension writes a hint to the Source Control input and skips the API call.
- Check the base URL, model, and API key. Authentication and provider errors are shown as returned by the API.
- For models that reject a configurable temperature, set `aiCommit.temperature` to `-1`.
- If the request times out, check the endpoint or increase `aiCommit.timeoutMs`.

## Development

```bash
git clone https://github.com/u7pi/ai-commit-generator
cd ai-commit-generator
npm install
npm test
npm run compile
```

Press `F5` in VS Code to launch the Extension Development Host. For locale checks, use **Configure Display Language**, restart the host, and verify English and `zh-cn` separately.

## Packaging and publishing

Before packaging, synchronize the version in `package.json` and `package-lock.json`, update both changelogs, and run:

```bash
npm test
npm run compile
git diff --check
npx @vscode/vsce package
```

Install the resulting VSIX to check the commands, Settings descriptions, and generation workflow. The package must include `out/extension.js`, runtime dependencies, English base resources, `package.nls.zh-cn.json`, README, and both changelogs. Source files, test scripts, and source maps are excluded.

After verifying the package, publish with the configured publisher account:

```bash
npx @vscode/vsce publish
```

Runtime dependencies are required; do not omit them when packaging or publishing.

## Changelog and license

See the [English changelog](./CHANGELOG.md) or [简体中文更新日志](./CHANGELOG.zh-CN.md).

Licensed under [MIT](./LICENSE).

## 简体中文快速说明

本扩展读取**已暂存**的 diff，使用兼容 OpenAI Chat Completions 的模型生成提交信息并填入源代码管理输入框。不会自动暂存或提交；没有已暂存更改时不调用 AI。

1. 在设置中搜索 `aiCommit`，配置 API 地址、模型和所需的 API Key。
2. 手动暂存更改，点击源代码管理标题栏的魔杖按钮，或运行“Simple AI Committer：根据已暂存的更改生成提交信息”。
3. 审查生成的提交信息后再提交。

运行“Simple AI Committer：选择 API 地址（支持自定义输入）”可选择常用接口，也可输入完整的 `http(s)` URL。已有工作区地址时更新工作区，否则更新用户设置；模型与 API Key 需单独配置。

VS Code 显示语言为简体中文（`zh-cn`）时，界面和内置提示词使用中文；其他语言统一使用英文。`aiCommit.systemPrompt` 留空时启用该行为，已有自定义提示词仍优先使用。如需固定生成语言，请修改自定义提示词；如需使用新的内置规则，请清空旧提示词。

`aiCommit.maxDiffChars` 默认 `6000`，按字符截断 diff；`temperature` 默认 `0.3`，设为 `-1` 可省略该参数；`timeoutMs` 默认 `30000` 毫秒。Git 不在 PATH 时设置 `gitPath` 的完整路径。无需认证的本地 Ollama 可将 API Key 留空。

更多配置与排查步骤见上方英文文档，历史变更见[简体中文更新日志](./CHANGELOG.zh-CN.md)。
