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
- Verify the setup after configuring with **Simple AI Committer: Test API Connection**: it reports the responding model and latency, or maps 401/403, 404, 400, 429, timeouts, DNS, and refused connections to corrective guidance with actionable buttons.
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
code --install-extension simple-ai-committer-0.3.3.vsix
```

## Usage

1. Configure your API base URL and model. Enter the API key in Settings (`aiCommit.apiKey`) or run **Simple AI Committer: Set API Key** if authentication is required. Run **Simple AI Committer: Test API Connection** to verify the setup — errors explain what to fix and offer **Set API Key**, **Select API Base URL**, or **Open Settings**.
2. Stage changes in Source Control using the `+` button or `git add`.
3. Click the wand button in the Source Control title bar, or run **Simple AI Committer: Generate Commit Message from Staged Changes** from the Command Palette.
4. Review and edit the generated message in the Source Control input box.
5. Commit when you are ready.

No staged changes means no AI request. If a Source Control repository is unavailable but generation succeeds, the message is copied to the clipboard.

The defaults are `https://api.deepseek.com/v1` and `deepseek-flash`; explicit URL/model settings are retained. The stored key is bound to the actual request destination, including path and query parameters. Changing it or upgrading an old string-only key requires approval; dismissing the dialog sends nothing. Key prompts hide query values. Plaintext settings can be migrated and masked, or explicitly authorized for that key and endpoint in this window. Migration removes identical plaintext copies in accessible scopes and warns about differing copies or cleanup failures. After downgrading, set the key again. See [key storage](./docs/configuration.md#api-key-storage-and-migration).

After updating or reinstalling the same extension ID, a retained secure key restores `*****` in an empty settings field on startup, without a network check. The mask means a key is stored. A generation request returning HTTP 401 clears the rejected key and its masks; 403, network errors, and timeouts retain them. A late response cannot clear a replacement key or newer settings.

SCM commands always honor the explicit repository root. If the Git API cannot match it, Git runs at that root and the result goes to the clipboard; an invalid target never falls back to another repository.

Updated local windows of the same extension ID and profile coordinate credential changes with a short shared file lock. Requests use an immutable credential snapshot; dialogs and network waits never hold the lock. Acquisition stops after 5 seconds. A leftover `credentials.lock` must only be removed from the reported path after closing related windows; it is never stolen based on age. Older versions, remote hosts and external writers are outside this guarantee.

Uninstalling the extension keeps your settings and the stored key. To remove them first, run **Simple AI Committer: Clear All Settings and Stored Key** and confirm: it deletes all eight settings from user and current workspace scopes (possibly editing `.vscode/settings.json` or the workspace file) and the key from SecretStorage, restoring defaults; canceling changes nothing. It is refused while generation is running, key and URL commands pause during cleanup, and per-item failures are reported by scope and setting name so you can retry — the command is idempotent. See [uninstalling without leaving data](./docs/troubleshooting.md#uninstalling-without-leaving-data).

Cancel from the Git-reading or generation notification. Git commands have a fixed 30-second deadline; API requests use `timeoutMs` and reject successful response bodies over 1 MiB. HTTP failures stop at the response headers; provider error bodies are never displayed or logged, including error objects returned with HTTP 200. Repeated clicks for the same repository are skipped while generation is running. Edited drafts are preserved; changed staged content discards the result. Empty-stage warnings never alter commit text: the SCM button uses a temporary placeholder, while the Command Palette uses notification-only hints when no public placeholder is available.

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

1. 在设置中搜索 `aiCommit`，配置 API 地址和模型；需要认证时直接在设置中输入 API Key（`aiCommit.apiKey`），或运行“Simple AI Committer：设置 API Key”。配置后可运行“Simple AI Committer：测试 API 连接”验证设置是否正常，报错会给出对应修正引导（设置 Key／选择地址／打开设置）。
2. 手动暂存更改，点击源代码管理标题栏的魔杖按钮，或运行“Simple AI Committer：根据已暂存的更改生成提交信息”。
3. 审查生成的提交信息后再提交。

运行“Simple AI Committer：选择 API 地址（支持自定义输入）”可选择常用接口，也可输入完整的 `http(s)` URL。已有工作区地址时更新工作区，否则更新用户设置；模型与 API Key 需单独配置。设置界面中 API 地址、API Key、模型固定显示在前三位。

默认地址为 `https://api.deepseek.com/v1`，默认模型为 `deepseek-flash`；已有显式地址和模型配置保留。单个密钥与实际请求地址一起保存到 VS Code SecretStorage，且不跨机器同步。协议、主机、端口、路径或查询参数变化后，必须确认才能发送已有密钥；旧格式密钥首次使用也需确认绑定，无需重新输入。确认界面隐藏查询值，取消或关闭即终止生成。“设置 API Key”的密码输入框会显示当前目标地址。

更新或重新安装相同扩展 ID 后，启动时若检测到保留的安全密钥且设置栏为空，会恢复 *****，表示已有密钥，不会自动联网验证。实际生成请求返回 HTTP 401 时，清除本次被拒绝的密钥及掩码，让有效设置栏保持空；403、网络错误及超时保留密钥。迟到的 401 不会删除新密钥或覆盖新设置。其他配置层中的不同明文保留；必要时在当前有效层保留空值，避免旧的不同明文自动成为有效密钥。

无安全密钥时，设置中的明文 Key 可选择“迁移并掩码”或明确授权“本窗口使用明文，不迁移”；授权只对同一密钥和地址有效，取消不发送请求。迁移成功后有效设置层显示 *****，其他可访问用户／当前工作区层中相同的明文副本删除，不同值保留并提示检查。设置更新失败会保留安全记录并明确报告残留。同一已绑定地址下，新输入的明文 Key 可自动更新存储；地址变化仍需确认。等待输入期间不阻塞设置或清除命令，状态变化会使旧操作失效。“清除已存储的 API Key”同时移除安全记录和可访问设置层中的掩码；遗留明文需重新授权。降级到旧版本时需要重新设置密钥。

同一配置、相同扩展 ID 且已更新并 Reload 的本地窗口，通过短时共享文件锁协调密钥操作。请求固定凭据快照，确认和网络等待不持锁；最多等待 5 秒，超时不修改数据。残留 `credentials.lock` 需先关闭相关窗口，再按提示删除指定文件，不按时间抢占。不同版本、远程宿主或外部写入不属于此保证范围。

卸载扩展本身不会删除配置或安全密钥。卸载前运行“Simple AI Committer：清除所有配置和密钥”并确认：从当前用户与当前工作区的设置中删除全部 8 项配置（可能修改 `.vscode/settings.json` 或工作区文件），并删除 SecretStorage 中的密钥，恢复默认设置；取消或关闭确认框不修改任何数据。生成进行中会拒绝清理；清理期间其他密钥与地址命令暂停；单项失败按作用域和设置名列出（不含配置值），可重试，命令幂等。

Git 读取和生成通知均提供取消按钮。同一仓库重复点击会跳过，不同仓库可以并行；发送前和写入前都会比较完整暂存内容，变化时丢弃结果并提示重试；生成期间修改草稿会保留草稿。无暂存更改时保留警告通知，绝不修改提交文本；SCM 标题栏入口使用临时占位提示，暂存出现、再次生成、仓库关闭或扩展停用时恢复。命令面板无法取得公开输入框时仅显示通知。SCM 明确指定的仓库始终优先；内置 Git API 不可用或目标失配时仅使用该明确路径，成功后复制到剪贴板；路径无效则停止，不回退到另一仓库。命令面板未指定目标时才使用首个仓库或工作区路径。401/403 提示在进度结束并释放仓库锁后显示，可直接重试或设置密钥。

VS Code 显示语言为简体中文（`zh-cn`）时，界面和内置提示词使用中文；其他语言统一使用英文。`aiCommit.systemPrompt` 保持内置默认值（未修改）时启用该行为，自定义提示词仍优先使用。设置界面中显示的默认提示词为英文版；如需固定生成语言，请直接修改该提示词。

`aiCommit.maxDiffChars` 默认 `6000`，长 diff 先加入文件及增删摘要（最多占三分之一预算），再截断正文；摘要和截断提示也计入上限。`temperature` 为 `-1` 或 `0–2`，默认 `-1`（不发送该参数，Claude、GPT-5.x、Kimi 等固定温度模型必须省略，否则报 400）；仅在模型接受时设 `0–2`（如 `0.3` 更稳定）。`timeoutMs` 默认 `30000` 毫秒，仅控制 API 连接和响应接收的总时限；两个长度／时间设置必须为正整数。成功响应按接收字节限制为 1 MiB；非成功 HTTP 状态收到响应头后立即终止，不读取错误正文。HTTP 200 中的错误对象也只显示固定提示，通知和日志不含服务端原始错误详情。Git 命令另有固定 30 秒时限，持续输出不延长；`gitPath` 支持含空格的绝对路径，不要加引号或命令参数。本地 Ollama 无需认证时可不设置密钥；已有安全密钥需先清除，并清空旧设置。

详细说明见[文档索引](./docs/README.md)：[配置参考](./docs/configuration.md)、[服务商示例](./docs/providers.md)、[故障排查](./docs/troubleshooting.md)。历史变更见[简体中文更新日志](./CHANGELOG.zh-CN.md)。

## Attribution

Forked from [humaid24/ai-commit-generator](https://github.com/humaid24/ai-commit-generator) under the MIT license.

Shared state uses a random change identifier and credential digest to detect stale SecretStorage caches before writes or requests; it stores no plaintext key or endpoint. If storage was changed by an older version or external tool, synchronization can stop with an explicit error. After closing all related windows, remove only the reported lock and the adjacent `credentials.state` to reset coordination, then reopen and check the key.

中文：共享状态使用随机变更标识及记录摘要识别 SecretStorage 旧缓存，不保存明文密钥或地址。旧版本或外部程序绕过锁修改存储后，可能出现同步错误；先关闭相关窗口，再删除指定锁及相邻的 `credentials.state` 重置协调状态，重开并检查密钥。
