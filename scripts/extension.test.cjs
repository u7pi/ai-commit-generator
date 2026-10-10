const assert = require("node:assert/strict");
const fs = require("node:fs");
const http = require("node:http");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");
const { EventEmitter } = require("node:events");
const ts = require("typescript");

const source = fs.readFileSync(path.join(__dirname, "../src/extension.ts"), "utf8");
const js = ts.transpileModule(
  source + "\nexports.test = { getRepo, getDiffStaged, callLLM, generateCommitMessage, selectApiBaseUrl };",
  { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } },
).outputText;

function load(config = {}, repositories = [], diff = "+ staged change", language = "en") {
  const observed = { errors: [], gitOptions: [], statusCalls: 0, updates: [] };
  const vscode = {
    env: { language, clipboard: { writeText: async () => {} } },
    workspace: {
      workspaceFolders: [{ uri: { fsPath: process.cwd() } }],
      onDidChangeConfiguration: () => ({ dispose() {} }),
      getConfiguration: () => ({
        get: (key, fallback) => config[key] ?? fallback,
        inspect: () => ({ workspaceValue: config.workspaceValue }),
        update: async (key, value, target) => { observed.updates.push({ key, value, target }); },
      }),
    },
    extensions: { getExtension: () => ({ exports: { getAPI: () => ({ repositories }) } }) },
    window: {
      showErrorMessage: async (message) => observed.errors.push(message),
      showWarningMessage() {},
      showInformationMessage() {},
      withProgress: async (_options, callback) => callback({}, {
        onCancellationRequested: () => ({ dispose() {} }),
      }),
    },
    commands: { executeCommand: async () => {} },
    ProgressLocation: { SourceControl: 1 },
    ConfigurationTarget: { Global: 1, Workspace: 2 },
  };
  const context = {
    exports: {}, Buffer, AbortController, process,
    console: { log() {}, warn() {}, error() {} },
    require: (name) => name === "vscode" ? vscode : name === "simple-git" ? {
      simpleGit: (options) => {
        observed.gitOptions.push(options);
        return {
          diff: async () => diff,
          status: async () => { observed.statusCalls++; return { files: [{}] }; },
        };
      },
    } : require(name),
  };
  vm.runInNewContext(js, context);
  return { ...context.exports.test, observed, vscode };
}

function createPicker(extension) {
  const events = new EventEmitter();
  const picker = {
    items: [], selectedItems: [], disposed: false,
    onDidChangeValue: (callback) => events.on("change", callback),
    onDidAccept: (callback) => events.on("accept", callback),
    onDidHide: (callback) => events.on("hide", callback),
    show() {},
    hide: () => events.emit("hide"),
    dispose: () => { picker.disposed = true; events.removeAllListeners(); },
  };
  extension.vscode.window.createQuickPick = () => picker;
  return { picker, events };
}

function repo(root) {
  return { rootUri: { fsPath: path.resolve(root) }, inputBox: { value: "" } };
}

async function withServer(handler, run) {
  const server = http.createServer((req, res) => { req.resume(); handler(req, res); });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  try {
    await run(`http://127.0.0.1:${server.address().port}/v1`);
  } finally {
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
  }
}

function request(extension, baseUrl, signal) {
  return extension.callLLM(baseUrl, "", "test", "", 0.3, "diff", 100, signal);
}

test("manifest translations cover every referenced key and use matching key sets", () => {
  const manifest = require("../package.json");
  const en = require("../package.nls.json");
  const zh = require("../package.nls.zh-cn.json");
  const keys = [...JSON.stringify(manifest).matchAll(/"%([^%]+)%"/g)].map((match) => match[1]);
  assert.equal(manifest.contributes.configuration.properties["aiCommit.systemPrompt"].default, "");
  assert.deepEqual(Object.keys(en).sort(), Object.keys(zh).sort());
  for (const key of keys) {
    assert.equal(typeof en[key], "string", key);
    assert.ok(en[key].trim(), key);
    assert.equal(typeof zh[key], "string", key);
    assert.ok(zh[key].trim(), key);
  }
  for (const text of Object.values(en)) assert.doesNotMatch(text, /[\u4e00-\u9fff]/);
});

test("generation sends the locale default or the unchanged custom prompt", async () => {
  const customPrompt = "Always output in French. Keep this prompt exactly as supplied.\n";
  for (const language of ["en", "zh-cn", "zh-tw", "fr"]) {
    for (const systemPrompt of [undefined, "", customPrompt]) {
      let payload;
      await withServer((req, res) => {
        let body = "";
        req.setEncoding("utf8");
        req.on("data", (chunk) => { body += chunk; });
        req.on("end", () => {
          payload = JSON.parse(body);
          res.end(JSON.stringify({ choices: [{ message: { content: "feat: add locale support" } }] }));
        });
      }, async (baseUrl) => {
        const target = repo("app");
        const extension = load({ apiBaseUrl: baseUrl, systemPrompt }, [target], "+ staged change", language);
        await extension.generateCommitMessage(target);
        assert.equal(extension.observed.errors.length, 0);
        assert.equal(target.inputBox.value, "feat: add locale support");
        assert.equal(payload.messages[0].role, "system");
        const prompt = payload.messages[0].content;
        if (systemPrompt) {
          assert.equal(prompt, customPrompt);
        } else if (language === "zh-cn") {
          assert.match(prompt, /使用中文/);
        } else {
          assert.doesNotMatch(prompt, /[\u4e00-\u9fff]/);
          assert.match(prompt, /Write the subject and body in English/);
        }
      });
    }
  }
});

test("picker and empty-stage hints use Simplified Chinese only for zh-cn", async () => {
  for (const language of ["en", "zh-cn", "zh-tw", "fr"]) {
    const target = repo("app");
    const extension = load({}, [target], "", language);
    await extension.generateCommitMessage(target);
    const { picker, events } = createPicker(extension);
    const selection = extension.selectApiBaseUrl();
    assert.equal(picker.title, language === "zh-cn" ? "AI Commit：选择 API 地址" : "AI Commit: Select API Base URL");
    assert.equal(picker.placeholder, language === "zh-cn" ? "选择常用地址，或直接输入 http(s) URL" : "Select a preset or enter an http(s) URL");
    assert.equal(target.inputBox.value, language === "zh-cn" ? "⚠ 没有已暂存的更改，请先暂存更改" : "⚠ No staged changes — stage your changes first");
    events.emit("change", "https://");
    picker.selectedItems = [picker.items[0]];
    events.emit("accept");
    assert.equal(extension.observed.errors[0], language === "zh-cn" ? "请输入有效的 http(s) API 地址。" : "Enter a valid http(s) API URL.");
    picker.hide();
    await selection;
  }
});

test("SCM selects the exact normalized root for sibling and nested repositories", async () => {
  const parent = repo("app");
  const sibling = repo("app-tools");
  const nested = repo("app/nested");
  const extension = load({}, [parent, sibling, nested]);
  assert.equal(await extension.getRepo(sibling), sibling);
  assert.equal(await extension.getRepo(nested), nested);
  const target = { rootUri: { fsPath: path.join(sibling.rootUri.fsPath, "child", "..") + path.sep } };
  assert.equal(await extension.getRepo(target), sibling);
  if (process.platform === "win32") {
    assert.equal(await extension.getRepo({ rootUri: { fsPath: sibling.rootUri.fsPath.toUpperCase() } }), sibling);
  }
  assert.equal(await extension.getRepo(), parent);
});

test("interrupted success and error responses reject promptly", async () => {
  for (const status of [200, 500]) {
    await withServer((_req, res) => {
      res.writeHead(status);
      res.write('{"choices":[');
      setTimeout(() => res.destroy(), 20);
    }, async (baseUrl) => {
      const controller = new AbortController();
      let outcome = "pending";
      const result = request(load(), baseUrl, controller.signal).then(
        () => { outcome = "resolved"; }, () => { outcome = "rejected"; },
      );
      const timer = setTimeout(() => controller.abort(), 300);
      try {
        await new Promise((resolve) => setTimeout(resolve, 150));
        assert.equal(outcome, "rejected");
      } finally {
        clearTimeout(timer);
        controller.abort();
        await result;
      }
    });
  }
});

test("UTF-8 characters split across chunks are preserved in success and error bodies", async () => {
  for (const status of [200, 400]) {
    const message = "fix: 修复问题 😀";
    const body = status === 200 ? JSON.stringify({ choices: [{ message: { content: message } }] }) : message;
    await withServer((_req, res) => {
      res.writeHead(status);
      const bytes = Buffer.from(body);
      const split = bytes.indexOf(Buffer.from("修")) + 1;
      res.write(bytes.subarray(0, split));
      setTimeout(() => res.end(bytes.subarray(split)), 20);
    }, async (baseUrl) => {
      if (status === 200) {
        assert.equal(await request(load(), baseUrl), message);
      } else {
        await assert.rejects(request(load(), baseUrl), /API request failed \(400\): fix: 修复问题 😀/);
      }
    });
  }
});

test("configured gitPath is used for staged diff and unstaged status", async () => {
  const target = repo("app");
  const gitPath = path.resolve("custom/git.exe");
  const extension = load({ gitPath }, [target], "");
  await extension.generateCommitMessage(target);
  assert.equal(extension.observed.statusCalls, 1);
  assert.equal(extension.observed.gitOptions.length, 2);
  for (const options of extension.observed.gitOptions) {
    assert.equal(options.baseDir, target.rootUri.fsPath);
    assert.equal(options.binary, gitPath);
  }
});

test("a compatible API accepts an empty key without an Authorization header", async () => {
  let requests = 0;
  await withServer((req, res) => {
    requests++;
    assert.equal(req.headers.authorization, undefined);
    res.end(JSON.stringify({ choices: [{ message: { content: "fix: local commit" } }] }));
  }, async (baseUrl) => {
    const target = repo("app");
    const extension = load({ apiBaseUrl: baseUrl, apiKey: "" }, [target]);
    await extension.generateCommitMessage(target);
    assert.equal(requests, 1);
    assert.equal(target.inputBox.value, "fix: local commit");
    assert.equal(extension.observed.errors.length, 0);
  });
});

test("API picker saves each provider URL to user settings", async () => {
  const urls = {
    OpenAI: "https://api.openai.com/v1",
    Kimi: "https://api.moonshot.cn/v1",
    DeepSeek: "https://api.deepseek.com/v1",
    GLM: "https://open.bigmodel.cn/api/paas/v4",
    Ollama: "http://localhost:11434/v1",
  };
  for (const [label, url] of Object.entries(urls)) {
    const extension = load();
    const { picker, events } = createPicker(extension);
    const selection = extension.selectApiBaseUrl();
    picker.selectedItems = [picker.items.find((item) => item.label === label)];
    events.emit("accept");
    await selection;
    assert.deepEqual(extension.observed.updates, [{ key: "apiBaseUrl", value: url, target: 1 }]);
    assert.equal(picker.disposed, true);
  }
});

test("API picker accepts a typed custom URL and preserves workspace scope", async () => {
  const extension = load({ workspaceValue: "https://existing.example/v1" });
  const { picker, events } = createPicker(extension);
  const selection = extension.selectApiBaseUrl();
  events.emit("change", " https://custom.example/api/v1 ");
  picker.selectedItems = [picker.items[0]];
  events.emit("accept");
  await selection;
  assert.deepEqual(extension.observed.updates, [{
    key: "apiBaseUrl", value: "https://custom.example/api/v1", target: 2,
  }]);
});

test("API picker filtering, invalid input and cancellation leave settings unchanged", async () => {
  const extension = load();
  const { picker, events } = createPicker(extension);
  const selection = extension.selectApiBaseUrl();
  events.emit("change", "kimi");
  assert.equal(picker.items.length, 5);
  events.emit("change", "https://");
  picker.selectedItems = [picker.items[0]];
  events.emit("accept");
  assert.equal(extension.observed.errors.length, 1);
  assert.equal(picker.disposed, false);
  picker.hide();
  await selection;
  assert.equal(extension.observed.updates.length, 0);
  assert.equal(picker.disposed, true);
});
