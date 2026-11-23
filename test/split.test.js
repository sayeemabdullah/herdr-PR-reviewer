// Reviewing a big PR in parts. Run with: node --test
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "pr-reviewer-test-"));
process.env.HERDR_PLUGIN_CONFIG_DIR = tmp;
const { diffFiles, mergeReviews, onlyFiles, splitDiff, validFor, buildPrompt, loadConfig } = await import("../src/lib.js");
const { writeWorkFiles } = await import("../src/agents.js");

const file = (name, size) => `diff --git a/${name} b/${name}\n--- a/${name}\n+++ b/${name}\n@@ -1 +1 @@\n+${"x".repeat(size)}\n`;
const DIFF = file("a.js", 100) + file("b.js", 100) + file("c.js", 100) + file("d.js", 100);

test("splitDiff packs whole files into passes no bigger than the limit", () => {
  const one = file("a.js", 100).length;
  const parts = splitDiff(DIFF, one * 2 + 5);
  assert.deepEqual(parts.map(diffFiles), [["a.js", "b.js"], ["c.js", "d.js"]]);
  assert.equal(parts.join(""), DIFF, "nothing lost, nothing repeated");
});

test("a diff that fits stays one pass; a file bigger than the limit gets a pass of its own", () => {
  assert.deepEqual(splitDiff(DIFF, 1e6), [DIFF]);
  const parts = splitDiff(file("small.js", 10) + file("huge.js", 5000) + file("tiny.js", 10), 300);
  assert.deepEqual(parts.map(diffFiles), [["small.js"], ["huge.js"], ["tiny.js"]]);
});

test("more passes than maxParts: the rest join the last pass", () => {
  const parts = splitDiff(DIFF, 10, 2);
  assert.equal(parts.length, 2);
  assert.deepEqual(diffFiles(parts[1]), ["b.js", "c.js", "d.js"]);
  assert.equal(parts.join(""), DIFF);
});

test("onlyFiles and validFor keep just the files asked for", () => {
  assert.deepEqual(diffFiles(onlyFiles(DIFF, ["b.js", "d.js"])), ["b.js", "d.js"]);
  assert.equal(onlyFiles(DIFF, []), "");
  const valid = new Map([["a.js", new Set([1])], ["b.js", new Set([2])]]);
  assert.deepEqual([...validFor(valid, ["b.js"]).keys()], ["b.js"]);
});

const R = (verdict, summary, comments = []) => ({ review: { verdict, summary, comments }, seconds: 10 });

test("merged review: strictest verdict, all comments, every part's summary, total time", () => {
  const m = mergeReviews([
    R("approve", "fine", [{ path: "a.js", body: "1" }]),
    R("request_changes", "bug in b", [{ path: "b.js", body: "2" }]),
    R("comment", "meh"),
  ], [["a.js"], ["b.js", "x.js", "y.js", "z.js"], ["c.js"]]);
  assert.equal(m.review.verdict, "request_changes");
  assert.equal(m.review.comments.length, 2);
  assert.equal(m.seconds, 30);
  assert.match(m.review.summary, /reviewed in 3 parts/);
  assert.match(m.review.summary, /\*\*Part 2\*\* \(`b\.js`, `x\.js`, `y\.js` and 1 more\)\nbug in b/);
  assert.equal(mergeReviews([R("approve", "x")], [["a.js"]]).review.summary, "x", "one pass is returned untouched");
});

test("approve only when every part approves", () => {
  assert.equal(mergeReviews([R("approve", "a"), R("approve", "b")], [[], []]).review.verdict, "approve");
  assert.equal(mergeReviews([R("approve", "a"), R("comment", "b")], [[], []]).review.verdict, "comment");
});

test("the prompt of a part says which part it is and to stay within its files", () => {
  const pr = { repo: "a/b", title: "t", author: { login: "x" }, headRefName: "h", baseRefName: "main",
    changedFiles: 4, additions: 1, deletions: 0, body: "", headRefOid: "c".repeat(40) };
  const p = buildPrompt(pr, loadConfig(), { diff: DIFF, part: { n: 2, of: 3, files: ["c.js", "d.js"] } });
  assert.match(p, /LARGE PR, PART 2 OF 3/);
  assert.match(p, /ONLY the 2 files/);
  assert.doesNotMatch(buildPrompt(pr, loadConfig(), { diff: DIFF }), /LARGE PR/);
});

test("writeWorkFiles puts files in and takes exactly them out again", () => {
  const dir = fs.mkdtempSync(path.join(tmp, "w-"));
  fs.writeFileSync(path.join(dir, "keep.txt"), "mine");
  const undo = writeWorkFiles(dir, { ".pr-review-prompt.md": "p", ".cursor/cli.json": "{}" });
  assert.deepEqual(fs.readdirSync(dir).sort(), [".cursor", ".pr-review-prompt.md", "keep.txt"]);
  undo();
  assert.deepEqual(fs.readdirSync(dir), ["keep.txt"]);
  const empty = fs.mkdtempSync(path.join(tmp, "w-"));
  writeWorkFiles(empty, { "p.md": "x" })();
  assert.ok(fs.existsSync(empty), "the folder the AI runs in is never removed");
});

test("parts: the earlier comments any part says are fixed are all kept, once", () => {
  const m = mergeReviews([{ review: { verdict: "comment", summary: "a", comments: [], fixed: [1, 2] }, seconds: 1 },
    { review: { verdict: "comment", summary: "b", comments: [], fixed: [2, 4] }, seconds: 1 }], [[], []]);
  assert.deepEqual(m.review.fixed.sort(), [1, 2, 4]);
});
