// Check that Claude Code really works here: node src/doctor.js [--wait]
// Runs a tiny fixed review (a one-line PR with a planted bug) through the same command a real review uses, so a missing
// sign-in, a bad flag or an answer in the wrong shape shows up here instead of in a failed review.
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { STATE_DIR, agentArgv, buildPrompt, loadConfig, parseAgentOutput, run, runAsync, settingsFor } from "./lib.js";

const FILE = "src/math.js";
const DIFF = `diff --git a/${FILE} b/${FILE}
new file mode 100644
--- /dev/null
+++ b/${FILE}
@@ -0,0 +1,2 @@
+// Adds two numbers.
+export const add = (a, b) => a - b;
`;
const PR = {
  repo: "doctor/check", title: "Add add()", author: { login: "someone" }, headRefName: "add", baseRefName: "main",
  headRefOid: "0000000000000000000000000000000000000000", changedFiles: 1, additions: 2, deletions: 0,
  body: "Adds a helper that adds two numbers.",
};

/** Turn a failure into the one thing the user should do about it. */
export function hintFor(message) {
  const m = String(message);
  if (/ENOENT|not found|isn't installed/i.test(m)) return "install Claude Code (https://claude.com/claude-code), or fix agent.command in config.json";
  if (/timed out/i.test(m)) return "it didn't answer in time. It may be waiting for you to sign in: run `claude` once and sign in";
  if (/no JSON object/i.test(m)) return "it ran but didn't reply with the JSON the reviewer needs. Its output is shown above";
  if (/unauthor|not logged|log in|login|sign in|api key|auth/i.test(m)) return "sign in: run `claude` once and sign in";
  if (/unknown (option|argument)|unrecognized|invalid (option|argument)/i.test(m)) return "this version of Claude Code rejected a flag. Please report it with the output of `claude --version`";
  return "sign-in is the usual cause: run `claude` once and sign in";
}

const lastLine = (s) => String(s).split("\n").map((l) => l.trim()).filter(Boolean).pop() ?? "";

/** Run the fixed review. Resolves { ok, seconds, verdict, foundBug } or { ok: false, error, hint }. */
export async function smokeReview(settings, { timeoutMs = 180000 } = {}) {
  const [cmd, ...args] = agentArgv(settings.agent.command, settings);
  fs.mkdirSync(STATE_DIR, { recursive: true });
  const tmp = fs.mkdtempSync(path.join(STATE_DIR, "doctor-"));
  const started = Date.now();
  const took = () => Math.round((Date.now() - started) / 100) / 10;
  try {
    const stdout = await runAsync(cmd, args, {
      input: buildPrompt(PR, settings, { diff: DIFF, commentable: `${FILE}: 1-2` }),
      timeoutMs, cwd: tmp,
    });
    let review;
    try {
      review = parseAgentOutput(stdout);
    } catch (e) {
      return { ok: false, error: e.message, hint: hintFor(e.message), seconds: took() };
    }
    const everything = `${review.summary} ${review.comments.map((c) => c.body).join(" ")}`;
    return {
      ok: true, seconds: took(), verdict: review.verdict,
      foundBug: /subtract|minus|a - b|\bsub\b|instead of (adding|\+)|should (add|be)|not (add|a \+ b)|wrong operator|`-`/i.test(everything),
    };
  } catch (e) {
    return { ok: false, error: e.message, hint: hintFor(e.message), seconds: took() };
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

/** Check GitHub access and Claude. Returns { ok, gh, result }. */
export async function diagnose({ cfg, log = () => {}, timeoutMs } = {}) {
  const gh = run("gh", ["auth", "status"], { allowFail: true });
  log(gh.ok ? "✓ GitHub: gh is signed in" : "✗ GitHub: gh isn't signed in (run `gh auth login`)");
  const settings = settingsFor(cfg, "");
  log("… Claude Code: running a tiny review (can take a minute)");
  const result = await smokeReview(settings, { timeoutMs: timeoutMs ?? Math.min(settings.agent.timeoutSeconds, 180) * 1000 });
  if (result.ok) log(`✓ Claude Code: works (${result.seconds}s, verdict "${result.verdict}"${result.foundBug ? ", spotted the planted bug" : ", didn't spot the planted bug"})`);
  else log(`✗ Claude Code: ${lastLine(result.error)}\n    → ${result.hint}`);
  return { ok: gh.ok && result.ok, gh: gh.ok, result };
}

async function main() {
  const args = process.argv.slice(2);
  let ok = false;
  try {
    console.log("PR Reviewer: checking that Claude Code works here\n");
    ok = (await diagnose({ cfg: loadConfig(), log: (l) => console.log(l) })).ok;
    console.log(ok ? "\nAll good." : "\nSomething needs fixing (see above).");
  } catch (e) {
    console.error(`✗ ${e.message}`);
  }
  if (args.includes("--wait")) {
    process.stdout.write("\nPress Enter to close.");
    await new Promise((r) => { process.stdin.once("data", r); process.stdin.once("end", r); process.stdin.resume(); });
  }
  process.exit(ok ? 0 : 1);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await main();
