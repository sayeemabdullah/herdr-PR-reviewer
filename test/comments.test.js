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

const SUG = "```suggestion\nfixed\n```";

test("a multi-line suggestion keeps its range when every line in it is in the diff", () => {
  const { placed } = placeComments([{ path: "src/app.js", start_line: 2, line: 4, body: SUG }], valid);
  assert.deepEqual(placed, [{ path: "src/app.js", start_line: 2, line: 4, body: SUG }]);
});

test("a range that crosses a gap or runs backwards loses its suggestion, so it can't replace the wrong lines", () => {
  const { placed } = placeComments([
    { path: "src/app.js", start_line: 3, line: 11, body: SUG },
    { path: "src/app.js", start_line: 4, line: 2, body: SUG },
  ], valid);
  for (const c of placed) {
    assert.equal(c.start_line, undefined);
    assert.doesNotMatch(c.body, /```suggestion/);
    assert.match(c.body, /```\nfixed\n```/);
  }
  assert.deepEqual(placed.map((c) => c.line), [11, 2]);
});

test("a suggestion that can't be applied inline (whole file, not in the diff, untouched file) shows as plain code", () => {
  const { placed, folded } = placeComments([
    { path: "src/app.js", line: 7, body: SUG },
    { path: "src/app.js", line: null, body: SUG },
    { path: "src/untouched.js", line: 5, body: SUG },
  ], valid);
  for (const c of [...placed, ...folded]) assert.doesNotMatch(c.body, /```suggestion/);
  assert.equal(placed.length, 2);
  assert.equal(folded.length, 1);
});

test("a one-line suggestion on a changed line is left alone", () => {
  const { placed } = placeComments([{ path: "src/app.js", line: 3, body: SUG }], valid);
  assert.deepEqual(placed, [{ path: "src/app.js", line: 3, body: SUG }]);
});

test("the prompt explains multi-line suggestions", () => {
  const pr = { repo: "a/b", title: "t", author: { login: "x" }, headRefName: "h", baseRefName: "main",
    changedFiles: 1, additions: 1, deletions: 0, body: "", headRefOid: "c".repeat(40) };
  const p = buildPrompt(pr, loadConfig(), { diff: "diff --git a/src/app.js b/src/app.js\n" });
  assert.match(p, /"start_line"/);
  assert.match(p, /REPLACES the commented line, or the lines start_line\.\.line/);
});
