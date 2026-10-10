# Configuration

[Documentation](./README.md) · [Project overview](../README.md)

Open VS Code Settings and search for `aiCommit`. For connection examples, see [Provider examples](./providers.md).

## Settings reference

| Setting | Description | Default |
| --- | --- | --- |
| `aiCommit.apiBaseUrl` | OpenAI-compatible API base URL, without `/chat/completions` | `https://api.openai.com/v1` |
| `aiCommit.apiKey` | Convenience input for the API key; on first use it is moved to SecretStorage and this field then shows `*****` (masked) | Empty |
| `aiCommit.model` | Model ID supported by your endpoint | `gpt-4o` |
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

Enter the key in the `aiCommit.apiKey` setting or run **Simple AI Committer: Set API Key** to type it in a password input box. Cancelled or blank command input leaves the stored key unchanged. The extension keeps a single key in VS Code SecretStorage; it is shared across workspaces and API base URLs and is not synced across machines. Configure it separately on each machine and update it when switching providers.

The first generation that needs a plaintext settings key offers **Migrate and mask** or **Not now**, once per window per value. Migration saves the key, then replaces its original user or workspace setting with the `*****` mask. A storage failure leaves the original setting intact; a masking failure reports that the settings field could not be updated. Other settings scopes are not removed. No staged changes means no migration prompt.

A plaintext key in the settings field always represents your latest input: whenever it differs from the stored key, secure storage is replaced automatically and the field shows `*****` again, with an information message instead of a prompt. When nothing is stored yet, the first plaintext key still asks for a one-time **Migrate and mask** confirmation; declining uses the settings key for that run without storing it. A settings key identical to the stored key is masked without prompting.

**Simple AI Committer: Clear Stored API Key** deletes the SecretStorage value and removes the `*****` mask from the settings field; a plaintext settings key, if present, becomes effective again. To send no Authorization header, clear the stored key and ensure the effective settings key is empty.

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

A customized `aiCommit.systemPrompt` — any value other than the unchanged built-in default — replaces the built-in prompt without modification. For example, use the following prompt to request English with any display language:

```text
Generate a Conventional Commit message from the diff. Always write the subject and body in English. Output only the commit message.
```

An explicitly saved prompt from an older version is retained. Reset the setting to its default value in the Settings UI to return to the built-in language selection; the displayed English default counts as unset.
