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
- Preserve edited drafts, discard results for changed staged content, and allow only one generation task per repository.
- Store a single API key securely with its bound endpoint; confirm legacy upgrades and changes of destination.
- Generate for the selected repository when using its Source Control title-bar command in a workspace with multiple repositories.

## Installation

### Marketplace

1. Open the Extensions view in VS Code (`Ctrl+Shift+X` on Windows/Linux or `Cmd+Shift+X` on macOS).
2. Search for **Simple AI Committer** by **u7pi**.
3. Click **Install**.

### Local VSIX

Use **Extensions: Install from VSIX...** from the Command Palette, or run:

```bash
code --install-extension simple-ai-committer-0.3.2.vsix
```

## Usage

1. Configure your API base URL and model. Enter the API key in Settings (`aiCommit.apiKey`) or run **Simple AI Committer: Set API Key** if authentication is required.
2. Stage changes in Source Control using the `+` button or `git add`.
3. Click the wand button in the Source Control title bar, or run **Simple AI Committer: Generate Commit Message from Staged Changes** from the Command Palette.
4. Review and edit the generated message in the Source Control input box.
5. Commit when you are ready.

No staged changes means no AI request. If a Source Control repository is unavailable but generation succeeds, the message is copied to the clipboard.

The defaults are `https://api.deepseek.com/v1` and `deepseek-flash`; explicit URL/model settings are retained. The stored key is bound to the actual request destination, including path and query parameters. Changing it or upgrading an old string-only key requires approval; dismissing the dialog sends nothing. Key prompts hide query values. Plaintext settings can be migrated and masked, or explicitly authorized for that key and endpoint in this window. Migration removes identical plaintext copies in accessible scopes and warns about differing copies or cleanup failures. After downgrading, set the key again. See [key storage](./docs/configuration.md#api-key-storage-and-migration).

Cancel from the Git-reading or generation notification. Git commands have a fixed 30-second deadline; API requests use `timeoutMs` and reject response bodies over 1 MiB. Repeated clicks for the same repository are skipped while generation is running. Edited drafts are preserved; changed staged content discards the result. Empty-stage warnings never alter commit text: the SCM button uses a temporary placeholder, while the Command Palette uses notification-only hints when no public placeholder is available.

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

1. 在设置中搜索 `aiCommit`，配置 API 地址和模型；需要认证时直接在设置中输入 API Key（`aiCommit.apiKey`），或运行“Simple AI Committer：设置 API Key”。
2. 手动暂存更改，点击源代码管理标题栏的魔杖按钮，或运行“Simple AI Committer：根据已暂存的更改生成提交信息”。
3. 审查生成的提交信息后再提交。

运行“Simple AI Committer：选择 API 地址（支持自定义输入）”可选择常用接口，也可输入完整的 `http(s)` URL。已有工作区地址时更新工作区，否则更新用户设置；模型与 API Key 需单独配置。

默认地址为 `https://api.deepseek.com/v1`，默认模型为 `deepseek-flash`；已有显式地址和模型配置保留。单个密钥与实际请求地址一起保存到 VS Code SecretStorage，且不跨机器同步。协议、主机、端口、路径或查询参数变化后，必须确认才能发送已有密钥；旧格式密钥首次使用也需确认绑定，无需重新输入。确认界面隐藏查询值，取消或关闭即终止生成。“设置 API Key”的密码输入框会显示当前目标地址。

无安全密钥时，设置中的明文 Key 可选择“迁移并掩码”或明确授权“本窗口使用明文，不迁移”；授权只对同一密钥和地址有效，取消不发送请求。迁移成功后有效设置层显示 *****，其他可访问用户／当前工作区层中相同的明文副本删除，不同值保留并提示检查。设置更新失败会保留安全记录并明确报告残留。同一已绑定地址下，新输入的明文 Key 可自动更新存储；地址变化仍需确认。等待输入期间不阻塞设置或清除命令，状态变化会使旧操作失效。“清除已存储的 API Key”同时移除安全记录和可访问设置层中的掩码；遗留明文需重新授权。降级到旧版本时需要重新设置密钥。

Git 读取和生成通知均提供取消按钮。同一仓库重复点击会跳过，不同仓库可以并行；发送前和写入前都会比较完整暂存内容，变化时丢弃结果并提示重试；生成期间修改草稿会保留草稿。无暂存更改时保留警告通知，绝不修改提交文本；SCM 标题栏入口使用临时占位提示，暂存出现、再次生成、仓库关闭或扩展停用时恢复。命令面板无法取得公开输入框时仅显示通知。内置 Git API 不可用时使用工作区路径，成功后复制到剪贴板。401/403 提示在进度结束并释放仓库锁后显示，可直接重试或设置密钥。

VS Code 显示语言为简体中文（`zh-cn`）时，界面和内置提示词使用中文；其他语言统一使用英文。`aiCommit.systemPrompt` 保持内置默认值（未修改）时启用该行为，自定义提示词仍优先使用。设置界面中显示的默认提示词为英文版；如需固定生成语言，请直接修改该提示词。

`aiCommit.maxDiffChars` 默认 `6000`，长 diff 先加入文件及增删摘要（最多占三分之一预算），再截断正文；摘要和截断提示也计入上限。`temperature` 为 `-1` 或 `0–2`，默认 `-1`（不发送该参数，Claude、GPT-5.x、Kimi 等固定温度模型必须省略，否则报 400）；仅在模型接受时设 `0–2`（如 `0.3` 更稳定）。`timeoutMs` 默认 `30000` 毫秒，仅控制 API 连接和响应接收的总时限；两个长度／时间设置必须为正整数。成功和错误响应均按接收字节限制为 1 MiB。Git 命令另有固定 30 秒时限，持续输出不延长；`gitPath` 支持含空格的绝对路径，不要加引号或命令参数。本地 Ollama 无需认证时可不设置密钥；已有安全密钥需先清除，并清空旧设置。

详细说明见[文档索引](./docs/README.md)：[配置参考](./docs/configuration.md)、[服务商示例](./docs/providers.md)、[故障排查](./docs/troubleshooting.md)。历史变更见[简体中文更新日志](./CHANGELOG.zh-CN.md)。

## Attribution

Forked from [humaid24/ai-commit-generator](https://github.com/humaid24/ai-commit-generator) under the MIT license.
