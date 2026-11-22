// Run with: node --test
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "pr-reviewer-test-"));
process.env.HERDR_PLUGIN_CONFIG_DIR = tmp;
const { buildPrompt, commentableRanges, loadConfig, placeComments } = await import("../src/lib.js");

const valid = new Map([
  ["src/app.js", new Set([1, 2, 3, 4, 10, 11, 20])],
  ["package-lock.json", new Set([1])],
]);

test("commentable lines are listed as compact ranges, minus skipped files", () => {
  assert.equal(commentableRanges(valid, { skip: ["package-lock.json"] }), "src/app.js: 1-4, 10-11, 20");
});

test("comments land on lines, on the file, or in the summary", () => {
  const { placed, folded } = placeComments([
    { path: "src/app.js", line: 3, body: "on a changed line" },
    { path: "src/app.js", line: 7, body: "line not in the diff" },
    { path: "src/app.js", line: null, body: "about the whole file" },
    { path: "src/untouched.js", line: 5, body: "file the PR didn't change" },
  ], valid);
  assert.deepEqual(placed, [
    { path: "src/app.js", line: 3, body: "on a changed line" },
    { path: "src/app.js", line: null, body: "**Line 7:** line not in the diff" },
    { path: "src/app.js", line: null, body: "about the whole file" },
  ]);
  assert.deepEqual(folded, [{ path: "src/untouched.js", line: 5, body: "file the PR didn't change" }]);
});

test("the prompt lists commentable lines and asks for findings inline", () => {
  const pr = { repo: "a/b", title: "t", author: { login: "x" }, headRefName: "h", baseRefName: "main",
    changedFiles: 1, additions: 1, deletions: 0, body: "", headRefOid: "c".repeat(40) };
  const p = buildPrompt(pr, loadConfig(), { diff: "diff --git a/src/app.js b/src/app.js\n", commentable: "src/app.js: 1-4" });
  assert.match(p, /COMMENTABLE LINES \(file: line ranges\):\nsrc\/app\.js: 1-4/);
  assert.match(p, /put each concrete finding in "comments"/);
  assert.match(p, /"line": null for a comment on the whole file/);
});
