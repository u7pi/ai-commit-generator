# Configuration

[Documentation](./README.md) · [Project overview](../README.md)

Open VS Code Settings and search for `aiCommit`. For connection examples, see [Provider examples](./providers.md).

## Settings reference

| Setting | Description | Default |
| --- | --- | --- |
| `aiCommit.apiBaseUrl` | OpenAI-compatible API base URL, without `/chat/completions` | `https://api.openai.com/v1` |
| `aiCommit.apiKey` | Deprecated plaintext fallback, used only when SecretStorage has no key | Empty |
| `aiCommit.model` | Model ID supported by your endpoint | `gpt-4o` |
| `aiCommit.systemPrompt` | Custom system prompt; leave empty to use the built-in language-specific prompt | Empty |
| `aiCommit.maxDiffChars` | Positive integer budget for diff content, including summaries and truncation notices | `6000` |
| `aiCommit.temperature` | `0–2`, or `-1` to omit it for models that require a fixed temperature | `0.3` |
| `aiCommit.timeoutMs` | Total request deadline, including connection and response reception; integer `1–2147483647` milliseconds | `30000` |
| `aiCommit.gitPath` | Git executable name or full path | `git` |

## Select an API base URL

Enter the URL in Settings or run **Simple AI Committer: Select API Base URL (Custom Input Supported)** from the Command Palette. The picker offers OpenAI, Kimi, DeepSeek, GLM, and Ollama presets. You can also type a complete `http://` or `https://` URL and press Enter.

If the current workspace already has an API base URL configured, the picker updates the workspace setting. Otherwise it updates the user setting. Selecting a URL does not change the model or API key.

Base URLs may include query parameters. The extension appends `/chat/completions` to the path, preserves the query, and ignores URL fragments.

## API key storage and migration

Run **Simple AI Committer: Set API Key** to enter a key in a password input box. Cancelled or blank input leaves the stored key unchanged. The extension stores a single key in VS Code SecretStorage; it is shared across workspaces and API base URLs and is not synced across machines. Configure it separately on each machine and update it when switching providers.

A stored key takes priority over `aiCommit.apiKey`. If no stored key exists, the effective legacy setting remains supported. The first generation that needs a legacy key offers **Migrate and clear** or **Not now**, once per window. Migration saves the key before clearing its original user or workspace setting. A storage failure leaves the original setting intact; a clearing failure reports that the plaintext setting remains. Other settings scopes are not removed. No staged changes means no migration prompt.

**Simple AI Committer: Clear Stored API Key** deletes only the SecretStorage value. Legacy settings, if present, become effective again. To send no Authorization header, clear the stored key and ensure the effective legacy key is empty.

## Long diffs and generation behavior

Diffs within `maxDiffChars` are sent unchanged. Longer diffs include staged file names with insertion/deletion counts; binary files are marked `binary`. The summary uses at most one third of the budget and reports omitted files if it cannot fit the full list. Remaining space holds the start of the diff and a truncation notice. All three parts count toward the limit, measured as JavaScript string characters. Extremely small budgets fall back to direct truncation.

Only one generation runs per repository; other repositories can run concurrently. Cancel through the generation notification. Drafts edited during generation are preserved, and no-stage hints only fill an empty input. Empty final text, reasoning-only responses, and output stopped by a length limit are rejected.

## Commit format and language

The built-in prompt requests Conventional Commits:

```text
<type>(<scope>): <subject>

<body, when needed>
```

The subject and body are requested in English for all display languages except `zh-cn`, which requests Simplified Chinese. The output language follows the VS Code display language, regardless of the language in the diff. The type and scope remain in English.

A non-empty `aiCommit.systemPrompt` replaces the built-in prompt without modification. For example, use the following prompt to request English with any display language:

```text
Generate a Conventional Commit message from the diff. Always write the subject and body in English. Output only the commit message.
```

An explicitly saved prompt from an older version is retained. Clear it to use the new built-in language selection.
