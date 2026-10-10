const assert = require("node:assert/strict");
const fs = require("node:fs");
const http = require("node:http");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");
const { EventEmitter, getEventListeners } = require("node:events");
const ts = require("typescript");

const source = fs.readFileSync(path.join(__dirname, "../src/extension.ts"), "utf8");
const js = ts.transpileModule(
  source + "\nexports.test = { getRepo, getDiffStaged, callLLM, generateCommitMessage, selectApiBaseUrl };",
  { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } },
).outputText;

function load(config = {}, repositories = [], diff = "+ staged change", language = "en", options = {}) {
  const observed = {
    errors: [], warnings: [], infos: [], logs: [], progress: [], clipboard: [], gitOptions: [], diffCalls: 0, statusCalls: 0, updates: [],
    commands: new Map(), secretValues: new Map(options.secureKey ? [["aiCommit.apiKey", options.secureKey]] : []),
    secretOps: [], summaryArgs: [], inputOptions: [],
  };
  const vscode = {
    env: { language, clipboard: { writeText: async (value) => observed.clipboard.push(value) } },
    workspace: {
      workspaceFolders: [{ uri: { fsPath: process.cwd() } }],
      onDidChangeConfiguration: () => ({ dispose() {} }),
      getConfiguration: () => ({
        get: (key, fallback) => (key === "apiKey" ? config.keyWorkspaceValue ?? config[key] : config[key]) ?? fallback,
        inspect: (key) => key === "apiKey"
          ? { workspaceValue: config.keyWorkspaceValue, globalValue: config.apiKey }
          : { workspaceValue: config.workspaceValue },
        update: async (key, value, target) => {
          observed.updates.push({ key, value, target });
          if (options.updateError) throw new Error(options.updateError);
          if (key === "apiKey" && target === 2) config.keyWorkspaceValue = value;
          else config[key] = value;
        },
      }),
    },
    extensions: { getExtension: () => ({ exports: { getAPI: () => ({ repositories }) } }) },
    window: {
      showErrorMessage: async (message) => observed.errors.push(message),
      showWarningMessage: async (message, ...items) => {
        observed.warnings.push(message);
        if (typeof options.migrate === "function") return options.migrate(items);
        return options.migrate ? items[0] : undefined;
      },
      showInformationMessage: async (message) => { observed.infos.push(message); },
      showInputBox: async (inputOptions) => { observed.inputOptions.push(inputOptions); return options.input; },
      withProgress: async (options, callback) => {
        const events = new EventEmitter();
        let cancelled = false;
        const progress = { options, disposed: false, cancel() { cancelled = true; events.emit("cancel"); } };
        observed.progress.push(progress);
        return callback({}, {
          get isCancellationRequested() { return cancelled; },
          onCancellationRequested: (handler) => {
            events.on("cancel", handler);
            return { dispose() { progress.disposed = true; events.removeListener("cancel", handler); } };
          },
        });
      },
    },
    commands: {
      executeCommand: async () => {},
      registerCommand: (name, callback) => { observed.commands.set(name, callback); return { dispose() {} }; },
    },
    ProgressLocation: { SourceControl: 1, Notification: 15 },
    ConfigurationTarget: { Global: 1, Workspace: 2 },
  };
  const context = {
    exports: {}, Buffer, AbortController, process, setTimeout, clearTimeout,
    console: {
      log: (...args) => observed.logs.push(args.map(String).join(" ")),
      warn: (...args) => observed.logs.push(args.map(String).join(" ")),
      error: (...args) => observed.logs.push(args.map(String).join(" ")),
    },
    require: (name) => name === "vscode" ? vscode : name === "simple-git" ? {
      simpleGit: (gitOptions) => {
        observed.gitOptions.push(gitOptions);
        return {
          diff: async () => { observed.diffCalls++; return typeof diff === "function" ? diff() : diff; },
          status: async () => { observed.statusCalls++; return { files: [{}] }; },
          diffSummary: async (args) => { observed.summaryArgs.push(args); return options.summary ?? { files: [] }; },
        };
      },
    } : require(name),
  };
  vm.runInNewContext(js, context);
  const secrets = {
    get: async (key) => { observed.secretOps.push("get"); return observed.secretValues.get(key); },
    store: async (key, value) => {
      observed.secretOps.push("store");
      if (options.storeError) throw new Error(options.storeError);
      observed.secretValues.set(key, value);
    },
    delete: async (key) => {
      observed.secretOps.push("delete");
      if (options.deleteError) throw new Error(options.deleteError);
      observed.secretValues.delete(key);
    },
  };
  context.exports.activate({ subscriptions: [], secrets });
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

function deferred() {
  let resolve;
  const promise = new Promise((done) => { resolve = done; });
  return { promise, resolve };
}

function reply(res, content = "fix: generated message") {
  res.end(JSON.stringify({ choices: [{ message: { content } }] }));
}

test("duplicate generation is blocked before reading the staged diff", async () => {
  const reading = deferred();
  const release = deferred();
  let requests = 0;
  await withServer((_req, res) => { requests++; reply(res); }, async (baseUrl) => {
    const target = repo("app");
    const extension = load({ apiBaseUrl: baseUrl }, [target], async () => {
      reading.resolve();
      await release.promise;
      return "+ staged change";
    });
    const first = extension.generateCommitMessage(target);
    await reading.promise;
    const duplicate = extension.generateCommitMessage(target);
    // Release even on the original implementation, where both calls read Git.
    await new Promise((resolve) => setImmediate(resolve));
    const diffCalls = extension.observed.diffCalls;
    release.resolve();
    await Promise.all([first, duplicate]);
    assert.equal(diffCalls, 1);
    assert.equal(requests, 1);
    assert.match(extension.observed.infos[0], /already.*generating/i);
  });
});

test("different repositories can generate concurrently", async () => {
  const bothArrived = deferred();
  const responses = [];
  await withServer((_req, res) => {
    responses.push(res);
    if (responses.length === 2) bothArrived.resolve();
  }, async (baseUrl) => {
    const targets = [repo("first"), repo("second")];
    const extension = load({ apiBaseUrl: baseUrl }, targets);
    const generations = targets.map((target) => extension.generateCommitMessage(target));
    await bothArrived.promise;
    responses.forEach((res) => reply(res));
    await Promise.all(generations);
    for (const target of targets) assert.equal(target.inputBox.value, "fix: generated message");
  });
});

test("a draft edited during Git or API work is preserved", async () => {
  for (const phase of ["git", "api"]) {
    const target = repo("app");
    target.inputBox.value = "initial draft";
    await withServer((_req, res) => {
      if (phase === "api") target.inputBox.value = "user edited draft";
      reply(res);
    }, async (baseUrl) => {
      const extension = load({ apiBaseUrl: baseUrl }, [target], async () => {
        if (phase === "git") target.inputBox.value = "user edited draft";
        return "+ staged change";
      });
      await extension.generateCommitMessage(target);
      assert.equal(target.inputBox.value, "user edited draft");
      assert.match(extension.observed.infos[0], /draft.*changed/i);
    });
  }
});

test("an empty staged diff leaves an existing draft intact", async () => {
  const target = repo("app");
  target.inputBox.value = "fix: my draft";
  const extension = load({}, [target], "");
  await extension.generateCommitMessage(target);
  assert.equal(target.inputBox.value, "fix: my draft");
  assert.equal(extension.observed.progress.length, 0);
});

test("generation uses cancellable notifications and can retry after cancellation or failure", async () => {
  for (const failure of ["cancel", "api", "git", "empty"]) {
    const arrived = deferred();
    let calls = 0;
    await withServer((_req, res) => {
      calls++;
      if (calls === 1 && failure === "cancel") { arrived.resolve(); return; }
      if (calls === 1 && failure === "api") { res.writeHead(500); res.end("failure"); return; }
      reply(res);
    }, async (baseUrl) => {
      const target = repo("app");
      let gitCalls = 0;
      const extension = load({ apiBaseUrl: baseUrl }, [target], () => {
        gitCalls++;
        if (gitCalls === 1 && failure === "git") throw new Error("git failed");
        return gitCalls === 1 && failure === "empty" ? "" : "+ staged change";
      });
      const first = extension.generateCommitMessage(target);
      if (failure === "cancel") {
        await arrived.promise;
        extension.observed.progress[0].cancel();
      }
      await first;
      if (failure === "cancel") {
        assert.equal(extension.observed.errors.length, 0);
        assert.equal(target.inputBox.value, "");
      }
      await extension.generateCommitMessage(target);
      assert.equal(target.inputBox.value, "fix: generated message");
      for (const progress of extension.observed.progress) {
        assert.equal(progress.options.location, 15);
        assert.equal(progress.options.cancellable, true);
        assert.equal(progress.disposed, true);
      }
    });
  }
});

test("an already cancelled signal does not send a request", async () => {
  let requests = 0;
  await withServer((_req, res) => { requests++; reply(res); }, async (baseUrl) => {
    const controller = new AbortController();
    controller.abort();
    await assert.rejects(request(load(), baseUrl, controller.signal), { name: "AbortError" });
    assert.equal(requests, 0);
  });
});

test("total deadline applies to silent and continuously trickling responses", async () => {
  for (const trickle of [false, true]) {
    await withServer((_req, res) => {
      let interval;
      if (trickle) {
        res.writeHead(200);
        res.write(" ");
        interval = setInterval(() => res.write(" "), 15);
      }
      const finish = setTimeout(() => { clearInterval(interval); reply(res); }, 700);
      res.on("close", () => { clearInterval(interval); clearTimeout(finish); });
    }, async (baseUrl) => {
      await assert.rejects(load().callLLM(baseUrl, "", "test", "", 0.3, "diff", 150), /Request timeout/);
    });
  }
});

test("completed success and failure requests release their abort listeners", async () => {
  for (const status of [200, 500]) {
    await withServer((_req, res) => {
      res.writeHead(status);
      if (status === 200) reply(res);
      else res.end("failure");
    }, async (baseUrl) => {
      const controller = new AbortController();
      const result = request(load(), baseUrl, controller.signal);
      if (status === 200) assert.equal(await result, "fix: generated message");
      else await assert.rejects(result, /500/);
      assert.equal(getEventListeners(controller.signal, "abort").length, 0);
    });
  }
});

test("API URLs append the endpoint to the path and retain query parameters", async () => {
  const urls = [];
  await withServer((req, res) => { urls.push(req.url); reply(res); }, async (baseUrl) => {
    for (const suffix of ["", "/", "///", "/?api-version=test#fragment"]) {
      await request(load(), baseUrl + suffix);
    }
  });
  assert.deepEqual(urls, ["/v1/chat/completions", "/v1/chat/completions", "/v1/chat/completions", "/v1/chat/completions?api-version=test"]);
  await assert.rejects(request(load(), "ftp://127.0.0.1/v1"), /http\(s\)/i);
});

test("only final nonempty text is accepted and truncated output is rejected", async () => {
  const choices = [
    { message: { content: null, reasoning: "internal analysis" } },
    { message: { content: "   " } },
    { message: { content: ["not a string"] } },
    { finish_reason: "length", message: { content: "fix: unfinished" } },
  ];
  for (const choice of choices) {
    await withServer((_req, res) => res.end(JSON.stringify({ choices: [choice] })), async (baseUrl) => {
      await assert.rejects(request(load(), baseUrl), /empty|text|truncated/i);
    });
  }
});

test("invalid numeric configuration fails before sending an API request", async () => {
  let requests = 0;
  await withServer((_req, res) => { requests++; reply(res); }, async (baseUrl) => {
    for (const language of ["en", "zh-cn"]) {
      for (const [key, values] of Object.entries({
        maxDiffChars: [0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY],
        timeoutMs: [0, -1, 1.5, 2147483648],
        temperature: [-0.5, -2, 2.1, Number.NaN],
      })) {
        for (const value of values) {
          const target = repo("app");
          const extension = load({ apiBaseUrl: baseUrl, [key]: value }, [target], "+ staged change", language);
          await extension.generateCommitMessage(target);
          assert.match(extension.observed.errors[0], new RegExp(key));
          assert.equal(target.inputBox.value, "");
          if (language === "zh-cn") assert.match(extension.observed.errors[0], /[\u4e00-\u9fff]/);
        }
      }
    }
  });
  assert.equal(requests, 0);
});

test("password commands store one global key and clear only secure storage", async () => {
  for (const input of [undefined, "", "   ", " new-secret "]) {
    const extension = load({ apiKey: "legacy-secret" }, [], "diff", "en", { input, secureKey: "old-secret" });
    await extension.observed.commands.get("ai-commit.setApiKey")();
    assert.equal(extension.observed.inputOptions[0].password, true);
    assert.equal(extension.observed.secretValues.get("aiCommit.apiKey"), input?.trim() ? "new-secret" : "old-secret");
    await extension.observed.commands.get("ai-commit.clearApiKey")();
    assert.equal(extension.observed.secretValues.has("aiCommit.apiKey"), false);
    assert.equal(extension.observed.updates.length, 0);
    assert.equal(extension.observed.warnings.length, 0);
  }
});

test("stored key takes precedence and migration clears only the confirmed source", async () => {
  for (const mode of ["stored", "global", "workspace", "declined", "store-failed", "clear-failed"]) {
    const headers = [];
    await withServer((req, res) => { headers.push(req.headers.authorization); reply(res); }, async (baseUrl) => {
      const target = repo("app");
      const config = { apiBaseUrl: baseUrl, apiKey: "legacy-secret" };
      if (mode === "workspace") config.keyWorkspaceValue = "workspace-secret";
      const options = {
        secureKey: mode === "stored" ? "secure-secret" : undefined,
        migrate: mode !== "declined",
        storeError: mode === "store-failed" ? "legacy-secret" : undefined,
        updateError: mode === "clear-failed" ? "legacy-secret" : undefined,
      };
      const extension = load(config, [target], "diff", "en", options);
      await extension.generateCommitMessage(target);
      await extension.generateCommitMessage(target);
      const expectedKey = mode === "stored" ? "secure-secret" : mode === "workspace" ? "workspace-secret" : "legacy-secret";
      assert.deepEqual(headers, [`Bearer ${expectedKey}`, `Bearer ${expectedKey}`]);
      assert.equal(extension.observed.warnings.length, mode === "stored" ? 0 : 1);
      const shouldStore = !["stored", "declined", "store-failed"].includes(mode);
      assert.equal(extension.observed.secretValues.get("aiCommit.apiKey"), mode === "stored" ? "secure-secret" : shouldStore ? expectedKey : undefined);
      if (shouldStore) {
        assert.deepEqual(extension.observed.updates, [{ key: "apiKey", value: undefined, target: mode === "workspace" ? 2 : 1 }]);
      } else {
        assert.equal(extension.observed.updates.length, 0);
      }
      assert.equal(config.apiKey, mode === "global" ? undefined : "legacy-secret");
      assert.equal(extension.observed.errors.length, ["store-failed", "clear-failed"].includes(mode) ? 1 : 0);
      for (const message of [...extension.observed.errors, ...extension.observed.warnings, ...extension.observed.infos, ...extension.observed.logs]) {
        assert.ok(!message.includes(expectedKey));
      }
    });
  }
});

test("empty staged changes never read secrets or offer migration", async () => {
  const target = repo("app");
  const extension = load({ apiKey: "legacy-secret" }, [target], "", "en", { migrate: true });
  await extension.generateCommitMessage(target);
  assert.equal(extension.observed.secretOps.length, 0);
  assert.equal(extension.observed.updates.length, 0);
  assert.equal(extension.observed.warnings.length, 1);
  assert.ok(!extension.observed.warnings[0].includes("migrate"));
});

test("parallel repositories share a single migration prompt", async () => {
  const prompted = deferred();
  const answer = deferred();
  await withServer((_req, res) => reply(res), async (baseUrl) => {
    const targets = [repo("first"), repo("second")];
    const extension = load({ apiBaseUrl: baseUrl, apiKey: "legacy-secret" }, targets, "diff", "en", {
      migrate: (items) => { prompted.resolve(items[0]); return answer.promise; },
    });
    const work = targets.map((target) => extension.generateCommitMessage(target));
    // The original implementation never offers migration, so avoid waiting indefinitely.
    await new Promise((resolve) => setImmediate(resolve));
    if (extension.observed.warnings.length) answer.resolve(await prompted.promise);
    await Promise.all(work);
    assert.equal(extension.observed.warnings.length, 1);
    assert.equal(extension.observed.secretOps.filter((op) => op === "store").length, 1);
  });
});

test("key command failures and provider errors never display or log the key", async () => {
  for (const language of ["en", "zh-cn"]) {
    const extension = load({}, [], "diff", language, { input: "private-key", storeError: "private-key", deleteError: "private-key" });
    await extension.observed.commands.get("ai-commit.setApiKey")();
    await extension.observed.commands.get("ai-commit.clearApiKey")();
    assert.equal(extension.observed.errors.length, 2);
    for (const message of extension.observed.errors) {
      assert.ok(!message.includes("private-key"));
      if (language === "zh-cn") assert.match(message, /[\u4e00-\u9fff]/);
    }
    await withServer((_req, res) => { res.writeHead(401); res.end("invalid private-key"); }, async (baseUrl) => {
      const target = repo("app");
      const generation = load({ apiBaseUrl: baseUrl }, [target], "diff", language, { secureKey: "private-key" });
      await generation.generateCommitMessage(target);
      assert.equal(generation.observed.errors.length, 1);
      for (const message of [...generation.observed.errors, ...generation.observed.logs]) assert.ok(!message.includes("private-key"));
    });
    await withServer((_req, res) => res.end(JSON.stringify({ error: { message: "invalid private-key" } })), async (baseUrl) => {
      const target = repo("app");
      const generation = load({ apiBaseUrl: baseUrl }, [target], "diff", language, { secureKey: "private-key" });
      await generation.generateCommitMessage(target);
      assert.equal(generation.observed.errors.length, 1);
      for (const message of [...generation.observed.errors, ...generation.observed.logs]) assert.ok(!message.includes("private-key"));
    });
  }
});

test("long diffs retain later file summaries and binary markers within the total budget", async () => {
  const payloads = [];
  await withServer((req, res) => {
    let body = "";
    req.setEncoding("utf8");
    req.on("data", (chunk) => { body += chunk; });
    req.on("end", () => { payloads.push(JSON.parse(body)); reply(res); });
  }, async (baseUrl) => {
    const rawDiff = "diff --git a/first.ts b/first.ts\n" + "+ first file content\n".repeat(500);
    const summary = { files: [
      { file: "first.ts", insertions: 500, deletions: 0, binary: false },
      { file: "later.ts", insertions: 2, deletions: 1, binary: false },
      { file: "icon.png", before: 12, after: 24, binary: true },
    ] };
    for (const maxDiffChars of [1, 30, 100, 600]) {
      const target = repo("app");
      const gitPath = path.resolve("custom/git.exe");
      const extension = load({ apiBaseUrl: baseUrl, maxDiffChars, gitPath }, [target], rawDiff, "en", { summary });
      await extension.generateCommitMessage(target);
      const diff = payloads.at(-1).messages[1].content.replace("Here is the git diff:\n\n", "");
      assert.ok(diff.length <= maxDiffChars);
      assert.equal(extension.observed.summaryArgs.length, 1);
      assert.equal(JSON.stringify(extension.observed.summaryArgs[0]), '["--staged"]');
      for (const options of extension.observed.gitOptions) assert.equal(options.binary, gitPath);
      if (maxDiffChars === 600) {
        assert.match(diff, /later\.ts.*\+2.*-1/);
        assert.match(diff, /icon\.png.*binary/);
        assert.match(diff, /diff --git a\/first/);
        assert.match(diff, /truncated/);
      }
    }
    const target = repo("app");
    const extension = load({ apiBaseUrl: baseUrl, maxDiffChars: 40 }, [target], "+ small diff");
    await extension.generateCommitMessage(target);
    assert.equal(extension.observed.summaryArgs.length, 0);
    assert.equal(payloads.at(-1).messages[1].content, "Here is the git diff:\n\n+ small diff");
  });
});

test("oversized file lists report omission without exceeding the diff limit", async () => {
  let payload;
  await withServer((req, res) => {
    let body = "";
    req.on("data", (chunk) => { body += chunk; });
    req.on("end", () => { payload = JSON.parse(body); reply(res); });
  }, async (baseUrl) => {
    const summary = { files: Array.from({ length: 100 }, (_, index) => ({ file: `file-${index}.ts`, insertions: 1, deletions: 0, binary: false })) };
    const target = repo("app");
    const extension = load({ apiBaseUrl: baseUrl, maxDiffChars: 600 }, [target], "x".repeat(2000), "en", { summary });
    await extension.generateCommitMessage(target);
    const diff = payload.messages[1].content.replace("Here is the git diff:\n\n", "");
    assert.ok(diff.length <= 600);
    assert.match(diff, /files omitted/);
    assert.match(diff, /file-0\.ts/);
    assert.ok(!diff.includes("file-99.ts"));
  });
});
