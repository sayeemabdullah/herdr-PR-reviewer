// Poll loop: reviews the open PRs your config asks for (see listPRsToReview in lib.js).
import fs from "node:fs";
import {
  CONFIG_FILE, HERDR, WATCHER_FILE, getReviewed, headSha, listDrafts, listPRsToReview, loadConfig,
  markReviewed, prKey, reviewPR, run, settingsFor, sleep, writeLauncher,
} from "./lib.js";

writeLauncher();

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
  // Work out what needs a review this round.
  const reviewed = getReviewed();
  const jobs = [];
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
    if (prev?.status === "failed") {
      // `sha` keeps the last *successful* review (for follow-ups); failures track failedSha.
      if ((prev.failedSha ?? prev.sha) === sha && (prev.attempts ?? 0) >= MAX_ATTEMPTS) continue;
    } else if (prev) {
      if (prev.sha === sha) continue;
      if (!s.rereviewOnPush) continue;
    }
    jobs.push({ pr, key, sha, prev });
  }

  // Run them, up to maxParallel at a time, so one slow review doesn't hold up the rest.
  const runJob = async ({ pr, key, sha, prev }) => {
    const tag = (...a) => log(`[${key}]`, ...a);
    tag(`reviewing "${pr.title}"`);
    try {
      const r = await reviewPR(cfg, pr.repo, pr.number, { log: (m) => tag(String(m).trim()) });
      if (r.skipped) tag(`skipped: ${r.skipped}`);
      else tag(`${r.status}: ${r.event ?? r.draft.verdict} (${r.draft.comments.length} inline comments)`);
    } catch (e) {
      const attempts = prev?.status === "failed" && (prev.failedSha ?? prev.sha) === sha ? (prev.attempts ?? 0) + 1 : 1;
      markReviewed(key, { status: "failed", failedSha: sha, attempts, error: e.message });
      tag(`FAILED (attempt ${attempts}/${MAX_ATTEMPTS}): ${e.message}`);
    }
    showInbox();
  };
  const queue = [...jobs];
  const workers = Array.from({ length: Math.max(1, Math.min(cfg.maxParallel ?? 2, queue.length)) }, async () => {
    while (queue.length) await runJob(queue.shift());
  });
  await Promise.all(workers);
  showInbox();
  log(`checked ${prs.length} PR(s); next check in ${cfg.pollSeconds}s`);
  await sleep(cfg.pollSeconds * 1000);
}
