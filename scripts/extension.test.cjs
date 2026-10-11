const assert = require("node:assert/strict");
const fs = require("node:fs");
const http = require("node:http");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");
const { createRequire } = require("node:module");
const { spawn } = require("node:child_process");
const { EventEmitter, getEventListeners } = require("node:events");
const ts = require("typescript");

const source = fs.readFileSync(path.join(__dirname, "../src/extension.ts"), "utf8");
const js = ts.transpileModule(
  source + "\nexports.test = { getRepo, getDiffStaged, getApiKey, callLLM, generateCommitMessage, selectApiBaseUrl, testConnection, DEFAULT_SYSTEM_PROMPT_EN, CLEARABLE_SETTINGS };",
  { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } },
).outputText;

function load(config = {}, repositories = [], diff = "+ staged change", language = "en", options = {}) {
  const observed = {
    errors: [], warnings: [], infos: [], logs: [], progress: [], clipboard: [], gitOptions: [], diffCalls: 0, statusCalls: 0, updates: [], executed: [],
    commands: new Map(), secretValues: new Map(options.secureKey ? [["aiCommit.apiKey", options.legacyStored ? options.secureKey : boundKey(config.apiBaseUrl, options.secureKey)]] : []),
    secretOps: [], summaryArgs: [], inputOptions: [],
  };
  const configurationEvents = new EventEmitter();
  const closeEvents = new EventEmitter();
  const folderList = options.folders === undefined
    ? [{ uri: { fsPath: process.cwd() } }]
    : options.folders.map((folder) => ({ uri: { fsPath: folder.fsPath }, name: folder.name }));
  const vscode = {
    env: { language, clipboard: { writeText: async (value) => observed.clipboard.push(value) } },
    workspace: {
      workspaceFolders: folderList.length ? folderList : undefined,
      workspaceFile: options.workspaceFile ? { fsPath: options.workspaceFile, scheme: "file" } : undefined,
      onDidChangeConfiguration: (handler) => {
        configurationEvents.on("change", handler);
        return { dispose() { configurationEvents.off("change", handler); } };
      },
      getConfiguration: (section, scopeUri) => {
        if (options.scopes) {
          const buckets = options.scopes;
          const folderPath = scopeUri?.fsPath ?? undefined;
          const folderBucket = folderPath !== undefined ? ((buckets.folders ??= {})[folderPath] ??= {}) : undefined;
          const bucketFor = (target) => target === 3 ? folderBucket : target === 2 ? (buckets.workspace ??= {}) : (buckets.global ??= {});
          return {
            get: (key, fallback) => (folderBucket?.[key] ?? buckets.workspace?.[key] ?? buckets.global?.[key]) ?? fallback,
            inspect: (key) => ({ globalValue: buckets.global?.[key], workspaceValue: buckets.workspace?.[key], workspaceFolderValue: folderBucket?.[key] }),
            update: async (key, value, target) => {
              observed.updates.push({ key, value, target, folder: folderPath });
              if (typeof options.updateError === "function") await options.updateError(key, value, target);
              else if (options.updateError) throw new Error(options.updateError);
              const bucket = bucketFor(target);
              if (!bucket) throw new Error("WorkspaceFolder target requires a scoped configuration");
              bucket[key] = value;
              configurationEvents.emit("change", { affectsConfiguration: () => true });
            },
          };
        }
        const snapshot = options.snapshotConfig ? { ...config } : config;
        return {
          get: (key, fallback) => (key === "apiKey" ? snapshot.keyWorkspaceValue ?? snapshot[key] : snapshot[key]) ?? fallback,
          inspect: (key) => key === "apiKey"
            ? { workspaceValue: snapshot.keyWorkspaceValue, globalValue: snapshot.apiKey }
            : { workspaceValue: snapshot.workspaceValue },
          update: async (key, value, target) => {
            observed.updates.push({ key, value, target });
            if (typeof options.updateError === "function") await options.updateError(key, value, target);
            else if (options.updateError) throw new Error(options.updateError);
            if (key === "apiKey" && target === 2) config.keyWorkspaceValue = value;
            else config[key] = value;
            configurationEvents.emit("change", { affectsConfiguration: () => true });
          },
        };
      },
    },
    extensions: { getExtension: () => options.gitUnavailable ? undefined : ({ exports: { enabled: !options.gitDisabled, getAPI: () => {
      if (options.gitApiError) throw new Error("Git model not found");
      return { repositories, onDidCloseRepository: (handler) => {
        closeEvents.on("close", handler);
        return { dispose() { closeEvents.off("close", handler); } };
      } };
    } } }) },
    window: {
      showErrorMessage: async (message, ...items) => {
        observed.errors.push(message);
        if (typeof options.errorAction === "function") return options.errorAction(items);
        return undefined;
      },
      showWarningMessage: async (message, ...items) => {
        observed.warnings.push(message);
        items = items.filter(item => typeof item === "string");
        if (typeof options.migrate === "function") return options.migrate(items);
        return options.migrate ? items[0] : undefined;
      },
      showInformationMessage: async (message, ...items) => {
        observed.infos.push(message);
        if (typeof options.infoAction === "function") return options.infoAction(items);
        return undefined;
      },
      showInputBox: async (inputOptions) => { observed.inputOptions.push(inputOptions); return typeof options.input === "function" ? options.input(inputOptions) : options.input; },
      withProgress: async (options, callback) => {
        const events = new EventEmitter();
        let cancelled = false;
        const progress = { options, disposed: false, closed: false, cancel() { cancelled = true; events.emit("cancel"); } };
        observed.progress.push(progress);
        try { return await callback({}, {
          get isCancellationRequested() { return cancelled; },
          onCancellationRequested: (handler) => {
            events.on("cancel", handler);
            return { dispose() { progress.disposed = true; events.removeListener("cancel", handler); } };
          },
        }); } finally { progress.closed = true; }
      },
    },
    commands: {
      executeCommand: async (name) => { observed.executed.push(name); },
      registerCommand: (name, callback) => { observed.commands.set(name, callback); return { dispose() {} }; },
    },
    ProgressLocation: { SourceControl: 1, Notification: 15 },
    ConfigurationTarget: { Global: 1, Workspace: 2, WorkspaceFolder: 3 },
  };
  const context = {
    exports: {}, Buffer, AbortController, process, setTimeout, clearTimeout,
    console: {
      log: (...args) => observed.logs.push(args.map(String).join(" ")),
      warn: (...args) => observed.logs.push(args.map(String).join(" ")),
      error: (...args) => observed.logs.push(args.map(String).join(" ")),
    },
    require: (name) => name === "vscode" ? vscode : name === "simple-git" ? options.realGit ?? {
      simpleGit: (gitOptions) => {
        observed.gitOptions.push(gitOptions);
        return {
          diff: async () => { observed.diffCalls++; return typeof diff === "function" ? diff(gitOptions, observed.diffCalls) : diff; },
          status: async () => { observed.statusCalls++; return { files: options.noChanges ? [] : [{}] }; },
          diffSummary: async (args) => { observed.summaryArgs.push(args); return typeof options.summary === "function" ? options.summary(gitOptions) : options.summary ?? { files: [] }; },
        };
      },
    } : require(name),
  };
  vm.runInNewContext(js, context);
  const secrets = {
    get: async (key) => { observed.secretOps.push("get"); return observed.secretValues.get(key); },
    store: async (key, value) => {
      observed.secretOps.push("store");
      if (typeof options.storeError === "function") await options.storeError(key, value);
      else if (options.storeError) throw new Error(options.storeError);
      observed.secretValues.set(key, value);
    },
    delete: async (key) => {
      observed.secretOps.push("delete");
      if (typeof options.deleteError === "function") await options.deleteError(key);
      else if (options.deleteError) throw new Error(options.deleteError);
      observed.secretValues.delete(key);
    },
  };
  const subscriptions = [];
  const ready = Promise.resolve(context.exports.activate({ subscriptions, secrets }));
  return { ...context.exports.test, observed, vscode, subscriptions, ready, deactivate: context.exports.deactivate,
    changeConfiguration() { configurationEvents.emit("change", { affectsConfiguration: () => true }); },
    closeRepo(target) { closeEvents.emit("close", target); },
  };
}

function boundKey(baseUrl = "https://api.deepseek.com/v1", key = "secure-secret") {
  const url = new URL(baseUrl);
  url.pathname = url.pathname.replace(/\/+$/, "") + "/chat/completions";
  return JSON.stringify({ version: 1, key, endpoint: url.origin + url.pathname + url.search });
}

function storedKey(extension) {
  const value = extension.observed.secretValues.get("aiCommit.apiKey");
  if (!value) return undefined;
  try { return JSON.parse(value).key; } catch { return value; }
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
  const events = new EventEmitter();
  return { rootUri: { fsPath: path.resolve(root) }, inputBox: { value: "", placeholder: "Original placeholder" },
    state: { indexChanges: [], onDidChange(handler) { events.on("change", handler); return { dispose() { events.off("change", handler); } }; } },
    changeState() { events.emit("change"); }, listenerCount() { return events.listenerCount("change"); },
  };
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
  const { DEFAULT_SYSTEM_PROMPT_EN, CLEARABLE_SETTINGS } = load();
  const props = manifest.contributes.configuration.properties;
  const prop = (name) => props[Object.keys(props).find((key) => key.endsWith("." + name))];
  assert.deepEqual([...CLEARABLE_SETTINGS].sort(), Object.keys(props).map((key) => key.slice(key.indexOf(".") + 1)).sort());
  assert.equal(prop("systemPrompt").default, DEFAULT_SYSTEM_PROMPT_EN);
  assert.equal(prop("apiBaseUrl").default, "https://api.deepseek.com/v1");
  assert.equal(prop("apiBaseUrl").order, 1);
  assert.equal(prop("apiKey").order, 2);
  assert.equal(prop("model").order, 3);
  assert.ok(manifest.activationEvents.includes("onStartupFinished"));
  assert.equal(prop("apiKey").markdownDeprecationMessage, undefined);
  assert.ok(!JSON.stringify(manifest.contributes.menus).includes("clearAllData"));
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
  const enDefault = require("../package.json").contributes.configuration.properties["aiCommit.systemPrompt"].default;
  for (const language of ["en", "zh-cn", "zh-tw", "fr"]) {
    for (const systemPrompt of [undefined, "", enDefault, customPrompt]) {
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
        if (systemPrompt === customPrompt) {
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
    assert.equal(target.inputBox.value, "");
    assert.equal(target.inputBox.placeholder, language === "zh-cn" ? "请先暂存更改，再生成提交信息" : "Stage your changes first, then generate a commit message");
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
  assert.equal(extension.observed.progress.length, 1);
  assert.ok(extension.observed.progress[0].closed);
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
        extension.observed.progress.at(-1).cancel();
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

test("the default temperature is omitted and an explicit value is sent", async () => {
  const payloads = [];
  await withServer((req, res) => {
    let body = "";
    req.setEncoding("utf8");
    req.on("data", (chunk) => { body += chunk; });
    req.on("end", () => { payloads.push(JSON.parse(body)); reply(res); });
  }, async (baseUrl) => {
    for (const [settings, expected] of [[{}, undefined], [{ temperature: 0.7 }, 0.7]]) {
      const target = repo("app");
      const extension = load({ apiBaseUrl: baseUrl, ...settings }, [target]);
      await extension.generateCommitMessage(target);
      assert.equal(payloads.at(-1).temperature, expected);
    }
  });
});

test("password commands store one key and mirror or clear the settings mask", async () => {
  for (const input of [undefined, "", "   ", " new-secret "]) {
    const extension = load({ apiKey: "legacy-secret" }, [], "diff", "en", { input, secureKey: "old-secret" });
    await extension.observed.commands.get("ai-commit.setApiKey")();
    assert.equal(extension.observed.inputOptions[0].password, true);
    const trimmed = input?.trim();
    assert.equal(storedKey(extension), trimmed ? "new-secret" : "old-secret");
    assert.match(extension.observed.inputOptions[0].prompt, /api\.deepseek\.com/);
    // Storing via the command replaces any plaintext with the ***** mask; blank input leaves settings untouched.
    assert.deepEqual(extension.observed.updates, trimmed ? [{ key: "apiKey", value: "*****", target: 1 }] : []);
    await extension.observed.commands.get("ai-commit.clearApiKey")();
    assert.equal(extension.observed.secretValues.has("aiCommit.apiKey"), false);
    // Clearing removes the mask mirror but keeps a real plaintext setting.
    assert.deepEqual(extension.observed.updates, trimmed
      ? [{ key: "apiKey", value: "*****", target: 1 }, { key: "apiKey", value: undefined, target: 1 }]
      : []);
    assert.equal(extension.observed.warnings.length, 0);
  }
});

test("plaintext settings key imports into secure storage with confirmation and masks the field", async () => {
  for (const mode of ["global", "workspace", "declined", "store-failed", "clear-failed", "stored-same", "stored-differs", "stored-differs-store-failed"]) {
    const headers = [];
    await withServer((req, res) => { headers.push(req.headers.authorization); reply(res); }, async (baseUrl) => {
      const target = repo("app");
      const workspace = mode === "workspace";
      const config = { apiBaseUrl: baseUrl, apiKey: workspace ? undefined : "legacy-secret" };
      if (workspace) config.keyWorkspaceValue = "workspace-secret";
      const hasStored = mode.startsWith("stored");
      const stored = mode === "stored-same" ? "legacy-secret" : hasStored ? "secure-secret" : undefined;
      const accept = !mode.includes("declined");
      const extension = load(config, [target], "diff", "en", {
        secureKey: stored,
        migrate: accept ? true : items => items[1],
        storeError: mode.endsWith("store-failed") ? "legacy-secret" : undefined,
        updateError: mode === "clear-failed" ? "legacy-secret" : undefined,
      });
      await extension.generateCommitMessage(target);
      await extension.generateCommitMessage(target);
      const adoptFailed = mode === "stored-differs-store-failed";
      const effectiveKey = workspace ? "workspace-secret"
        : hasStored && (!accept || adoptFailed) ? "secure-secret"
        : "legacy-secret";
      assert.deepEqual(headers, mode.endsWith("store-failed") ? [] : [`Bearer ${effectiveKey}`, `Bearer ${effectiveKey}`], mode);
      // Only the initial import into empty secure storage prompts; a differing
      // plaintext key with a stored key is adopted automatically.
      assert.equal(extension.observed.warnings.length, hasStored ? 0 : mode === "store-failed" ? 2 : 1, mode);
      const storedNow = ["declined", "store-failed"].includes(mode) ? undefined
        : adoptFailed ? "secure-secret"
        : effectiveKey;
      assert.equal(storedKey(extension), storedNow, mode);
      const expectedUpdates = ["declined", "store-failed", "stored-differs-store-failed"].includes(mode) ? 0
        : mode === "clear-failed" ? 2
        : 1;
      assert.equal(extension.observed.updates.length, expectedUpdates, mode);
      for (const update of extension.observed.updates) {
        assert.deepEqual([update.key, update.value], ["apiKey", "*****"], mode);
        assert.equal(update.target, workspace ? 2 : 1, mode);
      }
      const expectedErrors = mode === "clear-failed" || mode.endsWith("store-failed") ? 2 : 0;
      assert.equal(extension.observed.errors.length, expectedErrors, mode);
      for (const message of [...extension.observed.errors, ...extension.observed.warnings, ...extension.observed.infos, ...extension.observed.logs]) {
        assert.ok(!message.includes("legacy-secret") && !message.includes("workspace-secret") && !message.includes("secure-secret"), `${mode}: ${message}`);
      }
    });
  }
});

test("a masked settings field reuses the stored key without prompting", async () => {
  const headers = [];
  await withServer((req, res) => { headers.push(req.headers.authorization); reply(res); }, async (baseUrl) => {
    const target = repo("app");
    const extension = load({ apiBaseUrl: baseUrl, apiKey: "*****" }, [target], "diff", "en", { secureKey: "secure-secret" });
    await extension.generateCommitMessage(target);
    assert.deepEqual(headers, ["Bearer secure-secret"]);
    assert.equal(target.inputBox.value, "fix: generated message");
    assert.equal(extension.observed.warnings.length, 0);
    assert.equal(extension.observed.updates.length, 0);
    assert.equal(extension.observed.secretOps.filter((op) => op === "store").length, 0);
  });
});

test("a masked settings field without a stored key sends no Authorization header", async () => {
  const headers = [];
  await withServer((req, res) => { headers.push(req.headers.authorization); reply(res); }, async (baseUrl) => {
    const target = repo("app");
    const extension = load({ apiBaseUrl: baseUrl, apiKey: "*****" }, [target]);
    await extension.generateCommitMessage(target);
    assert.deepEqual(headers, [undefined]);
    assert.equal(target.inputBox.value, "fix: generated message");
    assert.equal(extension.observed.warnings.length, 0);
    assert.equal(extension.observed.updates.length, 0);
  });
});

test("a whitespace-padded plaintext key is trimmed before storage and use", async () => {
  const headers = [];
  await withServer((req, res) => { headers.push(req.headers.authorization); reply(res); }, async (baseUrl) => {
    const target = repo("app");
    const extension = load({ apiBaseUrl: baseUrl, apiKey: "  padded-secret \n" }, [target], "diff", "en", { migrate: true });
    await extension.generateCommitMessage(target);
    assert.deepEqual(headers, ["Bearer padded-secret"]);
    assert.equal(storedKey(extension), "padded-secret");
  });
});

test("overwriting the mask with a new key replaces the stored key without prompting", async () => {
  const headers = [];
  await withServer((req, res) => { headers.push(req.headers.authorization); reply(res); }, async (baseUrl) => {
    const target = repo("app");
    const settings = { apiBaseUrl: baseUrl, apiKey: "*****" };
    const extension = load(settings, [target], "diff", "en", { secureKey: "old-secret" });
    await extension.generateCommitMessage(target);
    assert.deepEqual(headers, ["Bearer old-secret"]);
    // The user edits the settings field, replacing the ***** mirror.
    settings.apiKey = "edited-secret";
    await extension.generateCommitMessage(target);
    assert.deepEqual(headers, ["Bearer old-secret", "Bearer edited-secret"]);
    assert.equal(storedKey(extension), "edited-secret");
    assert.equal(extension.observed.warnings.length, 0);
    assert.equal(settings.apiKey, "*****");
    assert.match(extension.observed.infos.at(-1), /new settings API key/);
  });
});

test("empty staged changes never read secrets or offer migration after activation", async () => {
  const target = repo("app");
  const extension = load({ apiKey: "legacy-secret" }, [target], "", "en", { migrate: true });
  await extension.ready;
  const reads = extension.observed.secretOps.length;
  await extension.generateCommitMessage(target);
  assert.equal(extension.observed.secretOps.length, reads);
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


test("401 and 403 responses offer an actionable Set API Key prompt", async () => {
  for (const language of ["en", "zh-cn"]) {
    for (const status of [401, 403, 500]) {
      for (const chooseAction of [false, true]) {
        await withServer((_req, res) => {
          res.writeHead(status, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: { message: "Invalid Authentication" } }));
        }, async (baseUrl) => {
          const target = repo("app");
          const actionable = status !== 500;
          const extension = load({ apiBaseUrl: baseUrl, apiKey: "some-key" }, [target], "diff", language, {
            migrate: true,
            errorAction: chooseAction ? (items) => items[0] : undefined,
          });
          await extension.generateCommitMessage(target);
          assert.equal(extension.observed.errors.length, 1);
          assert.match(extension.observed.errors[0], new RegExp(String(status)));
          if (language === "zh-cn" && actionable) assert.match(extension.observed.errors[0], /[一-龥]/);
          assert.equal(extension.observed.executed.includes("ai-commit.setApiKey"), actionable && chooseAction);
        });
      }
    }
  }
});


test("key confirmation resolves between the closed Git progress and API progress", async () => {
  await withServer((_req, res) => reply(res), async (baseUrl) => {
    const target = repo("app");
    let releasePrompt;
    const extension = load({ apiBaseUrl: baseUrl, apiKey: "legacy-secret" }, [target], "diff", "en", {
      migrate: (items) => new Promise((resolve) => { releasePrompt = () => resolve(items[0]); }),
    });
    const work = extension.generateCommitMessage(target);
    await new Promise((resolve) => setImmediate(resolve));
    // The confirmation is pending with no active progress notification.
    assert.equal(extension.observed.progress.length, 1);
    assert.ok(extension.observed.progress[0].closed);
    assert.equal(extension.observed.warnings.length, 1);
    releasePrompt();
    await work;
    assert.equal(extension.observed.progress.length, 2);
    assert.equal(target.inputBox.value, "fix: generated message");
  });
});

test("stored keys require approval for a new endpoint, including query changes", async () => {
  const headers = [];
  await withServer((req, res) => { headers.push(req.headers.authorization); reply(res); }, async (baseUrl) => {
    for (const accept of [false, true]) {
      const target = repo("endpoint");
      const extension = load({ apiBaseUrl: baseUrl + "?token=sensitive-query", apiKey: "*****" }, [target], "diff", "en", {
        secureKey: "private-key", migrate: accept,
      });
      const original = extension.observed.secretValues.get("aiCommit.apiKey");
      extension.observed.secretValues.set("aiCommit.apiKey", boundKey(baseUrl, "private-key"));
      const before = headers.length;
      await extension.generateCommitMessage(target);
      assert.equal(headers.length - before, accept ? 1 : 0);
      assert.equal(extension.observed.warnings.length, 1);
      assert.ok(extension.observed.warnings[0].includes("127.0.0.1"));
      assert.ok(!extension.observed.warnings[0].includes("sensitive-query"));
      assert.ok(!extension.observed.warnings[0].includes("private-key"));
      if (accept) {
        assert.equal(extension.observed.secretValues.get("aiCommit.apiKey"), original);
        await extension.generateCommitMessage(target);
        assert.equal(extension.observed.warnings.length, 1);
      } else {
        assert.equal(extension.observed.secretValues.get("aiCommit.apiKey"), boundKey(baseUrl, "private-key"));
        assert.equal(target.inputBox.value, "");
      }
    }
  });
});

test("legacy secure keys bind atomically only after destination approval", async () => {
  for (const accept of [false, true]) {
    let requests = 0;
    await withServer((_req, res) => { requests++; reply(res); }, async (baseUrl) => {
      const target = repo("legacy");
      const extension = load({ apiBaseUrl: baseUrl }, [target], "diff", "en", {
        secureKey: "legacy-key", legacyStored: true, migrate: accept,
      });
      await extension.generateCommitMessage(target);
      assert.equal(requests, accept ? 1 : 0);
      assert.equal(extension.observed.secretValues.get("aiCommit.apiKey"), accept ? boundKey(baseUrl, "legacy-key") : "legacy-key");
    });
  }
});

test("migration removes matching plaintext copies but retains different keys", async () => {
  await withServer((_req, res) => reply(res), async (baseUrl) => {
    for (const globalValue of ["same-key", "different-key"]) {
      const config = { apiBaseUrl: baseUrl, apiKey: globalValue, keyWorkspaceValue: "same-key" };
      const extension = load(config, [repo("copies")], "diff", "en", { migrate: true });
      await extension.generateCommitMessage();
      assert.equal(config.keyWorkspaceValue, "*****");
      assert.equal(config.apiKey, globalValue === "same-key" ? undefined : "different-key");
      assert.equal(storedKey(extension), "same-key");
      if (globalValue !== "same-key") assert.ok(extension.observed.warnings.some(msg => /plaintext/i.test(msg)));
    }
  });
});

test("setting or clearing a key invalidates a pending migration without waiting for its dialog", async () => {
  for (const command of ["ai-commit.setApiKey", "ai-commit.clearApiKey"]) {
    const answer = deferred();
    const prompted = deferred();
    const extension = load({ apiKey: "old-key" }, [], "diff", "en", {
      migrate: items => { prompted.resolve(items); return answer.promise; }, input: "new-key",
    });
    const pending = extension.getApiKey("https://api.deepseek.com/v1");
    const items = await prompted.promise;
    const rejected = assert.rejects(pending, /changed|cancel/i);
    await extension.observed.commands.get(command)();
    answer.resolve(items[0]);
    await rejected;
    assert.equal(storedKey(extension), command.includes("setApiKey") ? "new-key" : undefined);
  }
});

test("configuration changes while confirming a destination prevent sending or rebinding", async () => {
  const answer = deferred();
  const prompted = deferred();
  const config = { apiBaseUrl: "https://first.example/v1", apiKey: "*****" };
  const extension = load(config, [], "diff", "en", { secureKey: "test-key", legacyStored: true,
    migrate: items => { prompted.resolve(items); return answer.promise; },
  });
  const pending = extension.getApiKey(config.apiBaseUrl);
  const items = await prompted.promise;
  const rejected = assert.rejects(pending, /changed|cancel/i);
  config.apiBaseUrl = "https://second.example/v1";
  extension.changeConfiguration();
  answer.resolve(items[0]);
  await rejected;
  assert.equal(extension.observed.secretValues.get("aiCommit.apiKey"), "test-key");
});

test("plaintext authorization is specific to a key and destination and dismissal sends nothing", async () => {
  let requests = 0;
  await withServer((_req, res) => { requests++; reply(res); }, async (baseUrl) => {
    const config = { apiBaseUrl: baseUrl, apiKey: "plaintext" };
    const target = repo("session");
    const extension = load(config, [target], "diff", "en", { migrate: items => items[1] });
    await extension.generateCommitMessage(target);
    await extension.generateCommitMessage(target);
    assert.equal(requests, 2);
    assert.equal(extension.observed.warnings.length, 1);
    assert.equal(storedKey(extension), undefined);
    config.apiBaseUrl = baseUrl + "?changed=1";
    extension.changeConfiguration();
    extension.vscode.window.showWarningMessage = async () => undefined;
    await extension.generateCommitMessage(target);
    assert.equal(requests, 2);
  });
});

test("Git preflight has a cancellation notification and cancellation allows retry", async () => {
  await withServer((_req, res) => reply(res), async (baseUrl) => {
    const started = deferred();
    const release = deferred();
    const target = repo("cancel-git");
    const extension = load({ apiBaseUrl: baseUrl }, [target], async (options, count) => {
      if (count !== 1) return "diff";
      started.resolve(options);
      return Promise.race([release.promise, new Promise((_, reject) => options.abort?.addEventListener("abort", () => reject(new Error("Abort signal received")), { once: true }))]);
    });
    const work = extension.generateCommitMessage(target);
    const options = await started.promise;
    try {
      assert.equal(extension.observed.progress.length, 1);
      assert.equal(extension.observed.progress[0].options.cancellable, true);
      assert.ok(options.abort instanceof AbortSignal);
      assert.deepEqual(JSON.parse(JSON.stringify(options.timeout)), { block: 30000, stdOut: false, stdErr: false });
      extension.observed.progress[0].cancel();
    } finally { release.resolve("diff"); await work; }
    assert.equal(target.inputBox.value, "");
    assert.equal(extension.observed.errors.length, 0);
    await extension.generateCommitMessage(target);
    assert.equal(target.inputBox.value, "fix: generated message");
  });
});

test("authentication dialogs run after progress closes and the repository lock is released", async () => {
  for (const status of [401, 403]) {
    let requests = 0;
    const answer = deferred();
    const prompted = deferred();
    await withServer((_req, res) => {
      requests++;
      if (requests === 1) { res.writeHead(status); res.end("denied"); } else reply(res);
    }, async (baseUrl) => {
      const target = repo("auth-lock");
      const extension = load({ apiBaseUrl: baseUrl }, [target], "diff", "en", {
        errorAction: () => { prompted.resolve(); return answer.promise; },
      });
      const first = extension.generateCommitMessage(target);
      await prompted.promise;
      try {
        assert.ok(extension.observed.progress.every(p => p.closed && p.disposed));
        await extension.generateCommitMessage(target);
        assert.equal(requests, 2);
        assert.equal(target.inputBox.value, "fix: generated message");
      } finally { answer.resolve(undefined); await first; }
    });
  }
});

test("staged changes during confirmation or the API call discard stale results", async () => {
  for (const phase of ["confirmation", "api", "clipboard"]) {
    let staged = "original staged diff";
    let requests = 0;
    await withServer((_req, res) => { requests++; staged = "new staged diff"; reply(res); }, async (baseUrl) => {
      const target = repo("stale");
      const extension = load({ apiBaseUrl: baseUrl, apiKey: phase === "confirmation" ? "test-key" : "" }, [target], () => staged, "en", {
        gitUnavailable: phase === "clipboard",
        migrate: items => { staged = "changed before send"; return items[0]; },
      });
      await extension.generateCommitMessage(target);
      assert.equal(requests, phase === "confirmation" ? 0 : 1);
      assert.equal(target.inputBox.value, "");
      assert.equal(extension.observed.clipboard.length, 0);
      assert.ok(extension.observed.infos.some(msg => /staged.*changed/i.test(msg)));
    });
  }
});

test("missing or disabled Git APIs fall back to the workspace and clipboard", async () => {
  for (const option of ["gitUnavailable", "gitDisabled", "gitApiError"]) {
    await withServer((_req, res) => reply(res), async (baseUrl) => {
      const extension = load({ apiBaseUrl: baseUrl }, [], "diff", "en", { [option]: true });
      await extension.generateCommitMessage();
      assert.deepEqual(extension.observed.clipboard, ["fix: generated message"]);
      assert.equal(extension.observed.errors.length, 0);
    });
  }
});

test("response size limits include success and error bodies and release resources", async () => {
  const limit = 1024 * 1024;
  for (const status of [200, 500]) {
    for (const excess of [0, 1]) {
      const ending = status === 200 ? JSON.stringify({ choices: [{ message: { content: "fix: bounded" } }] }) : "error";
      const body = " ".repeat(limit - Buffer.byteLength(ending) + excess) + ending;
      await withServer((_req, res) => {
        res.writeHead(status);
        res.write(body.slice(0, limit - 1));
        setImmediate(() => res.end(body.slice(limit - 1)));
      }, async (baseUrl) => {
        const extension = load();
        const controller = new AbortController();
        const result = extension.callLLM(baseUrl, "", "test", "", -1, "diff", 2000, controller.signal);
        if (excess) await assert.rejects(result, /too large|limit/i);
        else if (status === 200) assert.equal(await result, "fix: bounded");
        else await assert.rejects(result, /500/);
        assert.equal(getEventListeners(controller.signal, "abort").length, 0);
      });
    }
  }
});

test("empty-stage hints use placeholders and restore on staging, retry, close or deactivation", async () => {
  for (const language of ["en", "zh-cn"]) {
    for (const restore of ["staging", "retry", "close", "deactivate"]) {
      const target = repo("hint");
      const extension = load({}, [target], "", language);
      await extension.generateCommitMessage(target);
      assert.equal(target.inputBox.value, "");
      assert.equal(target.inputBox.placeholder, language === "zh-cn" ? "请先暂存更改，再生成提交信息" : "Stage your changes first, then generate a commit message");
      assert.equal(extension.observed.warnings.length, 1);
      assert.equal(target.listenerCount(), 1);
      if (restore === "staging") { target.state.indexChanges = [{}]; target.changeState(); }
      if (restore === "close") extension.closeRepo(target);
      if (restore === "deactivate") extension.deactivate();
      if (restore === "retry") {
        extension.vscode.window.withProgress = async () => { throw new Error("test stops the retry after restoring the hint"); };
        await extension.generateCommitMessage(target);
      }
      assert.equal(target.inputBox.placeholder, "Original placeholder");
      assert.equal(target.listenerCount(), 0);
    }
  }
});

test("command-palette and value-only Git input boxes use notification-only empty hints", async () => {
  for (const palette of [false, true]) {
    const target = repo("palette");
    if (!palette) delete target.inputBox.placeholder;
    const extension = load({}, [target], "", "en", { noChanges: true });
    await extension.generateCommitMessage(palette ? undefined : target);
    assert.equal(target.inputBox.value, "");
    assert.equal(target.listenerCount(), 0);
    assert.equal(extension.observed.warnings.length, 1);
    assert.equal(target.inputBox.placeholder, palette ? "Original placeholder" : undefined);
  }
});

test("a clean repository shows the optimized no-changes placeholder without overwriting drafts", async () => {
  const target = repo("clean");
  const extension = load({}, [target], "", "en", { noChanges: true });
  await extension.generateCommitMessage(target);
  assert.equal(target.inputBox.placeholder, "There are no changes to commit");
  target.inputBox.value = "my existing draft";
  await extension.generateCommitMessage(target);
  assert.equal(target.inputBox.value, "my existing draft");
  assert.equal(target.inputBox.placeholder, "Original placeholder");
});

test("clearing or changing credentials while the password input is open invalidates that input", async () => {
  for (const change of ["clear", "setting"]) {
    const prompted = deferred();
    const answer = deferred();
    const config = { apiKey: "*****" };
    const extension = load(config, [], "diff", "en", {
      secureKey: "old-key", input: () => { prompted.resolve(); return answer.promise; },
    });
    const pending = extension.observed.commands.get("ai-commit.setApiKey")();
    await prompted.promise;
    if (change === "clear") await extension.observed.commands.get("ai-commit.clearApiKey")();
    else { config.apiKey = "changed-key"; extension.changeConfiguration(); }
    answer.resolve("stale-key");
    await pending;
    assert.notEqual(storedKey(extension), "stale-key");
    assert.ok(extension.observed.errors.some(message => /changed/i.test(message)));
  }
});

test("legacy keys that happen to be JSON values remain readable", async () => {
  for (const key of ["123", '"key"']) {
    const extension = load({}, [], "diff", "en", { secureKey: key, legacyStored: true, migrate: true });
    assert.equal(await extension.getApiKey("https://api.deepseek.com/v1"), key);
    assert.equal(storedKey(extension), key);
  }
});

test("response limits count raw bytes even for invalid UTF-8", async () => {
  await withServer((_req, res) => {
    res.writeHead(500);
    res.end(Buffer.alloc(1024 * 1024, 0xff));
  }, async (baseUrl) => {
    await assert.rejects(load().callLLM(baseUrl, "", "test", "", -1, "diff", 2000), /500/);
  });
});

// Load the installed library unchanged, with only its spawn boundary redirected
// to a real Node child process and its 30-second timer shortened for the test.
function realGitFixture(script) {
  const entry = require.resolve("simple-git");
  const libraryRequire = createRequire(entry);
  const calls = [];
  const ready = deferred();
  const context = {
    exports: {}, Buffer, process, console, clearTimeout,
    setTimeout: (callback, delay, ...args) => setTimeout(callback, delay === 30000 ? 1500 : delay, ...args),
    require: name => name === "node:child_process" ? { spawn: (binary, args, options) => {
      calls.push({ binary, args, options });
      const child = spawn(process.execPath, ["-e", script], options);
      child.stdout.once("data", () => ready.resolve());
      return child;
    } } : libraryRequire(name),
  };
  vm.runInNewContext(fs.readFileSync(entry, "utf8"), context);
  return { realGit: context.exports, calls, ready };
}

test("real simple-git accepts an absolute binary with spaces and passes it as one executable", async () => {
  const binary = path.resolve("Git With Spaces", "git.exe");
  assert.throws(() => require("simple-git").simpleGit({ binary }), /binary|spaces|custom/i);
  const fixture = realGitFixture("process.stdout.write('staged diff')");
  const extension = load({ gitPath: binary }, [], "", "en", fixture);
  assert.equal(await extension.getDiffStaged(process.cwd()), "staged diff");
  assert.equal(fixture.calls.length, 1);
  assert.equal(fixture.calls[0].binary, binary);
  assert.deepEqual(Array.from(fixture.calls[0].args), ["diff", "--staged"]);
  assert.notEqual(fixture.calls[0].options.shell, true);
});

test("real simple-git deadlines ignore continuous output and cancellation kills the child", async () => {
  for (const cancel of [false, true]) {
    const fixture = realGitFixture("process.stdout.write('ready'); setInterval(() => process.stdout.write('output'), 10)");
    const extension = load({}, [], "", "en", fixture);
    const controller = new AbortController();
    const work = extension.getDiffStaged(process.cwd(), controller.signal);
    const rejected = assert.rejects(work, error => cancel ? /abort/i.test(error.message) : error.plugin === "timeout");
    await Promise.race([fixture.ready.promise, rejected.then(() => { throw new Error("Child exited before producing continuous output"); })]);
    if (cancel) controller.abort();
    await rejected;
    assert.equal(fixture.calls.length, 1);
    assert.equal(getEventListeners(controller.signal, "abort").length, 0);
  }
});

test("migration checks fresh configuration rather than an old VS Code configuration snapshot", async () => {
  const answer = deferred();
  const prompted = deferred();
  const config = { apiKey: "old-key" };
  const extension = load(config, [], "diff", "en", {
    snapshotConfig: true, migrate: items => { prompted.resolve(items); return answer.promise; },
  });
  const pending = extension.getApiKey("https://api.deepseek.com/v1");
  const items = await prompted.promise;
  const rejected = assert.rejects(pending, /changed/i);
  config.apiKey = "changed-key";
  extension.changeConfiguration();
  answer.resolve(items[0]);
  await rejected;
  assert.equal(storedKey(extension), undefined);
  assert.equal(config.apiKey, "changed-key");
});

test("delayed migration storage and key clearing are serialized and remove all masks", async () => {
  const started = deferred();
  const release = deferred();
  const config = { apiKey: "same-key", keyWorkspaceValue: "same-key" };
  const extension = load(config, [], "diff", "en", { migrate: true,
    storeError: async () => { started.resolve(); await release.promise; },
  });
  const pending = extension.getApiKey("https://api.deepseek.com/v1");
  await started.promise;
  const clear = extension.observed.commands.get("ai-commit.clearApiKey")();
  assert.ok(!extension.observed.secretOps.includes("delete"));
  const rejected = assert.rejects(pending, /changed/i);
  release.resolve();
  await Promise.all([rejected, clear]);
  assert.equal(storedKey(extension), undefined);
  assert.equal(config.apiKey, "same-key");
  assert.equal(config.keyWorkspaceValue, "same-key");
  config.apiKey = config.keyWorkspaceValue = "*****";
  await extension.observed.commands.get("ai-commit.clearApiKey")();
  assert.equal(config.apiKey, undefined);
  assert.equal(config.keyWorkspaceValue, undefined);
});

test("password prompt shows the destination without query values", async () => {
  const extension = load({ apiBaseUrl: "https://example.com/v1?token=private-value" }, [], "diff", "zh-cn", { input: "test-key" });
  await extension.observed.commands.get("ai-commit.setApiKey")();
  const input = extension.observed.inputOptions[0];
  assert.equal(input.password, true);
  assert.match(input.prompt, /https:\/\/example.com\/v1\/chat\/completions/);
  assert.doesNotMatch(input.prompt, /private-value|test-key/);
});

test("Git summary cancellation skips the request and releases progress and lock", async () => {
  let requests = 0;
  await withServer((_req, res) => { requests++; reply(res); }, async baseUrl => {
    const started = deferred();
    const release = deferred();
    const extension = load({ apiBaseUrl: baseUrl, maxDiffChars: 1 }, [repo("summary")], "long staged diff", "en", {
      summary: options => { started.resolve(options); return release.promise; },
    });
    const pending = extension.generateCommitMessage();
    const options = await started.promise;
    extension.observed.progress.at(-1).cancel();
    assert.equal(options.abort.aborted, true);
    release.resolve({ files: [] });
    await pending;
    assert.equal(requests, 0);
    assert.ok(extension.observed.progress.every(progress => progress.closed && progress.disposed));
    assert.equal(extension.observed.errors.length, 0);
  });
});

test("query secrets echoed by an API never reach notifications or logs", async () => {
  for (const status of [200, 500]) {
    await withServer((_req, res) => {
      res.writeHead(status);
      res.end(status === 200 ? JSON.stringify({ error: { message: "private query / token=private%20query / token=private+query" } }) : "private query / token=private%20query / token=private+query");
    }, async baseUrl => {
      const extension = load({ apiBaseUrl: baseUrl + "?token=private%20query" }, [repo("redaction")], "diff", "en");
      await extension.generateCommitMessage();
      assert.equal(extension.observed.errors.length, 1);
      assert.doesNotMatch(extension.observed.errors.join("\n") + extension.observed.logs.join("\n"), /private(?: query|%20query|\+query)/);
    });
  }
});

test("password command can replace an invalid versioned record", async () => {
  const extension = load({}, [], "diff", "en", { input: "replacement-key" });
  await extension.ready;
  extension.observed.secretValues.set("aiCommit.apiKey", '{"version":1,"key":null}');
  await extension.observed.commands.get("ai-commit.setApiKey")();
  assert.equal(storedKey(extension), "replacement-key");
  assert.equal(extension.observed.errors.length, 0);
});

test("repository-close cleanup also works when Git initializes after extension activation", async () => {
  const target = repo("late-git");
  const options = { gitUnavailable: true };
  const extension = load({}, [target], "", "en", options);
  options.gitUnavailable = false;
  await extension.generateCommitMessage(target);
  assert.notEqual(target.inputBox.placeholder, "Original placeholder");
  extension.closeRepo(target);
  assert.equal(target.inputBox.placeholder, "Original placeholder");
  assert.equal(target.listenerCount(), 0);
});

test("activation restores the settings mask for retained secure keys without making a request", async () => {
  for (const legacyStored of [false, true]) {
    for (const apiKey of [undefined, "", "   "]) {
      const config = { apiKey };
      const extension = load(config, [], "diff", "en", { secureKey: "retained-key", legacyStored });
      await extension.ready;
      assert.equal(config.apiKey, "*****");
      assert.equal(storedKey(extension), "retained-key");
      assert.equal(extension.observed.gitOptions.length, 0);
      assert.equal(extension.observed.warnings.length, 0);
      assert.equal(extension.observed.secretOps.filter(op => op === "store").length, 0);
    }
  }
  for (const apiKey of [undefined, "new-plaintext", "*****"]) {
    const config = { apiKey };
    const extension = load(config, [], "diff", "en", { secureKey: apiKey === undefined ? undefined : "retained-key" });
    await extension.ready;
    assert.equal(config.apiKey, apiKey);
  }
});

test("401 clears the rejected key and all masks before showing the authentication prompt", async () => {
  for (const language of ["en", "zh-cn"]) {
    await withServer((_req, res) => { res.writeHead(401); res.end("invalid key"); }, async baseUrl => {
      const config = { apiBaseUrl: baseUrl, apiKey: "*****", keyWorkspaceValue: "*****" };
      const target = repo("rejected"); target.inputBox.value = "user draft";
      let extension;
      extension = load(config, [target], "diff", language, { secureKey: "old-key", errorAction: () => {
        assert.equal(storedKey(extension), undefined);
        assert.equal(config.apiKey, undefined); assert.equal(config.keyWorkspaceValue, undefined);
        assert.ok(extension.observed.progress.every(p => p.closed && p.disposed));
      } });
      await extension.generateCommitMessage(target);
      assert.equal(storedKey(extension), undefined);
      assert.equal(target.inputBox.value, "user draft");
      assert.equal(extension.observed.errors.length, 1);
      assert.match(extension.observed.errors[0], language === "zh-cn" ? /已清除/ : /cleared/i);
    });
  }
});

test("403, server errors, network errors and timeouts retain the stored key and its restored mask", async () => {
  for (const status of [403, 500, "network", "timeout"]) {
    await withServer((req, res) => { if (status === "network") req.socket.destroy(); else if (status !== "timeout") { res.writeHead(status); res.end("failed"); } }, async baseUrl => {
      const config = { apiBaseUrl: baseUrl, timeoutMs: 50 };
      const extension = load(config, [repo("retained")], "diff", "en", { secureKey: "valid-key" });
      await extension.generateCommitMessage();
      assert.equal(config.apiKey, "*****"); assert.equal(storedKey(extension), "valid-key");
      assert.ok(!extension.observed.secretOps.includes("delete"));
    });
  }
});

test("a late 401 never clears a replacement key, changed settings, or a changed endpoint", async () => {
  for (const change of ["key", "setting", "endpoint"]) {
    const arrived = deferred(), replyReady = deferred();
    await withServer((_req, res) => { arrived.resolve(); replyReady.promise.then(() => { res.writeHead(401); res.end("denied"); }); }, async baseUrl => {
      const config = { apiBaseUrl: baseUrl, apiKey: "*****" };
      const extension = load(config, [repo("late-401")], "diff", "en", { secureKey: "old-key", input: "new-key" });
      const work = extension.generateCommitMessage(); await arrived.promise;
      if (change === "key") await extension.observed.commands.get("ai-commit.setApiKey")();
      if (change === "setting") { config.apiKey = "new-plaintext"; extension.changeConfiguration(); }
      if (change === "endpoint") { config.apiBaseUrl = baseUrl + "?changed=1"; extension.changeConfiguration(); }
      replyReady.resolve(); await work;
      assert.equal(storedKey(extension), change === "key" ? "new-key" : "old-key");
      assert.equal(config.apiKey, change === "setting" ? "new-plaintext" : "*****");
      assert.ok(!extension.observed.secretOps.includes("delete"));
    });
  }
});

test("401 revokes explicit plaintext authorization and removes matching invalid copies only", async () => {
  await withServer((_req, res) => { res.writeHead(401); res.end("denied"); }, async baseUrl => {
    const config = { apiBaseUrl: baseUrl, apiKey: "different-key", keyWorkspaceValue: "invalid-key" };
    const extension = load(config, [repo("plaintext-401")], "diff", "en", { migrate: choices => choices[1] });
    await extension.generateCommitMessage();
    assert.equal(config.keyWorkspaceValue, "");
    assert.equal(config.apiKey, "different-key");
    assert.equal(storedKey(extension), undefined);
    const requests = extension.observed.warnings.length;
    config.keyWorkspaceValue = "invalid-key";
    extension.changeConfiguration();
    await extension.generateCommitMessage();
    assert.equal(extension.observed.warnings.length, requests + 1);
  });
});

test("automatic 401 cleanup failures report residue without exposing the key", async () => {
  for (const failure of ["delete", "mask"]) {
    await withServer((_req, res) => { res.writeHead(401); res.end("denied"); }, async baseUrl => {
      const config = { apiBaseUrl: baseUrl, apiKey: "*****" };
      const extension = load(config, [repo("cleanup-failure")], "diff", "en", {
        secureKey: "private-key", deleteError: failure === "delete" ? "private-key" : undefined,
        updateError: failure === "mask" ? "private-key" : undefined,
      });
      await extension.generateCommitMessage();
      assert.equal(storedKey(extension), failure === "delete" ? "private-key" : undefined);
      assert.equal(config.apiKey, "*****");
      assert.match(extension.observed.errors[0], /could not|failed/i);
      assert.doesNotMatch(extension.observed.errors.join("\n") + extension.observed.logs.join("\n"), /private-key/);
    });
  }
});

test("a key typed while rejected-key deletion is pending is preserved", async () => {
  const deleting = deferred(), release = deferred();
  await withServer((_req, res) => { res.writeHead(401); res.end("denied"); }, async baseUrl => {
    const config = { apiBaseUrl: baseUrl, apiKey: "*****" };
    const extension = load(config, [repo("deleting")], "diff", "en", { secureKey: "old-key",
      deleteError: async () => { deleting.resolve(); await release.promise; },
    });
    const work = extension.generateCommitMessage(); await deleting.promise;
    config.apiKey = "new-plaintext"; extension.changeConfiguration();
    release.resolve(); await work;
    assert.equal(storedKey(extension), undefined);
    assert.equal(config.apiKey, "new-plaintext");
    assert.doesNotMatch(extension.observed.errors.at(-1), /masks were cleared/);
  });
});

test("successful reuse restores an emptied field and retains the key", async () => {
  await withServer((_req, res) => reply(res), async baseUrl => {
    const config = { apiBaseUrl: baseUrl, apiKey: "*****" };
    const extension = load(config, [repo("successful")], "diff", "en", { secureKey: "valid-key" });
    await extension.ready;
    config.apiKey = ""; extension.changeConfiguration();
    await extension.generateCommitMessage();
    assert.equal(config.apiKey, "*****"); assert.equal(storedKey(extension), "valid-key");
    assert.equal(extension.observed.errors.length, 0);
  });
});


test("clearing all data with a dismissed confirmation writes nothing", async () => {
  const scopes = { global: { apiKey: "plaintext-key", model: "custom-model" }, workspace: { apiKey: "*****" } };
  const extension = load({}, [], "diff", "en", { scopes, secureKey: "secure-secret" });
  await extension.ready;
  extension.observed.updates.length = 0;
  extension.observed.secretOps.length = 0;
  await extension.observed.commands.get("ai-commit.clearAllData")();
  assert.equal(extension.observed.warnings.length, 1);
  assert.equal(extension.observed.updates.length, 0);
  assert.equal(extension.observed.secretOps.length, 0);
  assert.equal(scopes.global.apiKey, "plaintext-key");
  assert.equal(scopes.workspace.apiKey, "*****");
  assert.equal(storedKey(extension), "secure-secret");
});

test("clearing all data removes the eight settings across user and workspace scopes only", async () => {
  const folderA = path.resolve("folder-a");
  const folderB = path.resolve("folder-b");
  const scopes = {
    global: { apiBaseUrl: "https://custom.example/v1", apiKey: "global-key", model: "m", systemPrompt: "p", maxDiffChars: 1000, temperature: 0.5, timeoutMs: 5000, gitPath: "/usr/bin/git" },
    workspace: { model: "ws-model", timeoutMs: 6000 },
    folders: { [folderA]: { gitPath: "git-a" }, [folderB]: { timeoutMs: 1 } },
  };
  const extension = load({}, [], "diff", "en", {
    scopes, migrate: true,
    folders: [{ fsPath: folderA, name: "folder-a" }, { fsPath: folderB, name: "folder-b" }],
  });
  await extension.ready;
  extension.observed.updates.length = 0;
  await extension.observed.commands.get("ai-commit.clearAllData")();
  for (const bucket of [scopes.global, scopes.workspace]) {
    for (const key of Object.keys(bucket)) assert.equal(bucket[key], undefined, key);
  }
  // The settings are window-scoped, so folder buckets are never touched.
  assert.equal(scopes.folders[folderA].gitPath, "git-a");
  assert.equal(scopes.folders[folderB].timeoutMs, 1);
  assert.equal(extension.observed.updates.length, 16);
  assert.ok(extension.observed.updates.every((update) => update.value === undefined));
  assert.equal(extension.observed.updates.filter((update) => update.target === 1).length, 8);
  assert.equal(extension.observed.updates.filter((update) => update.target === 2).length, 8);
  assert.ok(extension.observed.updates.every((update) => update.target !== 3));
  assert.ok(extension.observed.secretOps.includes("delete"));
  assert.ok(extension.observed.infos.some((message) => /cleared/i.test(message) && /uninstall/i.test(message)));
  assert.equal(extension.observed.errors.length, 0);
});

test("clearing all data removes plaintext keys, masks and the stored record", async () => {
  const scopes = { global: { apiKey: "sk-plaintext" }, workspace: { apiKey: "*****" } };
  const extension = load({}, [], "diff", "en", { scopes, secureKey: "secure-secret", migrate: true });
  await extension.ready;
  await extension.observed.commands.get("ai-commit.clearAllData")();
  assert.equal(scopes.global.apiKey, undefined);
  assert.equal(scopes.workspace.apiKey, undefined);
  assert.equal(storedKey(extension), undefined);
  assert.ok(extension.observed.secretOps.includes("delete"));
  assert.ok(extension.observed.infos.some((message) => /safely uninstall/i.test(message)));
});

test("clearing all data is idempotent on an empty configuration", async () => {
  const scopes = { global: {} };
  const extension = load({}, [], "diff", "en", { scopes, migrate: true });
  await extension.ready;
  await extension.observed.commands.get("ai-commit.clearAllData")();
  await extension.observed.commands.get("ai-commit.clearAllData")();
  assert.equal(extension.observed.errors.length, 0);
  assert.equal(extension.observed.infos.filter((message) => /safely uninstall/i.test(message)).length, 2);
});

test("clearing all data restores manifest defaults", async () => {
  const manifest = require("../package.json");
  const scopes = { global: { apiBaseUrl: "https://custom.example/v1", apiKey: "sk-x", model: "custom-model", systemPrompt: "custom prompt", maxDiffChars: 100, temperature: 0.7, timeoutMs: 9999, gitPath: "/opt/git" } };
  const extension = load({}, [], "diff", "en", { scopes, migrate: true });
  await extension.ready;
  await extension.observed.commands.get("ai-commit.clearAllData")();
  const view = extension.vscode.workspace.getConfiguration("aiCommit");
  for (const [fullKey, prop] of Object.entries(manifest.contributes.configuration.properties)) {
    assert.deepEqual(view.get(fullKey.slice(fullKey.indexOf(".") + 1), prop.default), prop.default, fullKey);
  }
});

test("clearing all data only touches the eight declared settings", async () => {
  const scopes = { global: { model: "m", unrelatedNote: "keep-me" } };
  const extension = load({}, [], "diff", "en", { scopes, migrate: true });
  await extension.ready;
  await extension.observed.commands.get("ai-commit.clearAllData")();
  assert.equal(scopes.global.unrelatedNote, "keep-me");
  const touched = new Set(extension.observed.updates.map((update) => update.key));
  assert.deepEqual([...touched].sort(), [...extension.CLEARABLE_SETTINGS].sort());
});

test("clearing all data without a workspace only clears user settings and succeeds", async () => {
  const scopes = { global: { model: "custom-model" } };
  const extension = load({}, [], "diff", "en", { scopes, folders: [], migrate: true });
  await extension.ready;
  await extension.observed.commands.get("ai-commit.clearAllData")();
  assert.equal(extension.observed.updates.length, 8);
  assert.ok(extension.observed.updates.every((update) => update.target === 1));
  assert.equal(scopes.global.model, undefined);
  assert.equal(extension.observed.errors.length, 0);
  assert.ok(extension.observed.infos.some((message) => /safely uninstall/i.test(message)));
});

test("clearing all data also clears a folder-less workspace file", async () => {
  const scopes = { global: { model: "custom-model" }, workspace: { model: "ws-model", timeoutMs: 6000 } };
  const extension = load({}, [], "diff", "en", { scopes, folders: [], workspaceFile: path.resolve("empty.code-workspace"), migrate: true });
  await extension.ready;
  await extension.observed.commands.get("ai-commit.clearAllData")();
  assert.equal(scopes.global.model, undefined);
  assert.equal(scopes.workspace.model, undefined);
  assert.equal(scopes.workspace.timeoutMs, undefined);
  assert.equal(extension.observed.updates.length, 16);
  assert.equal(extension.observed.updates.filter((update) => update.target === 1).length, 8);
  assert.equal(extension.observed.updates.filter((update) => update.target === 2).length, 8);
  assert.equal(extension.observed.errors.length, 0);
  assert.ok(extension.observed.infos.some((message) => /safely uninstall/i.test(message)));
});

test("clearing all data continues after item failures and reports scopes and keys without values", async () => {
  let failedOnce = false;
  const scopes = { global: { apiKey: "sk-do-not-leak", model: "leak-model" }, workspace: { apiKey: "*****" } };
  const extension = load({}, [], "diff", "en", {
    scopes, migrate: true,
    updateError: async (key, value, target) => {
      if (!failedOnce && key === "model" && target === 1) {
        failedOnce = true;
        throw new Error("raw disk failure at /secret-path");
      }
    },
  });
  await extension.ready;
  await extension.observed.commands.get("ai-commit.clearAllData")();
  assert.equal(scopes.global.apiKey, undefined);
  assert.equal(scopes.workspace.apiKey, undefined);
  assert.equal(scopes.global.model, "leak-model");
  const report = extension.observed.errors.find((message) => /could not be cleared/i.test(message));
  assert.ok(report, "partial failure reported");
  assert.ok(report.includes("User / model"));
  assert.ok(!report.includes("sk-do-not-leak") && !report.includes("leak-model") && !report.includes("raw disk failure"));
  await extension.observed.commands.get("ai-commit.clearAllData")();
  assert.equal(scopes.global.model, undefined);
  assert.ok(extension.observed.infos.some((message) => /safely uninstall/i.test(message)));
});

test("clearing all data keeps clearing settings when secure deletion fails without leaking details", async () => {
  const scopes = { global: { apiKey: "sk-plain", model: "custom-model" } };
  const extension = load({}, [], "diff", "en", { scopes, secureKey: "secure-secret", migrate: true, deleteError: "raw keyring failure" });
  await extension.ready;
  await extension.observed.commands.get("ai-commit.clearAllData")();
  assert.equal(scopes.global.apiKey, undefined);
  assert.equal(scopes.global.model, undefined);
  assert.equal(storedKey(extension), "secure-secret");
  const report = extension.observed.errors.find((message) => /could not be cleared/i.test(message));
  assert.ok(report, "secure deletion failure reported");
  assert.ok(/Secure storage \/ API Key/.test(report));
  assert.ok(!report.includes("raw keyring failure") && !report.includes("secure-secret") && !report.includes("sk-plain"));
});

test("a key dialog opened before clearing cannot write afterwards", async () => {
  const prompted = deferred();
  const answer = deferred();
  const extension = load({}, [], "diff", "en", {
    scopes: { global: {} }, migrate: true,
    input: () => { prompted.resolve(); return answer.promise; },
  });
  await extension.ready;
  const pending = extension.observed.commands.get("ai-commit.setApiKey")();
  await prompted.promise;
  await extension.observed.commands.get("ai-commit.clearAllData")();
  answer.resolve("stale-key");
  await pending;
  assert.ok(!extension.observed.secretOps.includes("store"));
  assert.ok(extension.observed.errors.some((message) => /changed/i.test(message)));
});

test("clearing is refused while generating and blocks other commands while running", async () => {
  const scopes = { global: { model: "custom-model" } };
  const target = repo("busy");
  const gate = deferred();
  const deleteStarted = deferred();
  const deleteHeld = deferred();
  const extension = load({}, [target], () => gate.promise, "en", {
    scopes, migrate: true,
    deleteError: () => { deleteStarted.resolve(); return deleteHeld.promise; },
  });
  await extension.ready;
  const generation = extension.generateCommitMessage(target);
  await new Promise((resolve) => setTimeout(resolve, 0));
  await extension.observed.commands.get("ai-commit.clearAllData")();
  assert.ok(extension.observed.infos.some((message) => /being generated/i.test(message)));
  assert.equal(extension.observed.updates.length, 0);
  assert.ok(!extension.observed.secretOps.includes("delete"));
  extension.observed.progress[0].cancel();
  gate.resolve("diff");
  await generation;
  const clearing = extension.observed.commands.get("ai-commit.clearAllData")();
  await deleteStarted.promise;
  await extension.generateCommitMessage(target);
  await extension.observed.commands.get("ai-commit.setApiKey")();
  await extension.observed.commands.get("ai-commit.selectApiBaseUrl")();
  await extension.observed.commands.get("ai-commit.clearApiKey")();
  assert.equal(extension.observed.infos.filter((message) => /please wait/i.test(message)).length, 4);
  deleteHeld.resolve();
  await clearing;
  assert.equal(scopes.global.model, undefined);
  assert.ok(extension.observed.infos.some((message) => /safely uninstall/i.test(message)));
  assert.equal(extension.observed.errors.length, 0);
});

test("deactivation does not delete settings or keys", async () => {
  const scopes = { global: { apiKey: "*****", model: "custom-model" } };
  const extension = load({}, [], "diff", "en", { scopes, secureKey: "secure-secret" });
  await extension.ready;
  extension.observed.updates.length = 0;
  extension.observed.secretOps.length = 0;
  extension.deactivate();
  assert.equal(extension.observed.updates.length, 0);
  assert.equal(extension.observed.secretOps.length, 0);
  assert.equal(storedKey(extension), "secure-secret");
  assert.equal(scopes.global.apiKey, "*****");
});

test("clear all data command is registered and localized", async () => {
  const en = load({}, [], "diff", "en", { scopes: { global: {} } });
  await en.ready;
  assert.ok(en.observed.commands.has("ai-commit.clearAllData"));
  await en.observed.commands.get("ai-commit.clearAllData")();
  assert.ok(en.observed.warnings.some((message) => /removes all 8 Simple AI Committer settings/.test(message)));
  assert.ok(!en.observed.warnings.some((message) => /[一-鿿]/.test(message)));
  const zh = load({}, [], "diff", "zh-cn", { scopes: { global: {} } });
  await zh.ready;
  await zh.observed.commands.get("ai-commit.clearAllData")();
  assert.ok(zh.observed.warnings.some((message) => message.includes("删除 Simple AI Committer 的全部 8 项配置")));
});

test("connection test sends a minimal probe and reports the responding model", async () => {
  const payloads = [];
  const headers = [];
  await withServer((req, res) => {
    headers.push(req.headers.authorization);
    let body = "";
    req.setEncoding("utf8");
    req.on("data", (chunk) => { body += chunk; });
    req.on("end", () => {
      payloads.push(JSON.parse(body));
      res.end(JSON.stringify({ model: "server-reported-model", choices: [{ message: { content: "p" } }] }));
    });
  }, async (baseUrl) => {
    for (const language of ["en", "zh-cn"]) {
      const extension = load({ apiBaseUrl: baseUrl, apiKey: "*****", model: "configured-model" }, [], "diff", language, { secureKey: "probe-key" });
      await extension.observed.commands.get("ai-commit.testConnection")();
      assert.equal(extension.observed.errors.length, 0);
      assert.match(extension.observed.infos[0], language === "zh-cn" ? /连接测试成功/ : /Connection test succeeded/);
      assert.match(extension.observed.infos[0], /server-reported-model/);
      assert.match(extension.observed.infos[0], language === "zh-cn" ? /\d+ 毫秒/ : /\d+ ms/);
      assert.equal(extension.observed.progress.length, 1);
      assert.equal(extension.observed.progress[0].options.cancellable, true);
      assert.ok(extension.observed.progress[0].closed);
    }
    assert.equal(payloads.length, 2);
    assert.deepEqual(headers, ["Bearer probe-key", "Bearer probe-key"]);
    for (const payload of payloads) {
      assert.equal(payload.model, "configured-model");
      assert.equal(payload.max_tokens, 1);
      assert.deepEqual(payload.messages, [{ role: "user", content: "ping" }]);
    }
  });
});

test("connection test maps 401 and 403 to key guidance with a Set API Key action", async () => {
  for (const language of ["en", "zh-cn"]) {
    for (const status of [401, 403]) {
      await withServer((_req, res) => { res.writeHead(status); res.end("Invalid Authentication"); }, async (baseUrl) => {
        const extension = load({ apiBaseUrl: baseUrl, apiKey: "*****" }, [], "diff", language, {
          secureKey: "some-key", errorAction: (items) => items[0],
        });
        await extension.observed.commands.get("ai-commit.testConnection")();
        assert.equal(extension.observed.errors.length, 1);
        assert.match(extension.observed.errors[0], new RegExp(String(status)));
        if (language === "zh-cn") assert.match(extension.observed.errors[0], /[一-龥]/);
        assert.ok(extension.observed.executed.includes("ai-commit.setApiKey"));
        // A failed probe only diagnoses; it never deletes the stored key.
        assert.ok(!extension.observed.secretOps.includes("delete"));
        assert.equal(storedKey(extension), "some-key");
      });
    }
  }
});

test("connection test maps 404 to a URL check with a picker action", async () => {
  await withServer((_req, res) => { res.writeHead(404); res.end("not found"); }, async (baseUrl) => {
    const extension = load({ apiBaseUrl: baseUrl, apiKey: "*****" }, [], "diff", "en", {
      secureKey: "some-key", errorAction: (items) => items[0],
    });
    await extension.observed.commands.get("ai-commit.testConnection")();
    assert.equal(extension.observed.errors.length, 1);
    assert.match(extension.observed.errors[0], /404/);
    assert.match(extension.observed.errors[0], /\/v1|chat\/completions/);
    assert.ok(extension.observed.executed.includes("ai-commit.selectApiBaseUrl"));
  });
});

test("connection test maps 400 to model and temperature guidance", async () => {
  await withServer((_req, res) => {
    res.writeHead(400);
    res.end(JSON.stringify({ error: { message: "temperature is not supported" } }));
  }, async (baseUrl) => {
    const extension = load({ apiBaseUrl: baseUrl, apiKey: "*****", model: "no-such-model" }, [], "diff", "en", {
      secureKey: "some-key", errorAction: (items) => items[0],
    });
    await extension.observed.commands.get("ai-commit.testConnection")();
    assert.equal(extension.observed.errors.length, 1);
    assert.match(extension.observed.errors[0], /400/);
    assert.match(extension.observed.errors[0], /no-such-model/);
    assert.match(extension.observed.errors[0], /temperature/i);
    assert.ok(extension.observed.executed.includes("workbench.action.openSettings"));
  });
});

test("connection test reports invalid local settings before any request", async () => {
  let requests = 0;
  await withServer((_req, res) => { requests++; res.end("{}"); }, async (baseUrl) => {
    const invalidUrl = load({ apiBaseUrl: "not a url" }, [], "diff", "en", { errorAction: (items) => items[0] });
    await invalidUrl.observed.commands.get("ai-commit.testConnection")();
    assert.equal(invalidUrl.observed.errors.length, 1);
    assert.match(invalidUrl.observed.errors[0], /http/i);
    assert.ok(invalidUrl.observed.executed.includes("workbench.action.openSettings"));
    assert.equal(invalidUrl.observed.progress.length, 0);
    const numeric = load({ apiBaseUrl: baseUrl, timeoutMs: 0 }, [], "diff", "en");
    await numeric.observed.commands.get("ai-commit.testConnection")();
    assert.match(numeric.observed.errors[0], /timeoutMs/);
    assert.equal(numeric.observed.progress.length, 0);
    assert.equal(requests, 0);
  });
});

test("connection test probes unauthenticated endpoints without a key", async () => {
  // A compatible local service (e.g. Ollama) answers without an Authorization header.
  const headers = [];
  await withServer((req, res) => { headers.push(req.headers.authorization); reply(res); }, async (baseUrl) => {
    for (const language of ["en", "zh-cn"]) {
      const extension = load({ apiBaseUrl: baseUrl, apiKey: "" }, [], "diff", language);
      await extension.observed.commands.get("ai-commit.testConnection")();
      assert.equal(extension.observed.errors.length, 0);
      assert.match(extension.observed.infos[0], language === "zh-cn" ? /连接测试成功/ : /Connection test succeeded/);
      assert.equal(extension.observed.warnings.length, 0);
    }
    assert.deepEqual(headers, [undefined, undefined]);
  });
  // A server that requires auth still answers 401, which turns into key guidance.
  await withServer((_req, res) => { res.writeHead(401); res.end("auth required"); }, async (baseUrl) => {
    const extension = load({ apiBaseUrl: baseUrl, apiKey: "" }, [], "diff", "en", { errorAction: (items) => items[0] });
    await extension.observed.commands.get("ai-commit.testConnection")();
    assert.equal(extension.observed.errors.length, 1);
    assert.match(extension.observed.errors[0], /401/);
    assert.ok(extension.observed.executed.includes("ai-commit.setApiKey"));
  });
});

test("connection test sends the configured temperature with the generation omission rule", async () => {
  const payloads = [];
  await withServer((req, res) => {
    let body = "";
    req.setEncoding("utf8");
    req.on("data", (chunk) => { body += chunk; });
    req.on("end", () => { payloads.push(JSON.parse(body)); reply(res); });
  }, async (baseUrl) => {
    for (const [settings, expected] of [[{}, undefined], [{ temperature: 0.3 }, 0.3]]) {
      const extension = load({ apiBaseUrl: baseUrl, apiKey: "*****", ...settings }, [], "diff", "en", { secureKey: "probe-key" });
      await extension.observed.commands.get("ai-commit.testConnection")();
      assert.equal(extension.observed.errors.length, 0);
      assert.equal(payloads.at(-1).temperature, expected);
    }
    // A model that rejects custom temperatures fails the probe too, not just generation.
    await withServer((_req, res) => {
      res.writeHead(400);
      res.end(JSON.stringify({ error: { message: "temperature is not supported" } }));
    }, async (strictBaseUrl) => {
      const extension = load({ apiBaseUrl: strictBaseUrl, apiKey: "*****", temperature: 0.3, model: "fixed-temp-model" }, [], "diff", "en", { secureKey: "probe-key" });
      await extension.observed.commands.get("ai-commit.testConnection")();
      assert.equal(extension.observed.errors.length, 1);
      assert.match(extension.observed.errors[0], /400/);
      assert.match(extension.observed.errors[0], /fixed-temp-model/);
    });
  });
});

test("connection test timeout keeps the stored key and suggests network checks", async () => {
  await withServer(() => { /* never respond */ }, async (baseUrl) => {
    const extension = load({ apiBaseUrl: baseUrl, timeoutMs: 50, apiKey: "*****" }, [], "diff", "en", { secureKey: "valid-key" });
    await extension.observed.commands.get("ai-commit.testConnection")();
    assert.equal(extension.observed.errors.length, 1);
    assert.match(extension.observed.errors[0], /timed out|超时/i);
    assert.equal(storedKey(extension), "valid-key");
    assert.ok(!extension.observed.secretOps.includes("delete"));
  });
});

test("connection test maps a refused connection to local-service guidance", async () => {
  const server = http.createServer((_req, res) => res.end("{}"));
  await new Promise((resolve) => { server.listen(0, "127.0.0.1", resolve); });
  const port = server.address().port;
  await new Promise((resolve) => { server.close(resolve); });
  const extension = load({ apiBaseUrl: `http://127.0.0.1:${port}/v1`, apiKey: "*****" }, [], "diff", "en", {
    secureKey: "valid-key", errorAction: (items) => items[0],
  });
  await extension.observed.commands.get("ai-commit.testConnection")();
  assert.equal(extension.observed.errors.length, 1);
  assert.match(extension.observed.errors[0], /refused/i);
  assert.ok(extension.observed.executed.includes("ai-commit.selectApiBaseUrl"));
});

test("connection test cancellation closes silently without errors", async () => {
  await withServer(() => { /* hold the request */ }, async (baseUrl) => {
    const extension = load({ apiBaseUrl: baseUrl, apiKey: "*****" }, [], "diff", "en", { secureKey: "valid-key" });
    const pending = extension.observed.commands.get("ai-commit.testConnection")();
    while (!extension.observed.progress.length) await new Promise((resolve) => setImmediate(resolve));
    extension.observed.progress.at(-1).cancel();
    await pending;
    assert.equal(extension.observed.errors.length, 0);
    assert.equal(extension.observed.infos.length, 0);
    assert.ok(extension.observed.progress.every((progress) => progress.closed && progress.disposed));
  });
});

test("saving a key offers an immediate connection test", async () => {
  let requests = 0;
  await withServer((_req, res) => { requests++; reply(res); }, async (baseUrl) => {
    for (const language of ["en", "zh-cn"]) {
      const before = requests;
      const extension = load({ apiBaseUrl: baseUrl }, [], "diff", language, {
        input: "fresh-key", migrate: true,
        infoAction: (items) => items.find((item) => (language === "zh-cn" ? /测试连接/ : /Test Connection/).test(item)),
      });
      await extension.observed.commands.get("ai-commit.setApiKey")();
      assert.equal(storedKey(extension), "fresh-key");
      assert.ok(extension.observed.infos.some((message) => /saved securely|已安全保存/.test(message)));
      // The success notification's Test Connection button runs the real probe.
      assert.equal(requests, before + 1);
      assert.ok(extension.observed.infos.some((message) => /Connection test succeeded|连接测试成功/.test(message)));
      assert.equal(extension.observed.errors.length, 0);
    }
  });
});
