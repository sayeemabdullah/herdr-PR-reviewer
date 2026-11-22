// Interactive inbox for "final word" mode: post, change verdict, edit, or discard AI drafts.
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import readline from "node:readline/promises";
import {
  deleteDraft, getPR, listDrafts, loadConfig, markReviewed, parsePRUrl, postReview, reviewPR,
  saveDraft, settingsFor,
} from "./lib.js";

const C = { b: "\x1b[1m", d: "\x1b[2m", r: "\x1b[31m", g: "\x1b[32m", y: "\x1b[33m", x: "\x1b[0m" };
const VERDICT_COLOR = { approve: C.g, request_changes: C.r, comment: C.y };
const fmtVerdict = (v) => `${VERDICT_COLOR[v] ?? ""}${v.toUpperCase()}${C.x}`;

let rl = readline.createInterface({ input: process.stdin, output: process.stdout });
const ask = (q) => rl.question(q);
const clear = () => process.stdout.write("\x1b[2J\x1b[H");
const draftsSig = () => listDrafts().map((d) => d.key + d.createdAt + d.verdict).join("|");

/** Like ask(), but resolves to null if the drafts change on disk (so the list can re-render). */
async function askLive(q) {
  const before = draftsSig();
  const ac = new AbortController();
  const timer = setInterval(() => draftsSig() !== before && ac.abort(), 3000);
  try {
    return await rl.question(q, { signal: ac.signal });
  } catch (e) {
    if (e.name === "AbortError") return null;
    throw e;
  } finally {
    clearInterval(timer);
  }
}

function editInEditor(draft) {
  const file = path.join(os.tmpdir(), `pr-review-${process.pid}.json`);
  const { verdict, summary, comments } = draft;
  fs.writeFileSync(file, JSON.stringify({ verdict, summary, comments }, null, 2));
  rl.close();
  const editor = process.env.VISUAL || process.env.EDITOR || "vi";
  spawnSync(editor, [file], { stdio: "inherit", shell: true });
  rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  try {
    const edited = JSON.parse(fs.readFileSync(file, "utf8"));
    Object.assign(draft, {
      verdict: edited.verdict,
      summary: edited.summary,
      comments: edited.comments ?? [],
    });
    saveDraft(draft);
  } catch (e) {
    console.log(`${C.r}Couldn't parse your edit (${e.message}); draft unchanged.${C.x}`);
  } finally {
    fs.rmSync(file, { force: true });
  }
}

async function view(draft, cfg) {
  while (true) {
    clear();
    console.log(`${C.b}${draft.repo}#${draft.number}${C.x}  ${draft.title}`);
    console.log(`${C.d}${draft.url}  by ${draft.author}  @ ${draft.headSha.slice(0, 7)}${C.x}\n`);
    console.log(`Verdict: ${fmtVerdict(draft.verdict)}\n`);
    console.log(draft.summary + "\n");
    for (const c of draft.comments) console.log(`${C.b}${c.path}:${c.line}${C.x}\n  ${c.body.replace(/\n/g, "\n  ")}\n`);
    const a = (await ask(`${C.b}[p]${C.x}ost  ${C.b}[v]${C.x}erdict  ${C.b}[e]${C.x}dit  ${C.b}[d]${C.x}iscard  ${C.b}[o]${C.x}pen  ${C.b}[b]${C.x}ack > `)).trim().toLowerCase();

    if (a === "b" || a === "") return;
    if (a === "o") spawnSync("open", [draft.url]);
    if (a === "e") editInEditor(draft);
    if (a === "v") {
      const v = (await ask("verdict: (a)pprove, (r)equest_changes, (c)omment > ")).trim().toLowerCase();
      draft.verdict = { a: "approve", r: "request_changes", c: "comment" }[v] ?? draft.verdict;
      saveDraft(draft);
    }
    if (a === "d") {
      if ((await ask("Discard this draft? (y/N) ")).trim().toLowerCase() === "y") {
        deleteDraft(draft.key);
        markReviewed(draft.key, { sha: draft.headSha, status: "discarded" });
        return;
      }
    }
    if (a === "p") {
      try {
        const live = getPR(draft.repo, draft.number);
        if (live.headRefOid !== draft.headSha) {
          const ok = await ask(`${C.y}PR has new commits since this review (${live.headRefOid.slice(0, 7)}). Post anyway? (y/N) ${C.x}`);
          if (ok.trim().toLowerCase() !== "y") continue;
        }
        const event = postReview(draft, settingsFor(cfg, draft.repo));
        deleteDraft(draft.key);
        markReviewed(draft.key, { sha: draft.headSha, status: "posted", event });
        await ask(`${C.g}Posted as ${event}.${C.x} Enter to continue `);
        return;
      } catch (e) {
        await ask(`${C.r}${e.message}${C.x}\nEnter to continue `);
      }
    }
  }
}

while (true) {
  const cfg = loadConfig();
  const drafts = listDrafts();
  clear();
  console.log(`${C.b}PR Review Inbox${C.x}  ${C.d}(${drafts.length} waiting for your final word)${C.x}\n`);
  drafts.forEach((d, i) =>
    console.log(`${String(i + 1).padStart(2)}) ${d.repo}#${d.number}  ${fmtVerdict(d.verdict)}  ${d.title}  ${C.d}(${d.comments.length} inline)${C.x}`),
  );
  if (!drafts.length) console.log(`${C.d}Nothing waiting — this list updates by itself when a review lands.${C.x}`);
  const raw = await askLive(`\n# to open, ${C.b}n${C.x} = review a PR by URL now, ${C.b}q${C.x} = quit > `);
  if (raw === null) continue; // drafts changed → re-render
  const a = raw.trim().toLowerCase();

  if (a === "q") break;
  if (a === "n") {
    const target = parsePRUrl(await ask("PR URL: "));
    if (!target) { await ask("Not a GitHub PR URL. Enter "); continue; }
    console.log("Reviewing… (this can take a few minutes)");
    try {
      const r = reviewPR({ ...cfg, finalWord: true }, target.repo, target.number, { force: true });
      if (r.skipped) await ask(`Skipped: ${r.skipped}. Enter `);
      else await view(r.draft, cfg);
    } catch (e) {
      await ask(`${C.r}${e.message}${C.x}\nEnter `);
    }
    continue;
  }
  const n = Number(a);
  if (n >= 1 && n <= drafts.length) await view(drafts[n - 1], cfg);
}
rl.close();
