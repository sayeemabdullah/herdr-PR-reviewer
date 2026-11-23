// Run with: node --test
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

// lib.js makes its folders on import, so point it at a throwaway one first.
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "pr-reviewer-test-"));
process.env.HERDR_PLUGIN_CONFIG_DIR = tmp;
const { loadConfig, mergePRs, reviewModeFor } = await import("../src/lib.js");

const writeConfig = (c) => fs.writeFileSync(path.join(tmp, "config.json"), JSON.stringify(c));
const pr = (repo, number) => ({ repo, number, title: `#${number}` });

test("a repo set to all reviews every PR; others only the ones you're added to", () => {
  writeConfig({ repos: [{ repo: "me/my-app", review: "all" }, { repo: "team/team-app", review: "requested" }] });
  const cfg = loadConfig();
  assert.equal(reviewModeFor(cfg, "me/my-app"), "all");
  assert.equal(reviewModeFor(cfg, "Team/Team-App"), "requested");
  assert.equal(reviewModeFor(cfg, "someone/else"), "requested"); // not listed: the default
});

test("the round's PRs: every PR of an all repo plus requested ones, each once", () => {
  writeConfig({ repos: [{ repo: "me/my-app", review: "all" }], ignoreRepos: ["secret/repo"], onlyListedRepos: false });
  const cfg = loadConfig();
  const requested = [pr("me/my-app", 1), pr("team/team-app", 7), pr("secret/repo", 3)];
  const fromAll = [pr("me/my-app", 1), pr("me/my-app", 2)];
  assert.deepEqual(mergePRs(cfg, requested, fromAll).map((p) => `${p.repo}#${p.number}`), ["me/my-app#1", "me/my-app#2", "team/team-app#7"]);
});

test("onlyListedRepos drops requested PRs from repos not in the list", () => {
  writeConfig({ repos: [{ repo: "team/team-app" }], onlyListedRepos: true });
  const cfg = loadConfig();
  assert.deepEqual(mergePRs(cfg, [pr("team/team-app", 7), pr("other/x", 9)], []).map((p) => p.number), [7]);
});

test("a typo in review is an error, not silently 'requested'", () => {
  writeConfig({ repos: [{ repo: "me/my-app", review: "everything" }] });
  assert.throws(() => loadConfig(), /"review" must be "all" or "requested"/);
});

test("formatDuration: seconds, minutes, hours, and nothing for a missing time", async () => {
  const { formatDuration } = await import("../src/lib.js");
  assert.equal(formatDuration(0), "0s");
  assert.equal(formatDuration(42.4), "42s");
  assert.equal(formatDuration(190), "3m 10s");
  assert.equal(formatDuration(3700), "1h 1m");
  assert.equal(formatDuration(null), "");
  assert.equal(formatDuration(undefined), "");
  assert.equal(formatDuration(-3), "");
});

test("by default only the repos you listed are reviewed; other repos you're asked on are ignored", () => {
  writeConfig({ repos: [{ repo: "me/my-app", review: "all" }] });
  const cfg = loadConfig();
  assert.equal(cfg.onlyListedRepos, true);
  assert.deepEqual(mergePRs(cfg, [pr("me/my-app", 1), pr("work/big-repo", 7)], [pr("me/my-app", 2)]).map((p) => `${p.repo}#${p.number}`), ["me/my-app#2", "me/my-app#1"]);
});

test("onlyListedRepos: false brings back reviewing every repo you're asked on", () => {
  writeConfig({ repos: [{ repo: "me/my-app" }], onlyListedRepos: false });
  assert.deepEqual(mergePRs(loadConfig(), [pr("work/big-repo", 7)], []).map((p) => p.number), [7]);
});

test("with the default and no repos listed, the watcher has nothing to do and says why", () => {
  writeConfig({ repos: [] });
  assert.equal(loadConfig().missing, true);
  writeConfig({ repos: [], onlyListedRepos: false });
  assert.equal(loadConfig().missing, false);
});
