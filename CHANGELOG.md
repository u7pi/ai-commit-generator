# Changelog

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
