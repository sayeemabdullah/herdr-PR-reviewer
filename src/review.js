// CLI: review a single PR now.
//   node src/review.js <pr-url>            → draft (finalWord) or post, per your config
//   node src/review.js <pr-url> --draft    → always save a draft to the inbox, never post
//   node src/review.js <pr-url> --dry-run  → just print the AI's review; saves/posts nothing
// A stack link (…/stack/N) works the same way: each open PR in it is reviewed, one after another.
//   node src/review.js <stack-url> --list   → print the stack's open PR numbers, review nothing
import { getStack, loadConfig, parsePRUrl, parseStackUrl, reviewPR, reviewStack } from "./lib.js";

const link = process.argv.find((a) => a.includes("github.com"));
const stackTarget = parseStackUrl(link);
const target = parsePRUrl(link);
const dryRun = process.argv.includes("--dry-run");
if (!target && !stackTarget) {
  console.error("usage: node src/review.js https://github.com/owner/repo/pull/123 (or …/stack/45) [--draft | --dry-run]");
  process.exit(2);
}

const cfg = loadConfig();
if (process.argv.includes("--draft")) {
  cfg.finalWord = true;
  cfg.repos = cfg.repos.map((r) => ({ ...r, finalWord: true }));
}
if (stackTarget) {
  try {
    if (process.argv.includes("--list")) {
      const { repo, number, layers } = getStack(stackTarget.repo, stackTarget.number);
      console.log(JSON.stringify({ repo, number, open: layers.filter((l) => l.open).map((l) => l.number) }));
    } else {
      const { results } = await reviewStack(cfg, stackTarget.repo, stackTarget.number, { dryRun });
      if (dryRun) console.log(JSON.stringify(results.map((r) => r.draft ?? r), null, 2));
      else for (const r of results) console.log(`#${r.number} ${r.status}: ${r.event ?? r.draft?.verdict ?? r.why ?? String(r.error).split("\n")[0]}`);
      if (!results.length) console.log("no open pull requests in this stack");
      if (results.some((r) => r.status === "failed")) process.exitCode = 1;
    }
  } catch (e) {
    console.error(e.message);
    process.exitCode = 1;
  }
  process.exit();
}
const res = await reviewPR(cfg, target.repo, target.number, { force: true, dryRun, source: "link" });
if (res.skipped) console.log(`skipped: ${res.skipped}`);
else if (dryRun) console.log(JSON.stringify(res.draft, null, 2));
else console.log(`${res.status}: ${res.event ?? res.draft.verdict}`);
