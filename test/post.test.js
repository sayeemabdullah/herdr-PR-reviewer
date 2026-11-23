// Posting, against a fake `gh` that records each call instead of talking to GitHub.
// Run with: node --test
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "pr-reviewer-test-"));
process.env.HERDR_PLUGIN_CONFIG_DIR = tmp;
const bin = path.join(tmp, "bin");
const log = path.join(tmp, "gh.log");
fs.mkdirSync(bin);
// Fake gh: logs "args<TAB>stdin" per call. `api user` answers a login; file comments fail if FAIL_FILE is set.
fs.writeFileSync(path.join(bin, "gh"), `#!/bin/sh
input=$(cat)
printf '%s\\t%s\\n' "$*" "$input" >> "${log}"
case "$*" in
  "api user --jq .login") echo me ;;
  *pulls/*/comments*) [ -n "$FAIL_FILE" ] && exit 1 ;;
  *reviewThreads*) printf '%s' "$THREADS" ;;
esac
exit 0
`, { mode: 0o755 });
process.env.PATH = `${bin}${path.delimiter}${process.env.PATH}`;
const { postReview, resolveFixedThreads } = await import("../src/lib.js");

const calls = () => fs.readFileSync(log, "utf8").trim().split("\n").map((l) => {
  const [args, input] = l.split("\t");
  return { args, body: input ? JSON.parse(input) : null };
});
const draft = {
  repo: "acme/api", number: 7, author: "someone", headSha: "abc", verdict: "request_changes", summary: "Overview.",
  comments: [
    { path: "a.js", line: 3, body: "on a line" },
    { path: "a.js", line: null, body: "whole file" },
    { path: "b.js", line: 9, body: "turned off", excluded: true },
  ],
};

test("line comments go in the review; whole-file comments go to GitHub's file comments", () => {
  fs.rmSync(log, { force: true });
  delete process.env.FAIL_FILE;
  assert.equal(postReview(draft, { footer: "" }), "REQUEST_CHANGES");
  const c = calls().filter((x) => x.body);
  assert.match(c[0].args, /pulls\/7\/reviews/);
  assert.deepEqual(c[0].body.comments, [{ path: "a.js", line: 3, side: "RIGHT", body: "on a line" }]);
  assert.match(c[1].args, /pulls\/7\/comments/);
  assert.deepEqual(c[1].body, { body: "whole file", commit_id: "abc", path: "a.js", subject_type: "file" });
  assert.equal(c.length, 2, "the turned-off comment is never sent");
});

test("if a file comment is rejected, it still reaches the PR as a normal comment", () => {
  fs.rmSync(log, { force: true });
  process.env.FAIL_FILE = "1";
  postReview(draft, { footer: "" });
  const last = calls().filter((x) => x.body).at(-1);
  assert.match(last.args, /issues\/7\/comments/);
  assert.match(last.body.body, /a\.js.*whole file/);
});

test("a multi-line suggestion is posted with start_line / start_side; a bad range is dropped", () => {
  fs.rmSync(log, { force: true });
  delete process.env.FAIL_FILE;
  const sug = "```suggestion\nfixed\n```";
  postReview({
    ...draft,
    comments: [
      { path: "a.js", start_line: 2, line: 4, body: sug },
      { path: "a.js", start_line: 4, line: 4, body: "not a range" },
      { path: "a.js", start_line: 9, line: 4, body: "backwards" },
    ],
  }, { footer: "" });
  const [r] = calls().filter((x) => x.body);
  assert.deepEqual(r.body.comments, [
    { path: "a.js", line: 4, side: "RIGHT", body: sug, start_line: 2, start_side: "RIGHT" },
    { path: "a.js", line: 4, side: "RIGHT", body: "not a range" },
    { path: "a.js", line: 4, side: "RIGHT", body: "backwards" },
  ]);
});

test("nits and blockers are labelled in what is posted", () => {
  fs.rmSync(log, { force: true });
  delete process.env.FAIL_FILE;
  postReview({
    ...draft,
    comments: [
      { path: "a.js", line: 1, body: "must fix", severity: "blocker" },
      { path: "a.js", line: 2, body: "consider", severity: "important" },
      { path: "a.js", line: 3, body: "rename", severity: "nit" },
      { path: "a.js", line: null, body: "whole file", severity: "nit" },
    ],
  }, { footer: "" });
  const c = calls().filter((x) => x.body);
  assert.deepEqual(c[0].body.comments.map((x) => x.body), ["**blocker:** must fix", "consider", "**nit:** rename"]);
  assert.equal(c[1].body.body, "**nit:** whole file");
});

const thread = (id, body, { path = "a.js", login = "me", resolved = false } = {}) =>
  ({ id, isResolved: resolved, comments: { nodes: [{ body, path, author: { login } }] } });
const withThreads = (nodes) => { process.env.THREADS = JSON.stringify({ data: { repository: { pullRequest: { reviewThreads: { nodes } } } } }); };
const resolvedIds = () => calls().filter((c) => /resolveReviewThread/.test(c.args)).map((c) => /id=(\S+)/.exec(c.args)[1]);

test("resolveFixedThreads resolves your open thread with the same file and text, and nothing else", () => {
  fs.rmSync(log, { force: true });
  withThreads([
    thread("T1", "null check?"),
    thread("T2", "null check?", { login: "someone-else" }),
    thread("T3", "null check?", { resolved: true }),
    thread("T4", "null check?", { path: "other.js" }),
    thread("T5", "different words"),
    thread("T6", "**nit:** rename"),
  ]);
  const n = resolveFixedThreads(draft, [
    { path: "a.js", line: 3, body: "null check?" },
    { path: "a.js", line: 9, body: "rename", severity: "nit" },
    { path: "a.js", line: 1, body: "no such thread" },
  ]);
  assert.equal(n, 2);
  assert.deepEqual(resolvedIds().sort(), ["T1", "T6"]);
});

test("two earlier comments with the same text resolve two different threads", () => {
  fs.rmSync(log, { force: true });
  withThreads([thread("A", "same"), thread("B", "same")]);
  assert.equal(resolveFixedThreads(draft, [{ path: "a.js", body: "same" }, { path: "a.js", body: "same" }]), 2);
  assert.deepEqual(resolvedIds().sort(), ["A", "B"]);
});

test("posting resolves the fixed threads, unless you turned that off in the inbox", () => {
  fs.rmSync(log, { force: true });
  withThreads([thread("T1", "null check?")]);
  const d = { ...draft, comments: [], fixed: [{ path: "a.js", line: 3, body: "null check?" }] };
  postReview(d, { footer: "" });
  assert.equal(d.resolvedCount, 1);
  assert.deepEqual(resolvedIds(), ["T1"]);
  fs.rmSync(log, { force: true });
  const off = { ...d, resolveOff: true };
  postReview(off, { footer: "" });
  assert.equal(off.resolvedCount, 0);
  assert.deepEqual(resolvedIds(), []);
});

test("a failing GitHub query never fails the post", () => {
  fs.rmSync(log, { force: true });
  process.env.THREADS = "not json";
  const d = { ...draft, comments: [], fixed: [{ path: "a.js", body: "x" }] };
  assert.equal(postReview(d, { footer: "" }), "REQUEST_CHANGES");
  assert.equal(d.resolvedCount, 0);
});
