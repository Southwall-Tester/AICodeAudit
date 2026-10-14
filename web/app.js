"use strict";
const $ = (s, root = document) => root.querySelector(s);
const esc = (value) =>
  String(value ?? "").replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ],
  );
const icons = {
  grid: '<rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/>',
  map: '<rect x="8" y="3" width="8" height="5" rx="1"/><rect x="2" y="16" width="7" height="5" rx="1"/><rect x="15" y="16" width="7" height="5" rx="1"/><path d="M12 8v4M5.5 16v-4h13v4"/>',
  code: '<path d="m8 7-5 5 5 5m8-10 5 5-5 5m-3-14-2 18"/>',
  route:
    '<circle cx="6" cy="5" r="2"/><circle cx="18" cy="19" r="2"/><path d="M6 7v9a3 3 0 0 0 3 3h7M18 17V8a3 3 0 0 0-3-3h-3"/>',
  file: '<path d="M14 2H5v20h14V7zM14 2v6h5M8 12h8M8 16h6"/>',
  check: '<path d="m5 12 4 4L19 6"/>',
  flag: '<path d="M5 22V3m0 0c5-4 9 4 14 0v10c-5 4-9-4-14 0"/>',
  search: '<circle cx="10.5" cy="10.5" r="6.5"/><path d="m16 16 5 5"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  arrow: '<path d="M4 12h16m-6-6 6 6-6 6"/>',
  down: '<path d="m6 9 6 6 6-6"/>',
  export: '<path d="M12 3v12m-5-5 5 5 5-5M4 16v5h16v-5"/>',
  settings:
    '<path d="M4 7h16M4 17h16"/><circle cx="9" cy="7" r="3"/><circle cx="15" cy="17" r="3"/>',
  chat: '<path d="M21 11a9 9 0 0 1-9 9 10 10 0 0 1-4-.8L3 21l1.8-5A9 9 0 1 1 21 11Z"/><path d="M8 10h8m-8 4h5"/>',
  book: '<path d="M12 5C8 2 4 3 2 4v16c3-2 7-2 10 0 3-2 7-2 10 0V4c-2-1-6-2-10 1Zm0 0v15"/>',
  close: '<path d="m6 6 12 12M6 18 18 6"/>',
  folder: '<path d="M3 5h7l2 3h9v12H3z"/>',
  refresh: '<path d="M20 7V2l-3 3A9 9 0 1 0 21 14M20 7h-5"/>',
  bolt: '<path d="m14 2-9 12h7l-2 8 9-12h-7z"/>',
  shield: '<path d="m12 2 9 4v6c0 5-9 10-9 10S3 17 3 12V6zM8 12l3 3 5-6"/>',
};
const icon = (name, cls = "") =>
  `<svg class="icon ${cls}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${icons[name] || icons.file}</svg>`;
const navs = [
  ["overview", "grid", "项目概览"],
  ["map", "map", "架构地图"],
  ["features", "bolt", "功能探索"],
  ["tour", "route", "阅读路线"],
  ["files", "code", "源码浏览"],
  ["handoff", "shield", "交接与审查"],
  ["ask", "chat", "项目问答"],
];
const roleNames = {
  ui: "界面与交互",
  api: "接口与路由",
  logic: "业务与通用逻辑",
  data: "数据与模型",
  tests: "测试",
  config: "配置与依赖",
  docs: "项目文档",
};
const S = {
  projects: [],
  p: null,
  view: "overview",
  module: null,
  fileQuery: "",
  source: null,
  answer: null,
  settings: {},
  busy: false,
};

async function api(path, data) {
  const r = await fetch(
    "/api/" + path,
    data
      ? {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(data),
        }
      : {},
  );
  const result = await r.json();
  if (!r.ok) throw new Error(result.error || "请求失败");
  return result;
}
let toastTimer;
function toast(message) {
  $("#toast").textContent = message;
  $("#toast").classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => $("#toast").classList.remove("show"), 4000);
}
function doneCount() {
  return S.p?.tour.filter((t) => S.p.progress.items[t.id]?.done).length || 0;
}
function sourceButton(path, line = 1, label) {
  line = Number.isInteger(Number(line)) && Number(line) > 0 ? Number(line) : 1;
  return `<button class="source-link" data-source="${esc(path)}" data-line="${line}">${icon("code")}${esc(label || path)}<span>L${line}</span></button>`;
}
function empty(title, text, button = "") {
  return `<div class="empty">${icon("folder")}<h3>${title}</h3><p>${text}</p>${button}</div>`;
}
function badge(text, type = "") {
  return `<span class="badge ${type}">${esc(text)}</span>`;
}

function render() {
  const p = S.p;
  $("#app").innerHTML =
    `<aside class="sidebar"><a class="brand" href="/" aria-label="AICodeAudit 首页"><span class="brand-mark">${icon("map")}</span><span>AICodeAudit<small>PROJECT UNDERSTANDING</small></span></a>
 <button class="project-picker" data-action="projects"><span class="project-avatar">${p ? esc(p.name.slice(0, 1).toUpperCase()) : "+"}</span><span>${p ? esc(p.name) : "选择项目"}<small>${p ? `${p.stats.files} 个已索引文件` : "开始一次代码探索"}</small></span>${icon("down")}</button>
 <div class="nav-label">工作台</div><nav>${navs.map(([id, i, t]) => `<button class="nav-item ${S.view === id ? "active" : ""}" data-view="${id}" ${!p ? "disabled" : ""}>${icon(i)}<span>${t}</span>${id === "handoff" && p?.handoff.present ? '<span class="nav-dot"></span>' : ""}</button>`).join("")}</nav>
 <div class="sidebar-bottom"><button class="skill-promo" data-action="skill">${icon("bolt")}<span>让 AI 交付更易懂的代码<small>搭配 Audit-ready Skill</small></span>${icon("arrow")}</button><button class="nav-item" data-action="settings">${icon("settings")}模型设置<span class="tiny-dot ${S.settings.configured ? "on" : ""}"></span></button><div class="local-status"><span></span>本地工作空间<small>v0.1</small></div></div></aside>
 <div class="workspace"><header class="topbar"><div class="crumb">工作空间<span>/</span><strong>${p ? esc(p.name) : "欢迎"}</strong>${p ? badge(p.source === "demo" ? "示例项目" : "本地项目") : ""}</div><div class="top-actions"><button class="search-trigger" data-action="search" ${!p ? "disabled" : ""}>${icon("search")}搜索文件与代码<kbd>Ctrl K</kbd></button><button class="btn small" data-action="import">${icon("plus")}导入项目</button></div></header><main id="main">${p ? projectView() : welcome()}</main><footer><span>AICodeAudit · 把生成的代码，变成你掌握的项目。</span><span>${p ? "快照 " + p.snapshot.slice(0, 8) : "本地分析 · 无需 API Key"}</span></footer></div><div id="drawer-host"></div>`;
  if (S.source) renderSource();
}

function welcome() {
  return `<section class="welcome"><span class="eyebrow">FROM GENERATED TO UNDERSTOOD</span><h1>代码生成之后，<br>从这里开始理解。</h1><p>打开一个项目，找到它的入口、结构和关键逻辑。<br>沿着源码建立自己的认识，接手每一次 AI 交付。</p><div class="welcome-actions"><button class="btn primary large" data-action="import">${icon("folder")}导入本地项目${icon("arrow")}</button><button class="btn large" data-action="demo">探索示例项目</button></div><div class="welcome-diagram"><div>${icon("folder")}一个陌生项目<small>源码 / README / 交接包</small></div><span>→</span><div>${icon("map")}看懂全貌<small>模块 / 导入关系 / 入口</small></div><span>→</span><div>${icon("route")}跟着代码走<small>阅读路径 / 证据 / 笔记</small></div></div><div class="welcome-bottom"><span>${icon("shield")}源码在本机索引</span><span>${icon("code")}优先支持 Python 与 JS / TS</span><span>${icon("bolt")}可搭配生成端 Skill</span></div></section>`;
}

function title(eyebrow, heading, subtitle, actions = "") {
  return `<div class="page-heading"><div><span class="eyebrow">${eyebrow}</span><h1>${esc(heading)}</h1><p>${esc(subtitle)}</p></div><div class="heading-actions">${actions}</div></div>`;
}

function projectView() {
  const p = S.p;
  switch (S.view) {
    case "overview":
      return overview();
    case "map":
      return (
        title(
          "PROJECT AT A GLANCE",
          "架构地图",
          "按职责查看项目结构，沿静态导入关系找到相邻实现。",
        ) +
        mapPanel(true) +
        fileList(
          S.module
            ? p.files.filter((f) => f.role === S.module)
            : p.files.filter((f) =>
                p.edges.some((e) => e.source === f.path || e.target === f.path),
              ),
          "关联源码",
        )
      );
    case "features":
      return featuresView();
    case "tour":
      return tourView();
    case "files":
      return (
        title(
          "SOURCE EXPLORER",
          "源码浏览",
          "打开索引快照中的源码，查看符号、相邻模块并记录理解。",
        ) +
        `<div class="filter-bar"><div class="input-icon">${icon("search")}<input id="file-filter" placeholder="按路径或函数名筛选…" value="${esc(S.fileQuery)}"></div><select id="role-filter" aria-label="文件职责"><option value="">全部职责</option>${Object.entries(
          roleNames,
        )
          .map(
            ([k, v]) =>
              `<option value="${k}" ${S.module === k ? "selected" : ""}>${v}</option>`,
          )
          .join(
            "",
          )}</select><span class="muted">${p.files.length} 个文件</span></div><div id="file-results">${filteredFiles()}</div>`
      );
    case "handoff":
      return handoffView();
    case "ask":
      return askView();
  }
}

function overview() {
  const p = S.p,
    total = p.tour.length,
    done = doneCount();
  return (
    title(
      "YOUR PROJECT, DECODED.",
      p.name,
      "先建立全貌，再走进每一个关键实现。",
      `<button class="btn" data-action="rescan">${icon("refresh")}重新索引</button><button class="btn primary" data-action="export">${icon("export")}导出接管报告</button>`,
    ) +
    `<div class="overview-grid"><section class="intro-card"><div class="intro-top">${badge("项目速览", "green")}<span class="mono">${esc(Object.keys(p.stats.languages).slice(0, 3).join(" / ") || "TEXT")}</span></div><h2>${p.handoff.document?.project?.summary ? esc(p.handoff.document.project.summary) : "从入口出发，理解这个项目"}</h2><p class="project-description">${esc(p.description || "项目暂未提供 README。可以先查看候选入口与核心模块，再补充功能说明。")}</p><div class="intro-foot"><span>${icon("file")}${p.description ? "简介摘自 README" : "本地源码索引"}</span><button class="text-btn" data-view="tour">开始阅读${icon("arrow")}</button></div></section>
 <section class="progress-card"><div class="section-label">我的接管进度 ${icon("route")}</div><div class="progress-number">${done}<span>/ ${total}</span><small>阅读步骤已完成</small></div><div class="progress-track"><div style="width:${total ? (done / total) * 100 : 0}%"></div></div><p>${p.progress.previous_records ? "源码快照已变化，旧版记录保留，当前需重新核对。" : "读过的代码，留下自己的理解。"}</p><button class="text-btn" data-view="tour">继续阅读${icon("arrow")}</button></section></div>
 <div class="stats-row">${[
   [p.stats.files, "已索引文件", "file"],
   [p.stats.lines.toLocaleString(), "文本行数", "code"],
   [p.modules.length, "职责分组", "grid"],
   [p.edges.length, "静态导入关系", "map"],
 ]
   .map(
     ([n, t, i]) =>
       `<div class="stat">${icon(i)}<div><strong>${n}</strong><span>${t}</span></div></div>`,
   )
   .join("")}</div>${runtimePanel()}
 <div class="content-grid"><div>${mapPanel(false)}<section class="panel"><div class="panel-heading"><h2>从这些入口开始</h2><button class="text-btn" data-view="features">探索功能${icon("arrow")}</button></div>${
   p.entries
     .slice(0, 4)
     .map(
       (e) =>
         `<div class="entry-row"><span class="entry-icon">${icon(e.type === "readme" ? "book" : "code")}</span><div>${sourceButton(e.path, e.line)}<p>${esc(e.reason)}</p></div>${icon("arrow")}</div>`,
     )
     .join("") ||
   '<p class="muted inset">没有识别到约定入口，请从源码列表选择。</p>'
 }</section></div>
 <div><section class="panel"><div class="panel-heading"><h2>推荐阅读路线</h2>${badge(total + " 步")}</div><div class="mini-tour">${p.tour
   .slice(0, 4)
   .map(
     (t, i) =>
       `<button data-source="${esc(t.path)}" data-line="${t.line}"><span class="step-index ${p.progress.items[t.id]?.done ? "completed" : ""}">${p.progress.items[t.id]?.done ? "✓" : String(i + 1).padStart(2, "0")}</span><span><strong>${esc(t.title)}</strong><small>${esc(t.path)}</small></span>${icon("arrow")}</button>`,
   )
   .join(
     "",
   )}</div><button class="panel-bottom" data-view="tour">查看完整路线${icon("arrow")}</button></section><section class="handoff-promo"><span class="eyebrow">GENERATOR → HUMAN</span><h3>${p.handoff.present ? "这次交付，有迹可循。" : "给下一次 AI 交付一份约定。"}</h3><p>${p.handoff.present ? "查看生成方的功能声明、阅读指引与证据引用。" : "让生成 AI 同步交付功能说明、源码入口和验证记录。"}</p><button class="text-btn" data-view="handoff">${p.handoff.present ? "检查交接包" : "了解交接 Skill"}${icon("arrow")}</button></section></div></div>`
  );
}

function runtimePanel() {
  const p = S.p,
    starts = Array.isArray(p.handoff.document?.start)
      ? p.handoff.document.start.filter(
          (s) => s && typeof s.command === "string",
        )
      : [];
  return `<details class="panel disclosure"><summary>启动方式与依赖 <span class="subtle-label">${starts.length + p.commands.length} 个声明脚本 · ${p.dependencies.length} 项依赖</span></summary>${starts.map((s) => `<p><code>${esc(s.command)}</code> · 目录 ${esc(s.cwd || ".")}<br>${esc(s.note || "")}</p>`).join("")}${p.commands.map((c) => `<p><code>${esc(c.runner)}</code> → <code>${esc(c.command)}</code><br>${sourceButton(c.path, 1)}</p>`).join("")}${!starts.length && !p.commands.length ? "<p>未找到结构化启动命令，请核对 README 与候选入口。</p>" : ""}${
    p.dependencies.length
      ? `<p>${p.dependencies
          .slice(0, 25)
          .map((d) => `<code>${esc(d.name)} ${esc(d.version)}</code>`)
          .join(" · ")}</p>`
      : ""
  }<p>命令来自项目声明，工作台尚未执行。</p></details>`;
}

function mapPanel(large) {
  const p = S.p,
    modules = p.modules,
    positions = {
      ui: [35, 65],
      api: [270, 65],
      data: [505, 65],
      logic: [270, 205],
      tests: [35, 205],
      config: [505, 205],
      docs: [270, 345],
    };
  const roleOf = Object.fromEntries(p.files.map((f) => [f.path, f.role]));
  const counts = new Map();
  for (const e of p.edges) {
    const a = roleOf[e.source],
      b = roleOf[e.target];
    if (a !== b) counts.set(`${a}|${b}`, (counts.get(`${a}|${b}`) || 0) + 1);
  }
  const links = [...counts]
    .map(([key, count]) => {
      const [a, b] = key.split("|"),
        [x1, y1] = positions[a],
        [x2, y2] = positions[b];
      return `<path d="M${x1 + 85} ${y1 + 30} C${x1 + 85} ${y1 + 90},${x2 + 85} ${y2 - 40},${x2 + 85} ${y2 + 30}" class="map-edge" marker-end="url(#arrowhead)"/><text x="${(x1 + x2) / 2 + 90}" y="${(y1 + y2) / 2 + 22}" class="edge-label">${count}</text>`;
    })
    .join("");
  return `<section class="panel map-panel"><div class="panel-heading"><h2>项目架构<span class="subtle-label">按文件职责推断</span></h2>${large ? '<button class="text-btn" data-action="clear-module">显示全部</button>' : '<button class="text-btn" data-view="map">展开地图' + icon("arrow") + "</button>"}</div><div class="map-canvas"><svg viewBox="0 0 710 440" role="img" aria-label="项目职责分组及静态导入关系"><defs><marker id="arrowhead" markerWidth="7" markerHeight="7" refX="6" refY="3.5" orient="auto"><path d="M0 0L7 3.5L0 7" fill="#b7beb0"/></marker><pattern id="dots" width="18" height="18" patternUnits="userSpaceOnUse"><circle cx="1" cy="1" r=".7" fill="#d7dccf"/></pattern></defs><rect width="710" height="440" fill="url(#dots)"/>${links}${modules
    .map((m) => {
      const [x, y] = positions[m.id];
      return `<g class="map-node ${S.module === m.id ? "selected" : ""}" data-module="${m.id}" tabindex="0" role="button" aria-label="查看${m.name}"><rect x="${x}" y="${y}" width="170" height="65" rx="10"/><rect x="${x + 12}" y="${y + 15}" width="5" height="34" rx="2" class="role-fill ${m.id}"/><text x="${x + 29}" y="${y + 28}" class="node-title">${m.name}</text><text x="${x + 29}" y="${y + 47}" class="node-meta">${m.files.length} files · ${m.lines} lines</text></g>`;
    })
    .join(
      "",
    )}</svg></div><div class="map-legend"><span><i></i>连线来自已解析的导入</span><span>${counts.size ? "数字为跨组导入数量" : "未解析到跨组导入"}</span><span>点击分组查看源码</span></div></section>`;
}

function fileList(files, heading = "") {
  return `<section class="panel file-panel">${heading ? `<div class="panel-heading"><h2>${heading}${S.module ? ` · ${roleNames[S.module]}` : ""}</h2><span class="muted">${files.length} 个文件</span></div>` : ""}<div class="file-table"><div class="file-row table-head"><span>文件 / 位置</span><span>职责</span><span>行数</span><span>符号</span></div>${files.map((f) => `<button class="file-row" data-source="${esc(f.path)}"><span>${icon("file")}<span>${esc(f.path)}</span>${S.p.progress.items[f.path]?.done ? icon("check", "done-icon") : ""}</span><span>${roleNames[f.role]}</span><span class="mono">${f.lines}</span><span class="mono">${f.symbols.length}</span></button>`).join("") || '<div class="inset muted">没有匹配文件。</div>'}</div></section>`;
}
function filteredFiles() {
  return fileList(
    S.p.files.filter(
      (f) =>
        (!S.module || f.role === S.module) &&
        (!S.fileQuery ||
          f.path.toLowerCase().includes(S.fileQuery.toLowerCase()) ||
          f.symbols.some((s) =>
            s.name.toLowerCase().includes(S.fileQuery.toLowerCase()),
          )),
    ),
  );
}

function featuresView() {
  const p = S.p,
    declared = (p.handoff.document?.features || [])
      .map((f, index) => ({ ...f, index }))
      .filter((f) => typeof f.title === "string");
  return (
    title(
      "FOLLOW THE BEHAVIOR",
      "功能探索",
      "从生成方描述或代码入口进入，逐步核对一个功能如何实现。",
    ) +
    `<div class="section-divider"><h2>交接包中的功能</h2>${badge("生成方声明", "amber")}</div>` +
    (declared.length
      ? `<div class="feature-grid">${declared
          .map(
            (f) =>
              `<article class="panel feature-card"><div class="feature-top"><span class="feature-icon">${icon("bolt")}</span>${badge({ implemented: "声明已实现", partial: "部分实现", planned: "计划中" }[f.status] || "状态未填写", f.status === "partial" ? "amber" : "")}</div><h3>${esc(f.title)}</h3><p>${esc(f.summary)}</p><div class="feature-refs">${(Array.isArray(
                f.entrypoints,
              )
                ? f.entrypoints
                : []
              )
                .filter((r) => r && typeof r.path === "string")
                .map((r) => sourceButton(r.path, r.line))
                .join(
                  "",
                )}</div><div class="review-state">${badge({ confirmed: "人工确认", needs_work: "发现问题", pending: "待核实" }[p.progress.items["review:" + f.id]?.status] || "待核实", p.progress.items["review:" + f.id]?.status === "confirmed" ? "green" : "amber")}</div><button class="text-btn" data-feature="${f.index}">阅读路径与人工审查${icon("arrow")}</button></article>`,
          )
          .join("")}</div>`
      : empty(
          "还没有功能交接说明",
          "可使用 Audit-ready Skill 为项目补充功能与源码入口。",
          '<button class="btn" data-action="skill">查看 Skill</button>',
        )) +
    `<div class="section-divider"><h2>从代码发现的接口入口</h2>${badge("静态提取")}</div><div class="panel">${p.endpoints.map((e) => `<div class="endpoint-row"><span class="method ${e.method === "GET" ? "get" : ""}">${esc(e.method)}</span><div><strong class="mono">${esc(e.route)}</strong><small>${esc(e.name)} · ${e.confidence === "ast" ? "Python AST" : "启发式识别"}</small></div>${sourceButton(e.path, e.line)}</div>`).join("") || '<p class="inset muted">未识别到受支持的路由写法，可从源码浏览或交接包继续探索。</p>'}</div>`
  );
}

function tourView() {
  const p = S.p;
  return (
    title(
      "A GUIDED WAY IN",
      "阅读路线",
      "从项目约定到入口、核心逻辑和测试，按步骤建立理解。",
      badge(`${doneCount()} / ${p.tour.length} 已读`, "green"),
    ) +
    `<div class="tour-layout"><div>${p.tour
      .map((t, i) => {
        const done = p.progress.items[t.id]?.done;
        return `<article class="tour-step ${done ? "is-done" : ""}"><div class="tour-rail"><button class="step-index ${done ? "completed" : ""}" data-done="${esc(t.id)}" aria-label="${done ? "取消完成" : "标记已读"} ${esc(t.title)}">${done ? icon("check") : String(i + 1).padStart(2, "0")}</button></div><div class="panel tour-body"><div class="tour-title"><h3>${esc(t.title)}</h3>${badge(done ? "已读" : "待阅读", done ? "green" : "")}</div><p>${esc(t.why)}</p>${sourceButton(t.path, t.line)}${p.progress.items[t.id]?.note ? `<div class="note-preview">${esc(p.progress.items[t.id].note)}</div>` : ""}</div></article>`;
      })
      .join(
        "",
      )}</div><aside class="reading-tip"><span class="eyebrow">READ WITH A QUESTION</span><h3>每一步，弄清一件事。</h3><ol><li>这里接收什么输入？</li><li>它改变了什么状态？</li><li>失败时会发生什么？</li><li>有哪些证据可以核实？</li></ol><p>打开源码后可以记笔记、标记已读。记录绑定当前快照，重新索引产生新快照后需复核。</p><button class="btn" data-action="export">${icon("export")}导出阅读记录</button></aside></div>`
  );
}

function handoffView() {
  const p = S.p,
    h = p.handoff,
    d = h.document;
  return (
    title(
      "CLAIMS MEET CODE",
      "交接与审查",
      "把生成方声明放在源码旁边，逐项核对可追溯的依据。",
      '<button class="btn" data-action="skill">' +
        icon("bolt") +
        "生成端 Skill</button>",
    ) +
    `<div class="handoff-status"><span class="status-symbol">${icon(h.present ? "shield" : "file")}</span><div><h2>${!h.present ? "项目尚未附带交接包" : h.valid ? "引用检查通过" : "交接包有待处理项"}</h2><p>${!h.present ? "加入 .aicodeaudit/handoff.json，连接生成端与理解端。" : "检查文件存在、行号与源码指纹；功能正确性和测试真实性仍需核实。"}</p></div>${badge(h.present ? h.references.length + " 个引用" : "协议 v1", h.valid ? "green" : "amber")}</div>` +
    (h.errors.length
      ? `<section class="panel"><div class="panel-heading"><h2>交接检查结果</h2>${badge(h.errors.length + " 项", "amber")}</div>${h.errors.map((e) => `<div class="issue-row">${icon("flag")}<p>${esc(e)}</p></div>`).join("")}</section>`
      : "") +
    (h.references.length
      ? `<section class="panel"><div class="panel-heading"><h2>引用与版本</h2></div>${h.references.map((r) => `<div class="reference-row">${typeof r.path === "string" ? sourceButton(r.path, r.line) : "<span>无效路径</span>"}${badge({ matched: "引用匹配", unpinned: "未固定版本", stale: "源码已变化", missing: "文件缺失", invalid_line: "行号无效", invalid_path: "路径无效" }[r.state], r.state === "matched" ? "green" : "amber")}</div>`).join("")}</section>`
      : "") +
    (d
      ? `<div class="two-col"><section class="panel"><div class="panel-heading"><h2>生成方验证记录</h2>${badge("未由工作台复跑")}</div>${
          (Array.isArray(d.checks) ? d.checks : [])
            .filter((c) => c && typeof c === "object")
            .map(
              (c) =>
                `<div class="check-record"><div><strong>${esc(c.name)}</strong>${badge({ passed: "声明通过", failed: "声明失败", not_run: "尚未运行" }[c.status] || "未知", c.status === "passed" ? "green" : "amber")}</div><code>${esc(c.command)}</code>${c.ran_at ? `<small>${esc(c.ran_at)} · exit ${esc(c.exit_code)}</small>` : ""}${c.evidence?.path ? sourceButton(c.evidence.path, c.evidence.line) : ""}</div>`,
            )
            .join("") || '<p class="inset muted">没有验证记录。</p>'
        }</section><section class="panel"><div class="panel-heading"><h2>生成方已知限制</h2></div>${
          (Array.isArray(d.risks) ? d.risks : [])
            .filter((r) => r && typeof r === "object")
            .map(
              (r) =>
                `<div class="risk-record"><strong>${esc(r.title)}</strong><p>${esc(r.detail)}</p></div>`,
            )
            .join("") ||
          '<p class="inset muted">没有声明限制，不代表不存在问题。</p>'
        }</section></div>`
      : "") +
    `<section class="panel"><div class="panel-heading"><h2>源码中的待确认项</h2>${badge(p.issue_total + " 个标记")}</div>${p.issues.map((i) => `<div class="issue-row">${icon("flag")}<div><strong>${esc(i.title)}</strong><p>${esc(i.detail)}</p>${sourceButton(i.path, i.line)}</div></div>`).join("") || '<p class="inset muted">未发现当前规则覆盖的待完成或解析错误标记。此结果不是全面缺陷审查。</p>'}</section><details class="panel disclosure"><summary>索引范围与分析边界</summary><p>${esc(p.limits)}</p><p>未解析的相对导入 / 别名：${p.unresolved.length} 个（最多列出 80 个）。目录扫描采用基础 .gitignore 规则，不支持否定规则。单文件上限 350 KB，总计 12 MB，最多 1500 个文件。</p><p>跳过统计：${esc(JSON.stringify(p.skipped))}</p>${p.unresolved
      .slice(0, 15)
      .map(
        (r) => `<p class="mono">${esc(r.path)}:${r.line} → ${esc(r.spec)}</p>`,
      )
      .join("")}</details>`
  );
}

function askView() {
  return (
    title(
      "ASK WITH CONTEXT",
      "项目问答",
      "带着问题定位源码，沿引用继续探索。",
    ) +
    `<div class="ask-layout"><section class="panel ask-panel"><div class="ask-intro"><span class="feature-icon">${icon("chat")}</span><h2>你想先弄懂什么？</h2><p>试着从一个功能、一次请求或你想做的修改开始。</p><div class="suggestions">${["这个项目从哪里启动？", "登录和权限在哪里实现？", "有哪些测试和未完成项？"].map((q) => `<button class="btn" data-question="${q}">${q}</button>`).join("")}</div></div><form id="ask-form"><textarea id="question" rows="3" maxlength="2000" placeholder="例如：我想修改登录规则，应该先读哪些文件？" required></textarea><div class="composer-bottom"><label><input type="checkbox" id="use-model" ${S.settings.configured ? "" : "disabled"}> 使用已配置模型</label><button class="btn primary" type="submit">查找与解答${icon("arrow")}</button></div></form><p class="privacy-note">本地模式返回关键词匹配和代码关系。启用模型时，会将问题及检索片段发送到你配置的接口。</p><div id="answer">${answerHTML()}</div></section><aside class="reading-tip"><span class="eyebrow">EVIDENCE FIRST</span><h3>答案后面，有源码。</h3><p>从引用打开文件，阅读完整上下文。模型解释是辅助判断，运行行为仍需实际验证。</p><button class="btn" data-action="settings">${icon("settings")}配置模型</button></aside></div>`
  );
}
function answerHTML() {
  const a = S.answer;
  return a
    ? `<div class="answer-block"><div class="answer-heading">${icon("chat")} ${a.mode === "model" ? "模型回答" : "本地检索结果"}${badge(a.mode === "model" ? "基于检索片段" : "无需外部服务")}</div><div class="answer-text">${esc(a.answer)}</div><div class="answer-sources">${a.sources.map((r) => sourceButton(r.path, r.line)).join("")}</div></div>`
    : "";
}

async function loadProject(id) {
  S.p = await api("project?id=" + encodeURIComponent(id));
  S.source = null;
  S.module = null;
  S.answer = null;
  localStorage.setItem("audit-project", id);
  render();
}
async function importProject(data) {
  if (S.busy) return;
  S.busy = true;
  const busy = $("#import-status");
  if (busy) busy.textContent = "正在读取源码并建立索引…";
  try {
    const p = await api("import", data);
    S.projects = await api("projects");
    S.view = "overview";
    await loadProject(p.id);
    $("#modal").close();
    toast(`已索引 ${p.stats.files} 个文件`);
  } finally {
    S.busy = false;
    if (busy) busy.textContent = "";
  }
}

function modal(content) {
  const el = $("#modal");
  el.innerHTML = `<button class="modal-close icon-btn" data-action="close-modal" aria-label="关闭">${icon("close")}</button>${content}`;
  if (!el.open) el.showModal();
}
function importModal() {
  modal(
    `<span class="eyebrow">OPEN A PROJECT</span><h2>导入一个项目</h2><p>选择 AI 生成的项目文件夹，或填写本机目录。</p><form id="import-form"><label class="field-label" for="project-path">项目绝对路径</label><input id="project-path" placeholder="C:\\Projects\\my-app 或 /home/me/my-app" required><button class="btn primary wide" type="submit">${icon("folder")}读取并分析</button></form><div class="or-divider">或</div><label class="folder-upload">${icon("plus")}从文件选择器导入文件夹<input id="folder-upload" type="file" webkitdirectory multiple hidden></label><p class="muted small-text">忽略依赖、构建产物及常见密钥文件。原项目保持只读，索引保存在本机 .local 目录。</p><div id="import-status" role="status"></div><button class="text-btn" data-action="demo">先探索内置示例${icon("arrow")}</button>`,
  );
}

function skillModal() {
  modal(
    `<span class="eyebrow">THE OTHER HALF OF THE WORKFLOW</span><h2>Audit-ready Skill</h2><p>让生成代码的 AI 同步准备一份可核对的交接包。</p><div class="skill-flow"><span>AI 编写代码</span>${icon("arrow")}<span>交接包 + 证据</span>${icon("arrow")}<span>工作台审查</span></div><ol class="skill-instructions"><li>将仓库中的 <code>skills/audit-ready</code> 复制到你的 AI 工具支持的 Skills 目录；也可以直接让 AI 阅读其中的 SKILL.md。</li><li>生成或修改项目时，要求使用 <code>$audit-ready</code>，同步维护功能、源码入口、阅读步骤和验证记录。</li><li>将项目导入工作台，在「功能探索」与「交接与审查」中核对声明和源码。</li></ol><div class="code-box">使用 $audit-ready 完成这个项目，交付代码、启动说明，以及 .aicodeaudit/handoff.json。未运行的检查请明确标记。</div><p class="muted">附带独立 Python 校验器，可检查文件、行号与内容指纹；不会执行被审查项目。</p>`,
  );
}

async function openSource(path, line = 1) {
  const data = await api(
    "source?id=" +
      encodeURIComponent(S.p.id) +
      "&path=" +
      encodeURIComponent(path),
  );
  S.source = { ...data, line: Number(line) || 1 };
  if ($("#modal").open) $("#modal").close();
  renderSource();
}
function renderSource() {
  const d = S.source,
    p = S.p,
    f = p.files.find((f) => f.path === d.path),
    progress = p.progress.items[d.path] || {},
    lines = d.content.split("\n");
  $("#drawer-host").innerHTML =
    `<div class="drawer-backdrop" data-action="close-source"></div><aside class="source-drawer" role="dialog" aria-label="源码阅读"><header class="drawer-header"><div>${icon("code")}<strong>${esc(d.path)}</strong></div><button class="icon-btn" data-action="close-source" aria-label="关闭源码">${icon("close")}</button></header><div class="source-meta">${badge(f.language)}<span>${f.lines} 行</span><span>快照 ${p.snapshot.slice(0, 8)}</span><button class="text-btn" data-done="${esc(d.path)}">${icon(progress.done ? "check" : "plus")}${progress.done ? "已标记阅读" : "标记已读"}</button></div><div class="source-scroll"><div class="code-view">${lines.map((text, i) => `<div class="code-line ${i + 1 === d.line ? "highlight" : ""}" id="source-line-${i + 1}"><span class="line-no">${i + 1}</span><code>${esc(text) || " "}</code></div>`).join("")}</div></div><div class="source-bottom"><details><summary>符号与关联文件 <span>${f.symbols.length} 个符号 · ${d.related.length} 个关联</span></summary><div class="symbol-list">${f.symbols
      .slice(0, 60)
      .map(
        (s) =>
          `<button class="chip" data-source="${esc(d.path)}" data-line="${s.line}">${esc(s.name)} <small>L${s.line}</small></button>`,
      )
      .join(
        "",
      )}</div>${d.related.map((r) => `<div class="related-row">${badge(r.direction === "dependency" ? "导入依赖" : "被其导入")}${sourceButton(r.path, 1)}</div>`).join("") || '<p class="muted">没有解析到静态导入关联。</p>'}</details><form id="note-form"><label class="field-label" for="source-note">我的理解与待确认问题</label><div class="note-composer"><textarea id="source-note" rows="2" maxlength="5000" placeholder="用自己的话记下这里做了什么…">${esc(progress.note || "")}</textarea><button class="btn" type="submit">保存笔记</button></div></form></div></aside>`;
  requestAnimationFrame(() => {
    const target = $("#source-line-" + d.line),
      container = $(".source-scroll");
    if (target && container)
      container.scrollTop = Math.max(
        0,
        target.offsetTop - container.offsetTop - 90,
      );
  });
}
async function saveProgress(path, value) {
  const p = S.p;
  p.progress = await api("progress", {
    id: p.id,
    snapshot: p.snapshot,
    key: path,
    value,
  });
  render();
}

async function searchModal() {
  modal(
    `<span class="eyebrow">FIND YOUR WAY</span><h2>搜索项目</h2><form id="search-form"><div class="search-composer"><input id="search-query" placeholder="文件名、函数名或关键词" autofocus required><button class="btn primary">搜索</button></div></form><div id="search-results" class="search-results"><p class="muted">搜索当前索引中的文件路径与源码。</p></div>`,
  );
  $("#search-query").focus();
}

document.addEventListener("click", async (event) => {
  const el = event.target.closest("button, [data-module], [data-action]");
  if (!el || el.disabled) return;
  try {
    if (el.dataset.view) {
      S.view = el.dataset.view;
      S.module = null;
      S.source = null;
      render();
      window.scrollTo(0, 0);
      return;
    }
    if (el.dataset.source) {
      await openSource(el.dataset.source, el.dataset.line);
      return;
    }
    if (el.dataset.module) {
      S.module = el.dataset.module;
      S.view = "map";
      S.source = null;
      render();
      return;
    }
    if (el.dataset.done) {
      const path = el.dataset.done,
        v = S.p.progress.items[path] || {};
      await saveProgress(path, {
        ...v,
        note: S.source?.path === path ? $("#source-note").value : v.note || "",
        done: !v.done,
      });
      return;
    }
    if (el.dataset.project) {
      await loadProject(el.dataset.project);
      $("#modal").close();
      return;
    }
    if (el.dataset.question) {
      $("#question").value = el.dataset.question;
      $("#question").focus();
      return;
    }
    if (el.dataset.feature !== undefined) {
      const f = S.p.handoff.document.features[Number(el.dataset.feature)],
        review = S.p.progress.items["review:" + f.id] || {};
      modal(
        `<span class="eyebrow">FEATURE WALKTHROUGH</span><h2>${esc(f.title)}</h2><p>${esc(f.summary)}</p>${badge("生成方建议的阅读顺序")}<div class="feature-flow">${
          (Array.isArray(f.flow) ? f.flow : [])
            .filter((r) => r && typeof r.path === "string")
            .map(
              (r, i) =>
                `<div><span class="step-index">${i + 1}</span><section>${sourceButton(r.path, r.line)}<p>${esc(r.note)}</p></section></div>`,
            )
            .join("") || "<p>交接包尚未提供分步说明。</p>"
        }</div><h3>作者列出的验收条件</h3><ul>${(Array.isArray(f.acceptance) ? f.acceptance : []).map((a) => `<li>${esc(a)}</li>`).join("")}</ul><form id="review-form" data-key="${esc("review:" + f.id)}"><label class="field-label" for="review-status">我的审查结论</label><select id="review-status">${[
          ["pending", "待核实"],
          ["confirmed", "人工确认"],
          ["needs_work", "发现问题"],
        ]
          .map(
            ([v, t]) =>
              `<option value="${v}" ${review.status === v ? "selected" : ""}>${t}</option>`,
          )
          .join(
            "",
          )}</select><label class="field-label" for="review-note">依据与待办</label><textarea id="review-note" rows="3" maxlength="5000" placeholder="记录你检查过的行为、证据或发现的问题…">${esc(review.note || "")}</textarea><button class="btn primary wide" type="submit">保存人工结论</button></form>`,
      );
      return;
    }
    switch (el.dataset.action) {
      case "import":
        importModal();
        break;
      case "demo":
        await importProject({ demo: true });
        break;
      case "close-modal":
        $("#modal").close();
        break;
      case "close-source":
        S.source = null;
        $("#drawer-host").innerHTML = "";
        break;
      case "clear-module":
        S.module = null;
        render();
        break;
      case "skill":
        skillModal();
        break;
      case "search":
        await searchModal();
        break;
      case "projects":
        S.projects = await api("projects");
        modal(
          `<span class="eyebrow">YOUR WORKSPACE</span><h2>我的项目</h2><div class="project-list">${S.projects.map((p) => `<div><button data-project="${p.id}"><span class="project-avatar">${esc(p.name.slice(0, 1).toUpperCase())}</span><span><strong>${esc(p.name)}</strong><small>${p.stats.files} 个文件 · ${p.snapshot.slice(0, 8)}</small></span>${icon("arrow")}</button><button class="icon-btn remove-project" data-delete="${p.id}" aria-label="移除 ${esc(p.name)} 的本地索引">${icon("close")}</button></div>`).join("") || "<p>还没有导入项目。</p>"}</div><button class="btn primary wide" data-action="import">${icon("plus")}导入新项目</button>`,
        );
        break;
      case "settings":
        S.settings = await api("settings");
        modal(
          `<span class="eyebrow">OPTIONAL INTELLIGENCE</span><h2>模型设置</h2><p>连接兼容 Chat Completions 的远程接口或本地模型。</p><form id="settings-form"><label class="field-label">完整接口地址<input id="model-endpoint" type="url" placeholder="http://localhost:1234/v1/chat/completions" value="${esc(S.settings.endpoint)}"></label><label class="field-label">模型名称<input id="model-name" placeholder="填写服务提供的模型 ID" value="${esc(S.settings.model)}"></label><label class="field-label">API Key<input id="model-key" type="password" autocomplete="off" placeholder="${S.settings.has_key ? "已设置，留空保留" : "本地模型可留空"}"></label><p class="muted small-text">设置仅保存在当前服务进程内。问答中勾选使用模型后，才会发送问题和相关代码片段。源码中的敏感内容请在启用前确认。</p><button class="btn primary wide">保存设置</button></form>`,
        );
        break;
      case "rescan":
        if (S.busy) return;
        S.busy = true;
        toast("正在重新索引…");
        try {
          await api("rescan", { id: S.p.id });
          await loadProject(S.p.id);
          toast("索引已更新；阅读记录按源码快照保存");
        } finally {
          S.busy = false;
        }
        break;
      case "export": {
        const r = await fetch("/api/report?id=" + S.p.id);
        if (!r.ok) throw new Error("导出失败");
        const blob = await r.blob(),
          url = URL.createObjectURL(blob),
          a = document.createElement("a");
        a.href = url;
        a.download = S.p.name.replace(/[\\/:*?"<>|]/g, "_") + "-接管报告.md";
        a.click();
        setTimeout(() => URL.revokeObjectURL(url), 1000);
        toast("报告已导出");
        break;
      }
    }
    if (el.dataset.delete) {
      const id = el.dataset.delete;
      modal(
        `<h2>移除本地项目索引？</h2><p>这会删除工作台保存的源码快照和阅读记录，原项目文件保持不变。</p><button class="btn danger" data-confirm-delete="${id}">移除索引</button>`,
      );
    }
    if (el.dataset.confirmDelete) {
      await api("delete", { id: el.dataset.confirmDelete });
      S.projects = await api("projects");
      if (S.p?.id === el.dataset.confirmDelete) {
        S.p = null;
        S.source = null;
        localStorage.removeItem("audit-project");
      }
      $("#modal").close();
      render();
      toast("本地索引已移除");
    }
  } catch (e) {
    toast(e.message);
  }
});

document.addEventListener("submit", async (event) => {
  event.preventDefault();
  const form = event.target,
    button = form.querySelector('button[type="submit"], button');
  if (button) button.disabled = true;
  try {
    switch (form.id) {
      case "import-form":
        await importProject({ path: $("#project-path").value.trim() });
        break;
      case "settings-form":
        await api("settings", {
          endpoint: $("#model-endpoint").value,
          model: $("#model-name").value,
          key: $("#model-key").value,
        });
        S.settings = await api("settings");
        $("#modal").close();
        render();
        toast("设置已保存到当前进程");
        break;
      case "note-form":
        await saveProgress(S.source.path, {
          ...S.p.progress.items[S.source.path],
          note: $("#source-note").value,
        });
        toast("笔记已保存");
        break;
      case "review-form":
        await saveProgress(form.dataset.key, {
          status: $("#review-status").value,
          note: $("#review-note").value,
        });
        $("#modal").close();
        toast("人工审查结论已保存");
        break;
      case "search-form": {
        const hits = await api(
          "search?id=" +
            S.p.id +
            "&q=" +
            encodeURIComponent($("#search-query").value),
        );
        $("#search-results").innerHTML =
          hits
            .map(
              (h) =>
                `<div class="search-hit">${sourceButton(h.path, h.line)}<p>${esc(h.text)}</p></div>`,
            )
            .join("") ||
          '<p class="muted">没有匹配结果，试试文件名或函数名。</p>';
        break;
      }
      case "ask-form": {
        const question = $("#question").value,
          use_model = $("#use-model").checked;
        $("#answer").innerHTML =
          '<div class="loading"><span class="spinner"></span>正在查找相关代码' +
          (use_model ? "并请求模型" : "") +
          "…</div>";
        S.answer = await api("ask", {
          id: S.p.id,
          snapshot: S.p.snapshot,
          question,
          use_model,
        });
        $("#answer").innerHTML = answerHTML();
        break;
      }
    }
  } catch (e) {
    toast(e.message);
    if (form.id === "ask-form")
      $("#answer").innerHTML = `<p class="error-text">${esc(e.message)}</p>`;
  } finally {
    if (button) button.disabled = false;
  }
});
document.addEventListener("input", (e) => {
  if (e.target.id === "file-filter") {
    S.fileQuery = e.target.value;
    $("#file-results").innerHTML = filteredFiles();
  }
});
document.addEventListener("change", async (e) => {
  if (e.target.id === "role-filter") {
    S.module = e.target.value || null;
    $("#file-results").innerHTML = filteredFiles();
  }
  if (e.target.id === "folder-upload") {
    try {
      const selected = [...e.target.files],
        name = selected[0]?.webkitRelativePath.split("/")[0] || "Project";
      let total = 0;
      const files = [];
      const status = $("#import-status");
      status.textContent = "正在读取所选文件…";
      const excluded =
        /(^|\/)(node_modules|\.git|\.venv|venv|dist|build|\.next|\.local|__pycache__|vendor)(\/|$)/;
      for (const f of selected) {
        const path = f.webkitRelativePath.split("/").slice(1).join("/");
        if (excluded.test(path) || f.size > 350000 || /(^|\/)\.env/.test(path))
          continue;
        if (
          !/\.(py|js|jsx|ts|tsx|mjs|cjs|vue|svelte|json|md|toml|yaml|yml|html|css|scss|sql|go|rs|java|sh|bat|ps1|txt)$|(^|\/)(Dockerfile|Makefile|Procfile|\.gitignore)$/i.test(
            path,
          )
        )
          continue;
        total += f.size;
        if (total > 12000000 || files.length >= 1500)
          throw new Error("文件夹超过浏览器导入限额，请改用本机路径导入。");
        files.push({ path, content: await f.text() });
      }
      await importProject({ files, name });
    } catch (err) {
      toast(err.message);
      if ($("#import-status"))
        $("#import-status").textContent = "导入未完成，请重试或使用本机路径。";
    }
  }
});
document.addEventListener("keydown", (e) => {
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k" && S.p) {
    e.preventDefault();
    searchModal();
  }
  if (e.key === "Escape" && S.source) {
    S.source = null;
    $("#drawer-host").innerHTML = "";
  }
  if (e.key === "Enter" && e.target.dataset.module)
    e.target.dispatchEvent(new MouseEvent("click", { bubbles: true }));
});

(async () => {
  try {
    [S.projects, S.settings] = await Promise.all([
      api("projects"),
      api("settings"),
    ]);
    const last = localStorage.getItem("audit-project");
    if (last && S.projects.some((p) => p.id === last)) await loadProject(last);
    else render();
  } catch (e) {
    render();
    toast("无法连接本地服务：" + e.message);
  }
})();
