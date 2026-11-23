// Which model reviews which PR. Run with: node --test
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "pr-reviewer-test-"));
process.env.HERDR_PLUGIN_CONFIG_DIR = tmp;
const { loadConfig, pickModel } = await import("../src/lib.js");

const on = (over = {}) => ({ ...loadConfig(), smartModel: true, ...over });
const pr = (adds, dels = 0) => ({ additions: adds, deletions: dels });

test("off by default: always your model and effort", () => {
  const s = loadConfig();
  assert.equal(s.smartModel, false);
  assert.deepEqual(pickModel(s, pr(1), ["README.md"]), { model: "opus", effort: "high", tier: "main", why: "" });
});

test("docs-only PRs use the cheap model, whatever their size", () => {
  const r = pickModel(on(), pr(2000), ["README.md", "docs/setup/install.md", "CHANGELOG.md", "notes.txt"]);
  assert.deepEqual([r.model, r.effort, r.tier, r.why], ["sonnet", "medium", "cheap", "docs only"]);
});

test("one non-doc file means it is not docs-only", () => {
  const r = pickModel(on(), pr(500), ["README.md", "src/app.js"]);
  assert.equal(r.tier, "main");
  assert.match(r.why, /^big: 2 files, 500 lines$/);
});

test("small means few files and few lines, counting added and removed lines", () => {
  assert.equal(pickModel(on(), pr(30, 30), ["a.js", "b.js", "c.js"]).tier, "cheap", "60 lines and 3 files is the edge");
  assert.equal(pickModel(on(), pr(31, 30), ["a.js"]).tier, "main", "61 lines");
  assert.equal(pickModel(on(), pr(5), ["a.js", "b.js", "c.js", "d.js"]).tier, "main", "4 files");
});

test("risky paths always get your model, even for a one-line or docs change", () => {
  for (const f of ["src/auth/login.js", "lib/user-auth.js", "db/migrations/001.sql", "schema.sql", ".github/workflows/ci.yml",
    "Dockerfile", "infra/main.tf", "package.json", "config/.env.production", "src/payments/charge.js", "src/crypto/hash.js", "tokens.js"]) {
    const r = pickModel(on(), pr(1), [f]);
    assert.equal(r.tier, "main", f);
    assert.equal(r.why, "touches " + f);
  }
  assert.equal(pickModel(on(), pr(1), ["docs/security/policy.md"]).tier, "main", "a docs file in a risky folder is still risky");
});

test("ordinary files are not mistaken for risky ones", () => {
  for (const f of ["src/app.js", "src/utils/format.js", "README.md", "test/format.test.js"]) assert.equal(pickModel(on(), pr(1), [f]).tier, "cheap", f);
});

test("the cheap model, effort and the limits are all configurable", () => {
  const s = on({ cheapModel: "haiku", cheapEffort: "low", smallMaxLines: 5, smallMaxFiles: 1, riskyPaths: ["src/core/**"] });
  assert.deepEqual([pickModel(s, pr(3), ["a.js"]).model, pickModel(s, pr(3), ["a.js"]).effort], ["haiku", "low"]);
  assert.equal(pickModel(s, pr(6), ["a.js"]).tier, "main");
  assert.equal(pickModel(s, pr(1), ["src/core/x.js"]).tier, "main");
  assert.equal(pickModel(s, pr(1), ["src/auth/x.js"]).tier, "cheap", "your own riskyPaths replace the defaults");
});

test("an empty PR (no files known) is not called docs-only", () => {
  assert.notEqual(pickModel(on(), pr(0), []).why, "docs only");
});
