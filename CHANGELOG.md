# Changelog

## Unreleased

- Bind the single stored API key atomically to a normalized request endpoint. Confirm legacy upgrades and destination changes, hide sensitive query values, and make dismissed dialogs cancel generation.
- Serialize key writes/clears, invalidate stale dialogs, remove matching plaintext copies across accessible scopes, and report preserved differing values or cleanup failures. Explicit plaintext authorization applies only to the same key/endpoint in the current window. Downgrading requires setting the key again.
- Support absolute Git paths containing spaces, cancel all Git reads, and enforce a fixed 30-second deadline. Recheck the full staged diff before requests and output; discard stale results and preserve edited drafts.
- End progress and release repository locks before authentication prompts, fall back safely when the Git API is unavailable, and limit success/error response bodies to 1 MiB of received bytes.
- Default the API URL to DeepSeek while retaining explicit settings. Keep no-stage notifications and use temporary SCM placeholders instead of modifying commit text; restore placeholders and listeners on staging, retry, close, and deactivation.
- Expand regression tests, including real simple-git process tests, and synchronize English/Chinese configuration and guides.

## 0.3.2

- Once the API key lives in SecretStorage, the `aiCommit.apiKey` settings field shows `*****` instead of being cleared, so the Settings UI always reflects that a key is stored. Keys saved through migration and through **Set API Key** both write the mask; **Clear Stored API Key** also removes it.
- Default `aiCommit.temperature` to `-1` (omit the parameter entirely): most current models (Claude, GPT-5.x, Kimi) reject a custom temperature with a 400 error, while omitting it is always accepted. Set `0–2` explicitly only for models that still honor it.
- A plaintext key in the `aiCommit.apiKey` settings field is always treated as the latest intent: when it differs from the stored key, secure storage is replaced automatically and the field shows `*****` again — no confirmation, so "Not now" can no longer leave generation failing on the old key with a 401. Only the first import into empty secure storage keeps the one-time prompt; declining there uses the settings key for that run without persisting it.
- Change the default `aiCommit.model` to `deepseek-flash` and refresh the documented model examples (`deepseek-flash`, `kimi-for-coding`, `gpt-6-luna`).

## 0.3.1

- Surface the `aiCommit.apiKey` setting again: a key entered there is imported into SecretStorage with confirmation and the plaintext field is cleared. A settings key that differs from the stored key can replace it through the same one-time prompt; an identical value is cleared silently.
- Show the built-in English system prompt as the Settings default for `aiCommit.systemPrompt`; the `zh-cn` display language still uses the Chinese prompt until the setting is customized.
- Turn API 401/403 failures into an actionable error offering **Set API Key** instead of surfacing the provider's raw response.
- Resolve the API key before the progress notification starts, so the secure-storage migration or update confirmation is never hidden behind the "Generating" spinner.

## 0.3.0

- Prevent duplicate generation per repository and preserve drafts edited during generation or present when no changes are staged.
- Provide cancellation through a notification, enforce a total API deadline, and release cancellation listeners and timers on completion.
- Preserve API URL query parameters, validate numeric settings, and reject reasoning-only, empty, or truncated responses.
- Add secure API key commands with confirmed legacy migration, safe failure handling, and redaction of keys in provider errors.
- Include file statistics for long diffs within a strict combined character budget.
- Commit the npm lockfile, pin VS Code 1.85 typings, and add Windows/Ubuntu CI using Node.js 22.

## 0.2.6

- Rename the extension to **Simple AI Committer**, with Marketplace ID `u7pi.simple-ai-committer`.
- Make the Marketplace description, base localization resources, README, and main changelog English, while retaining Simplified Chinese resources and a Chinese quick start.
- Select the built-in prompt by VS Code display language: Chinese for `zh-cn`, English otherwise. Custom prompts continue to take priority.
- Set the default `systemPrompt` to an empty string, correct character-based diff truncation documentation, and document all settings.
- Add tests for language fallback, custom prompts, and localization resource completeness.

## 0.2.5

- Add an API base URL picker with OpenAI, Kimi, DeepSeek, GLM, and Ollama presets, plus custom URL input.
- Retain direct URL entry in Settings. The picker updates workspace settings when a workspace URL exists, and user settings otherwise.

## 0.2.4

- Fix requests waiting indefinitely after an interrupted API response.
- Fix repository selection when multiple repository paths share a prefix.
- Preserve UTF-8 Chinese characters when responses split them across data chunks.
- Use the configured `aiCommit.gitPath` for diff and status operations.
- Allow an empty API key for endpoints that require no authentication, such as local Ollama.

## 0.2.3

- Fix HTTP 400 errors for models that only accept a fixed temperature, such as kimi-for-coding. Set `aiCommit.temperature` to `-1` to omit the parameter.

## 0.2.2

- Replace child_process Git operations with simple-git. Commands invoked from a repository's Source Control view use that repository in workspaces with multiple repositories.
- Add `maxDiffChars` for character-based diff truncation, `temperature`, and `timeoutMs`; remove `maxDiffLines`.
- Support cancellation in the generation progress UI, aborting the API request.
- Use a built-in Chinese Conventional Commits guide when no custom prompt is configured.
- Add logging and configuration caching with automatic invalidation on configuration changes.

## 0.2.1

- Analyze staged changes only and stop running `git add` automatically, leaving the commit scope under user control.
- Distinguish no changes from unstaged changes and prompt the user to stage changes when needed.
- Improve README details and feature descriptions with Chinese and English text, and align interface hints with actual behavior.
- Add CHANGELOG.md.

## 0.2.0

- Rename the extension to **AI Commit Generator** from AI Commit Message Generator by Humaid.
- Improve the default prompt with Conventional Commits formatting (`type(scope): subject` plus a bullet-point body), requesting the diff's primary language and defaulting to Chinese.
- Show a hint directly in the input box when no changes are staged, without calling AI or consuming tokens.
- Add Chinese command titles, setting descriptions, errors, and progress text, with Chinese as the default.
- Replace the icon with a white star on an indigo-purple gradient rounded square.
