import * as vscode from "vscode";
import * as https from "https";
import * as http from "http";
import { URL } from "url";
import { relative } from "path";
import { simpleGit, DiffResult } from "simple-git";

// ─── Logger ─────────────────────────────────────────────────────────────────

class Logger {
  private static readonly prefix = "[AI Commit]";
  static info(msg: string) {
    console.log(`${Logger.prefix} ${msg}`);
  }
  static warn(msg: string) {
    console.warn(`${Logger.prefix} ${msg}`);
  }
  static error(msg: string, err?: any) {
    console.error(`${Logger.prefix} ERROR: ${msg}`, err ?? "");
  }
}

// ─── Default System Prompt ──────────────────────────────────────────────────

const DEFAULT_SYSTEM_PROMPT_EN = `# Git Commit Message Guide

## Role
You are a Git commit message assistant. Output only the commit message, with no explanation, greeting, or extra content.

## Output format
<type>(<scope>): <subject>

<body>

## Type reference
| Type     | Emoji | Description         |
| -------- | ----- | ------------------- |
| feat     | ✨    | New feature         |
| fix      | 🐛    | Bug fix             |
| docs     | 📝    | Documentation       |
| style    | 💄    | Code formatting     |
| refactor | ♻️    | Refactoring         |
| perf     | ⚡️   | Performance         |
| test     | ✅    | Tests               |
| build    | 📦    | Build system        |
| ci       | 👷    | CI configuration    |
| chore    | 🔧    | Other maintenance   |

## Rules
1. Use an imperative subject with a lowercase first letter and no trailing period
2. Use a lowercase English scope, such as auth, api, or ui
3. Use bullet points in the body to describe reasons and details when needed
4. Output only the commit message, without markdown code fences
5. Write the subject and body in English, regardless of the language in the diff`;

const DEFAULT_SYSTEM_PROMPT_ZH_CN = `# Git 提交信息生成指南

## 角色
你是 Git 提交信息生成助手。仅输出提交信息本身，不要任何解释、问候或额外内容。

## 输出格式
<type>(<scope>): <subject>

<body>

## Type 对照表
| Type     | Emoji | 说明           |
| -------- | ----- | -------------- |
| feat     | ✨    | 新功能         |
| fix      | 🐛    | 修复 Bug       |
| docs     | 📝    | 文档更新       |
| style    | 💄    | 代码格式调整   |
| refactor | ♻️    | 重构           |
| perf     | ⚡️   | 性能优化       |
| test     | ✅    | 测试相关       |
| build    | 📦    | 构建系统       |
| ci       | 👷    | CI 配置        |
| chore    | 🔧    | 其他杂项       |

## 规则
1. Subject 使用祈使句，首字母不大写，末尾不加句号
2. Scope 用英文小写，如 auth、api、ui
3. Body 用中文分条说明变更原因和细节（如有必要）
4. 仅输出提交信息，不输出 markdown 代码块标记
5. Subject 和 Body 使用中文，不受 diff 内容语言影响`;

// ─── i18n ───────────────────────────────────────────────────────────────────

const isZh = vscode.env.language === "zh-cn";
const t = (zh: string, en: string) => (isZh ? zh : en);
const DEFAULT_SYSTEM_PROMPT = isZh ? DEFAULT_SYSTEM_PROMPT_ZH_CN : DEFAULT_SYSTEM_PROMPT_EN;

// ─── Config Manager ─────────────────────────────────────────────────────────

class ConfigManager {
  private static instance: ConfigManager;
  private cache = new Map<string, any>();
  private disposable: vscode.Disposable;

  private constructor() {
    this.disposable = vscode.workspace.onDidChangeConfiguration((e) => {
      if (e.affectsConfiguration("aiCommit")) {
        this.cache.clear();
        Logger.info("Config cache cleared");
      }
    });
  }

  static getInstance(): ConfigManager {
    if (!ConfigManager.instance) {
      ConfigManager.instance = new ConfigManager();
    }
    return ConfigManager.instance;
  }

  get<T>(key: string, defaultValue?: T): T {
    const fullKey = `aiCommit.${key}`;
    if (!this.cache.has(fullKey)) {
      const value = vscode.workspace
        .getConfiguration("aiCommit")
        .get<T>(key, defaultValue as T);
      this.cache.set(fullKey, value);
    }
    return this.cache.get(fullKey) as T;
  }

  dispose() {
    this.disposable.dispose();
  }
}

function getConfig() {
  const cfg = ConfigManager.getInstance();
  // The Settings UI shows the built-in English prompt as this setting's
  // default; treat that exact text as "not customized" so the locale-aware
  // default prompt still applies until the user edits it.
  const rawPrompt = cfg.get<string>("systemPrompt", "");
  const config = {
    apiBaseUrl: cfg.get<string>("apiBaseUrl", "https://api.openai.com/v1"),
    model: cfg.get<string>("model", "deepseek-flash"),
    systemPrompt: rawPrompt === DEFAULT_SYSTEM_PROMPT_EN ? "" : rawPrompt,
    temperature: cfg.get<number>("temperature", -1),
    maxDiffChars: cfg.get<number>("maxDiffChars", 6000),
    timeoutMs: cfg.get<number>("timeoutMs", 30000),
  };
  for (const key of ["maxDiffChars", "timeoutMs"] as const) {
    const value = config[key];
    if (!Number.isSafeInteger(value) || value <= 0 || (key === "timeoutMs" && value > 2147483647)) {
      throw new Error(t(`aiCommit.${key} 必须为有效的正整数。`, `aiCommit.${key} must be a valid positive integer.`));
    }
  }
  if (!Number.isFinite(config.temperature) || (config.temperature !== -1 && (config.temperature < 0 || config.temperature > 2))) {
    throw new Error(t("aiCommit.temperature 必须为 -1 或 0–2。", "aiCommit.temperature must be -1 or between 0 and 2."));
  }
  getApiUrl(config.apiBaseUrl);
  return config;
}

const API_KEY = "aiCommit.apiKey";
// Placeholder written back to the settings field once the key lives in
// SecretStorage, so the Settings UI shows a masked key instead of an empty box.
const MASKED_KEY = "*****";
let secrets: vscode.SecretStorage;
// Plaintext settings value we already prompted for; a changed value prompts again.
let promptedValue: string | undefined;
let migration: Promise<string> | undefined;

function keySettingTarget(config: vscode.WorkspaceConfiguration): vscode.ConfigurationTarget {
  return config.inspect<string>("apiKey")?.workspaceValue !== undefined
    ? vscode.ConfigurationTarget.Workspace : vscode.ConfigurationTarget.Global;
}

async function writeMaskedKey(config: vscode.WorkspaceConfiguration): Promise<void> {
  await config.update("apiKey", MASKED_KEY, keySettingTarget(config));
}

async function setApiKey() {
  const key = await vscode.window.showInputBox({
    title: t("Simple AI Committer：设置 API Key", "Simple AI Committer: Set API Key"),
    prompt: t("密钥将保存在 VS Code 安全存储中。", "The key will be saved in VS Code SecretStorage."),
    password: true,
    ignoreFocusOut: true,
  });
  if (!key?.trim()) return;
  try {
    await secrets.store(API_KEY, key.trim());
  } catch {
    vscode.window.showErrorMessage(t("AI Commit：无法安全保存 API Key。", "AI Commit: Could not save the API key securely."));
    return;
  }
  // Mirror the stored key in the settings field as a mask, so the Settings UI
  // shows ***** instead of a stale plaintext value or an empty box.
  try {
    await writeMaskedKey(vscode.workspace.getConfiguration("aiCommit"));
  } catch {
    vscode.window.showErrorMessage(t("AI Commit：API Key 已安全保存，但设置栏未能更新为掩码显示。", "AI Commit: API key saved securely, but the settings field could not be updated to the masked display."));
    return;
  }
  vscode.window.showInformationMessage(t("AI Commit：API Key 已安全保存。", "AI Commit: API key saved securely."));
}

async function clearApiKey() {
  try {
    await secrets.delete(API_KEY);
  } catch {
    vscode.window.showErrorMessage(t("AI Commit：无法清除安全存储中的 API Key。", "AI Commit: Could not clear the stored API key."));
    return;
  }
  // Drop the ***** mirror so the settings field shows empty again; a real
  // plaintext setting is left untouched and stays effective.
  const config = vscode.workspace.getConfiguration("aiCommit");
  if (config.get<string>("apiKey", "") === MASKED_KEY) {
    try {
      await config.update("apiKey", undefined, keySettingTarget(config));
    } catch {
      vscode.window.showErrorMessage(t("AI Commit：密钥已清除，但设置栏中的掩码未能移除。", "AI Commit: Key cleared, but the settings mask could not be removed."));
      return;
    }
  }
  vscode.window.showInformationMessage(t("AI Commit：已清除安全存储中的密钥及设置栏掩码；已有明文设置仍会生效。", "AI Commit: Cleared the stored key and the settings mask; any plaintext setting still applies."));
}

async function getApiKey(): Promise<string> {
  let stored: string | undefined;
  try {
    stored = await secrets.get(API_KEY);
  } catch {
    throw new Error(t("无法读取安全存储中的 API Key。", "Could not read the stored API key."));
  }
  const config = vscode.workspace.getConfiguration("aiCommit");
  // Trim like the Set API Key command does: keys copied with stray whitespace
  // would otherwise be stored and sent verbatim, failing authentication.
  const legacy = config.get<string>("apiKey", "").trim();
  if (legacy === MASKED_KEY) return stored ?? "";
  if (!legacy) return stored ?? "";
  if (stored && legacy === stored) {
    // The settings field merely duplicates the stored key — show the mask.
    try {
      await writeMaskedKey(config);
    } catch {
      vscode.window.showErrorMessage(t("AI Commit：密钥已安全保存，但设置栏未能更新为掩码显示。", "AI Commit: Key saved securely, but the settings field could not be updated to the masked display."));
    }
    return stored;
  }
  if (migration) return migration;
  if (promptedValue === legacy) return stored ?? legacy;
  promptedValue = legacy;
  migration = (async () => {
    if (stored) {
      // A plaintext value that differs from the stored key is the user's
      // latest input: replace the stored key and re-mask the field. Prompting
      // here used to keep the old key on "Not now", which failed generation
      // with a confusing 401.
      try {
        await secrets.store(API_KEY, legacy);
      } catch {
        vscode.window.showErrorMessage(t("AI Commit：无法安全保存 API Key，仍使用安全存储中的原密钥。", "AI Commit: Could not save the API key securely; the stored key is still used."));
        return stored ?? legacy;
      }
      try {
        await writeMaskedKey(config);
      } catch {
        vscode.window.showErrorMessage(t("AI Commit：密钥已安全保存，但设置栏未能更新为掩码显示。", "AI Commit: Key saved securely, but the settings field could not be updated to the masked display."));
      }
      vscode.window.showInformationMessage(t("AI Commit：检测到设置栏中的新 API Key，已更新安全存储。", "AI Commit: Detected the new settings API key and updated secure storage."));
      return legacy;
    }
    const migrate = t("迁移并掩码", "Migrate and mask");
    const message = t("AI Commit：发现明文 API Key，是否迁入安全存储并将此栏改为 ***** 显示？", "AI Commit: A plaintext API key was found. Move it to secure storage and show ***** in this field instead?");
    const choice = await vscode.window.showWarningMessage(message, migrate, t("暂不", "Not now"));
    if (choice !== migrate) return stored ?? legacy;
    try {
      await secrets.store(API_KEY, legacy);
    } catch {
      vscode.window.showErrorMessage(t("AI Commit：密钥迁移失败，原设置已保留。", "AI Commit: Key migration failed; the original setting was preserved."));
      return stored ?? legacy;
    }
    try {
      await writeMaskedKey(config);
    } catch {
      vscode.window.showErrorMessage(t("AI Commit：密钥已安全保存，但设置栏未能更新为掩码显示。", "AI Commit: Key saved securely, but the settings field could not be updated to the masked display."));
    }
    return legacy;
  })();
  try {
    return await migration;
  } finally {
    migration = undefined;
  }
}

function getApiUrl(baseUrl: string): URL {
  let parsed: URL;
  try {
    parsed = new URL(baseUrl.trim());
    if (!["http:", "https:"].includes(parsed.protocol)) throw new Error();
  } catch {
    throw new Error(t("请输入有效的 http(s) API 地址。", "Enter a valid http(s) API URL."));
  }
  parsed.pathname = parsed.pathname.replace(/\/+$/, "") + "/chat/completions";
  parsed.hash = "";
  return parsed;
}

async function selectApiBaseUrl() {
  const presets = [
    { label: "OpenAI", url: "https://api.openai.com/v1" },
    { label: "Kimi", url: "https://api.moonshot.cn/v1" },
    { label: "DeepSeek", url: "https://api.deepseek.com/v1" },
    { label: "GLM", url: "https://open.bigmodel.cn/api/paas/v4" },
    { label: "Ollama", url: "http://localhost:11434/v1" },
  ].map((preset) => ({ ...preset, description: preset.url }));
  const url = await new Promise<string | undefined>((resolve) => {
    const picker = vscode.window.createQuickPick<vscode.QuickPickItem & { url: string }>();
    picker.title = t("AI Commit：选择 API 地址", "AI Commit: Select API Base URL");
    picker.placeholder = t("选择常用地址，或直接输入 http(s) URL", "Select a preset or enter an http(s) URL");
    picker.matchOnDescription = true;
    picker.items = presets;
    picker.onDidChangeValue((value) => {
      const input = value.trim();
      picker.items = /^https?:\/\//i.test(input)
        ? [{ label: t(`使用 ${input}`, `Use ${input}`), url: input, alwaysShow: true }, ...presets]
        : presets;
    });
    picker.onDidAccept(() => {
      const selected = picker.selectedItems[0];
      if (!selected) return;
      try {
        getApiUrl(selected.url);
      } catch {
        vscode.window.showErrorMessage(t("请输入有效的 http(s) API 地址。", "Enter a valid http(s) API URL."));
        return;
      }
      resolve(selected.url);
      picker.hide();
    });
    picker.onDidHide(() => {
      resolve(undefined);
      picker.dispose();
    });
    picker.show();
  });
  if (url !== undefined) {
    const config = vscode.workspace.getConfiguration("aiCommit");
    const target = config.inspect<string>("apiBaseUrl")?.workspaceValue !== undefined
      ? vscode.ConfigurationTarget.Workspace
      : vscode.ConfigurationTarget.Global;
    await config.update(
      "apiBaseUrl", url, target,
    );
  }
}

// ─── Git Helpers ────────────────────────────────────────────────────────────

async function getRepo(arg?: any): Promise<any> {
  const gitExtension = vscode.extensions.getExtension("vscode.git")?.exports;
  const api = gitExtension?.getAPI(1);
  if (!api) return null;

  if (arg?.rootUri) {
    const targetPath = arg.rootUri.fsPath;
    for (const repo of api.repositories) {
      if (relative(repo.rootUri.fsPath, targetPath) === "") {
        return repo;
      }
    }
  }
  return api.repositories?.[0] ?? null;
}

async function getDiffStaged(rootPath: string): Promise<string> {
  const git = simpleGit({
    baseDir: rootPath,
    binary: ConfigManager.getInstance().get<string>("gitPath", "git"),
  });
  const diff = await git.diff(["--staged"]);
  return diff;
}

function truncateDiff(diff: string, maxChars: number, summary?: DiffResult): string {
  if (diff.length <= maxChars) return diff;
  const marker = `\n\n... [diff truncated: ${diff.length} chars]`;
  if (marker.length >= maxChars) return diff.slice(0, maxChars);
  const summaryBudget = Math.min(Math.floor(maxChars / 3), maxChars - marker.length);
  let fileList = "";
  if (summary?.files.length) {
    const header = "Staged files:\n";
    const omitted = (count: number) => count ? `[${count} files omitted]\n\n` : "\n";
    if (header.length + omitted(summary.files.length).length <= summaryBudget) {
      fileList = header;
      let included = 0;
      for (const file of summary.files) {
        const stats = file.binary ? "binary" : `+${file.insertions} -${file.deletions}`;
        const line = `${JSON.stringify(file.file)}: ${stats}\n`;
        if (fileList.length + line.length + omitted(summary.files.length - included - 1).length > summaryBudget) break;
        fileList += line;
        included++;
      }
      fileList += omitted(summary.files.length - included);
    }
  }
  return fileList + diff.slice(0, maxChars - fileList.length - marker.length) + marker;
}

// ─── LLM Call ────────────────────────────────────────────────────────────────

function abortError(): Error {
  const error = new Error("Cancelled by user");
  error.name = "AbortError";
  return error;
}

function callLLM(
  baseUrl: string,
  apiKey: string,
  model: string,
  systemPrompt: string,
  temperature: number,
  diff: string,
  timeoutMs: number,
  signal?: AbortSignal,
): Promise<string> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(abortError());
      return;
    }
    const payload = JSON.stringify({
      model,
      max_tokens: 2048,
      // temperature < 0 means "auto": omit the field entirely for models that
      // only accept a fixed sampling temperature.
      ...(temperature >= 0 ? { temperature } : {}),
      messages: [
        {
          role: "system",
          content: systemPrompt || DEFAULT_SYSTEM_PROMPT,
        },
        {
          role: "user",
          content: `Here is the git diff:\n\n${diff}`,
        },
      ],
    });

    const parsedUrl = getApiUrl(baseUrl);
    const options: https.RequestOptions = {
      hostname: parsedUrl.hostname,
      port: parsedUrl.port || (parsedUrl.protocol === "https:" ? 443 : 80),
      path: parsedUrl.pathname + parsedUrl.search,
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Content-Length": Buffer.byteLength(payload),
        ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}),
      },
    };

    let settled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const redact = (text: string) => (apiKey ? text.split(apiKey).join("[redacted]") : text);
    const finish = (error?: Error, message?: string) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      signal?.removeEventListener("abort", onAbort);
      if (error) {
        req.destroy();
        const statusCode = (error as Error & { statusCode?: number }).statusCode;
        if (apiKey && error.message.includes(apiKey)) {
          const redacted = new Error(redact(error.message)) as Error & { statusCode?: number };
          redacted.name = error.name;
          redacted.statusCode = statusCode;
          reject(redacted);
        } else {
          reject(error);
        }
      } else {
        resolve(message!);
      }
    };
    const onAbort = () => finish(abortError());
    const transport = parsedUrl.protocol === "https:" ? https : http;
    const req = transport.request(options, (res) => {
      res.setEncoding("utf8");
      res.on("error", (err) => finish(err));
      res.on("aborted", () => finish(new Error("API response aborted")));
      if (
        res.statusCode === undefined ||
        res.statusCode < 200 ||
        res.statusCode > 299
      ) {
        let errBody = "";
        res.on("data", (chunk) => (errBody += chunk));
        res.on("end", () => {
          const error = new Error(
            `API request failed (${res.statusCode}): ${redact(errBody).slice(0, 300)}`,
          ) as Error & { statusCode?: number };
          error.statusCode = res.statusCode;
          finish(error);
        });
        return;
      }

      let body = "";
      res.on("data", (chunk) => (body += chunk));
      res.on("end", () => {
        try {
          const json = JSON.parse(body);
          if (json.error) {
            finish(new Error(redact(String(json.error.message || JSON.stringify(json.error)))));
            return;
          }
          const choice = json.choices?.[0];
          if (choice?.finish_reason === "length") {
            finish(new Error(t("API 输出被截断，请调整模型或提示词后重试。", "API output was truncated. Adjust the model or prompt and retry.")));
            return;
          }
          const content = choice?.message?.content;
          const message = typeof content === "string" ? content.trim() : "";
          if (!message) {
            finish(new Error(t("API 未返回有效的最终文本。", "Empty or invalid final text from API.")));
            return;
          }
          finish(undefined, message);
        } catch (e) {
          finish(new Error("Failed to parse API response"));
        }
      });
    });

    req.on("error", (err) => finish(err));
    timer = setTimeout(() => finish(new Error("Request timeout")), timeoutMs);
    signal?.addEventListener("abort", onAbort, { once: true });
    req.end(payload);
  });
}

// ─── Main Command ───────────────────────────────────────────────────────────

const generatingRepos = new Set<string>();

async function generateCommitMessage(arg?: any) {
  const workspaceRoot =
    vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? null;

  // Resolve the SCM repo up front — supports multi-repo workspaces when the
  // command is invoked from a specific repo's SCM view.
  const repo = await getRepo(arg);

  const rootPath = repo?.rootUri.fsPath ?? workspaceRoot;
  if (!rootPath) {
    vscode.window.showErrorMessage(
      t("AI Commit：未打开工作区文件夹。", "AI Commit: No workspace folder open."),
    );
    return;
  }

  const repoKey = process.platform === "win32" ? rootPath.toLowerCase() : rootPath;
  if (generatingRepos.has(repoKey)) {
    vscode.window.showInformationMessage(t("AI Commit：该仓库正在生成提交信息。", "AI Commit: Already generating a message for this repository."));
    return;
  }
  generatingRepos.add(repoKey);
  const initialInput = repo?.inputBox.value;
  try {
    // Diff the staged changes before anything else, so the empty-diff path
    // never touches config validation or the AI. Never stage anything
    // ourselves — only what the user already staged is analyzed.
    let rawDiff: string;
    try {
      rawDiff = await getDiffStaged(rootPath);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      Logger.error(`Git operation failed: ${msg}`, err);
      vscode.window.showErrorMessage(
        t(`AI Commit：Git 操作失败：${msg}`, `AI Commit: Git operation failed: ${msg}`),
      );
      return;
    }

    if (!rawDiff.trim()) {
      // Distinguish "nothing at all" from "changes exist but none are staged".
      let hasChanges = false;
      try {
        const status = await simpleGit({
          baseDir: rootPath,
          binary: ConfigManager.getInstance().get<string>("gitPath", "git"),
        }).status();
        hasChanges = status.files.length > 0;
      } catch {
        // ignore — fall back to the generic hint
      }
      const hint = hasChanges
        ? t(
            "⚠ 没有已暂存的更改，请先暂存更改",
            "⚠ No staged changes — stage your changes first",
          )
        : t("⚠ 没有可提交的更改", "⚠ No changes to commit");
      const warning = hasChanges
        ? t(
            "AI Commit：未检测到已暂存的更改，已跳过 AI 生成。",
            "AI Commit: No staged changes detected, AI call skipped.",
          )
        : t(
            "AI Commit：未检测到任何更改，已跳过 AI 生成。",
            "AI Commit: No changes detected, AI call skipped.",
          );
      if (repo) {
        if (!repo.inputBox.value.trim()) repo.inputBox.value = hint;
        vscode.commands.executeCommand("workbench.view.scm");
      }
      Logger.warn(warning);
      vscode.window.showWarningMessage(warning);
      return;
    }

    // Only read config once we have an actual diff to send.
    let config: ReturnType<typeof getConfig>;
    try {
      config = getConfig();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      vscode.window.showErrorMessage(t(`AI Commit：${msg}`, `AI Commit: ${msg}`));
      return;
    }

    // Resolve the key before showing progress: the migration/update
    // confirmation must not wait invisibly behind the progress notification.
    let apiKey: string;
    try {
      apiKey = await getApiKey();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      vscode.window.showErrorMessage(t(`AI Commit：${msg}`, `AI Commit: ${msg}`));
      return;
    }

    await vscode.window.withProgress(
      {
        location: vscode.ProgressLocation.Notification,
        title: t(
          "Simple AI Committer：正在生成提交信息…",
          "Simple AI Committer: Generating commit message…",
        ),
        cancellable: true,
      },
      async (_progress, token) => {
        const abortCtrl = new AbortController();
        const cancellation = token.onCancellationRequested(() => {
          Logger.info("Generation cancelled by user");
          abortCtrl.abort();
        });
        if (token.isCancellationRequested) abortCtrl.abort();
        try {
          if (abortCtrl.signal.aborted) return;
          const summary = rawDiff.length > config.maxDiffChars
            ? await simpleGit({
                baseDir: rootPath,
                binary: ConfigManager.getInstance().get<string>("gitPath", "git"),
              }).diffSummary(["--staged"])
            : undefined;
          if (abortCtrl.signal.aborted) return;
          const diff = truncateDiff(rawDiff, config.maxDiffChars, summary);

          const message = await callLLM(
            config.apiBaseUrl,
            apiKey,
            config.model,
            config.systemPrompt,
            config.temperature,
            diff,
            config.timeoutMs,
            abortCtrl.signal,
          );

          if (abortCtrl.signal.aborted) return;
          if (repo) {
            if (repo.inputBox.value !== initialInput) {
              vscode.window.showInformationMessage(t("AI Commit：提交草稿已变更，生成结果未写入。", "AI Commit: The draft has changed; the generated message was not inserted."));
              return;
            }
            repo.inputBox.value = message;
            // Focus the Source Control panel so the user sees it
            vscode.commands.executeCommand("workbench.view.scm");
          } else {
            // Fallback: copy to clipboard
            await vscode.env.clipboard.writeText(message);
            vscode.window.showInformationMessage(
              t(
                "AI Commit：已复制到剪贴板（未找到 Git 仓库）。",
                "AI Commit: Message copied to clipboard (SCM repo not found).",
              ),
            );
          }
        } catch (err: unknown) {
          if (err instanceof Error && err.name === "AbortError") return;
          const statusCode = (err as { statusCode?: number })?.statusCode;
          if (statusCode === 401 || statusCode === 403) {
            // Surface an actionable hint instead of the provider's raw error.
            const setKey = t("设置 API Key", "Set API Key");
            const choice = await vscode.window.showErrorMessage(
              t(
                `AI Commit：API 认证失败（${statusCode}），请检查 API Key 是否有效。`,
                `AI Commit: API authentication failed (${statusCode}). Check that the API key is valid.`,
              ),
              setKey,
            );
            if (choice === setKey) await vscode.commands.executeCommand("ai-commit.setApiKey");
            return;
          }
          const msg = err instanceof Error ? err.message : String(err);
          Logger.error(`Failed to generate commit message: ${msg}`, err);
          vscode.window.showErrorMessage(
            t(`AI Commit：${msg}`, `AI Commit: ${msg}`),
          );
        } finally {
          cancellation.dispose();
        }
      },
    );
  } finally {
    generatingRepos.delete(repoKey);
  }
}

// ─── Activation ──────────────────────────────────────────────────────────────

export function activate(context: vscode.ExtensionContext) {
  secrets = context.secrets;
  ConfigManager.getInstance(); // 初始化配置监听
  context.subscriptions.push(
    vscode.commands.registerCommand(
      "ai-commit.generateCommitMessage",
      (arg) => generateCommitMessage(arg),
    ),
    vscode.commands.registerCommand("ai-commit.selectApiBaseUrl", selectApiBaseUrl),
    vscode.commands.registerCommand("ai-commit.setApiKey", setApiKey),
    vscode.commands.registerCommand("ai-commit.clearApiKey", clearApiKey),
  );
  Logger.info("Extension activated");
}

export function deactivate() {
  ConfigManager.getInstance().dispose();
}
