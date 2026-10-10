# Simple AI Committer

A simple, practical way to generate Git commit messages from **staged changes** using an OpenAI-compatible LLM, then insert them directly into the VS Code Source Control input box.

[🛍️ Marketplace](https://marketplace.visualstudio.com/items?itemName=u7pi.simple-ai-committer) · [📚 Documentation](./docs/README.md) · [🐙 GitHub](https://github.com/u7pi/ai-commit-generator) · [🚀 快速说明](#快速说明)

## Features

- Generate Conventional Commits with the wand button in the Source Control title bar.
- Analyze only the changes you stage yourself. The extension never runs `git add` or commits for you.
- Skip the AI request when no changes are staged, with a hint explaining whether there are unstaged changes.
- Use English interface text and built-in prompts by default. With the Simplified Chinese (`zh-cn`) VS Code display language, use Chinese text and prompts.
- Customize `aiCommit.systemPrompt` to match your team's commit format and preferred output language.
- Connect to an OpenAI-compatible Chat Completions endpoint, including OpenAI, DeepSeek, Kimi, GLM, or local Ollama.
- Include file summaries for long diffs within a strict character budget, and cancel generation from its notification.
- Preserve drafts edited during generation and allow only one generation task per repository.
- Store a single API key securely in VS Code SecretStorage, with confirmed migration of legacy settings.
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

1. Configure your API base URL and model. Run **Simple AI Committer: Set API Key** if authentication is required.
2. Stage changes in Source Control using the `+` button or `git add`.
3. Click the wand button in the Source Control title bar, or run **Simple AI Committer: Generate Commit Message from Staged Changes** from the Command Palette.
4. Review and edit the generated message in the Source Control input box.
5. Commit when you are ready.

No staged changes means no AI request. If a Source Control repository is unavailable but generation succeeds, the message is copied to the clipboard.

Cancel from the generation notification. Repeated clicks for the same repository are skipped while generation is running. If you edit the commit draft during generation, your draft is preserved and the result is not inserted.

## Documentation

See the [documentation index](./docs/README.md) for all guides.

| Guide | Contents |
| --- | --- |
| [Configuration](./docs/configuration.md) | Settings, API URL selection, commit format, and output language |
| [Provider examples](./docs/providers.md) | OpenAI, DeepSeek, Kimi, GLM, Ollama, and compatible gateways |
| [Troubleshooting](./docs/troubleshooting.md) | Git setup, output language, and generation errors |
| [Development](./docs/development.md) | Local setup, tests, compilation, and debugging |
| [Packaging and publishing](./docs/publishing.md) | Version updates, VSIX verification, and Marketplace publishing |

## Changelog and license

See the [English changelog](./CHANGELOG.md) or [简体中文更新日志](./CHANGELOG.zh-CN.md).

Licensed under [MIT](./LICENSE).

## 快速说明

本扩展读取**已暂存**的 diff，使用兼容 OpenAI Chat Completions 的模型生成提交信息并填入源代码管理输入框。不会自动暂存或提交；没有已暂存更改时不调用 AI。

1. 在设置中搜索 `aiCommit`，配置 API 地址和模型；需要认证时运行“Simple AI Committer：设置 API Key”。
2. 手动暂存更改，点击源代码管理标题栏的魔杖按钮，或运行“Simple AI Committer：根据已暂存的更改生成提交信息”。
3. 审查生成的提交信息后再提交。

运行“Simple AI Committer：选择 API 地址（支持自定义输入）”可选择常用接口，也可输入完整的 `http(s)` URL。已有工作区地址时更新工作区，否则更新用户设置；模型与 API Key 需单独配置。

密钥保存在 VS Code SecretStorage 中，优先于旧版明文设置，切换 API 地址后仍使用同一密钥，且不跨机器同步。首次使用旧密钥时，可确认迁移并清除对应原设置，也可暂不迁移继续使用。运行“清除已存储的 API Key”仅删除安全存储中的值；已有旧设置仍会生效。

生成通知提供取消按钮。同一仓库重复点击会跳过，不同仓库可以并行；生成期间修改草稿会保留草稿，不写入生成结果。无暂存更改时也不会覆盖已有非空草稿。

VS Code 显示语言为简体中文（`zh-cn`）时，界面和内置提示词使用中文；其他语言统一使用英文。`aiCommit.systemPrompt` 留空时启用该行为，已有自定义提示词仍优先使用。如需固定生成语言，请修改自定义提示词；如需使用新的内置规则，请清空旧提示词。

`aiCommit.maxDiffChars` 默认 `6000`，长 diff 先加入文件及增删摘要（最多占三分之一预算），再截断正文；摘要和截断提示也计入上限。`temperature` 为 `-1` 或 `0–2`，默认 `0.3`，设为 `-1` 可省略该参数。`timeoutMs` 默认 `30000` 毫秒，是包含连接和接收响应的总时限；两个长度／时间设置必须为正整数。Git 不在 PATH 时设置 `gitPath` 的完整路径。本地 Ollama 无需认证时可不设置密钥；已有安全密钥需先清除，并清空旧设置。

详细说明见[文档索引](./docs/README.md)：[配置参考](./docs/configuration.md)、[服务商示例](./docs/providers.md)、[故障排查](./docs/troubleshooting.md)。历史变更见[简体中文更新日志](./CHANGELOG.zh-CN.md)。

## Attribution

Forked from [humaid24/ai-commit-generator](https://github.com/humaid24/ai-commit-generator) under the MIT license.
