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
  writeConfig({ repos: [{ repo: "me/my-app", review: "all" }], ignoreRepos: ["secret/repo"] });
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
