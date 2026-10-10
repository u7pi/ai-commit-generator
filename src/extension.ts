import * as vscode from "vscode";
import * as https from "https";
import * as http from "http";
import { URL } from "url";
import { simpleGit } from "simple-git";

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

const DEFAULT_SYSTEM_PROMPT = `# Git 提交信息生成指南

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
4. 仅输出提交信息，不输出 markdown 代码块标记`;

// ─── i18n ───────────────────────────────────────────────────────────────────

const isZh = vscode.env.language.toLowerCase().startsWith("zh");
const t = (zh: string, en: string) => (isZh ? zh : en);

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
  return {
    apiBaseUrl: cfg
      .get<string>("apiBaseUrl", "https://api.openai.com/v1")
      .replace(/\/$/, ""),
    apiKey: cfg.get<string>("apiKey", ""),
    model: cfg.get<string>("model", "gpt-4o"),
    systemPrompt: cfg.get<string>("systemPrompt", ""),
    temperature: cfg.get<number>("temperature", 0.3),
    maxDiffChars: cfg.get<number>("maxDiffChars", 6000),
    timeoutMs: cfg.get<number>("timeoutMs", 30000),
  };
}

// ─── Git Helpers ────────────────────────────────────────────────────────────

async function getRepo(arg?: any): Promise<any> {
  const gitExtension = vscode.extensions.getExtension("vscode.git")?.exports;
  const api = gitExtension?.getAPI(1);
  if (!api) return null;

  if (arg?.rootUri) {
    const targetPath = arg.rootUri.fsPath;
    for (const repo of api.repositories) {
      if (targetPath.startsWith(repo.rootUri.fsPath)) {
        return repo;
      }
    }
  }
  return api.repositories?.[0] ?? null;
}

async function getDiffStaged(rootPath: string): Promise<string> {
  const git = simpleGit(rootPath);
  const diff = await git.diff(["--staged"]);
  return diff;
}

function truncateDiff(diff: string, maxChars: number): string {
  if (diff.length <= maxChars) return diff;
  return (
    diff.slice(0, maxChars) +
    `\n\n... [diff truncated: ${diff.length} chars → ${maxChars}]`
  );
}

// ─── LLM Call ────────────────────────────────────────────────────────────────

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

    const parsedUrl = new URL(`${baseUrl}/chat/completions`);
    const options: https.RequestOptions = {
      hostname: parsedUrl.hostname,
      port: parsedUrl.port || (parsedUrl.protocol === "https:" ? 443 : 80),
      path: parsedUrl.pathname + parsedUrl.search,
      method: "POST",
      timeout: timeoutMs,
      headers: {
        "Content-Type": "application/json",
        "Content-Length": Buffer.byteLength(payload),
        ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}),
      },
    };

    const transport = parsedUrl.protocol === "https:" ? https : http;
    const req = transport.request(options, (res) => {
      if (
        res.statusCode === undefined ||
        res.statusCode < 200 ||
        res.statusCode > 299
      ) {
        let errBody = "";
        res.on("data", (chunk) => (errBody += chunk));
        res.on("end", () => {
          reject(
            new Error(
              `API request failed (${res.statusCode}): ${errBody.slice(0, 300)}`,
            ),
          );
        });
        return;
      }

      let body = "";
      res.on("data", (chunk) => (body += chunk));
      res.on("end", () => {
        signal?.removeEventListener("abort", onAbort);
        try {
          const json = JSON.parse(body);
          if (json.error) {
            reject(new Error(json.error.message || JSON.stringify(json.error)));
            return;
          }
          const choice = json.choices?.[0]?.message;
          const message = (choice?.content ?? choice?.reasoning ?? "").trim();
          if (!message) {
            reject(new Error("Empty response from API. Raw: " + body));
            return;
          }
          resolve(message);
        } catch (e) {
          reject(new Error("Failed to parse API response: " + body));
        }
      });
    });

    const onAbort = () => {
      req.destroy();
      reject(new Error("Cancelled by user"));
    };

    req.on("timeout", () => {
      req.destroy();
      reject(new Error("Request timeout"));
    });
    req.on("error", (err) => {
      signal?.removeEventListener("abort", onAbort);
      reject(err);
    });
    signal?.addEventListener("abort", onAbort);
    req.write(payload);
    req.end();
  });
}

// ─── Main Command ───────────────────────────────────────────────────────────

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
      const status = await simpleGit(rootPath).status();
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
      repo.inputBox.value = hint;
      vscode.commands.executeCommand("workbench.view.scm");
    }
    Logger.warn(warning);
    vscode.window.showWarningMessage(warning);
    return;
  }

  // Only validate config once we have an actual diff to send.
  const config = getConfig();
  if (!config.apiKey) {
    Logger.warn("No API key configured");
    const action = await vscode.window.showErrorMessage(
      t("AI Commit：未配置 API Key。", "AI Commit: No API key configured."),
      t("打开设置", "Open Settings"),
    );
    if (action) {
      vscode.commands.executeCommand(
        "workbench.action.openSettings",
        "aiCommit.apiKey",
      );
    }
    return;
  }

  await vscode.window.withProgress(
    {
      location: vscode.ProgressLocation.SourceControl,
      title: t(
        "AI Commit Generator：正在生成提交信息…",
        "AI Commit Generator: Generating commit message…",
      ),
      cancellable: true,
    },
    async (_progress, token) => {
      const abortCtrl = new AbortController();
      token.onCancellationRequested(() => {
        Logger.info("Generation cancelled by user");
        abortCtrl.abort();
      });
      try {
        const diff = truncateDiff(rawDiff, config.maxDiffChars);

        const message = await callLLM(
          config.apiBaseUrl,
          config.apiKey,
          config.model,
          config.systemPrompt,
          config.temperature,
          diff,
          config.timeoutMs,
          abortCtrl.signal,
        );

        if (repo) {
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
        const msg = err instanceof Error ? err.message : String(err);
        Logger.error(`Failed to generate commit message: ${msg}`, err);
        vscode.window.showErrorMessage(
          t(`AI Commit：${msg}`, `AI Commit: ${msg}`),
        );
      }
    },
  );
}

// ─── Activation ──────────────────────────────────────────────────────────────

export function activate(context: vscode.ExtensionContext) {
  ConfigManager.getInstance(); // 初始化配置监听
  context.subscriptions.push(
    vscode.commands.registerCommand(
      "ai-commit.generateCommitMessage",
      (arg) => generateCommitMessage(arg),
    ),
  );
  Logger.info("Extension activated");
}

export function deactivate() {
  ConfigManager.getInstance().dispose();
}
