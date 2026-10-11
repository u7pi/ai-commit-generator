# Configuration

[Documentation](./README.md) · [Project overview](../README.md)

Open VS Code Settings and search for `aiCommit`. For connection examples, see [Provider examples](./providers.md).

## Settings reference

| Setting | Description | Default |
| --- | --- | --- |
| `aiCommit.apiBaseUrl` | OpenAI-compatible API base URL, without `/chat/completions` | `https://api.deepseek.com/v1` |
| `aiCommit.apiKey` | Convenience input for the API key; on first use it is moved to SecretStorage and this field then shows `*****` (masked) | Empty |
| `aiCommit.model` | Model ID supported by your endpoint | `deepseek-flash` |
| `aiCommit.systemPrompt` | Custom system prompt; until edited, the built-in prompt is used (Chinese for the `zh-cn` display language, English otherwise). The Settings default shows the built-in English prompt | Built-in prompt |
| `aiCommit.maxDiffChars` | Positive integer budget for diff content, including summaries and truncation notices | `6000` |
| `aiCommit.temperature` | `0–2`, or `-1` to omit the parameter (default). Most current models (Claude, GPT-5.x, Kimi) reject a custom temperature with a 400 error | `-1` |
| `aiCommit.timeoutMs` | Total request deadline, including connection and response reception; integer `1–2147483647` milliseconds | `30000` |
| `aiCommit.gitPath` | Git executable name or full path | `git` |

## Select an API base URL

Enter the URL in Settings or run **Simple AI Committer: Select API Base URL (Custom Input Supported)** from the Command Palette. The picker offers OpenAI, Kimi, DeepSeek, GLM, and Ollama presets. You can also type a complete `http://` or `https://` URL and press Enter.

If the current workspace already has an API base URL configured, the picker updates the workspace setting. Otherwise it updates the user setting. Selecting a URL does not change the model or API key.

Base URLs may include query parameters. The extension appends `/chat/completions` to the path, preserves the query, and ignores URL fragments.

## API key storage and migration

Run **Simple AI Committer: Set API Key** to type the key in a password input box showing the current destination, or enter it in `aiCommit.apiKey`. Cancelled or blank input leaves the stored key unchanged. The extension keeps a single versioned record containing the key and its bound endpoint in VS Code SecretStorage; it is not synced across machines.

An existing key requires **Allow and bind to this endpoint** before sending it to a different destination. The destination identity uses the actual request's normalized protocol, host, port, path, and query parameters; fragments are ignored. Changing a path or query also requires confirmation. The confirmation hides query values and never shows the key. Dismissing it cancels generation without sending a request. Legacy string-only stored keys require this confirmation once to upgrade; no re-entry is needed.

When no secure key exists, the first use of plaintext offers **Migrate and mask** or **Use plaintext this window, without migrating**, showing the destination. The latter explicitly authorizes only that key and endpoint for the current window. Dismissing the dialog sends nothing. On an already bound endpoint, a new plaintext value replaces the stored key and is masked without another destination prompt. No staged changes means no key prompt.

Migration retains `*****` in the effective user or workspace scope and deletes identical plaintext copies from other accessible user/current-workspace scopes. Different plaintext values are preserved with a warning. Storage failures abort generation and leave the old data intact; settings-update failures retain the secure record and explicitly report possible plaintext residue. Pending dialogs do not block key commands; changes to credentials or destination invalidate old operations, and writes/clears are serialized.

**Simple AI Committer: Clear Stored API Key** deletes the secure record and removes all accessible user/current-workspace `*****` masks. Remaining plaintext requires explicit authorization again. To send no Authorization header, also empty the effective settings key. Older extension versions cannot read the new record: after downgrading, set the key again.

The default endpoint is now DeepSeek, matching the default model `deepseek-flash`. Explicitly configured URLs and models are retained. Users with an old stored key and no explicit URL must approve binding to the new default before it is used.

## Long diffs and generation behavior

Diffs within `maxDiffChars` are sent unchanged. Longer diffs include staged file names with insertion/deletion counts; binary files are marked `binary`. The summary uses at most one third of the budget and reports omitted files if it cannot fit the full list. Remaining space holds the start of the diff and a truncation notice. All three parts count toward the limit, measured as JavaScript string characters. Extremely small budgets fall back to direct truncation.

Only one generation runs per repository; other repositories can run concurrently. Cancel through the Git-reading or API-generation notification. Each Git command has a fixed 30-second deadline that continuous output cannot extend; `timeoutMs` controls only the API request. Absolute Git executable paths containing spaces are supported without a shell.

The full staged diff is compared again before sending and before writing the input or clipboard. If it changed, the result is discarded and you are asked to retry. Drafts edited during generation are preserved. API success and error bodies are limited to 1 MiB of received bytes. Empty final text, reasoning-only responses, and output stopped by a length limit are rejected. Authentication errors appear after progress ends and the repository lock is released, so retrying is possible while the error prompt remains open.

Without staged changes, a warning remains visible and commit text is never modified. The SCM title-bar command temporarily changes the public input placeholder to distinguish unstaged changes from no changes. It restores the original placeholder when staged content appears, on retry, repository close, or extension deactivation. The Command Palette uses notification-only hints when the public input object is unavailable. If the built-in Git API is missing, disabled, or fails to initialize, generation uses the workspace folder and copies successful output to the clipboard.

## Commit format and language

The built-in prompt requests Conventional Commits:

```text
<type>(<scope>): <subject>

<body, when needed>
```

The subject and body are requested in English for all display languages except `zh-cn`, which requests Simplified Chinese. The output language follows the VS Code display language, regardless of the language in the diff. The type and scope remain in English.

A customized `aiCommit.systemPrompt` — any value other than the unchanged built-in default — replaces the built-in prompt without modification. For example, use the following prompt to request English with any display language:

```text
Generate a Conventional Commit message from the diff. Always write the subject and body in English. Output only the commit message.
```

An explicitly saved prompt from an older version is retained. Reset the setting to its default value in the Settings UI to return to the built-in language selection; the displayed English default counts as unset.
