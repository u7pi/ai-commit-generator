# Troubleshooting

[Documentation](./README.md) · [Project overview](../README.md)

For settings and defaults, see [Configuration](./configuration.md#settings-reference).

## Git is not found on Windows

The VS Code extension process may not have Git in its `PATH`. Set `aiCommit.gitPath` to the full executable path, for example `C:\Program Files\Git\bin\git.exe`. Spaces in absolute paths are supported; enter the path without surrounding quotes or shell arguments. Run `where.exe git` in PowerShell or Command Prompt to locate it. Each Git command has a fixed 30-second deadline; changing `aiCommit.timeoutMs` does not extend it.

## The commit message uses the wrong language

Leave `aiCommit.systemPrompt` empty to use the built-in display-language selection. If it has a saved value, edit its language instructions or clear it. Generated text is produced by the model and should always be reviewed.

See [Commit format and language](./configuration.md#commit-format-and-language) for the display-language rules and an example custom prompt.

## No message is generated

- Run **Simple AI Committer: Test API Connection** to check the URL, key, and model without staging anything. It validates the settings locally, then probes the endpoint and explains what to fix: 401/403 point at the key, 404 and DNS/refused connections point at the URL, 400 suggests a wrong model name or an explicit temperature, and timeouts suggest network, proxy, or local-service checks.
- Stage your changes first. Without a staged diff, the extension shows a warning and skips the API call. The SCM button can also show a temporary placeholder; commit text is never changed. The Command Palette uses only the warning when no public placeholder is available.
- Check the base URL, model, and API key. The defaults are DeepSeek (`https://api.deepseek.com/v1`, `deepseek-flash`); explicit settings are retained. A changed destination or an old unbound key requires confirmation. Dismissing a key dialog cancels the request. A new plaintext key replaces the stored key only after any necessary destination approval. Query values are hidden in key prompts, and provider errors never include the original body in notifications or logs. Non-2xx responses stop at headers and report a local status message; HTTP 200 error objects get a fixed message.
- For models that reject a configurable temperature (most current models do), `aiCommit.temperature` defaults to `-1`, which omits the parameter. A `400` mentioning temperature means an explicit `0–2` value was set — remove it or set `-1`.
- If the request times out, check the endpoint or increase `aiCommit.timeoutMs`. This limits total request time, even if the server keeps sending data.
- If output is truncated or contains only reasoning, adjust the model or prompt and retry. Only final nonempty text is inserted.
- Successful responses exceeding 1 MiB of raw bytes are rejected. Error responses stop at headers without reading the body. Check the provider or gateway if this occurs.
- If your draft changed during generation, the result is skipped to preserve your edits. Repeated clicks for the same repository do not start another request.
- If staged content changed during generation, the old result is discarded. Retry after finishing staging.
- If the built-in Git API is missing or disabled, the workspace folder is used and successful output goes to the clipboard.

Cancel through the generation notification. Cancellation preserves the draft and does not show an error.

## Key storage or authentication errors

For 401/403, use **Set API Key** in the error notification. Progress and the repository lock have already been released, so you can retry even while that notification is open. HTTP 401 automatically clears the rejected credential and settings masks if they still match that request; enter a new key. HTTP 403, network errors, and timeouts retain the key because they do not establish that it is invalid. A late 401 preserves any newer key or changed settings. If cleanup fails, follow the notification to inspect secure storage and user/workspace settings. To tell these cases apart before generating, run **Simple AI Committer: Test API Connection** — the probe keeps the stored key on failure and only diagnoses the problem.

An empty settings field after update/reinstall is restored to `*****` on startup when the same extension ID still has a secure key. The mask indicates stored credentials; validity is checked by your next generation request. There is no automatic network probe. Blank settings alone do not delete secure storage.

If secure storage cannot save or bind a key, no request is sent. If masking or plaintext-copy cleanup fails after secure storage succeeds, the secure record is retained: inspect user and workspace settings for residue. Different keys in other scopes are deliberately preserved and reported. Clearing a key removes stored credentials and accessible masks, but leftover plaintext requires new authorization. See [API key storage and migration](./configuration.md#api-key-storage-and-migration).

After downgrading to an older extension version, set the key again because older versions cannot read the versioned record.

## Uninstalling without leaving data

Uninstalling the extension does not remove its settings or the key in SecretStorage. To remove them first:

1. Run **Simple AI Committer: Clear All Settings and Stored Key** from the Command Palette and confirm the dialog.
2. Wait for the success message. If some items could not be cleared, the message lists them by scope and setting name — fix the cause (for example a read-only settings file) and run the command again; it is idempotent.
3. Uninstall the extension.

Reinstalling afterwards starts from defaults with no key. The cleanup only covers the current VS Code window: repeat it in other profiles or machines (and in a dev-alias build, which has its own settings namespace and stored key), and note that Settings Sync may restore cleared values from other devices.

## Credential lock timeout

Updated local windows in the same profile and extension ID coordinate writes with `credentials.lock` under extension global storage. Normal operations release it even after errors; dialogs and network waits do not hold it. A busy or leftover lock times out after 5 seconds without modifying data. Do not remove a live lock or use its age to decide it is stale. After closing all related windows, remove only the exact lock file named in the notification, then reopen VS Code. Different versions, remote hosts and external writers are outside the shared-lock guarantee.

SCM commands use only their explicit repository root. If it closed or the Git API is unavailable, generation runs Git at that root and copies results to the clipboard; an invalid root stops instead of selecting another repository.

中文：错误通知和日志不展示服务端原始正文。凭据锁超时后不会修改数据；如异常退出留下锁，先关闭相关窗口，再只删除通知指定的 `credentials.lock` 文件并重开 VS Code，不能按文件时间抢占锁。SCM 指定路径失效时停止，不会发送其他仓库内容。

Shared state uses a random change identifier and credential digest to detect stale SecretStorage caches before writes or requests; it stores no plaintext key or endpoint. If storage was changed by an older version or external tool, synchronization can stop with an explicit error. After closing all related windows, remove only the reported lock and the adjacent `credentials.state` to reset coordination, then reopen and check the key.

中文：共享状态使用随机变更标识及记录摘要识别 SecretStorage 旧缓存，不保存明文密钥或地址。旧版本或外部程序绕过锁修改存储后，可能出现同步错误；先关闭相关窗口，再删除指定锁及相邻的 `credentials.state` 重置协调状态，重开并检查密钥。
