const assert = require("node:assert/strict");
const fs = require("node:fs");
const http = require("node:http");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");
const ts = require("typescript");

const source = fs.readFileSync(path.join(__dirname, "../src/extension.ts"), "utf8");
const js = ts.transpileModule(
  source + "\nexports.test = { getRepo, getDiffStaged, callLLM, generateCommitMessage };",
  { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } },
).outputText;

function load(config = {}, repositories = [], diff = "+ staged change") {
  const observed = { errors: [], gitOptions: [], statusCalls: 0 };
  const vscode = {
    env: { language: "en", clipboard: { writeText: async () => {} } },
    workspace: {
      workspaceFolders: [{ uri: { fsPath: process.cwd() } }],
      onDidChangeConfiguration: () => ({ dispose() {} }),
      getConfiguration: () => ({ get: (key, fallback) => config[key] ?? fallback }),
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
  return { ...context.exports.test, observed };
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
