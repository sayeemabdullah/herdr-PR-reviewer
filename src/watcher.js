// Poll loop: reviews the open PRs your config asks for (see listPRsToReview in lib.js).
import fs from "node:fs";
import {
  CONFIG_FILE, HERDR, WATCHER_FILE, getReviewed, headSha, listDrafts, listPRsToReview, loadConfig,
  markReviewed, prKey, reviewPR, run, settingsFor, sleep,
} from "./lib.js";

const MAX_ATTEMPTS = 3;
const PANE = process.env.HERDR_PANE_ID;
const ts = () => new Date().toLocaleTimeString();
const log = (...a) => console.log(`[${ts()}]`, ...a);

fs.writeFileSync(WATCHER_FILE, JSON.stringify({ pid: process.pid, paneId: PANE ?? null }));
const cleanup = () => {
  try {
    if (JSON.parse(fs.readFileSync(WATCHER_FILE, "utf8")).pid === process.pid) fs.rmSync(WATCHER_FILE);
  } catch {}
};
process.on("exit", cleanup);
for (const sig of ["SIGINT", "SIGTERM", "SIGHUP"]) process.on(sig, () => process.exit(0));

/** Inbox section: shown in this pane and in its herdr label, e.g. "PR watcher · 2 waiting". */
let lastInbox = "";
function showInbox() {
  const drafts = listDrafts();
  if (PANE) run(HERDR, ["pane", "rename", PANE, `PR watcher · ${drafts.length} waiting`], { allowFail: true });
  const text = drafts.length
    ? `Inbox — ${drafts.length} waiting for your final word (open the inbox: prefix+i, or herdr plugin action invoke pr-reviewer.inbox):\n` +
      drafts.map((d) => `   • ${d.repo}#${d.number}  ${d.verdict.toUpperCase()}  ${d.title}`).join("\n")
    : "Inbox — empty";
  if (text !== lastInbox) console.log(`\n${text}\n`);
  lastInbox = text;
}

console.log("PR Reviewer watcher — reviews PRs you're added to, and every PR in repos set to \"all\". Ctrl+C to stop.\n");

while (true) {
  let cfg;
  try {
    cfg = loadConfig();
  } catch (e) {
    log(`config error in ${CONFIG_FILE}: ${e.message}`);
    await sleep(30_000);
    continue;
  }
  if (cfg.missing) {
    log(`onlyListedRepos is on but no repos are listed in ${CONFIG_FILE}`);
    await sleep(30_000);
    continue;
  }

  let prs = [];
  try {
    prs = listPRsToReview(cfg);
  } catch (e) {
    log(`GitHub search failed: ${e.message}`);
  }
  const reviewed = getReviewed();
  for (const pr of prs) {
    const s = settingsFor(cfg, pr.repo);
    const key = prKey(pr.repo, pr.number);
    if (s.skipDrafts && pr.isDraft) continue;
    if (s.ignoreAuthors.includes(pr.author?.login ?? "")) continue;

    let sha;
    try {
      sha = headSha(pr.repo, pr.number);
    } catch (e) {
      log(`${key}: ${e.message}`);
      continue;
    }
    const prev = reviewed[key];
    if (prev) {
      const sameSha = prev.sha === sha;
      if (sameSha && (prev.status !== "failed" || (prev.attempts ?? 0) >= MAX_ATTEMPTS)) continue;
      if (!sameSha && !s.rereviewOnPush) continue;
    }

    log(`reviewing ${key} "${pr.title}"`);
    try {
      const r = reviewPR(cfg, pr.repo, pr.number, { log });
      if (r.skipped) log(`  skipped: ${r.skipped}`);
      else log(`  ${r.status}: ${r.event ?? r.draft.verdict} (${r.draft.comments.length} inline comments)`);
    } catch (e) {
      const attempts = prev?.sha === sha ? (prev.attempts ?? 0) + 1 : 1;
      markReviewed(key, { sha, status: "failed", attempts, error: e.message });
      log(`  FAILED (attempt ${attempts}/${MAX_ATTEMPTS}): ${e.message}`);
    }
    showInbox();
  }
  showInbox();
  log(`checked ${prs.length} PR(s); next check in ${cfg.pollSeconds}s`);
  await sleep(cfg.pollSeconds * 1000);
}
