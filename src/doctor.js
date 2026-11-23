// Check that your AI really works here: node src/doctor.js [--ai codex | --all] [--wait]
// Runs a tiny fixed review (a one-line PR with a planted bug) through the same code as a real review, so a missing
// login, a bad flag or an AI that answers in the wrong shape shows up here instead of in a failed review.
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { AI_IDS, detectAgents, getAgent, hardenCheckout, modelShown, pickAgent, planRun, readReply } from "./agents.js";
import { STATE_DIR, buildPrompt, loadConfig, parseAgentOutput, run, runAsync, settingsFor } from "./lib.js";

const SIGN_IN = {
  claude: "run `claude` once and sign in",
  codex: "run `codex login`",
  gemini: "run `gemini` once and sign in",
  cursor: "run `cursor-agent login`",
  opencode: "run `opencode auth login`",
};

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
export function hintFor(id, message) {
  const m = String(message);
  if (/isn't installed|not found|ENOENT/i.test(m)) return `install ${getAgent(id)?.label ?? id}, or pick another AI in Settings`;
  if (/timed out/i.test(m)) return `it didn't answer in time. It may be waiting for you to sign in: ${SIGN_IN[id] ?? "sign in"}`;
  if (/no JSON object/i.test(m)) return "it ran but didn't reply with the JSON the reviewer needs. Its output is shown above";
  if (/unauthor|not logged|log in|login|sign in|api key|auth/i.test(m)) return `sign in: ${SIGN_IN[id] ?? "sign in"}`;
  if (/unknown (option|argument)|unrecognized|invalid (option|argument)/i.test(m)) return "this version of the CLI rejected a flag. Please report it with the CLI version";
  return `sign-in is the usual cause: ${SIGN_IN[id] ?? "sign in"}`;
}

/** Run the fixed review on one AI. Resolves { ok, seconds, verdict, foundBug } or { ok: false, error, hint }. */
export async function smokeReview(id, settings, { timeoutMs = 180000 } = {}) {
  let picked;
  try {
    picked = pickAgent({ ...settings, ai: id, agentIsCustom: false });
  } catch (e) {
    return { ok: false, error: e.message, hint: hintFor(id, e.message) };
  }
  const { adapter, bin } = picked;
  fs.mkdirSync(STATE_DIR, { recursive: true });
  const tmp = fs.mkdtempSync(path.join(STATE_DIR, "doctor-"));
  const work = path.join(tmp, "checkout");
  const started = Date.now();
  try {
    fs.mkdirSync(path.join(work, "src"), { recursive: true });
    fs.writeFileSync(path.join(work, FILE), "// Adds two numbers.\nexport const add = (a, b) => a - b;\n");
    hardenCheckout(work);
    const prompt = buildPrompt(PR, settings, {
      diff: DIFF, codeAccess: true, commentable: `${FILE}: 1-2`,
    });
    const plan = planRun(adapter, { bin, settings, codeAccess: true, workDir: work, tmp, prompt });
    for (const [rel, text] of Object.entries(plan.workFiles)) {
      fs.mkdirSync(path.dirname(path.join(work, rel)), { recursive: true });
      fs.writeFileSync(path.join(work, rel), text);
    }
    const [cmd, ...args] = plan.argv;
    const stdout = await runAsync(cmd, args, { input: plan.input, env: plan.env, cwd: work, timeoutMs });
    const text = readReply(adapter, stdout, plan);
    let review;
    try {
      review = parseAgentOutput(text);
    } catch (e) {
      return { ok: false, error: e.message, hint: hintFor(id, e.message), seconds: (Date.now() - started) / 1000 };
    }
    const everything = `${review.summary} ${review.comments.map((c) => c.body).join(" ")}`;
    return {
      ok: true, seconds: Math.round((Date.now() - started) / 100) / 10, verdict: review.verdict,
      model: modelShown(adapter, settings),
      foundBug: /subtract|minus|a - b|\bsub\b|instead of (adding|\+)|should (add|be)|not (add|a \+ b)|wrong operator|`-`/i.test(everything),
    };
  } catch (e) {
    return { ok: false, error: e.message, hint: hintFor(id, e.message), seconds: (Date.now() - started) / 1000 };
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

const lastLine = (s) => String(s).split("\n").map((l) => l.trim()).filter(Boolean).pop() ?? "";

/** Check GitHub access and each AI in `ids`. Returns { ok, gh, results: [{ id, label, ...smokeReview }] }. */
export async function diagnose({ cfg, ids, log = () => {}, timeoutMs } = {}) {
  const gh = run("gh", ["auth", "status"], { allowFail: true });
  log(gh.ok ? "✓ GitHub: gh is signed in" : "✗ GitHub: gh isn't signed in (run `gh auth login`)");
  const settings = settingsFor(cfg, "");
  const results = [];
  for (const id of ids) {
    const label = getAgent(id)?.label ?? id;
    log(`… ${label}: running a tiny review (can take a minute)`);
    const r = await smokeReview(id, settings, { timeoutMs: timeoutMs ?? Math.min(settings.agent.timeoutSeconds, 180) * 1000 });
    results.push({ id, label, ...r });
    if (r.ok) log(`✓ ${label}: works (${r.seconds}s, verdict "${r.verdict}"${r.foundBug ? ", spotted the planted bug" : ", didn't spot the planted bug"})`);
    else log(`✗ ${label}: ${lastLine(r.error)}\n    → ${r.hint}`);
  }
  return { ok: gh.ok && results.length > 0 && results.every((r) => r.ok), gh: gh.ok, results };
}

/** Which AIs to check: --ai X, --all (everything installed), else the one reviews would use. */
export function chooseIds(args, cfg, pathVar) {
  const i = args.indexOf("--ai");
  if (i >= 0) {
    const id = args[i + 1];
    if (!AI_IDS.includes(id)) throw new Error(`--ai must be one of ${AI_IDS.join(", ")}`);
    return [id];
  }
  if (args.includes("--all")) return detectAgents(pathVar).map((d) => d.id);
  return [pickAgent(settingsFor(cfg, ""), pathVar).adapter.id];
}

async function main() {
  const args = process.argv.slice(2);
  let ok = false;
  try {
    const cfg = loadConfig();
    const ids = chooseIds(args, cfg);
    console.log("PR Reviewer: checking that your AI works here\n");
    ok = (await diagnose({ cfg, ids, log: (l) => console.log(l) })).ok;
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
