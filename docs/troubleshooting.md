# Troubleshooting

[Documentation](./README.md) · [Project overview](../README.md)

For settings and defaults, see [Configuration](./configuration.md#settings-reference).

## Git is not found on Windows

The VS Code extension process may not have Git in its `PATH`. Set `aiCommit.gitPath` to the full executable path, for example `C:\Program Files\Git\bin\git.exe`. Spaces in absolute paths are supported; enter the path without surrounding quotes or shell arguments. Run `where.exe git` in PowerShell or Command Prompt to locate it. Each Git command has a fixed 30-second deadline; changing `aiCommit.timeoutMs` does not extend it.

## The commit message uses the wrong language

Leave `aiCommit.systemPrompt` empty to use the built-in display-language selection. If it has a saved value, edit its language instructions or clear it. Generated text is produced by the model and should always be reviewed.

See [Commit format and language](./configuration.md#commit-format-and-language) for the display-language rules and an example custom prompt.

## No message is generated

- Stage your changes first. Without a staged diff, the extension shows a warning and skips the API call. The SCM button can also show a temporary placeholder; commit text is never changed. The Command Palette uses only the warning when no public placeholder is available.
- Check the base URL, model, and API key. The defaults are DeepSeek (`https://api.deepseek.com/v1`, `deepseek-flash`); explicit settings are retained. A changed destination or an old unbound key requires confirmation. Dismissing a key dialog cancels the request. A new plaintext key replaces the stored key only after any necessary destination approval. Query values are hidden in key prompts, and provider errors redact the key before display and logging.
- For models that reject a configurable temperature (most current models do), `aiCommit.temperature` defaults to `-1`, which omits the parameter. A `400` mentioning temperature means an explicit `0–2` value was set — remove it or set `-1`.
- If the request times out, check the endpoint or increase `aiCommit.timeoutMs`. This limits total request time, even if the server keeps sending data.
- If output is truncated or contains only reasoning, adjust the model or prompt and retry. Only final nonempty text is inserted.
- Responses exceeding 1 MiB, including error bodies, are rejected. Check the provider or gateway if this occurs.
- If your draft changed during generation, the result is skipped to preserve your edits. Repeated clicks for the same repository do not start another request.
- If staged content changed during generation, the old result is discarded. Retry after finishing staging.
- If the built-in Git API is missing or disabled, the workspace folder is used and successful output goes to the clipboard.

Cancel through the generation notification. Cancellation preserves the draft and does not show an error.

## Key storage or authentication errors

For 401/403, use **Set API Key** in the error notification. Progress and the repository lock have already been released, so you can retry even while that notification is open. HTTP 401 automatically clears the rejected credential and settings masks if they still match that request; enter a new key. HTTP 403, network errors, and timeouts retain the key because they do not establish that it is invalid. A late 401 preserves any newer key or changed settings. If cleanup fails, follow the notification to inspect secure storage and user/workspace settings.

An empty settings field after update/reinstall is restored to `*****` on startup when the same extension ID still has a secure key. The mask indicates stored credentials; validity is checked by your next generation request. There is no automatic network probe. Blank settings alone do not delete secure storage.

If secure storage cannot save or bind a key, no request is sent. If masking or plaintext-copy cleanup fails after secure storage succeeds, the secure record is retained: inspect user and workspace settings for residue. Different keys in other scopes are deliberately preserved and reported. Clearing a key removes stored credentials and accessible masks, but leftover plaintext requires new authorization. See [API key storage and migration](./configuration.md#api-key-storage-and-migration).

After downgrading to an older extension version, set the key again because older versions cannot read the versioned record.

## Uninstalling without leaving data

Uninstalling the extension does not remove its settings or the key in SecretStorage. To remove them first:

1. Run **Simple AI Committer: Clear All Settings and Stored Key** from the Command Palette and confirm the dialog.
2. Wait for the success message. If some items could not be cleared, the message lists them by scope and setting name — fix the cause (for example a read-only settings file) and run the command again; it is idempotent.
3. Uninstall the extension.

Reinstalling afterwards starts from defaults with no key. The cleanup only covers the current VS Code window: repeat it in other profiles or machines (and in a dev-alias build, which has its own settings namespace and stored key), and note that Settings Sync may restore cleared values from other devices.
