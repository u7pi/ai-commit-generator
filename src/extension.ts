import * as vscode from "vscode";
import { execSync } from "child_process";
import * as https from "https";
import * as http from "http";
import { URL } from "url";

// ─── Helpers ────────────────────────────────────────────────────────────────

function getConfig() {
  const cfg = vscode.workspace.getConfiguration("aiCommit");
  return {
    apiBaseUrl: cfg
      .get<string>("apiBaseUrl", "https://api.openai.com/v1")
      .replace(/\/$/, ""),
    apiKey: cfg.get<string>("apiKey", ""),
    model: cfg.get<string>("model", "gpt-4o"),
    systemPrompt: cfg.get<string>("systemPrompt", ""),
    maxDiffLines: cfg.get<number>("maxDiffLines", 500),
  };
}

function getWorkspaceRoot(): string | null {
  const folders = vscode.workspace.workspaceFolders;
  return folders && folders.length > 0 ? folders[0].uri.fsPath : null;
}

function runGit(cwd: string, args: string): string {
  const gitPath = vscode.workspace
    .getConfiguration("aiCommit")
    .get<string>("gitPath", "git");
  return execSync(`"${gitPath}" ${args}`, { cwd, encoding: "utf8" });
}

function truncateDiff(diff: string, maxLines: number): string {
  const lines = diff.split("\n");
  if (lines.length <= maxLines) return diff;
  return [
    ...lines.slice(0, maxLines),
    "",
    `... [diff truncated: showing ${maxLines} of ${lines.length} lines]`,
  ].join("\n");
}

// ─── LLM Call ────────────────────────────────────────────────────────────────

function callLLM(
  baseUrl: string,
  apiKey: string,
  model: string,
  systemPrompt: string,
  diff: string,
): Promise<string> {
  return new Promise((resolve, reject) => {
    const payload = JSON.stringify({
      model,
      max_tokens: 2048,
      messages: [
        {
          role: "user",
          content: `${systemPrompt}\n\nHere is the git diff:\n\n${diff}`,
        },
      ],
    });

    const parsedUrl = new URL(`${baseUrl}/chat/completions`);
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

    const transport = parsedUrl.protocol === "https:" ? https : http;
    const req = transport.request(options, (res) => {
      let body = "";
      res.on("data", (chunk) => (body += chunk));
      res.on("end", () => {
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

    req.on("error", reject);
    req.write(payload);
    req.end();
  });
}

// ─── Main Command ─────────────────────────────────────────────────────────────

async function generateCommitMessage() {
  const root = getWorkspaceRoot();
  if (!root) {
    vscode.window.showErrorMessage("AI Commit: No workspace folder open.");
    return;
  }

  // Validate config
  const config = getConfig();
  if (!config.apiKey) {
    const action = await vscode.window.showErrorMessage(
      "AI Commit: No API key configured.",
      "Open Settings",
    );
    if (action === "Open Settings") {
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
      title: "Generating commit message…",
      cancellable: false,
    },
    async () => {
      try {
        // 1. Stage everything
        runGit(root, "add --all");

        // 2. Get the staged diff
        const rawDiff = runGit(root, "diff --cached");
        if (!rawDiff.trim()) {
          vscode.window.showWarningMessage(
            "AI Commit: Nothing staged to commit.",
          );
          return;
        }

        // 3. Truncate if needed
        const diff = truncateDiff(rawDiff, config.maxDiffLines);

        // 4. Call the LLM
        const message = await callLLM(
          config.apiBaseUrl,
          config.apiKey,
          config.model,
          config.systemPrompt,
          diff,
        );

        // 5. Auto-fill the SCM commit message box
        const gitExtension =
          vscode.extensions.getExtension("vscode.git")?.exports;
        const api = gitExtension?.getAPI(1);
        const repo = api?.repositories?.[0];

        if (repo) {
          repo.inputBox.value = message;
          // Focus the Source Control panel so the user sees it
          vscode.commands.executeCommand("workbench.view.scm");
        } else {
          // Fallback: copy to clipboard
          await vscode.env.clipboard.writeText(message);
          vscode.window.showInformationMessage(
            "AI Commit: Message copied to clipboard (SCM repo not found).",
          );
        }
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        vscode.window.showErrorMessage(`AI Commit: ${msg}`);
      }
    },
  );
}

// ─── Activation ──────────────────────────────────────────────────────────────

export function activate(context: vscode.ExtensionContext) {
  context.subscriptions.push(
    vscode.commands.registerCommand(
      "ai-commit.generateCommitMessage",
      generateCommitMessage,
    ),
  );
}

export function deactivate() {}
