import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { JSDOM, VirtualConsole } from "jsdom";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
let child, url, dataDirectory;
const windows = [];

async function until(predicate, label = "condition") {
  for (let i = 0; i < 200; i++) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error("Timed out: " + label);
}

before(async () => {
  fs.mkdirSync(path.join(root, ".local"), { recursive: true });
  dataDirectory = fs.mkdtempSync(path.join(root, ".local", "dom-test-"));
  child = spawn(
    "python",
    [
      "-X",
      "utf8",
      "-m",
      "audit.server",
      "--port",
      "0",
      "--data-dir",
      dataDirectory,
    ],
    {
      cwd: root,
      env: {
        ...process.env,
        AUDIT_LLM_ENDPOINT: "",
        AUDIT_LLM_MODEL: "",
        AUDIT_LLM_KEY: "",
      },
      windowsHide: true,
    },
  );
  child.stdout.on("data", (data) => {
    const match = String(data).match(/http:\/\/127\.0\.0\.1:\d+/);
    if (match) url = match[0];
  });
  await until(() => url, "test server startup");
});

after(async () => {
  for (const dom of windows) dom.window.close();
  if (child && child.exitCode === null) {
    const stopped = new Promise((resolve) => child.once("exit", resolve));
    child.kill();
    await stopped;
  }
  // Delete only this test's freshly created directory inside the workspace.
  if (
    dataDirectory &&
    path.dirname(path.resolve(dataDirectory)) === path.join(root, ".local") &&
    path.basename(dataDirectory).startsWith("dom-test-")
  )
    fs.rmSync(dataDirectory, { recursive: true, force: true });
});

async function page() {
  const errors = [];
  const virtualConsole = new VirtualConsole();
  virtualConsole.on("jsdomError", (error) => {
    if (error.type !== "not-implemented") errors.push(error.message);
  });
  const dom = new JSDOM(
    fs.readFileSync(path.join(root, "web/index.html"), "utf8"),
    {
      url,
      runScripts: "outside-only",
      pretendToBeVisual: true,
      virtualConsole,
    },
  );
  windows.push(dom);
  dom.window.fetch = (input, options) => fetch(new URL(input, url), options);
  dom.window.addEventListener("error", (event) => errors.push(event.message));
  // jsdom has no window manager. Only dialog open-state is emulated here.
  dom.window.HTMLDialogElement.prototype.showModal = function () {
    this.open = true;
  };
  dom.window.HTMLDialogElement.prototype.close = function () {
    this.open = false;
  };
  dom.window.scrollTo = () => {};
  dom.window.eval(fs.readFileSync(path.join(root, "web/app.js"), "utf8"));
  await until(
    () => dom.window.document.querySelector('[data-action="demo"]'),
    "welcome rendering",
  );
  return { dom, document: dom.window.document, errors };
}

function click(document, selector) {
  const button = document.querySelector(selector);
  assert.ok(button, "Expected " + selector);
  button.click();
}
function submit(dom, id) {
  dom.window.document
    .getElementById(id)
    .dispatchEvent(
      new dom.window.Event("submit", { bubbles: true, cancelable: true }),
    );
}

test("real demo import, all views, source navigation and persistent reading notes", async () => {
  const { dom, document, errors } = await page();
  click(document, '[data-action="demo"]');
  await until(() => document.querySelector(".stats-row"), "project overview");
  assert.match(document.querySelector("main").textContent, /校园闲置/);
  assert.ok(document.querySelectorAll(".map-node").length >= 5);
  for (const view of [
    "map",
    "features",
    "tour",
    "files",
    "handoff",
    "ask",
    "overview",
  ]) {
    click(document, `nav [data-view="${view}"]`);
    assert.ok(document.querySelector("main h1"));
  }
  click(document, 'nav [data-view="features"]');
  assert.equal(document.querySelectorAll(".feature-card").length, 3);
  click(document, '[data-feature="0"]');
  assert.match(
    document.querySelector("#modal").textContent,
    /读取内存|业务服务/,
  );
  click(document, '#modal [data-source="services/items.py"]');
  await until(() => document.querySelector(".source-drawer"), "source drawer");
  assert.match(
    document.querySelector(".code-view").textContent,
    /def list_items/,
  );
  assert.ok(document.querySelector(".code-line.highlight"));
  document.querySelector("#source-note").value =
    "核对内存存储，重启后不会持久化。";
  submit(dom, "note-form");
  await until(
    () => document.querySelector("#toast").textContent === "笔记已保存",
    "saved note",
  );
  click(document, ".source-meta [data-done]");
  await until(
    () =>
      document.querySelector(".source-meta").textContent.includes("已标记阅读"),
    "read marker",
  );
  const projects = await fetch(url + "/api/projects").then((r) => r.json());
  const p = await fetch(url + "/api/project?id=" + projects[0].id).then((r) =>
    r.json(),
  );
  assert.equal(p.progress.items["services/items.py"].done, true);
  assert.match(p.progress.items["services/items.py"].note, /重启/);
  click(document, '[data-action="close-source"]');
  click(document, 'nav [data-view="ask"]');
  document.querySelector("#question").value = "收藏在哪里实现？";
  submit(dom, "ask-form");
  await until(() => document.querySelector(".answer-block"), "answer");
  assert.ok(
    document.querySelectorAll(".answer-sources .source-link").length > 0,
  );
  assert.match(
    document.querySelector(".answer-heading").textContent,
    /本地检索/,
  );
  click(document, 'nav [data-view="features"]');
  click(document, '[data-feature="2"]');
  document.querySelector("#review-status").value = "needs_work";
  document.querySelector("#review-note").value =
    "固定演示用户，真实身份隔离仍需实现。";
  submit(dom, "review-form");
  await until(
    () =>
      document
        .querySelector(".feature-card:last-child .review-state")
        ?.textContent.includes("发现问题"),
    "human review saved",
  );
  const reviewed = await fetch(url + "/api/project?id=" + p.id).then((r) =>
    r.json(),
  );
  assert.equal(reviewed.progress.items["review:favorite"].status, "needs_work");
  assert.match(reviewed.progress.items["review:favorite"].note, /身份隔离/);
  assert.deepEqual(errors, []);
});

test("untrusted filenames and handoff line values render as text, not injected markup", async () => {
  const { dom, document, errors } = await page();
  const sourcePath = "src/<img src=x onerror=alert(1)>.py";
  const manifest = {
    version: 1,
    project: { summary: "<script>alert(1)</script>" },
    features: [
      {
        id: "x",
        title: "<img src=x>",
        summary: "Test",
        status: "implemented",
        entrypoints: [{ path: sourcePath, line: '1" onclick="alert(1)' }],
      },
    ],
    checks: [],
    risks: [],
  };
  const p = await fetch(url + "/api/import", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      name: "Untrusted <b>project</b>",
      files: [
        { path: sourcePath, content: "x = 1\n" },
        {
          path: ".aicodeaudit/handoff.json",
          content: JSON.stringify(manifest),
        },
      ],
    }),
  }).then((r) => r.json());
  click(document, '[data-action="projects"]');
  await until(
    () => document.querySelector(`[data-project="${p.id}"]`),
    "new project picker",
  );
  click(document, `[data-project="${p.id}"]`);
  await until(
    () => document.querySelector("main h1")?.textContent === p.name,
    "untrusted project loaded",
  );
  click(document, 'nav [data-view="features"]');
  assert.equal(
    document.querySelectorAll("main img, main script, main [onclick]").length,
    0,
  );
  assert.equal(
    document.querySelector(".feature-refs button").dataset.line,
    "1",
  );
  click(document, 'nav [data-view="handoff"]');
  assert.match(
    document.querySelector("main").textContent,
    /行号无效|invalid_line/,
  );
  assert.deepEqual(errors, []);
});
