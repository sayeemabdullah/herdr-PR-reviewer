// PR Panel: a full-screen terminal UI with four tabs.
//   Inbox     AI reviews waiting for your final word: read, edit, post or discard
//   Repos     which repos are watched; add (pick from your GitHub repos) and remove in a keypress
//   Settings  model, effort, final word and the rest of config.json
//   History   what was posted, discarded or failed
// No dependencies: raw-mode keys and ANSI. Works in any terminal (herdr pane, Herdr app, iTerm...).
import { execFile, spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import readline from "node:readline";
import {
  CONFIG_FILE, ROOT, deleteDraft, getReviewed, listActiveReviews, listDrafts, loadConfig, markReviewed,
  parsePRUrl, postReview, saveDraft, settingsFor, watcherRunning,
} from "./lib.js";
import {
  FIELDS, MODELS, addRepo, cycle, effective, parseNumber, parseRepo, readRaw, removeRepo, repoList,
  setRepoValue, setValue, writeRaw,
} from "./settings.js";

// ---------- styling ----------

const E = {
  reset: "\x1b[0m", bold: "\x1b[1m", dim: "\x1b[2m", inv: "\x1b[7m", strike: "\x1b[9m", under: "\x1b[4m",
  red: "\x1b[31m", green: "\x1b[32m", yellow: "\x1b[33m", blue: "\x1b[34m", magenta: "\x1b[35m", cyan: "\x1b[36m",
  gray: "\x1b[90m",
};
const paint = (s, ...codes) => codes.map((c) => E[c]).join("") + s + E.reset;
const strip = (s) => s.replace(/\x1b\[[0-9;]*m/g, "");
const vlen = (s) => [...strip(s)].length;

/** Truncate a (possibly styled) string to `w` visible chars, with "…", and pad to exactly `w`. */
function fit(s, w) {
  const toks = s.match(/\x1b\[[0-9;]*m|[^\x1b]/gu) ?? [];
  const total = toks.filter((t) => !t.startsWith("\x1b")).length;
  let o = "", n = 0;
  for (const t of toks) {
    if (t.startsWith("\x1b")) { o += t; continue; }
    if (total > w && n === w - 1) { o += "…"; n++; break; }
    if (n >= w) break;
    o += t; n++;
  }
  return o + E.reset + " ".repeat(Math.max(0, w - n));
}
const fitPlain = (s, w) => fit(String(s).replace(/\s+/g, " "), w);

/** Word-wrap plain text to width `w`, keeping list-item indentation as a hanging indent. */
function wrap(text, w, indent = "") {
  const res = [];
  for (const raw of String(text).split("\n")) {
    if (!raw.trim()) { res.push(""); continue; }
    const lead = /^(\s*(?:[-*•]|\d+[.)])?\s*)/.exec(raw)[1];
    const hang = indent + " ".repeat(Math.min(lead.length, 8));
    let line = indent + lead;
    let fresh = true;
    for (let word of raw.slice(lead.length).split(/\s+/).filter(Boolean)) {
      while (word.length > w - hang.length) { // hard-split very long tokens (URLs, paths)
        if (!fresh) { res.push(line); line = hang; }
        res.push(line + word.slice(0, w - hang.length));
        word = word.slice(w - hang.length);
        line = hang; fresh = true;
      }
      if (!fresh && line.length + 1 + word.length > w) { res.push(line); line = hang + word; }
      else line += (fresh ? "" : " ") + word;
      fresh = false;
    }
    res.push(line);
  }
  return res;
}

/** Light markdown: headings, **bold**, `code`. Applied per wrapped line. */
const md = (l) =>
  /^\s*#{1,6} /.test(l)
    ? paint(l.replace(/^(\s*)#{1,6} /, "$1"), "bold", "blue")
    : l.replace(/\*\*([^*]+)\*\*/g, (_, x) => paint(x, "bold")).replace(/`([^`]+)`/g, (_, x) => paint(x, "cyan"));

const VERDICT = {
  request_changes: { label: "CHANGES", color: "red", event: "REQUEST_CHANGES", words: "request changes" },
  comment: { label: "COMMENT", color: "yellow", event: "COMMENT", words: "comment" },
  approve: { label: "APPROVE", color: "green", event: "APPROVE", words: "approve" },
};
const badge = (v) => paint(` ${(VERDICT[v]?.label ?? v).padEnd(7)} `, "inv", VERDICT[v]?.color ?? "gray");

function age(iso) {
  const s = (Date.now() - new Date(iso).getTime()) / 1000;
  if (!Number.isFinite(s)) return "";
  if (s < 60) return "now";
  if (s < 3600) return `${Math.floor(s / 60)}m`;
  if (s < 86400) return `${Math.floor(s / 3600)}h`;
  return `${Math.floor(s / 86400)}d`;
}
const shortRepo = (r) => r.split("/")[1] ?? r;
const included = (d) => d.comments.filter((c) => !c.excluded);
const rule = (W) => paint("─".repeat(W), "gray");
const pad = (lines, h) => [...lines.slice(0, h), ...Array(Math.max(0, h - lines.length)).fill("")];
const bar = (left, right, W) => left + " ".repeat(Math.max(1, W - vlen(left) - vlen(right) - 1)) + right;

// ---------- non-interactive fallback ----------

if (!process.stdin.isTTY || !process.stdout.isTTY) {
  const ds = listDrafts();
  console.log(`PR Panel: ${ds.length} review(s) waiting`);
  for (const d of ds) console.log(`  ${VERDICT[d.verdict]?.label ?? d.verdict}  ${d.repo}#${d.number}  ${d.title}`);
  process.exit(0);
}

// ---------- state ----------

const out = process.stdout;
const TABS = ["inbox", "repos", "settings", "history"];
let tab = "inbox";
let drafts = [];
let cur = null; // review open in the inbox (detail view)
const sel = { inbox: 0, repos: 0, settings: 0 };
let scroll = 0; // detail / history scroll offset
let input = null; // { label, value, hint, onSubmit } — one-line text prompt
let confirm = null; // { label, onYes }
let choice = null; // { label, options: [[key, label, fn]] }
let picker = null; // { query, sel, items, loading, error } — add-a-repo picker
let help = false;
let flash = null; // { text, color, until }
let busy = null; // text shown while a blocking op runs
const remote = {}; // key -> { checking, sha, state } — live PR status from GitHub

function refresh() {
  drafts = listDrafts();
  sel.inbox = Math.max(0, Math.min(sel.inbox, drafts.length - 1));
  if (cur && !drafts.some((d) => d.key === cur.key)) {
    if (tab === "inbox") setFlash("That review was handled elsewhere.", "yellow");
    cur = null;
  } else if (cur) {
    cur = drafts.find((d) => d.key === cur.key); // pick up on-disk edits
  }
}
function setFlash(text, color = "green", ms = 4000) {
  flash = { text, color, until: Date.now() + ms };
  setTimeout(render, ms + 50);
}
function readRawSafe() {
  try { return { raw: readRaw() }; } catch (e) { return { error: e.message }; }
}

/** Ask GitHub (async) whether the PR moved on since the review was written. */
function checkRemote(d) {
  if (remote[d.key]?.checking || (remote[d.key] && Date.now() - remote[d.key].at < 60_000)) return;
  remote[d.key] = { checking: true, at: Date.now() };
  execFile("gh", ["pr", "view", String(d.number), "--repo", d.repo, "--json", "headRefOid,state"], (err, stdout) => {
    try {
      const j = JSON.parse(stdout);
      remote[d.key] = { sha: j.headRefOid, state: j.state, at: Date.now() };
    } catch {
      remote[d.key] = { error: true, at: Date.now() };
    }
    render();
  });
}
function remoteNote(d) {
  const r = remote[d.key];
  if (!r || r.checking) return paint("checking GitHub…", "gray");
  if (r.error) return paint("couldn't reach GitHub", "gray");
  if (r.state && r.state !== "OPEN") return paint(`PR is ${r.state.toLowerCase()}`, "yellow", "bold");
  if (r.sha !== d.headSha) return paint("new commits since this review", "yellow", "bold");
  return paint("up to date", "green");
}
const moved = (d) => {
  const r = remote[d.key];
  return r && !r.checking && !r.error && (r.state !== "OPEN" || r.sha !== d.headSha);
};

// ---------- frame: tabs on top, hints at the bottom ----------

function statusRight() {
  const active = listActiveReviews();
  const parts = [watcherRunning() ? paint("● watching", "green") : paint("○ watcher off", "gray")];
  if (active.length) parts.push(paint(`reviewing ${active.map((k) => k.split("/")[1] ?? k).join(", ")}`, "cyan"));
  return parts.join(paint("  ·  ", "gray")) + " ";
}

function tabStrip(W) {
  const { raw } = readRawSafe();
  const count = { inbox: drafts.length, repos: raw ? repoList(raw).length : 0 };
  const name = { inbox: "Inbox", repos: "Repos", settings: "Settings", history: "History" };
  const parts = TABS.map((t) => {
    const n = count[t] !== undefined ? ` ${count[t]}` : "";
    if (t === tab) return paint(` ${name[t]}${n} `, "inv", "cyan", "bold");
    return " " + paint(name[t], "bold") + (n ? paint(n, t === "inbox" && count[t] ? "yellow" : "gray") : "") + " ";
  });
  const left = paint(" PR Panel ", "inv", "bold") + "  " + parts.join(paint("│", "gray"));
  return [bar(left, statusRight(), W), rule(W)];
}

/** "key label" pairs, as many as fit, keys highlighted. */
function hints(pairs, W) {
  const items = pairs.map(([k, l]) => paint(k, "cyan", "bold") + " " + paint(l, "gray"));
  let line = " ";
  for (const it of items) {
    if (vlen(line) + vlen(it) + 3 > W) break;
    line += it + "   ";
  }
  return line;
}

/** The two bottom lines: a message line (prompt / confirm / flash / tip) and key hints. */
function bottom(pairs, tip, W) {
  let msg;
  if (busy) msg = paint(` ${busy}`, "cyan", "bold");
  else if (confirm) msg = " " + confirm.label + "  " + paint("y", "cyan", "bold") + paint(" yes  ", "gray") + paint("n", "cyan", "bold") + paint(" no", "gray");
  else if (choice) msg = " " + choice.label + "  " + choice.options.map(([k, l]) => paint(k, "cyan", "bold") + " " + l).join("   ") + paint("   esc cancel", "gray");
  else if (input) msg = ` ${paint(input.label, "bold")} ${input.value}${paint("█", "cyan")}` + paint(`   ${input.hint ?? "⏎ save  esc cancel"}`, "gray");
  else if (flash && Date.now() < flash.until) msg = paint(` ${flash.text}`, flash.color, "bold");
  else msg = paint(` ${tip ?? ""}`, "gray");
  const keys = input || confirm || choice ? "" : hints(pairs, W);
  return [rule(W), msg, keys];
}

const GLOBAL_KEYS = [["tab", "next tab"], ["?", "help"], ["q", "quit"]];

// ---------- Inbox ----------

function renderInbox(W, H) {
  if (cur) return renderDetail(W, H);
  const head = tabStrip(W);
  const pairs = drafts.length
    ? [["↑↓", "move"], ["⏎", "open"], ["p", "post"], ["d", "discard"], ["o", "browser"], ["n", "review a link"], ...GLOBAL_KEYS]
    : [["n", "review a link"], ["r", "repos"], ["s", "settings"], ...GLOBAL_KEYS];
  const foot = bottom(pairs, drafts.length ? "Open a review to read it, change it, then post it, or discard it." : "", W);
  const bodyH = H - head.length - foot.length;
  const body = [];

  if (!drafts.length) {
    body.push("", "", paint("    All caught up.", "bold", "green"), "");
    body.push(paint("    New AI reviews show up here on their own, and wait for your final word.", "gray"), "");
    body.push(`    ${paint("n", "cyan", "bold")}  review any PR now, from its link`);
    body.push(`    ${paint("r", "cyan", "bold")}  choose which repos are watched`);
    body.push(`    ${paint("s", "cyan", "bold")}  model, final word and other settings`);
    if (!watcherRunning()) {
      body.push("", paint("    The watcher isn't running, so nothing new will arrive.", "yellow", "bold"));
      body.push(paint("    Start it in herdr with Ctrl+b Shift+i, or: herdr plugin action invoke pr-reviewer.watch", "yellow"));
    }
    return [...head, ...pad(body, bodyH), ...foot];
  }

  const repoW = Math.min(20, Math.max(8, ...drafts.map((d) => shortRepo(d.repo).length)));
  body.push(paint(`    ${"VERDICT".padEnd(10)}${"REPO".padEnd(repoW + 1)}${"PR".padEnd(7)}TITLE`, "gray"));
  const listH = Math.min(drafts.length, Math.max(3, Math.floor(bodyH / 2) - 1));
  const top = Math.max(0, Math.min(sel.inbox - Math.floor(listH / 2), drafts.length - listH));
  for (let i = top; i < top + listH; i++) {
    const d = drafts[i], on = i === sel.inbox;
    const right = paint(`${included(d).length} notes  ${age(d.createdAt).padStart(3)} `, "gray");
    const left = `${on ? paint(" ▸ ", "cyan", "bold") : "   "} ${badge(d.verdict)} ${fitPlain(shortRepo(d.repo), repoW)} ` +
      paint(("#" + d.number).padEnd(6), "gray") + " " + (moved(d) ? paint("! ", "yellow", "bold") : "");
    const tW = W - vlen(left) - vlen(right) - 1;
    body.push(left + (on ? paint(fitPlain(d.title, tW), "bold") : fitPlain(d.title, tW)) + " " + right);
  }
  if (drafts.length > listH) body.push(paint(`    ${drafts.length - listH} more, use ↑↓`, "gray"));

  // Preview of the selected review underneath the list.
  const d = drafts[sel.inbox];
  checkRemote(d);
  body.push("", rule(W));
  body.push(` ${paint(`${d.repo}#${d.number}`, "bold")}  ${paint(`by ${d.author}`, "gray")}   ${remoteNote(d)}`);
  body.push("");
  for (const l of wrap(d.summary, W - 4, "  ")) body.push(md(l));
  return [...head, ...pad(body, bodyH), ...foot];
}

function detailBody(d, W) {
  const lines = [];
  for (const l of wrap(d.summary, W - 4, "  ")) lines.push(md(l));
  lines.push("");
  const n = included(d).length;
  lines.push(paint(` Comments: ${n} of ${d.comments.length} will be posted`, "bold") +
    (d.comments.length ? paint("   press 1-9 to turn one on or off", "gray") : ""));
  d.comments.forEach((c, i) => {
    lines.push("");
    const box = c.excluded ? paint("[ ]", "gray") : paint("[x]", "green", "bold");
    const loc = c.line ? `${c.path}:${c.line}` : `${c.path} (whole file)`;
    lines.push(` ${box} ${paint(String(i + 1), "bold")}  ${c.excluded ? paint(loc, "gray", "strike") : paint(loc, "cyan")}` +
      (c.excluded ? paint("  not posted", "gray") : ""));
    for (const l of wrap(c.body, W - 2, "       ")) lines.push(c.excluded ? paint(l, "gray") : md(l));
  });
  return lines;
}

function renderDetail(W, H) {
  const d = cur;
  checkRemote(d);
  const head = [
    ...tabStrip(W),
    ` ${badge(d.verdict)}  ${paint(`${d.repo}#${d.number}`, "bold")}  ${paint(d.title, "bold")}`,
    ` ${paint(`by ${d.author} · ${d.headSha.slice(0, 7)} · reviewed ${age(d.createdAt)} ago`, "gray")}   ${remoteNote(d)}`,
    rule(W),
  ];
  const pairs = [["esc", "back"], ["p", "post"], ["a/r/c", "verdict"], ["1-9", "comment on/off"], ["e/E", "edit"],
    ["d", "discard"], ["o", "browser"], ["↑↓", "scroll"], ["?", "help"]];
  const foot = bottom(pairs, `Will post as ${VERDICT[d.verdict].words.toUpperCase()} with ${included(d).length} comment(s).`, W);
  const bodyH = H - head.length - foot.length;
  const body = detailBody(d, W);
  scroll = Math.max(0, Math.min(scroll, body.length - bodyH));
  const shown = body.slice(scroll, scroll + bodyH);
  if (body.length > bodyH) {
    const pct = Math.min(100, Math.round(((scroll + bodyH) / body.length) * 100));
    foot[0] = bar(rule(Math.max(0, W - 8)), paint(`${pct}%`, "gray"), W);
  }
  return [...head, ...pad(shown, bodyH), ...foot];
}

// ---------- Repos ----------

function repoRows(raw) {
  return [...repoList(raw).map((r) => ({ repo: r })), { add: true }, { other: true }];
}

function renderRepos(W, H) {
  const head = tabStrip(W);
  if (picker) return renderPicker(W, H, head);
  const { raw, error } = readRawSafe();
  if (error) return [...head, paint(` config.json can't be read: ${error}`, "red"), paint(" Press E to fix it in your editor.", "gray")];
  const rows = repoRows(raw);
  sel.repos = Math.max(0, Math.min(sel.repos, rows.length - 1));
  const at = rows[sel.repos];
  const pairs = at.repo
    ? [["a", "add"], ["x", "remove"], ["⏎", "every PR / when asked"], ["f", "final word"], ["m", "model"], ...GLOBAL_KEYS]
    : [["a", "add"], ["⏎", at.add ? "add a repo" : "change"], ...GLOBAL_KEYS];
  const tip = at.repo ? "Final word and model set here apply to this repo only. Empty means the global setting."
    : at.other ? "When off, only the repos above are reviewed." : "Pick from your GitHub repos, or type owner/repo.";
  const foot = bottom(pairs, tip, W);
  const bodyH = H - head.length - foot.length;
  const gFw = effective(raw, "finalWord"), gModel = effective(raw, "model");
  const RW = Math.max(18, Math.min(36, ...repoList(raw).map((r) => r.repo.length + 2)));
  const body = ["", paint(` Repos that are watched`, "bold", "blue"), ""];
  const list = repoList(raw);
  if (list.length) {
    body.push(paint(`    ${"REPO".padEnd(RW)}${"REVIEWS".padEnd(16)}${"FINAL WORD".padEnd(22)}MODEL`, "gray"));
  } else {
    body.push(paint("    None yet. Press a to add one.", "gray"));
  }
  rows.forEach((r, i) => {
    const on = i === sel.repos;
    const mark = on ? paint(" ▸  ", "cyan", "bold") : "    ";
    if (r.repo) {
      const x = r.repo;
      const mode = x.review === "all" ? paint("every PR".padEnd(16), "cyan", "bold") : "when asked".padEnd(16);
      const fwVal = x.finalWord ?? gFw;
      const fw = (fwVal ? "you approve" : paint("AI posts", "yellow")) + (x.finalWord === undefined ? paint(" (global)", "gray") : "");
      const model = (x.model ?? gModel) + (x.model === undefined ? paint(" (global)", "gray") : "");
      body.push(mark + (on ? paint(fitPlain(x.repo, RW), "bold") : fitPlain(x.repo, RW)) + mode + fit(fw, 22) + model);
    } else if (r.add) {
      body.push(mark + paint("+ Add a repo", "cyan", "bold"));
    } else if (r.other) {
      const v = !effective(raw, "onlyListedRepos");
      body.push("", paint(" Other repos", "bold", "blue"), "");
      body.push(mark + fitPlain("PRs I'm asked to review", RW + 8) +
        (v ? paint("reviewed", "green", "bold") + paint("  (from any repo on GitHub)", "gray") : paint("ignored", "yellow", "bold") + paint("  (only the repos above)", "gray")));
    }
  });
  body.push("", "", paint("    every PR    every open PR in the repo is reviewed", "gray"));
  body.push(paint("    when asked  only PRs where you're added as a reviewer", "gray"));
  return [...head, ...pad(body, bodyH), ...foot];
}

function pickerMatches() {
  const q = picker.query.trim().toLowerCase();
  const { raw } = readRawSafe();
  const have = new Set((raw ? repoList(raw) : []).map((r) => r.repo.toLowerCase()));
  return (picker.items ?? [])
    .filter((it) => !q || it.name.toLowerCase().includes(q))
    .map((it) => ({ ...it, added: have.has(it.name.toLowerCase()) }));
}

function renderPicker(W, H, head) {
  const matches = pickerMatches();
  picker.sel = Math.max(0, Math.min(picker.sel, matches.length - 1));
  const pairs = [["type", "to search"], ["↑↓", "pick"], ["⏎", "add"], ["esc", "cancel"]];
  let typed = null;
  try { typed = picker.query.trim() ? parseRepo(picker.query) : null; } catch {}
  const tip = !matches.length && typed ? `Press ⏎ to add ${typed}.` : "Or type any owner/repo, or paste a GitHub link.";
  const foot = bottom(pairs, tip, W);
  const bodyH = H - head.length - foot.length;
  const body = ["", paint(" Add a repo", "bold", "blue"), ""];
  body.push(`  ${paint("Search:", "bold")} ${picker.query}${paint("█", "cyan")}`, "");
  if (picker.loading) body.push(paint("    Loading your repos from GitHub…", "gray"));
  else if (picker.error) body.push(paint(`    Couldn't list your repos (${picker.error}). Type owner/repo instead.`, "yellow"));
  else if (!matches.length) body.push(paint(typed ? `    No match in your repos. ⏎ adds ${typed} anyway.` : "    No match.", "gray"));
  const listH = Math.max(3, bodyH - body.length - 1);
  const top = Math.max(0, Math.min(picker.sel - Math.floor(listH / 2), matches.length - listH));
  matches.slice(top, top + listH).forEach((m, j) => {
    const on = top + j === picker.sel;
    const mark = on ? paint(" ▸  ", "cyan", "bold") : "    ";
    const name = on ? paint(fitPlain(m.name, 40), "bold") : fitPlain(m.name, 40);
    const meta = m.added ? paint("already added", "green") : paint(`${m.private ? "private" : "public "}  updated ${age(m.pushed)} ago`, "gray");
    body.push(mark + name + " " + meta);
  });
  return [...head, ...pad(body, bodyH), ...foot];
}

function openPicker() {
  picker = { query: "", sel: 0, items: null, loading: true, error: null };
  execFile("gh", ["api", "user/repos?per_page=100&sort=pushed&affiliation=owner,collaborator,organization_member",
    "--jq", ".[] | [.full_name, .pushed_at, .private] | @tsv"], { maxBuffer: 8 << 20 }, (err, stdout) => {
    if (!picker) return;
    picker.loading = false;
    if (err) picker.error = "is gh signed in?";
    else picker.items = stdout.trim().split("\n").filter(Boolean).map((l) => {
      const [name, pushed, priv] = l.split("\t");
      return { name, pushed, private: priv === "true" };
    });
    render();
  });
}

function pickerSubmit() {
  const m = pickerMatches()[picker.sel];
  let repo;
  try {
    repo = m && !m.added ? m.name : parseRepo(picker.query);
  } catch (e) {
    return setFlash(m?.added ? `${m.name} is already added.` : e.message, "red", 5000);
  }
  picker = null;
  choice = {
    label: `Add ${paint(repo, "bold")}. Review:`,
    options: [
      ["e", "every PR", () => doAddRepo(repo, "all")],
      ["w", "only when I'm asked", () => doAddRepo(repo, "requested")],
    ],
  };
}

function doAddRepo(repo, review) {
  if (saveSettings((c) => addRepo(c, repo, review), `Added ${repo}: ${review === "all" ? "every PR is reviewed" : "reviewed when you're asked"}.`)) {
    const { raw } = readRawSafe();
    sel.repos = Math.max(0, repoList(raw).findIndex((r) => r.repo.toLowerCase() === repo.toLowerCase()));
  }
}

function reposKey(str, k) {
  if (picker) {
    if (k === "escape") picker = null;
    else if (k === "return") pickerSubmit();
    else if (k === "up") picker.sel = Math.max(0, picker.sel - 1);
    else if (k === "down") picker.sel++;
    else if (k === "backspace") { picker.query = picker.query.slice(0, -1); picker.sel = 0; }
    else if (str && str >= " " && !/[\x00-\x1f]/.test(str)) { picker.query += str; picker.sel = 0; }
    return true;
  }
  const { raw } = readRawSafe();
  if (!raw) return false;
  const rows = repoRows(raw);
  const at = rows[sel.repos];
  if (k === "up" || k === "k") sel.repos = Math.max(0, sel.repos - 1);
  else if (k === "down" || k === "j") sel.repos = Math.min(rows.length - 1, sel.repos + 1);
  else if (str === "a" || str === "+" || (at?.add && (k === "return" || k === "space"))) openPicker();
  else if (at?.other && (k === "return" || k === "space")) {
    saveSettings((c) => setValue(c, "onlyListedRepos", !effective(c, "onlyListedRepos")));
  } else if (at?.repo) {
    const r = at.repo;
    if (k === "return" || k === "space") {
      const next = r.review === "all" ? "requested" : "all";
      saveSettings((c) => setRepoValue(c, r.repo, "review", next), `${r.repo}: ${next === "all" ? "every PR is reviewed" : "reviewed when you're asked"}.`);
    } else if (str === "f") {
      const nextFw = r.finalWord === undefined ? !effective(raw, "finalWord") : undefined;
      saveSettings((c) => setRepoValue(c, r.repo, "finalWord", nextFw),
        `${r.repo}: ${nextFw === undefined ? "uses the global final word" : nextFw ? "you approve first" : "the AI posts by itself"}.`);
    } else if (str === "m") {
      const opts = [undefined, ...MODELS];
      const nextModel = opts[(opts.indexOf(r.model) + 1) % opts.length];
      saveSettings((c) => setRepoValue(c, r.repo, "model", nextModel), `${r.repo}: ${nextModel ? `uses ${nextModel}` : "uses the global model"}.`);
    } else if (str === "x" || k === "delete" || k === "backspace") {
      confirm = {
        label: `Remove ${paint(r.repo, "bold")}?`,
        onYes: () => saveSettings((c) => removeRepo(c, r.repo), `Removed ${r.repo}.`),
      };
    } else return false;
  } else return false;
  return true;
}

// ---------- Settings ----------

const SETTING_FIELDS = FIELDS.filter((f) => f.key !== "onlyListedRepos"); // that one lives in the Repos tab

function settingsRows() {
  const rows = [];
  for (const f of SETTING_FIELDS) rows.push(f.section ? { section: f.section } : { pick: true, field: f });
  rows.push({ section: "More" }, { pick: true, file: true });
  return rows;
}

function fieldValue(f, v) {
  if (f.type === "bool") return v ? paint("on  ", "green", "bold") + paint(f.on, "gray") : paint("off ", "yellow", "bold") + paint(f.off, "gray");
  if (f.type === "choice") {
    const opts = f.options.includes(v) ? f.options : [...f.options, v];
    return opts.map((o) => (o === v ? paint(` ${o} `, "inv", "cyan", "bold") : paint(` ${o} `, "gray"))).join(" ");
  }
  return paint(String(v), "bold");
}

function renderSettings(W, H) {
  const head = tabStrip(W);
  const { raw, error } = readRawSafe();
  if (error) return [...head, paint(` config.json can't be read: ${error}`, "red"), paint(" Press E to fix it in your editor.", "gray")];
  const rows = settingsRows();
  const picks = rows.filter((r) => r.pick);
  sel.settings = Math.max(0, Math.min(sel.settings, picks.length - 1));
  const at = picks[sel.settings];
  const f = at.field;
  const pairs = !f ? [["⏎", "open in editor"], ...GLOBAL_KEYS]
    : f.type === "choice" ? [["←→", "change"], ...(f.custom ? [["t", "type a name"]] : []), ["E", "edit file"], ...GLOBAL_KEYS]
    : f.type === "number" ? [["⏎", "type a number"], ["E", "edit file"], ...GLOBAL_KEYS]
    : [["⏎", "turn on/off"], ["E", "edit file"], ...GLOBAL_KEYS];
  const tip = f?.help ?? (f ? "Saved straight away. The watcher uses it from its next check." : CONFIG_FILE.replace(os.homedir(), "~"));
  const foot = bottom(pairs, tip, W);
  const bodyH = H - head.length - foot.length;
  const LW = 26;
  const body = [];
  let selLine = 0;
  for (const r of rows) {
    if (r.section) { body.push("", paint(` ${r.section}`, "bold", "blue"), ""); continue; }
    const on = r === at;
    if (on) selLine = body.length;
    const mark = on ? paint(" ▸  ", "cyan", "bold") : "    ";
    if (r.field) body.push(mark + (on ? paint(fitPlain(r.field.label, LW), "bold") : fitPlain(r.field.label, LW)) + fieldValue(r.field, effective(raw, r.field.key)));
    else body.push(mark + paint("Edit config.json in your editor", "cyan", "bold") + paint("  ignore paths, instructions, footer…", "gray"));
  }
  scroll = Math.max(0, Math.min(selLine - Math.floor(bodyH / 2), body.length - bodyH));
  return [...head, ...pad(body.slice(scroll), bodyH), ...foot];
}

function settingsKey(str, k) {
  if (str === "E") { editConfigFile(); return true; }
  const { raw } = readRawSafe();
  if (!raw) return false;
  const picks = settingsRows().filter((r) => r.pick);
  const at = picks[sel.settings];
  if (k === "up" || k === "k") { sel.settings = Math.max(0, sel.settings - 1); return true; }
  if (k === "down" || k === "j") { sel.settings = Math.min(picks.length - 1, sel.settings + 1); return true; }
  const go = k === "return" || k === "space";
  if (at.file) { if (go) editConfigFile(); return go; }
  const f = at.field, v = effective(raw, f.key);
  if (f.type === "bool" && (go || k === "left" || k === "right")) saveSettings((c) => setValue(c, f.key, !v), `${f.label}: ${!v ? f.on : f.off}.`);
  else if (f.type === "choice" && (go || k === "right" || k === "left")) {
    const nv = cycle(f.options, v, k === "left" ? -1 : 1);
    saveSettings((c) => setValue(c, f.key, nv), `${f.label}: ${nv}.`);
  } else if (f.type === "choice" && f.custom && str === "t") {
    input = { label: `${f.label}:`, value: String(v), onSubmit: (t) => t.trim() && saveSettings((c) => setValue(c, f.key, t.trim()), `${f.label}: ${t.trim()}.`) };
  } else if (f.type === "number" && go) {
    input = { label: `${f.label}:`, value: String(v), hint: `${f.min} to ${f.max}   ⏎ save  esc cancel`,
      onSubmit: (t) => saveSettings((c) => setValue(c, f.key, parseNumber(f, t)), `${f.label}: ${t.trim()}.`) };
  } else return false;
  return true;
}

// ---------- History ----------

function renderHistory(W, H) {
  const head = tabStrip(W);
  const all = Object.entries(getReviewed()).sort((a, b) => (b[1].at ?? "").localeCompare(a[1].at ?? ""));
  const foot = bottom([["↑↓", "scroll"], ...GLOBAL_KEYS], `${all.length} PR(s) reviewed so far.`, W);
  const bodyH = H - head.length - foot.length;
  const COLOR = { posted: "green", drafted: "yellow", discarded: "gray", failed: "red" };
  const body = all.length
    ? [paint(`   ${"STATUS".padEnd(10)}${"PR".padEnd(Math.max(10, W - 40))} ${"POSTED AS".padEnd(16)}WHEN`, "gray"), ...all.flatMap(([key, v]) => {
      const row = `   ${paint((v.status ?? "?").padEnd(10), COLOR[v.status] ?? "gray", "bold")}${fitPlain(key, Math.max(10, W - 40))} ` +
        paint(`${(v.event ?? "").padEnd(16)}${age(v.at ?? 0)} ago`, "gray");
      return v.status === "failed" && v.error ? [row, paint(`             ${String(v.error).split("\n")[0]}`, "red")] : [row];
    })]
    : ["", paint("    Nothing yet. Reviews you post or discard are listed here.", "gray")];
  scroll = Math.max(0, Math.min(scroll, body.length - bodyH));
  return [...head, ...pad(body.slice(scroll, scroll + bodyH), bodyH), ...foot];
}

// ---------- Help ----------

function renderHelp(W, H) {
  const head = tabStrip(W);
  const foot = bottom([["any key", "close"]], "", W);
  const k = (a, b) => `    ${paint(a.padEnd(12), "cyan", "bold")}${b}`;
  const left = ["", paint(" Moving around", "bold", "blue"),
    k("tab", "next tab (shift+tab: previous)"), k("i r s h", "Inbox, Repos, Settings, History"), k("esc", "back"), k("q", "quit"),
    "", paint(" Inbox", "bold", "blue"),
    k("⏎", "open a review"), k("p", "post it to GitHub (asks first)"), k("d", "discard it, nothing is posted"),
    k("a / r / c", "inside a review: approve / request changes / comment"), k("1-9", "inside a review: turn a comment on or off"),
    k("e / E", "inside a review: edit the summary / everything"), k("n", "review any PR now, from its link"), k("o", "open the PR in the browser")];
  const right = ["", paint(" Repos", "bold", "blue"),
    k("a", "add a repo: search your GitHub repos, or type owner/repo"), k("x", "remove the selected repo"),
    k("⏎", "every PR / only when you're asked"), k("f / m", "final word / model for that repo only"),
    "", paint(" Settings", "bold", "blue"),
    k("⏎ ←→", "change the selected setting"), k("t", "type any model name"), k("E", "edit config.json in your editor")];
  const half = Math.floor(W / 2);
  const body = W >= 110
    ? Array.from({ length: Math.max(left.length, right.length) }, (_, i) => fit(left[i] ?? "", half) + (right[i] ?? ""))
    : [...left, ...right];
  return [...head, ...pad(body, H - head.length - foot.length), ...foot];
}

function render() {
  if (suspended) return;
  const W = out.columns || 80, H = out.rows || 24;
  const lines = help ? renderHelp(W, H)
    : tab === "inbox" ? renderInbox(W, H)
    : tab === "repos" ? renderRepos(W, H)
    : tab === "settings" ? renderSettings(W, H)
    : renderHistory(W, H);
  out.write("\x1b[H" + lines.slice(0, H).map((l) => fit(l, W)).join("\r\n") + "\x1b[J");
}

// ---------- actions ----------

/** Apply a change to config.json and say so. Returns true when saved. */
function saveSettings(change, done = "Saved. The watcher uses it from its next check.") {
  try {
    const raw = readRaw();
    change(raw);
    writeRaw(raw);
    setFlash(done);
    return true;
  } catch (e) {
    setFlash(`Not saved: ${String(e.message).split("\n")[0]}`, "red", 6000);
    return false;
  }
}

function openUrl(url) {
  spawn(process.platform === "darwin" ? "open" : "xdg-open", [url], { stdio: "ignore", detached: true }).unref();
}

function pickEditor() {
  if (process.env.VISUAL || process.env.EDITOR) return process.env.VISUAL || process.env.EDITOR;
  if (spawnSync("which", ["code"]).status === 0) return "code --wait";
  return "vi";
}

let suspended = false;
function enterScreen() {
  out.write("\x1b[?1049h\x1b[?25l"); // alt screen, hide cursor
  process.stdin.setRawMode(true);
  suspended = false;
}
function leaveScreen() {
  suspended = true;
  process.stdin.setRawMode(false);
  out.write("\x1b[?25h\x1b[?1049l");
}

/** Open text in the user's editor (suspending the UI); returns the edited text or null. */
function editText(text, ext) {
  const file = path.join(os.tmpdir(), `pr-panel-${process.pid}.${ext}`);
  fs.writeFileSync(file, text);
  leaveScreen();
  const editor = pickEditor();
  console.log(`Opening ${editor.split(" ")[0]}. Save and close the file to come back…`);
  spawnSync(`${editor} "${file}"`, { stdio: "inherit", shell: true });
  const edited = fs.readFileSync(file, "utf8");
  fs.rmSync(file, { force: true });
  enterScreen();
  return edited === text ? null : edited;
}

function editConfigFile() {
  let text;
  try { text = fs.readFileSync(CONFIG_FILE, "utf8"); } catch { text = "{}\n"; }
  const edited = editText(text, "json");
  if (edited === null) return setFlash("No changes.", "gray");
  try {
    writeRaw(JSON.parse(edited));
    setFlash("Saved config.json.");
  } catch (e) {
    setFlash(`Not saved, your edit has a problem: ${String(e.message).split("\n")[0]}`, "red", 8000);
  }
}

function editSummary(d) {
  const edited = editText(d.summary, "md");
  if (edited === null) return setFlash("No changes.", "gray");
  d.summary = edited.trim() || d.summary;
  saveDraft(d);
  setFlash("Summary updated.");
}

function editAll(d) {
  const { verdict, summary, comments } = d;
  const edited = editText(JSON.stringify({ verdict, summary, comments }, null, 2), "json");
  if (edited === null) return setFlash("No changes.", "gray");
  try {
    const j = JSON.parse(edited);
    if (!VERDICT[j.verdict]) throw new Error(`verdict must be one of ${Object.keys(VERDICT).join(", ")}`);
    Object.assign(d, { verdict: j.verdict, summary: String(j.summary ?? ""), comments: j.comments ?? [] });
    saveDraft(d);
    setFlash("Review updated.");
  } catch (e) {
    setFlash(`Couldn't use your edit: ${e.message}`, "red", 6000);
  }
}

function setVerdict(d, v) {
  if (d.verdict === v) return;
  d.verdict = v;
  saveDraft(d);
  setFlash(`Will post as ${VERDICT[v].words.toUpperCase()}.`);
}

function askPost(d) {
  const r = remote[d.key];
  const warn = r?.state && r.state !== "OPEN" ? paint(` The PR is ${r.state.toLowerCase()}.`, "yellow")
    : moved(d) ? paint(" The PR has new commits since this review.", "yellow") : "";
  confirm = {
    label: `Post ${paint(VERDICT[d.verdict].words.toUpperCase(), "bold", VERDICT[d.verdict].color)} with ${included(d).length} comment(s) to ${paint(`${d.repo}#${d.number}`, "bold")}?${warn}`,
    onYes: () => {
      busy = `Posting to ${d.repo}#${d.number}…`;
      render();
      setImmediate(() => {
        try {
          const event = postReview(d, settingsFor(loadConfig(), d.repo));
          deleteDraft(d.key);
          markReviewed(d.key, { sha: d.headSha, status: "posted", event, error: null,
            lastReview: { verdict: d.verdict, summary: d.summary, comments: included(d) } });
          setFlash(`Posted to ${d.repo}#${d.number} as ${event}.`);
          cur = null;
        } catch (e) {
          setFlash(String(e.message).split("\n")[0], "red", 8000);
        }
        busy = null;
        refresh();
        render();
      });
    },
  };
}

function askDiscard(d) {
  confirm = {
    label: `Discard the review of ${paint(`${d.repo}#${d.number}`, "bold")}? Nothing goes to GitHub.`,
    onYes: () => {
      deleteDraft(d.key);
      markReviewed(d.key, { sha: d.headSha, status: "discarded" });
      setFlash(`Discarded ${d.repo}#${d.number}.`, "gray");
      cur = null;
      refresh();
    },
  };
}

function askNewReview() {
  input = {
    label: "PR link:",
    value: "",
    hint: "paste a github.com/…/pull/… link   ⏎ review  esc cancel",
    onSubmit: (v) => {
      const t = parsePRUrl(v);
      if (!t) return setFlash("That isn't a GitHub pull request link.", "red");
      const child = spawn(process.execPath, [path.join(ROOT, "src", "review.js"), v.trim(), "--draft"], {
        stdio: "ignore", detached: true, env: process.env,
      });
      child.unref();
      setFlash(`Reviewing ${t.repo}#${t.number} in the background. It shows up here when it's ready.`, "cyan", 6000);
    },
  };
}

// ---------- keys ----------

function quit() {
  leaveScreen();
  process.exit(0);
}
function goTab(t) {
  tab = t;
  scroll = 0;
  picker = null;
  if (t !== "inbox") cur = null;
}

function onKey(str, key = {}) {
  if (key.ctrl && key.name === "c") return quit();
  if (busy) return;

  if (input) {
    if (key.name === "return") { const { onSubmit, value } = input; input = null; onSubmit(value); }
    else if (key.name === "escape") input = null;
    else if (key.name === "backspace") input.value = input.value.slice(0, -1);
    else if (key.ctrl && key.name === "u") input.value = "";
    else if (str && !key.ctrl && !key.meta && str >= " ") input.value += str;
    return render();
  }
  if (confirm) {
    const { onYes } = confirm;
    confirm = null;
    if (str === "y" || str === "Y") onYes();
    else setFlash("Cancelled.", "gray", 1500);
    return render();
  }
  if (choice) {
    const opt = choice.options.find(([k]) => k === str);
    if (opt || key.name === "escape") { choice = null; opt?.[2](); }
    return render();
  }
  if (help) { help = false; return render(); }

  const k = key.name ?? str;
  // Tabs work everywhere except while typing in the repo picker.
  if (k === "tab" && !picker) { goTab(TABS[(TABS.indexOf(tab) + (key.shift ? -1 : 1) + TABS.length) % TABS.length]); return render(); }

  if (tab === "repos" && reposKey(str, k)) return render();
  if (tab === "settings" && settingsKey(str, k)) return render();

  if (tab === "inbox" && cur) {
    const d = cur, page = Math.max(1, (out.rows || 24) - 10);
    if (k === "escape" || k === "left" || k === "b") cur = null;
    else if (k === "up" || k === "k") scroll = Math.max(0, scroll - 1);
    else if (k === "down" || k === "j") scroll++;
    else if (k === "space" || k === "pagedown") scroll += page;
    else if (k === "pageup") scroll = Math.max(0, scroll - page);
    else if (str === "g") scroll = 0;
    else if (str === "G") scroll = 1e9;
    else if (str === "a") setVerdict(d, "approve");
    else if (str === "r") setVerdict(d, "request_changes");
    else if (str === "c") setVerdict(d, "comment");
    else if (/^[1-9]$/.test(str ?? "") && d.comments[Number(str) - 1]) {
      const c = d.comments[Number(str) - 1];
      c.excluded = !c.excluded;
      saveDraft(d);
    }
    else if (str === "e") editSummary(d);
    else if (str === "E") editAll(d);
    else if (str === "p") askPost(d);
    else if (str === "d") askDiscard(d);
    else if (str === "o") openUrl(d.url);
    else if (str === "q") quit();
    return render();
  }

  // Keys shared by the tab views.
  if (str === "q") return quit();
  if (str === "?") { help = true; return render(); }
  if (k === "escape") { goTab("inbox"); return render(); }
  if (str === "i") { goTab("inbox"); return render(); }
  if (str === "r") { goTab("repos"); return render(); }
  if (str === "s") { goTab("settings"); return render(); }
  if (str === "h") { goTab("history"); return render(); }

  if (tab === "inbox") {
    const d = drafts[sel.inbox];
    if (k === "up" || k === "k") sel.inbox = Math.max(0, sel.inbox - 1);
    else if (k === "down" || k === "j") sel.inbox = Math.min(drafts.length - 1, sel.inbox + 1);
    else if ((k === "return" || k === "right" || k === "l") && d) { cur = d; scroll = 0; }
    else if (/^[1-9]$/.test(str ?? "") && drafts[Number(str) - 1]) { sel.inbox = Number(str) - 1; cur = drafts[sel.inbox]; scroll = 0; }
    else if (str === "p" && d) askPost(d);
    else if (str === "d" && d) askDiscard(d);
    else if (str === "o" && d) openUrl(d.url);
    else if (str === "n") askNewReview();
  } else if (tab === "history") {
    if (k === "up" || k === "k") scroll = Math.max(0, scroll - 1);
    else if (k === "down" || k === "j") scroll++;
  }
  render();
}

// ---------- main ----------

readline.emitKeypressEvents(process.stdin);
process.stdin.on("keypress", onKey);
process.on("exit", () => { if (!suspended) { try { process.stdin.setRawMode(false); } catch {} out.write("\x1b[?25h\x1b[?1049l"); } });
process.on("SIGTERM", quit);
process.on("uncaughtException", (e) => { leaveScreen(); console.error(e); process.exit(1); });
out.on("resize", render);

const startTab = process.argv.find((a) => a.startsWith("--tab="))?.slice(6);
if (TABS.includes(startTab)) tab = startTab;

enterScreen();
refresh();
render();

// Live updates: redraw when reviews, running reviews, the watcher or the config change.
let sig = "";
setInterval(() => {
  let cfg = "";
  try { cfg = String(fs.statSync(CONFIG_FILE).mtimeMs); } catch {}
  const next = JSON.stringify([listDrafts().map((d) => [d.key, d.createdAt, d.verdict]), listActiveReviews(), watcherRunning(), cfg]);
  if (next !== sig) { sig = next; refresh(); render(); }
}, 1500);
