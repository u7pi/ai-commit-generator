import * as vscode from "vscode";
import * as https from "https";
import * as http from "http";
import { URL } from "url";
import { isAbsolute, relative } from "path";
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
    apiBaseUrl: cfg.get<string>("apiBaseUrl", "https://api.deepseek.com/v1"),
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
// Settings mirror only; credentials and their destination live in SecretStorage.
const MASKED_KEY = "*****";
interface KeyRecord { version: 1; key: string; endpoint: string; }
let secrets: vscode.SecretStorage;
let keyRevision = 0;
let keyWrites: Promise<unknown> = Promise.resolve();
let migration: { signature: string; promise: Promise<string> } | undefined;
let plaintextAuthorization: { key: string; endpoint: string } | undefined;

function serializeKeyWrite<T>(work: () => Promise<T>): Promise<T> {
  const result = keyWrites.then(work);
  keyWrites = result.catch(() => {});
  return result;
}

function apiEndpoint(baseUrl: string): string {
  const url = getApiUrl(baseUrl);
  return url.origin + url.pathname + url.search;
}

function currentEndpoint(): string {
  return apiEndpoint(vscode.workspace.getConfiguration("aiCommit").get<string>("apiBaseUrl", "https://api.deepseek.com/v1"));
}

function destinationLabel(baseUrl: string, key = ""): string {
  const url = getApiUrl(baseUrl);
  const label = url.origin + url.pathname + (url.search ? t("（查询参数已隐藏）", " (query values hidden)") : "");
  return key ? label.split(key).join("[redacted]") : label;
}

async function readStoredKey(): Promise<{ raw: string | undefined; key: string; endpoint?: string }> {
  let raw: string | undefined;
  try {
    raw = await secrets.get(API_KEY);
  } catch {
    throw new Error(t("无法读取安全存储中的 API Key。", "Could not read the stored API key."));
  }
  if (!raw) return { raw, key: "" };
  let record: any;
  try {
    record = JSON.parse(raw);
  } catch {
    return { raw, key: raw };
  }
  if (record === null || typeof record !== "object" || !("version" in record)) return { raw, key: raw };
  if (record?.version !== 1 || typeof record.key !== "string" || !record.key || typeof record.endpoint !== "string") {
    throw new Error(t("安全存储中的密钥记录无效，请重新设置 API Key。", "Invalid stored key record. Set the API key again."));
  }
  return { raw, key: record.key, endpoint: record.endpoint };
}

function keySettingTarget(config: vscode.WorkspaceConfiguration): vscode.ConfigurationTarget {
  return config.inspect<string>("apiKey")?.workspaceValue !== undefined
    ? vscode.ConfigurationTarget.Workspace : vscode.ConfigurationTarget.Global;
}

async function writeMaskedKey(config: vscode.WorkspaceConfiguration, key: string): Promise<void> {
  const inspected = config.inspect<string>("apiKey");
  const target = keySettingTarget(config);
  let failed = false;
  try {
    if (config.get<string>("apiKey", "") !== MASKED_KEY) await config.update("apiKey", MASKED_KEY, target);
  } catch {
    failed = true;
  }
  let otherPlaintext = false;
  for (const [scope, value] of [
    [vscode.ConfigurationTarget.Global, inspected?.globalValue],
    [vscode.ConfigurationTarget.Workspace, inspected?.workspaceValue],
  ] as const) {
    if (scope === target || !value?.trim() || value.trim() === MASKED_KEY) continue;
    if (value.trim() !== key) {
      otherPlaintext = true;
      continue;
    }
    try {
      await config.update("apiKey", undefined, scope);
    } catch {
      failed = true;
    }
  }
  if (failed) {
    vscode.window.showErrorMessage(t("AI Commit：密钥已安全保存，但设置掩码或同值明文副本未能更新，请检查用户和工作区设置。", "AI Commit: Key saved securely, but masking or plaintext-copy cleanup failed. Check user and workspace settings."));
  }
  if (otherPlaintext) {
    vscode.window.showWarningMessage(t("AI Commit：其他配置层中仍有不同的明文 API Key，已保留，请检查。", "AI Commit: A different plaintext API key remains in another settings scope. It was preserved; please check it."));
  }
}

async function setApiKey() {
  let endpoint: string;
  let label: string;
  const initialRevision = keyRevision;
  const setting = vscode.workspace.getConfiguration("aiCommit").get<string>("apiKey", "");
  let stored: string | undefined;
  try {
    await keyWrites;
    try {
      stored = await secrets.get(API_KEY);
    } catch {
      throw new Error(t("无法读取安全存储中的 API Key。", "Could not read the stored API key."));
    }
    endpoint = currentEndpoint();
    label = destinationLabel(vscode.workspace.getConfiguration("aiCommit").get<string>("apiBaseUrl", "https://api.deepseek.com/v1"));
  } catch (err) {
    vscode.window.showErrorMessage(err instanceof Error ? err.message : String(err));
    return;
  }
  const key = await vscode.window.showInputBox({
    title: t("Simple AI Committer：设置 API Key", "Simple AI Committer: Set API Key"),
    prompt: t("密钥将安全保存并绑定到：", "The key will be saved securely and bound to: ") + label,
    password: true,
    ignoreFocusOut: true,
  });
  if (!key?.trim()) return;
  try {
    await serializeKeyWrite(async () => {
      let current: string | undefined;
      try {
        current = await secrets.get(API_KEY);
      } catch {
        throw new Error(t("无法读取安全存储中的 API Key。", "Could not read the stored API key."));
      }
      if (initialRevision !== keyRevision || currentEndpoint() !== endpoint || current !== stored ||
          vscode.workspace.getConfiguration("aiCommit").get<string>("apiKey", "") !== setting) throw credentialsChanged();
      const revision = ++keyRevision;
      plaintextAuthorization = undefined;
      try {
        await secrets.store(API_KEY, JSON.stringify({ version: 1, key: key.trim(), endpoint } satisfies KeyRecord));
      } catch {
        throw new Error(t("AI Commit：无法安全保存 API Key。", "AI Commit: Could not save the API key securely."));
      }
      if (revision !== keyRevision || currentEndpoint() !== endpoint ||
          vscode.workspace.getConfiguration("aiCommit").get<string>("apiKey", "") !== setting) throw credentialsChanged();
      await writeMaskedKey(vscode.workspace.getConfiguration("aiCommit"), key.trim());
      if (revision !== keyRevision || currentEndpoint() !== endpoint) throw credentialsChanged();
    });
    vscode.window.showInformationMessage(t("AI Commit：API Key 已安全保存并绑定到当前接口。", "AI Commit: API key saved securely and bound to the current endpoint."));
  } catch (err) {
    vscode.window.showErrorMessage(err instanceof Error ? err.message : String(err));
  }
}

async function clearApiKey() {
  ++keyRevision;
  plaintextAuthorization = undefined;
  try {
    await serializeKeyWrite(async () => {
      try {
        await secrets.delete(API_KEY);
      } catch {
        throw new Error(t("AI Commit：无法清除安全存储中的 API Key。", "AI Commit: Could not clear the stored API key."));
      }
      const config = vscode.workspace.getConfiguration("aiCommit");
      const inspected = config.inspect<string>("apiKey");
      let failed = false;
      for (const [scope, value] of [
        [vscode.ConfigurationTarget.Global, inspected?.globalValue],
        [vscode.ConfigurationTarget.Workspace, inspected?.workspaceValue],
      ] as const) {
        if (value?.trim() !== MASKED_KEY) continue;
        try {
          await config.update("apiKey", undefined, scope);
        } catch {
          failed = true;
        }
      }
      if (failed) throw new Error(t("AI Commit：密钥已清除，但部分设置掩码未能移除，请检查设置。", "AI Commit: Key cleared, but some settings masks could not be removed. Check settings."));
    });
    vscode.window.showInformationMessage(t("AI Commit：已清除安全密钥和设置掩码；已有明文设置仍会生效，并需授权使用。", "AI Commit: Cleared the stored key and settings masks; existing plaintext settings still apply and require authorization."));
  } catch (err) {
    vscode.window.showErrorMessage(err instanceof Error ? err.message : String(err));
  }
}

function credentialsChanged(): Error {
  return new Error(t("API Key 或接口地址已变更，请重新生成。", "The API key or endpoint changed. Generate again."));
}

async function getApiKey(baseUrl: string): Promise<string> {
  const revision = keyRevision;
  await keyWrites;
  const stored = await readStoredKey();
  const config = vscode.workspace.getConfiguration("aiCommit");
  const setting = config.get<string>("apiKey", "");
  const plaintext = setting.trim() === MASKED_KEY ? "" : setting.trim();
  const key = plaintext || stored.key;
  if (!key) return "";
  const endpoint = apiEndpoint(baseUrl);
  const check = async () => {
    const current = await readStoredKey();
    if (revision !== keyRevision || currentEndpoint() !== endpoint ||
        vscode.workspace.getConfiguration("aiCommit").get<string>("apiKey", "") !== setting || current.raw !== stored.raw) {
      throw credentialsChanged();
    }
  };
  const signature = JSON.stringify([revision, stored.raw, setting, endpoint]);
  if (migration?.signature === signature) return migration.promise;
  const operation = (async () => {
    await check();
    let persist = true;
    const sessionApproved = plaintextAuthorization?.key === key && plaintextAuthorization.endpoint === endpoint;
    if (!stored.key && !sessionApproved) {
      const migrate = t("迁移并掩码", "Migrate and mask");
      const once = t("本窗口使用明文，不迁移", "Use plaintext this window, without migrating");
      const choice = await vscode.window.showWarningMessage(
        t("AI Commit：是否将明文密钥用于以下接口？迁移后将安全保存并掩码：", "AI Commit: Authorize the plaintext key for this endpoint? Migration saves it securely and masks settings: ") + destinationLabel(baseUrl, key),
        { modal: true }, migrate, once,
      );
      if (choice !== migrate && choice !== once) throw abortError();
      persist = choice === migrate;
    } else if (stored.key && stored.endpoint !== endpoint) {
      const allow = t("允许并绑定到此接口", "Allow and bind to this endpoint");
      const choice = await vscode.window.showWarningMessage(
        t("AI Commit：现有密钥尚未绑定此接口。是否允许发送并重新绑定？路径或查询参数变化也需要确认：", "AI Commit: The stored key is not bound to this endpoint. Allow sending and rebind it? Path or query changes also require approval: ") + destinationLabel(baseUrl, key),
        { modal: true }, allow,
      );
      if (choice !== allow) throw abortError();
    } else if (sessionApproved) {
      persist = false;
    }
    return serializeKeyWrite(async () => {
      await check();
      let operationRevision = revision;
      if (!persist) {
        plaintextAuthorization = { key, endpoint };
        return key;
      }
      if (key !== stored.key || endpoint !== stored.endpoint) {
        const writeRevision = ++keyRevision;
        operationRevision = writeRevision;
        try {
          await secrets.store(API_KEY, JSON.stringify({ version: 1, key, endpoint } satisfies KeyRecord));
        } catch {
          throw new Error(t("AI Commit：无法安全保存或绑定 API Key，原密钥及设置已保留。", "AI Commit: Could not securely save or bind the API key; the original key and settings were preserved."));
        }
        if (writeRevision !== keyRevision || currentEndpoint() !== endpoint ||
            vscode.workspace.getConfiguration("aiCommit").get<string>("apiKey", "") !== setting) throw credentialsChanged();
        if (stored.key && plaintext && plaintext !== stored.key) {
          vscode.window.showInformationMessage(t("AI Commit：设置中的新 API Key 已更新安全存储。", "AI Commit: The new settings API key updated secure storage."));
        }
      }
      if (plaintext || key !== stored.key || endpoint !== stored.endpoint || setting.trim() === MASKED_KEY) {
        await writeMaskedKey(config, key);
      }
      if (operationRevision !== keyRevision || currentEndpoint() !== endpoint) throw credentialsChanged();
      return key;
    });
  })();
  migration = { signature, promise: operation };
  try {
    return await operation;
  } finally {
    if (migration?.promise === operation) migration = undefined;
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

function getGitApi(): any {
  try {
    const extension = vscode.extensions.getExtension("vscode.git")?.exports;
    return extension?.enabled === false ? null : extension?.getAPI(1) ?? null;
  } catch {
    Logger.warn("Built-in Git API unavailable; using workspace fallback");
    return null;
  }
}

async function getRepo(arg?: any): Promise<any> {
  const api = getGitApi();
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

function createGit(rootPath: string, signal?: AbortSignal) {
  const binary = ConfigManager.getInstance().get<string>("gitPath", "git");
  return simpleGit({
    baseDir: rootPath,
    binary,
    abort: signal,
    timeout: { block: 30000, stdOut: false, stdErr: false },
    unsafe: { allowUnsafeCustomBinary: isAbsolute(binary) && /\s/.test(binary) },
  });
}

async function getDiffStaged(rootPath: string, signal?: AbortSignal): Promise<string> {
  return createGit(rootPath, signal).diff(["--staged"]);
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
      let receivedBytes = 0;
      const chunks: Buffer[] = [];
      res.on("data", (chunk: Buffer) => {
        if (settled) return;
        receivedBytes += chunk.length;
        if (receivedBytes > 1024 * 1024) {
          finish(new Error(t("API 响应过大，超过 1 MiB 上限。", "API response too large; the limit is 1 MiB.")));
          res.destroy();
          return;
        }
        chunks.push(chunk);
      });
      res.on("error", (err) => finish(err));
      res.on("aborted", () => finish(new Error("API response aborted")));
      if (
        res.statusCode === undefined ||
        res.statusCode < 200 ||
        res.statusCode > 299
      ) {
        res.on("end", () => {
          if (settled) return;
          const errBody = Buffer.concat(chunks).toString("utf8");
          const error = new Error(
            `API request failed (${res.statusCode}): ${redact(errBody).slice(0, 300)}`,
          ) as Error & { statusCode?: number };
          error.statusCode = res.statusCode;
          finish(error);
        });
        return;
      }

      res.on("end", () => {
        if (settled) return;
        try {
          const body = Buffer.concat(chunks).toString("utf8");
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
const emptyHints = new Map<string, () => void>();

function rootKey(rootPath: string): string {
  return process.platform === "win32" ? rootPath.toLowerCase() : rootPath;
}

function showEmptyHint(repo: any, arg: any, hint: string) {
  // Only the SCM command argument exposes a public SourceControlInputBox.
  if (!arg?.rootUri || relative(repo.rootUri.fsPath, arg.rootUri.fsPath) !== "" ||
      typeof arg.inputBox?.placeholder !== "string" || repo.inputBox.value.trim() || repo.state?.indexChanges.length) return;
  const input = arg.inputBox as vscode.SourceControlInputBox;
  const original = input.placeholder;
  const key = rootKey(repo.rootUri.fsPath);
  const restore = () => {
    if (input.placeholder === hint) input.placeholder = original;
    listener?.dispose();
    emptyHints.delete(key);
  };
  const listener = repo.state?.onDidChange(() => {
    if (repo.state.indexChanges.length) restore();
  }) as vscode.Disposable | undefined;
  emptyHints.set(key, restore);
  input.placeholder = hint;
}

async function withGenerationProgress<T>(title: string, work: (signal: AbortSignal) => Promise<T>): Promise<T> {
  return vscode.window.withProgress(
    { location: vscode.ProgressLocation.Notification, title, cancellable: true },
    async (_progress, token) => {
      const controller = new AbortController();
      const cancellation = token.onCancellationRequested(() => controller.abort());
      if (token.isCancellationRequested) controller.abort();
      try {
        if (controller.signal.aborted) throw abortError();
        const result = await work(controller.signal);
        if (controller.signal.aborted) throw abortError();
        return result;
      } catch (err) {
        if (controller.signal.aborted) throw abortError();
        if ((err as { plugin?: string })?.plugin === "timeout") {
          throw new Error(t("Git 操作超过 30 秒时限，请检查 Git 配置后重试。", "Git exceeded its 30-second deadline. Check Git configuration and retry."));
        }
        throw err;
      } finally {
        cancellation.dispose();
      }
    },
  );
}

function stagedChangesChanged() {
  vscode.window.showInformationMessage(t("AI Commit：暂存内容已变更，旧生成结果已丢弃，请重新生成。", "AI Commit: Staged changes changed; the old result was discarded. Generate again."));
}

async function generateCommitMessage(arg?: any) {
  const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? null;
  const repo = await getRepo(arg);
  const rootPath = repo?.rootUri.fsPath ?? workspaceRoot;
  if (!rootPath) {
    vscode.window.showErrorMessage(t("AI Commit：未打开工作区文件夹。", "AI Commit: No workspace folder open."));
    return;
  }
  const repoKey = rootKey(rootPath);
  if (generatingRepos.has(repoKey)) {
    vscode.window.showInformationMessage(t("AI Commit：该仓库正在生成提交信息。", "AI Commit: Already generating a message for this repository."));
    return;
  }
  generatingRepos.add(repoKey);
  emptyHints.get(repoKey)?.();
  const initialInput = repo?.inputBox.value;
  let failure: unknown;
  try {
    // Git preflight is cancellable; no credential dialog lives inside progress.
    const { rawDiff, hasChanges } = await withGenerationProgress(
      t("Simple AI Committer：正在读取暂存更改…", "Simple AI Committer: Reading staged changes…"),
      async (signal) => {
        const rawDiff = await getDiffStaged(rootPath, signal);
        let hasChanges = false;
        if (!rawDiff.trim()) {
          try {
            hasChanges = (await createGit(rootPath, signal).status()).files.length > 0;
          } catch (err) {
            if (signal.aborted || (err as { plugin?: string })?.plugin === "timeout") throw err;
          }
        }
        return { rawDiff, hasChanges };
      },
    );
    if (!rawDiff.trim()) {
      const hint = hasChanges
        ? t("请先暂存更改，再生成提交信息", "Stage your changes first, then generate a commit message")
        : t("当前没有可提交的更改", "There are no changes to commit");
      if (repo) {
        showEmptyHint(repo, arg, hint);
        vscode.commands.executeCommand("workbench.view.scm");
      }
      const warning = hasChanges
        ? t("AI Commit：未检测到已暂存的更改，已跳过 AI 生成。", "AI Commit: No staged changes detected, AI call skipped.")
        : t("AI Commit：未检测到任何更改，已跳过 AI 生成。", "AI Commit: No changes detected, AI call skipped.");
      Logger.warn(warning);
      vscode.window.showWarningMessage(warning);
      return;
    }

    const config = getConfig();
    const apiKey = await getApiKey(config.apiBaseUrl);
    const revision = keyRevision;
    await withGenerationProgress(
      t("Simple AI Committer：正在生成提交信息…", "Simple AI Committer: Generating commit message…"),
      async (signal) => {
        const summary = rawDiff.length > config.maxDiffChars
          ? await createGit(rootPath, signal).diffSummary(["--staged"])
          : undefined;
        if (signal.aborted) throw abortError();
        if (await getDiffStaged(rootPath, signal) !== rawDiff) {
          stagedChangesChanged();
          return;
        }
        if (signal.aborted) throw abortError();
        const stored = await readStoredKey();
        const setting = vscode.workspace.getConfiguration("aiCommit").get<string>("apiKey", "").trim();
        const currentKey = (setting === MASKED_KEY ? "" : setting) || stored.key;
        if (signal.aborted) throw abortError();
        if (revision !== keyRevision || currentKey !== apiKey || currentEndpoint() !== apiEndpoint(config.apiBaseUrl)) throw credentialsChanged();
        const message = await callLLM(
          config.apiBaseUrl, apiKey, config.model, config.systemPrompt,
          config.temperature, truncateDiff(rawDiff, config.maxDiffChars, summary), config.timeoutMs, signal,
        );
        if (signal.aborted) throw abortError();
        if (await getDiffStaged(rootPath, signal) !== rawDiff) {
          stagedChangesChanged();
          return;
        }
        if (signal.aborted) throw abortError();
        if (repo) {
          if (repo.inputBox.value !== initialInput) {
            vscode.window.showInformationMessage(t("AI Commit：提交草稿已变更，生成结果未写入。", "AI Commit: The draft has changed; the generated message was not inserted."));
            return;
          }
          repo.inputBox.value = message;
          vscode.commands.executeCommand("workbench.view.scm");
        } else {
          await vscode.env.clipboard.writeText(message);
          vscode.window.showInformationMessage(t("AI Commit：已复制到剪贴板（未找到 Git 仓库）。", "AI Commit: Message copied to clipboard (SCM repo not found)."));
        }
      },
    );
  } catch (err) {
    if (!(err instanceof Error && err.name === "AbortError")) failure = err;
  } finally {
    generatingRepos.delete(repoKey);
  }
  // Interactive errors run only after progress and the repository lock are gone.
  if (!failure) return;
  const statusCode = (failure as { statusCode?: number })?.statusCode;
  if (statusCode === 401 || statusCode === 403) {
    const setKey = t("设置 API Key", "Set API Key");
    const choice = await vscode.window.showErrorMessage(
      t("AI Commit：API 认证失败（" + statusCode + "），请检查 API Key 是否有效。", "AI Commit: API authentication failed (" + statusCode + "). Check that the API key is valid."),
      setKey,
    );
    if (choice === setKey) await vscode.commands.executeCommand("ai-commit.setApiKey");
    return;
  }
  const msg = failure instanceof Error ? failure.message : String(failure);
  Logger.error("Failed to generate commit message: " + msg, failure);
  vscode.window.showErrorMessage(t("AI Commit：" + msg, "AI Commit: " + msg));
}

// ─── Activation ──────────────────────────────────────────────────────────────

export function activate(context: vscode.ExtensionContext) {
  secrets = context.secrets;
  ConfigManager.getInstance(); // 初始化配置监听
  const repositoryClosed = getGitApi()?.onDidCloseRepository((repo: any) => emptyHints.get(rootKey(repo.rootUri.fsPath))?.());
  if (repositoryClosed) context.subscriptions.push(repositoryClosed);
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
  for (const restore of emptyHints.values()) restore();
  ConfigManager.getInstance().dispose();
}
