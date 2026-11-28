// End to end: reviewPR against a stub `gh` and a stub `claude` on PATH, with a real local git repo as "GitHub".
// Run with: node --test
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

const tmp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "pr-reviewer-e2e-")));
process.env.HERDR_PLUGIN_CONFIG_DIR = tmp;
process.env.HERDR_PLUGIN_STATE_DIR = path.join(tmp, "state");
const { parseStackUrl, getStack, reviewStack, existingFeedback, PROJECT_URL, getDraft, postStoredDraft, getReviewed, listActiveDetails, listActiveReviews, loadConfig, markReviewed, repoReviewRules, reviewPR, listDrafts, deleteDraft } = await import("../src/lib.js");

// "GitHub": a repo whose PR #1 head is a commit.
const origin = path.join(tmp, "origin");
const git = (...a) => execFileSync("git", ["-C", origin, ...a], { encoding: "utf8" }).trim();
fs.mkdirSync(path.join(origin, "src"), { recursive: true });
execFileSync("git", ["init", "-q", origin]);
fs.writeFileSync(path.join(origin, "src/app.js"), "one\ntwo\n");
git("add", "-A");
git("-c", "user.email=t@t", "-c", "user.name=t", "commit", "-qm", "pr");
const sha = git("rev-parse", "HEAD");
for (const n of [1, 2, 3]) git("update-ref", `refs/pull/${n}/head`, sha);

const DIFF = "diff --git a/src/app.js b/src/app.js\n--- a/src/app.js\n+++ b/src/app.js\n@@ -1,2 +1,2 @@\n one\n-old\n+two\n";
const bin = path.join(tmp, "bin");
const LOG = path.join(tmp, "log");
fs.mkdirSync(bin);
fs.mkdirSync(LOG);
const script = (name, body) => { fs.writeFileSync(path.join(bin, name), `#!/usr/bin/env node\n${body}`); fs.chmodSync(path.join(bin, name), 0o755); };

// Stub gh. REVIEW.md is only served for the base branch name "main" and only when RULES_ON is set.
script("gh", `
const fs = require("fs"), cp = require("child_process"), a = process.argv.slice(2), has = (s) => a.join(" ").includes(s);
if (has("api user")) console.log("me");
else if (a[0] === "pr" && a[1] === "view") console.log(JSON.stringify({ number: Number(a[2]), title: "Add thing", body: "", url: "u", author: { login: "stranger" },
  baseRefName: "main", headRefName: "x", headRefOid: ${JSON.stringify(sha)}, isDraft: false, additions: Number(process.env.ADDS || 1), deletions: 1, changedFiles: 1 }));
else if (a[0] === "pr" && a[1] === "diff" && a[2] === process.env.BREAK_PR) { process.stderr.write("boom\\n"); process.exit(1); }
else if (a[0] === "pr" && a[1] === "diff") process.stdout.write(process.env.RISKY ? ${JSON.stringify(DIFF)}.split("src/app.js").join("src/auth/login.js") : process.env.DOCS ? ${JSON.stringify(DIFF)}.split("src/app.js").join("docs/guide.md") : process.env.BIG_DIFF ? ["a", "b", "c"].map((f) => "diff --git a/" + f + ".js b/" + f + ".js\\n--- /dev/null\\n+++ b/" + f + ".js\\n@@ -0,0 +1,2 @@\\n+" + "x".repeat(100) + "\\n+y\\n").join("") : ${JSON.stringify(DIFF)});
else if (a[0] === "repo" && a[1] === "clone") cp.execFileSync("git", ["clone", "-q", "--no-checkout", ${JSON.stringify(origin)}, a[3]]);
else if (has("stacks/7")) { if (!has("X-GitHub-Api-Version: 2026-03-10")) process.exit(1); console.log(JSON.stringify({ number: 7, base: { ref: "main" }, pull_requests: [
  { number: 1, title: "Layer one", state: "closed", merged_at: "2026-01-01T00:00:00Z" }, { number: 2, title: "Layer two", state: "open", draft: true }, { number: 3, title: "Layer three", state: "open" }] })); }
else if (has("stacks/404")) { process.stderr.write("gh: Not Found (HTTP 404)\\n"); process.exit(1); }
else if (has("/contents/")) { if (has("REVIEW.md?ref=main") && !has(".github/") && process.env.RULES_ON) process.stdout.write("Always check input validation.\\n"); else process.exit(1); }
else if (has("--method POST")) { fs.writeFileSync(${JSON.stringify(LOG)} + "/posted.json", fs.readFileSync(0, "utf8")); console.log("{}"); }
else console.log("[]");
`);

// Stub claude: records what it was given, answers with an approval.
const REVIEW = JSON.stringify({ verdict: "approve", summary: "Looks fine.", comments: [{ path: "src/app.js", line: 2, body: "nit" }] });
script("claude", `
const fs = require("fs"), a = process.argv.slice(2), stdin = fs.readFileSync(0, "utf8");
fs.appendFileSync(${JSON.stringify(LOG)} + "/claude.parts", JSON.stringify(/LARGE PR, PART (\\d) OF (\\d)/.exec(stdin)?.slice(1) ?? null) + "\\n");
fs.appendFileSync(${JSON.stringify(LOG)} + "/claude.prompts", JSON.stringify(stdin) + "\\n");
fs.writeFileSync(${JSON.stringify(LOG)} + "/claude.json", JSON.stringify({ argv: a, cwd: process.cwd(), stdinHasPrompt: stdin.includes("<pr>"), numbered: /\\n1\\. src\\/app\\.js:2: null\\?/.test(stdin), asksFixed: stdin.includes('"fixed": ['),
  rules: stdin.includes("<rules>\\nAlways check input validation.\\n</rules>"),
  recheck: stdin.includes("This is a RECHECK"), followUp: stdin.includes("FOLLOW-UP REVIEW"), sinceDiff: stdin.includes("Changes since your last review"),
  rulesBeforePr: stdin.indexOf("<rules>") >= 0 && stdin.indexOf("<rules>") < stdin.lastIndexOf("<pr>") }));
const R = ${REVIEW}; if (process.env.FIXED) R.fixed = JSON.parse(process.env.FIXED); console.log(JSON.stringify(R));
`);

process.env.PATH = `${bin}${path.delimiter}${process.env.PATH}`;
const seen = () => JSON.parse(fs.readFileSync(path.join(LOG, "claude.json"), "utf8"));
const cfg = (over = {}) => ({ ...loadConfig(), finalWord: false, allowApprove: true, ...over }); // the user wants auto-posting
const fresh = () => { for (const d of listDrafts()) deleteDraft(d.key); fs.rmSync(path.join(LOG, "posted.json"), { force: true }); };

test("a review runs Claude restricted, posts, and approves when allowed", async () => {
  fresh();
  const r = await reviewPR(cfg(), "o/r", 1, { log: () => {} });
  assert.equal(r.status, "posted");
  assert.equal(r.event, "APPROVE");
  assert.equal(JSON.parse(fs.readFileSync(path.join(LOG, "posted.json"), "utf8")).event, "APPROVE");
  assert.ok(seen().argv.includes("--restricted") && seen().stdinHasPrompt);
});

test("with the final word on, it saves a draft and posts nothing", async () => {
  fresh();
  const r = await reviewPR(cfg({ finalWord: true }), "o/r", 1, { log: () => {} });
  assert.equal(r.status, "drafted");
  assert.equal(listDrafts().length, 1);
  assert.equal(fs.existsSync(path.join(LOG, "posted.json")), false);
});

test("REVIEW.md from the base branch is added to the prompt, outside the untrusted <pr> block", async () => {
  process.env.RULES_ON = "1";
  try {
    fresh();
    await reviewPR(cfg(), "o/r", 1, { log: () => {} });
    assert.ok(seen().rules, "rules inside <rules>");
    assert.ok(seen().rulesBeforePr, "rules come before the untrusted <pr> block");
    fresh();
    await reviewPR(cfg({ repoRules: false }), "o/r", 1, { log: () => {} });
    assert.equal(seen().rules, false, "repoRules: false ignores the file");
  } finally { delete process.env.RULES_ON; }
});

test("no REVIEW.md: the review runs as before", async () => {
  fresh();
  const r = await reviewPR(cfg(), "o/r", 1, { log: () => {} });
  assert.equal(r.status, "posted");
  assert.equal(seen().rules, false);
});

test("repoReviewRules asks for the base branch, and returns nothing when the file is missing", () => {
  assert.equal(repoReviewRules("o/r", "main"), "");
  process.env.RULES_ON = "1";
  try {
    assert.equal(repoReviewRules("o/r", "main"), "Always check input validation.");
    assert.equal(repoReviewRules("o/r", "feature-x"), "", "only the base branch name the stub knows answers");
  } finally { delete process.env.RULES_ON; }
});

test("how long the AI took is saved with the draft and in the review history", async () => {
  fresh();
  const r = await reviewPR(cfg({ finalWord: true }), "o/r", 1, { log: () => {} });
  assert.equal(typeof r.draft.seconds, "number");
  assert.ok(r.draft.seconds >= 0 && r.draft.seconds < 60);
  assert.equal(getReviewed()["o/r#1"].seconds, r.draft.seconds);
});

const partsSeen = () => fs.readFileSync(path.join(LOG, "claude.parts"), "utf8").trim().split("\n").map((l) => JSON.parse(l));

test("a PR bigger than maxDiffChars is reviewed in parts, one run each, and merged into one review", async () => {
  process.env.BIG_DIFF = "1";
  try {
    fresh();
    fs.rmSync(path.join(LOG, "claude.parts"), { force: true });
    const r = await reviewPR(cfg({ maxDiffChars: 300, finalWord: true }), "o/r", 1, { log: () => {} });
    assert.deepEqual(partsSeen(), [["1", "3"], ["2", "3"], ["3", "3"]]);
    assert.match(r.draft.summary, /reviewed in 3 parts/);
    assert.match(r.draft.summary, /\*\*Part 3\*\* \(`c\.js`\)/);
    assert.equal(r.status, "drafted");
  } finally { delete process.env.BIG_DIFF; }
});

test("splitLarge: false keeps one pass, and a small PR is never split", async () => {
  fresh();
  process.env.BIG_DIFF = "1";
  try {
    fs.rmSync(path.join(LOG, "claude.parts"), { force: true });
    await reviewPR(cfg({ maxDiffChars: 300, splitLarge: false }), "o/r", 1, { log: () => {} });
    assert.deepEqual(partsSeen(), [null]);
  } finally { delete process.env.BIG_DIFF; }
  fresh();
  fs.rmSync(path.join(LOG, "claude.parts"), { force: true });
  await reviewPR(cfg({ maxDiffChars: 300 }), "o/r", 1, { log: () => {} });
  assert.deepEqual(partsSeen(), [null]);
});

const OLD = "a".repeat(40);
const earlier = () => markReviewed("o/r#1", { sha: OLD, status: "posted", lastReview: { verdict: "comment", summary: "before", comments: [
  { path: "src/app.js", line: 2, body: "skipped, never posted", excluded: true },
  { path: "src/app.js", line: 2, body: "null?" },
  { path: "src/app.js", line: 1, body: "second one" } ] } });

test("resolveFixed: Claude sees the earlier comments numbered (switched-off ones left out) and its 'fixed' numbers become the draft's list", async () => {
  process.env.FIXED = "[1, 7, 1]";
  try {
    fresh(); earlier();
    const r = await reviewPR(cfg({ resolveFixed: true, finalWord: true }), "o/r", 1, { log: () => {} });
    assert.ok(seen().numbered && seen().asksFixed, "numbered list and the 'fixed' field are in the prompt");
    assert.deepEqual(r.draft.fixed, [{ path: "src/app.js", line: 2, body: "null?" }], "number 7 doesn't exist and 1 counted once");
  } finally { delete process.env.FIXED; }
});

test("resolveFixed off (the default): nothing about fixing is asked for or kept", async () => {
  process.env.FIXED = "[1]";
  try {
    fresh(); earlier();
    const r = await reviewPR(cfg({ finalWord: true }), "o/r", 1, { log: () => {} });
    assert.equal(seen().asksFixed, false);
    assert.equal(r.draft.fixed, undefined);
  } finally { delete process.env.FIXED; }
});

test("an auto-posted review resolves what it says is fixed; the review record keeps only posted comments", async () => {
  process.env.FIXED = "[2]";
  try {
    fresh(); earlier();
    const r = await reviewPR(cfg({ resolveFixed: true }), "o/r", 1, { log: () => {} });
    assert.equal(r.status, "posted");
    assert.deepEqual(r.draft.fixed, [{ path: "src/app.js", line: 1, body: "second one" }]);
    assert.ok(getReviewed()["o/r#1"].lastReview.comments.every((c) => !c.excluded));
  } finally { delete process.env.FIXED; }
});

const modelUsed = () => { const a = seen().argv; return [a[a.indexOf("--model") + 1], a[a.indexOf("--effort") + 1]]; };

test("smartModel off (the default): every review uses your model and effort", async () => {
  fresh();
  await reviewPR(cfg(), "o/r", 1, { log: () => {} });
  assert.deepEqual(modelUsed(), ["opus", "high"]);
});

test("smartModel on: a small PR gets the cheap model, and the draft says why", async () => {
  fresh();
  const r = await reviewPR(cfg({ smartModel: true, finalWord: true }), "o/r", 1, { log: () => {} });
  assert.deepEqual(modelUsed(), ["sonnet", "medium"]);
  assert.equal(r.draft.model, "sonnet");
  assert.match(r.draft.modelWhy, /^small: 1 file, 2 lines$/);
});

test("smartModel on: a docs-only PR gets the cheap model even when it is big", async () => {
  process.env.DOCS = "1"; process.env.ADDS = "900";
  try {
    fresh();
    const r = await reviewPR(cfg({ smartModel: true, finalWord: true }), "o/r", 1, { log: () => {} });
    assert.deepEqual(modelUsed(), ["sonnet", "medium"]);
    assert.equal(r.draft.modelWhy, "docs only");
  } finally { delete process.env.DOCS; delete process.env.ADDS; }
});

test("smartModel on: a risky path gets your model and effort, however small", async () => {
  process.env.RISKY = "1";
  try {
    fresh();
    const r = await reviewPR(cfg({ smartModel: true, finalWord: true }), "o/r", 1, { log: () => {} });
    assert.deepEqual(modelUsed(), ["opus", "high"]);
    assert.equal(r.draft.modelWhy, "touches src/auth/login.js");
  } finally { delete process.env.RISKY; }
});

test("smartModel on: a big PR gets your model and effort; the cheap model is yours to choose", async () => {
  process.env.ADDS = "500";
  try {
    fresh();
    await reviewPR(cfg({ smartModel: true }), "o/r", 1, { log: () => {} });
    assert.deepEqual(modelUsed(), ["opus", "high"]);
    fresh();
    await reviewPR(cfg({ smartModel: true, smallMaxLines: 1000, cheapModel: "haiku", cheapEffort: "low" }), "o/r", 1, { log: () => {} });
    assert.deepEqual(modelUsed(), ["haiku", "low"]);
  } finally { delete process.env.ADDS; }
});

test("the note at the bottom of a posted review links to the project", async () => {
  fresh();
  await reviewPR(cfg(), "o/r", 1, { log: () => {} });
  const body = JSON.parse(fs.readFileSync(path.join(LOG, "posted.json"), "utf8")).body;
  assert.match(body, /AI-assisted review via \[herdr pr-reviewer\]\(https:\/\/github\.com\/sayeemabdullah\/herdr-PR-reviewer\)/);
  assert.equal(PROJECT_URL, "https://github.com/sayeemabdullah/herdr-PR-reviewer");
});

test("a draft remembers whether the watcher found the PR or you gave its link", async () => {
  fresh();
  await reviewPR(cfg({ finalWord: true }), "o/r", 1, { log: () => {} });
  assert.equal(listDrafts()[0].source, "auto");
  fresh();
  await reviewPR(cfg({ finalWord: true }), "o/r", 1, { log: () => {}, source: "link" });
  assert.equal(listDrafts()[0].source, "link");
});

test("running reviews say who asked for them and since when; an old lock without that still works", () => {
  const locks = path.join(tmp, "state", "locks");
  fs.writeFileSync(path.join(locks, "a.json"), "o/a#1\tlink");
  fs.writeFileSync(path.join(locks, "b.json"), "o/b#2");
  const act = Object.fromEntries(listActiveDetails().map((a) => [a.key, a]));
  assert.equal(act["o/a#1"].source, "link");
  assert.equal(act["o/b#2"].source, null);
  assert.ok(Date.now() - act["o/a#1"].since < 5000);
  assert.deepEqual(listActiveReviews().sort(), ["o/a#1", "o/b#2"]);
  fs.rmSync(path.join(locks, "a.json")); fs.rmSync(path.join(locks, "b.json"));
});

test("reviews posted with the old plain note don't count as feedback from others", () => {
  // existingFeedback strips both the current footer and the old unlinked one.
  const old = "Looks fine.\n\n---\n<sub>🤖 AI-assisted review via herdr pr-reviewer</sub>";
  fs.writeFileSync(path.join(bin, "gh"), fs.readFileSync(path.join(bin, "gh"), "utf8").replace('else console.log("[]");', `else if (has("/reviews?")) console.log(JSON.stringify([{ user: { login: "x" }, state: "COMMENTED", body: ${JSON.stringify(old)} }]));\nelse console.log("[]");`));
  const out = existingFeedback("o/r", 1, "");
  assert.match(out, /Looks fine\./, "the review itself is still read");
  assert.ok(!/herdr pr-reviewer/.test(out), out);
});

test("a recheck reviews the same commit again with the earlier review in front of it, and may approve", async () => {
  fresh();
  const lastReview = { verdict: "request_changes", summary: "Needs a null check.", comments: [{ path: "src/app.js", line: 2, body: "null?" }] };
  markReviewed("o/r#1", { sha, status: "posted", event: "REQUEST_CHANGES", lastReview });
  // Without the flag the same commit is just reviewed from scratch.
  await reviewPR(cfg({ finalWord: true }), "o/r", 1, { log: () => {} });
  assert.equal(seen().followUp, false);
  fresh();
  markReviewed("o/r#1", { sha, status: "posted", event: "REQUEST_CHANGES", lastReview });
  const r = await reviewPR(cfg({ finalWord: true }), "o/r", 1, { log: () => {}, recheck: true, source: "recheck" });
  assert.equal(r.status, "drafted");
  assert.equal(r.draft.verdict, "approve");
  assert.equal(r.draft.source, "recheck");
  assert.ok(seen().followUp && seen().recheck);
  assert.equal(seen().sinceDiff, false); // the code didn't change, so there is no "since" diff
});

test("posting a saved draft sends it, removes it from the inbox and records it in the history", async () => {
  fresh();
  await reviewPR(cfg({ finalWord: true }), "o/r", 1, { log: () => {} });
  assert.ok(getDraft("o/r#1"));
  const res = postStoredDraft("o/r#1", cfg());
  assert.equal(res.event, "APPROVE");
  assert.equal(JSON.parse(fs.readFileSync(path.join(LOG, "posted.json"), "utf8")).event, "APPROVE");
  assert.equal(getDraft("o/r#1"), null);
  assert.equal(getReviewed()["o/r#1"].status, "posted");
  assert.throws(() => postStoredDraft("o/r#1", cfg()), /no longer in the inbox/); // a second post finds nothing, so it can't post twice
});

test("the post CLI (what the panel runs in the background) prints one JSON line, for success and for failure", async () => {
  fresh();
  await reviewPR(cfg({ finalWord: true }), "o/r", 1, { log: () => {} });
  const run = (...a) => spawnSync(process.execPath, [path.join(import.meta.dirname, "..", "src", "post.js"), ...a], { encoding: "utf8", env: process.env });
  const ok = run("o/r#1");
  assert.deepEqual([ok.status, JSON.parse(ok.stdout).ok, JSON.parse(ok.stdout).event], [0, true, "APPROVE"]);
  const gone = run("o/r#1");
  assert.equal(gone.status, 1);
  assert.match(JSON.parse(gone.stdout).error, /no longer in the inbox/);
});

test("a fixed comment keeps its severity, so it matches the text that was posted; earlier comments are remembered across reviews", async () => {
  fresh();
  const lastReview = { verdict: "request_changes", summary: "s", comments: [
    { path: "src/app.js", line: 2, body: "null?", severity: "blocker" }, { path: "src/app.js", line: 1, body: "naming", severity: "nit" }] };
  markReviewed("o/r#1", { sha: "0".repeat(40), status: "posted", event: "COMMENT", lastReview });
  process.env.FIXED = "[1]";
  try {
    const r = await reviewPR(cfg({ finalWord: true, resolveFixed: true }), "o/r", 1, { log: () => {} });
    assert.deepEqual(r.draft.fixed, [{ path: "src/app.js", line: 2, body: "null?", severity: "blocker" }]);
  } finally { delete process.env.FIXED; }
  // The nit that still stands is remembered next to the new comment.
  const remembered = getReviewed()["o/r#1"].lastReview.comments.map((c) => c.body);
  assert.ok(remembered.includes("naming") && remembered.includes("nit") && !remembered.includes("null?"));
});

test("a stack link is recognised, and nothing else is", () => {
  assert.deepEqual(parseStackUrl("https://github.com/Org/some-repo/stack/8115"), { repo: "Org/some-repo", number: 8115 });
  assert.deepEqual(parseStackUrl(" github.com/o/r/stack/7/ "), { repo: "o/r", number: 7 });
  assert.equal(parseStackUrl("https://github.com/o/r/pull/7"), null);
  assert.equal(parseStackUrl(undefined), null);
});

test("getStack lists every layer bottom to top and says which are open", () => {
  const st = getStack("o/r", 7);
  assert.deepEqual(st.layers.map((l) => [l.number, l.title, l.open]), [[1, "Layer one", false], [2, "Layer two", true], [3, "Layer three", true]]);
  assert.throws(() => getStack("o/r", 404), /stack 404/i);
});

const prompts = () => fs.readFileSync(path.join(LOG, "claude.prompts"), "utf8").trim().split("\n").map((l) => JSON.parse(l));

test("a stack: each open PR is reviewed one after another, bottom first, and told its place", async () => {
  fresh();
  fs.rmSync(path.join(LOG, "claude.prompts"), { force: true });
  const r = await reviewStack(cfg({ finalWord: true }), "o/r", 7, { log: () => {} });
  assert.deepEqual(r.results.map((x) => [x.number, x.status]), [[2, "drafted"], [3, "drafted"]]);
  assert.deepEqual(listDrafts().map((d) => d.number), [2, 3]);
  const [two, three] = prompts();
  assert.match(two, /layer 2 of 3/);
  assert.match(three, /layer 3 of 3/);
  assert.match(two.slice(two.lastIndexOf("<pr>")), /1\. #1 Layer one \(merged or closed\)\n2\. #2 Layer two <- this PR\n3\. #3 Layer three/);
  assert.equal(fs.existsSync(path.join(LOG, "posted.json")), false);
});

test("a stack: one failing PR is recorded and the rest are still reviewed", async () => {
  fresh();
  process.env.BREAK_PR = "2";
  try {
    const r = await reviewStack(cfg({ finalWord: true }), "o/r", 7, { log: () => {} });
    assert.deepEqual(r.results.map((x) => [x.number, x.status]), [[2, "failed"], [3, "drafted"]]);
    assert.equal(getReviewed()["o/r#2"].status, "failed");
    assert.equal(getReviewed()["o/r#2"].attempts, 3);
  } finally { delete process.env.BREAK_PR; }
});

test("review.js: --list prints the open PRs of a stack; a stack that can't be read exits 1", () => {
  const cli = (...a) => spawnSync(process.execPath, [path.join(import.meta.dirname, "../src/review.js"), ...a], { encoding: "utf8" });
  const ok = cli("https://github.com/o/r/stack/7", "--list");
  assert.equal(ok.status, 0, ok.stderr);
  assert.deepEqual(JSON.parse(ok.stdout), { repo: "o/r", number: 7, open: [2, 3] });
  const bad = cli("https://github.com/o/r/stack/404", "--list");
  assert.equal(bad.status, 1);
  assert.match(bad.stderr, /stack 404/i);
});
