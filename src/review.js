// CLI: review a single PR now.
//   node src/review.js <pr-url>            → draft (finalWord) or post, per your config
//   node src/review.js <pr-url> --draft    → always save a draft to the inbox, never post
//   node src/review.js <pr-url> --dry-run  → just print the AI's review; saves/posts nothing
import { loadConfig, parsePRUrl, reviewPR } from "./lib.js";

const target = parsePRUrl(process.argv.find((a) => a.includes("github.com")));
const dryRun = process.argv.includes("--dry-run");
if (!target) {
  console.error("usage: node src/review.js https://github.com/owner/repo/pull/123 [--draft | --dry-run]");
  process.exit(2);
}

const cfg = loadConfig();
if (process.argv.includes("--draft")) {
  cfg.finalWord = true;
  cfg.repos = cfg.repos.map((r) => ({ ...r, finalWord: true }));
}
const res = await reviewPR(cfg, target.repo, target.number, { force: true, dryRun, source: "link" });
if (res.skipped) console.log(`skipped: ${res.skipped}`);
else if (dryRun) console.log(JSON.stringify(res.draft, null, 2));
else console.log(`${res.status}: ${res.event ?? res.draft.verdict}`);
