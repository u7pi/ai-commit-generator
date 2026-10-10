# Troubleshooting

[Documentation](./README.md) · [Project overview](../README.md)

For settings and defaults, see [Configuration](./configuration.md#settings-reference).

## Git is not found on Windows

The VS Code extension process may not have Git in its `PATH`. Set `aiCommit.gitPath` to the full executable path, for example `C:\Program Files\Git\bin\git.exe`. Run `where.exe git` in PowerShell or Command Prompt to locate it.

## The commit message uses the wrong language

Leave `aiCommit.systemPrompt` empty to use the built-in display-language selection. If it has a saved value, edit its language instructions or clear it. Generated text is produced by the model and should always be reviewed.

See [Commit format and language](./configuration.md#commit-format-and-language) for the display-language rules and an example custom prompt.

## No message is generated

- Stage your changes first. Without a staged diff, the extension writes a hint only to an empty Source Control input and skips the API call.
- Check the base URL, model, and API key. Stored keys take priority over legacy settings; update the key when switching providers. Provider errors redact the key before display and logging.
- For models that reject a configurable temperature, set `aiCommit.temperature` to `-1`.
- If the request times out, check the endpoint or increase `aiCommit.timeoutMs`. This limits total request time, even if the server keeps sending data.
- If output is truncated or contains only reasoning, adjust the model or prompt and retry. Only final nonempty text is inserted.
- If your draft changed during generation, the result is skipped to preserve your edits. Repeated clicks for the same repository do not start another request.

Cancel through the generation notification. Cancellation preserves the draft and does not show an error.
