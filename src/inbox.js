// PR review inbox: a full-screen terminal UI for giving AI drafts your final word.
// No dependencies — raw-mode keys + ANSI. Works in any terminal (herdr pane, Herdr app, iTerm…).
import { execFile, spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import readline from "node:readline";
import {
  ROOT, deleteDraft, getReviewed, listActiveReviews, listDrafts, loadConfig, markReviewed, parsePRUrl,
  postReview, saveDraft, settingsFor, watcherRunning,
} from "./lib.js";

// ---------- styling helpers ----------

const E = {
  reset: "\x1b[0m", bold: "\x1b[1m", dim: "\x1b[2m", inv: "\x1b[7m", strike: "\x1b[9m",
  red: "\x1b[31m", green: "\x1b[32m", yellow: "\x1b[33m", blue: "\x1b[34m", cyan: "\x1b[36m", gray: "\x1b[90m",
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
  request_changes: { label: "CHANGES", color: "red", event: "REQUEST_CHANGES" },
  comment: { label: "COMMENT", color: "yellow", event: "COMMENT" },
  approve: { label: "APPROVE", color: "green", event: "APPROVE" },
};
const badge = (v) => paint(` ${(VERDICT[v]?.label ?? v).padEnd(7)} `, "inv", VERDICT[v]?.color ?? "gray");

function age(iso) {
  const s = (Date.now() - new Date(iso).getTime()) / 1000;
  if (s < 60) return "now";
  if (s < 3600) return `${Math.floor(s / 60)}m`;
  if (s < 86400) return `${Math.floor(s / 3600)}h`;
  return `${Math.floor(s / 86400)}d`;
}
const shortRepo = (r) => r.split("/")[1] ?? r;
const included = (d) => d.comments.filter((c) => !c.excluded);

// ---------- non-interactive fallback ----------

if (!process.stdin.isTTY || !process.stdout.isTTY) {
  const ds = listDrafts();
  console.log(`PR Review Inbox — ${ds.length} waiting`);
  for (const d of ds) console.log(`  ${VERDICT[d.verdict]?.label ?? d.verdict}  ${d.repo}#${d.number}  ${d.title}`);
  process.exit(0);
}

// ---------- state ----------

const out = process.stdout;
let view = "list"; // list | detail | history
let drafts = [];
let sel = 0; // selected row in list
let cur = null; // draft open in detail view
let scroll = 0; // detail / history scroll offset
let input = null; // { label, value, onSubmit } — single-line text prompt in the footer
let confirm = null; // { label, onYes }
let flash = null; // { text, color, until }
let busy = null; // text shown while a blocking op runs
const remote = {}; // key -> { checking, sha, state } — live PR status from GitHub

function refresh() {
  drafts = listDrafts();
  sel = Math.max(0, Math.min(sel, drafts.length - 1));
  if (cur && !drafts.some((d) => d.key === cur.key)) {
    if (view === "detail") { view = "list"; setFlash("That review was handled elsewhere.", "yellow"); }
    cur = null;
  } else if (cur) {
    cur = drafts.find((d) => d.key === cur.key); // pick up on-disk edits
  }
}
function setFlash(text, color = "green", ms = 4000) {
  flash = { text, color, until: Date.now() + ms };
  setTimeout(render, ms + 50);
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
  if (r.state && r.state !== "OPEN") return paint(`⚠ PR is ${r.state.toLowerCase()}`, "yellow", "bold");
  if (r.sha !== d.headSha) return paint("⚠ new commits since this review", "yellow", "bold");
  return paint("✓ up to date", "green");
}

// ---------- rendering ----------

function statusRight() {
  const active = listActiveReviews();
  const parts = [watcherRunning() ? paint("● watching", "green") : paint("○ watcher off", "gray")];
  if (active.length) parts.push(paint(`⟳ reviewing ${active.map((k) => k.split("/")[1] ?? k).join(", ")}`, "cyan"));
  return parts.join(paint("  ·  ", "gray"));
}
function bar(left, right, W) {
  return left + " ".repeat(Math.max(1, W - vlen(left) - vlen(right) - 1)) + right;
}
const rule = (W) => paint("─".repeat(W), "gray");

function footer(keys, W) {
  if (busy) return paint(` ${busy}`, "cyan", "bold");
  if (confirm) return " " + confirm.label + paint("  [y/N]", "bold");
  if (input) return ` ${paint(input.label, "bold")} ${input.value}${paint("█", "gray")}`;
  if (flash && Date.now() < flash.until) return paint(` ${flash.text}`, flash.color, "bold");
  return paint(" " + keys, "gray");
}

function renderList(W, H) {
  const head = [
    bar(paint(" PR Review Inbox ", "bold") + paint(`${drafts.length} waiting`, drafts.length ? "yellow" : "gray"), statusRight(), W),
    rule(W),
  ];
  const foot = [rule(W), footer("↑↓ move  ⏎ open  p post  d discard  o browser  n review a URL  h history  q quit", W)];
  const bodyH = H - head.length - foot.length;
  const body = [];

  if (!drafts.length) {
    body.push("", paint("  Nothing waiting for you.", "bold"));
    body.push(paint("  New reviews appear here by themselves; press n to review any PR by URL.", "gray"));
    if (!watcherRunning()) body.push("", paint("  The watcher isn't running, so nothing new will arrive. Start it with Ctrl+b Shift+i in herdr,", "yellow"), paint("  or: herdr plugin action invoke pr-reviewer.watch", "yellow"));
  } else {
    const repoW = Math.min(20, Math.max(...drafts.map((d) => shortRepo(d.repo).length)));
    const listH = Math.min(drafts.length, Math.max(3, Math.floor(bodyH / 2)));
    const top = Math.max(0, Math.min(sel - Math.floor(listH / 2), drafts.length - listH));
    for (let i = top; i < top + listH; i++) {
      const d = drafts[i], on = i === sel;
      const r = remote[d.key];
      const warn = r && !r.checking && !r.error && (r.state !== "OPEN" || r.sha !== d.headSha) ? paint("⚠ ", "yellow") : "";
      const right = paint(`${included(d).length} notes  ${age(d.createdAt).padStart(3)} `, "gray");
      const left = `${on ? paint(" ▸", "cyan", "bold") : "  "} ${badge(d.verdict)} ${fitPlain(shortRepo(d.repo), repoW)} ${paint(("#" + d.number).padEnd(6), "gray")} ${warn}`;
      const tW = W - vlen(left) - vlen(right) - 1;
      body.push(left + (on ? paint(fitPlain(d.title, tW), "bold") : fitPlain(d.title, tW)) + " " + right);
    }
    // Preview of the selected review underneath the list.
    const d = drafts[sel];
    checkRemote(d);
    body.push(rule(W));
    body.push(` ${paint(`${d.repo}#${d.number}`, "bold")}  ${paint(`by ${d.author}`, "gray")}  ${remoteNote(d)}`);
    for (const l of wrap(d.summary, W - 2, " ")) body.push(md(l));
  }
  return [...head, ...body.slice(0, bodyH), ...Array(Math.max(0, bodyH - body.length)).fill(""), ...foot];
}

function detailBody(d, W) {
  const lines = [];
  for (const l of wrap(d.summary, W - 2, " ")) lines.push(md(l));
  lines.push("");
  const n = included(d).length;
  lines.push(paint(` Inline comments — ${n} of ${d.comments.length} will be posted`, "bold") +
    (d.comments.length ? paint("   (press 1–9 to turn one on/off)", "gray") : ""));
  d.comments.forEach((c, i) => {
    lines.push("");
    const box = c.excluded ? paint("□", "gray") : paint("■", "green");
    const loc = c.line ? `${c.path}:${c.line}` : `${c.path} (whole file)`;
    lines.push(` ${box} ${paint(String(i + 1), "bold")}  ${c.excluded ? paint(loc, "gray", "strike") : paint(loc, "cyan")}` +
      (c.excluded ? paint("  (won't be posted)", "gray") : ""));
    for (const l of wrap(c.body, W - 2, "     ")) lines.push(c.excluded ? paint(l, "gray") : md(l));
  });
  return lines;
}

function renderDetail(W, H) {
  const d = cur;
  checkRemote(d);
  const head = [
    bar(` ${badge(d.verdict)} ${paint(`${d.repo}#${d.number}`, "bold")}`, statusRight(), W),
    " " + paint(d.title, "bold"),
    ` ${paint(`by ${d.author} · ${d.headSha.slice(0, 7)} · reviewed ${age(d.createdAt)} ago`, "gray")}   ${remoteNote(d)}`,
    rule(W),
  ];
  const foot = [rule(W), footer("↑↓ scroll  p post  a/r/c verdict  1-9 toggle comment  e edit  E edit all  d discard  o browser  ← back", W)];
  const bodyH = H - head.length - foot.length;
  const body = detailBody(d, W);
  scroll = Math.max(0, Math.min(scroll, body.length - bodyH));
  const shown = body.slice(scroll, scroll + bodyH);
  if (body.length > bodyH) {
    const pct = Math.round(((scroll + bodyH) / body.length) * 100);
    foot[0] = bar(rule(Math.max(0, W - 8)), paint(`${Math.min(pct, 100)}%`, "gray"), W);
  }
  return [...head, ...shown, ...Array(Math.max(0, bodyH - shown.length)).fill(""), ...foot];
}

function renderHistory(W, H) {
  const all = Object.entries(getReviewed()).sort((a, b) => (b[1].at ?? "").localeCompare(a[1].at ?? ""));
  const head = [bar(paint(" Review history ", "bold") + paint(`${all.length} PRs`, "gray"), statusRight(), W), rule(W)];
  const foot = [rule(W), footer("↑↓ scroll  ← back  q quit", W)];
  const bodyH = H - head.length - foot.length;
  const COLOR = { posted: "green", drafted: "yellow", discarded: "gray", failed: "red" };
  const body = all.flatMap(([key, v]) => {
    const row = ` ${paint((v.status ?? "?").padEnd(9), COLOR[v.status] ?? "gray", "bold")} ${fitPlain(key, Math.max(10, W - 38))} ` +
      paint(`${(v.event ?? "").padEnd(15)} ${age(v.at ?? 0).padStart(3)} ago`, "gray");
    return v.status === "failed" && v.error ? [row, paint(`           ${String(v.error).split("\n")[0]}`, "red")] : [row];
  });
  scroll = Math.max(0, Math.min(scroll, body.length - bodyH));
  const shown = body.slice(scroll, scroll + bodyH);
  return [...head, ...shown, ...Array(Math.max(0, bodyH - shown.length)).fill(""), ...foot];
}

function render() {
  if (suspended) return;
  const W = out.columns || 80, H = out.rows || 24;
  if (view === "detail" && !cur) view = "list";
  const lines = view === "detail" ? renderDetail(W, H) : view === "history" ? renderHistory(W, H) : renderList(W, H);
  out.write("\x1b[H" + lines.slice(0, H).map((l) => fit(l, W)).join("\r\n") + "\x1b[J");
}

// ---------- actions ----------

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
  const file = path.join(os.tmpdir(), `pr-review-${process.pid}.${ext}`);
  fs.writeFileSync(file, text);
  leaveScreen();
  const editor = pickEditor();
  console.log(`Opening ${editor.split(" ")[0]} — save and close the file to come back…`);
  spawnSync(`${editor} "${file}"`, { stdio: "inherit", shell: true });
  const edited = fs.readFileSync(file, "utf8");
  fs.rmSync(file, { force: true });
  enterScreen();
  return edited === text ? null : edited;
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
  setFlash(`Verdict → ${VERDICT[v].event}`);
}

function askPost(d) {
  const r = remote[d.key];
  const moved = r && !r.checking && !r.error && r.sha && r.sha !== d.headSha;
  const closed = r?.state && r.state !== "OPEN";
  const warn = closed ? paint(` ⚠ PR is ${r.state.toLowerCase()}.`, "yellow") : moved ? paint(" ⚠ PR has new commits since this review.", "yellow") : "";
  confirm = {
    label: `Post ${paint(VERDICT[d.verdict].event, "bold", VERDICT[d.verdict].color)} with ${included(d).length} inline comment(s) to ${paint(`${d.repo}#${d.number}`, "bold")}?${warn}`,
    onYes: () => {
      busy = `Posting to ${d.repo}#${d.number}…`;
      render();
      setImmediate(() => {
        try {
          const event = postReview(d, settingsFor(loadConfig(), d.repo));
          deleteDraft(d.key);
          markReviewed(d.key, { sha: d.headSha, status: "posted", event, error: null,
            lastReview: { verdict: d.verdict, summary: d.summary, comments: included(d) } });
          setFlash(`✓ Posted ${d.repo}#${d.number} as ${event}`);
          view = "list";
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
      view = "list";
      refresh();
    },
  };
}

function askNewReview() {
  input = {
    label: "PR URL:",
    value: "",
    onSubmit: (v) => {
      const t = parsePRUrl(v);
      if (!t) return setFlash("That isn't a GitHub pull request URL.", "red");
      const child = spawn(process.execPath, [path.join(ROOT, "src", "review.js"), v.trim(), "--draft"], {
        stdio: "ignore", detached: true, env: process.env,
      });
      child.unref();
      setFlash(`Reviewing ${t.repo}#${t.number} in the background — it'll show up here when ready.`, "cyan", 6000);
    },
  };
}

// ---------- keys ----------

function quit() {
  leaveScreen();
  process.exit(0);
}

function onKey(str, key = {}) {
  if (key.ctrl && key.name === "c") return quit();
  if (busy) return;

  if (input) {
    if (key.name === "return") { const { onSubmit, value } = input; input = null; onSubmit(value); }
    else if (key.name === "escape") input = null;
    else if (key.name === "backspace") input.value = input.value.slice(0, -1);
    else if (str && !key.ctrl && !key.meta && str >= " ") input.value += str;
    return render();
  }
  if (confirm) {
    const { onYes } = confirm;
    confirm = null;
    if (str === "y" || str === "Y") onYes();
    return render();
  }

  const k = key.name ?? str;
  if (view === "list") {
    const d = drafts[sel];
    if (k === "q" || k === "escape") return quit();
    if (k === "up" || k === "k") sel = Math.max(0, sel - 1);
    else if (k === "down" || k === "j") sel = Math.min(drafts.length - 1, sel + 1);
    else if ((k === "return" || k === "right" || k === "l") && d) { cur = d; view = "detail"; scroll = 0; }
    else if (/^[1-9]$/.test(str ?? "") && drafts[Number(str) - 1]) { sel = Number(str) - 1; cur = drafts[sel]; view = "detail"; scroll = 0; }
    else if (k === "p" && d) askPost(d);
    else if (k === "d" && d) askDiscard(d);
    else if (k === "o" && d) openUrl(d.url);
    else if (k === "n") askNewReview();
    else if (k === "h") { view = "history"; scroll = 0; }
    else if (k === "r") refresh();
  } else if (view === "detail") {
    const d = cur, page = Math.max(1, (out.rows || 24) - 8);
    if (k === "escape" || k === "left" || k === "q" || k === "b") view = "list";
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
  } else if (view === "history") {
    if (k === "escape" || k === "left" || k === "h" || k === "b") { view = "list"; scroll = 0; }
    else if (k === "q") return quit();
    else if (k === "up" || k === "k") scroll = Math.max(0, scroll - 1);
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

enterScreen();
refresh();
render();

// Live updates: redraw when drafts, active reviews or the watcher change.
let sig = "";
setInterval(() => {
  const next = JSON.stringify([listDrafts().map((d) => [d.key, d.createdAt, d.verdict]), listActiveReviews(), watcherRunning()]);
  if (next !== sig) { sig = next; refresh(); render(); }
}, 1500);
