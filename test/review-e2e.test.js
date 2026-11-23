// End to end: reviewPR against a stub `gh` and a stub `claude` on PATH, with a real local git repo as "GitHub".
// Run with: node --test
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

const tmp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "pr-reviewer-e2e-")));
process.env.HERDR_PLUGIN_CONFIG_DIR = tmp;
process.env.HERDR_PLUGIN_STATE_DIR = path.join(tmp, "state");
const { loadConfig, repoReviewRules, reviewPR, listDrafts, deleteDraft } = await import("../src/lib.js");

// "GitHub": a repo whose PR #1 head is a commit.
const origin = path.join(tmp, "origin");
const git = (...a) => execFileSync("git", ["-C", origin, ...a], { encoding: "utf8" }).trim();
fs.mkdirSync(path.join(origin, "src"), { recursive: true });
execFileSync("git", ["init", "-q", origin]);
fs.writeFileSync(path.join(origin, "src/app.js"), "one\ntwo\n");
git("add", "-A");
git("-c", "user.email=t@t", "-c", "user.name=t", "commit", "-qm", "pr");
const sha = git("rev-parse", "HEAD");
git("update-ref", "refs/pull/1/head", sha);

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
else if (a[0] === "pr" && a[1] === "view") console.log(JSON.stringify({ number: 1, title: "Add thing", body: "", url: "u", author: { login: "stranger" },
  baseRefName: "main", headRefName: "x", headRefOid: ${JSON.stringify(sha)}, isDraft: false, additions: 1, deletions: 1, changedFiles: 1 }));
else if (a[0] === "pr" && a[1] === "diff") process.stdout.write(${JSON.stringify(DIFF)});
else if (a[0] === "repo" && a[1] === "clone") cp.execFileSync("git", ["clone", "-q", "--no-checkout", ${JSON.stringify(origin)}, a[3]]);
else if (has("/contents/")) { if (has("REVIEW.md?ref=main") && !has(".github/") && process.env.RULES_ON) process.stdout.write("Always check input validation.\\n"); else process.exit(1); }
else if (has("--method POST")) { fs.writeFileSync(${JSON.stringify(LOG)} + "/posted.json", fs.readFileSync(0, "utf8")); console.log("{}"); }
else console.log("[]");
`);

// Stub claude: records what it was given, answers with an approval.
const REVIEW = JSON.stringify({ verdict: "approve", summary: "Looks fine.", comments: [{ path: "src/app.js", line: 2, body: "nit" }] });
script("claude", `
const fs = require("fs"), a = process.argv.slice(2), stdin = fs.readFileSync(0, "utf8");
fs.writeFileSync(${JSON.stringify(LOG)} + "/claude.json", JSON.stringify({ argv: a, cwd: process.cwd(), stdinHasPrompt: stdin.includes("<pr>"),
  rules: stdin.includes("<rules>\\nAlways check input validation.\\n</rules>"),
  rulesBeforePr: stdin.indexOf("<rules>") >= 0 && stdin.indexOf("<rules>") < stdin.lastIndexOf("<pr>") }));
console.log(${JSON.stringify(REVIEW)});
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
