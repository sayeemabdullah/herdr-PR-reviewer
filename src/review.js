// CLI: review a single PR now.
//   node src/review.js <pr-url>            → draft (finalWord) or post, per your config
//   node src/review.js <pr-url> --dry-run  → just print the AI's review; saves/posts nothing
import { loadConfig, parsePRUrl, reviewPR } from "./lib.js";

const target = parsePRUrl(process.argv.find((a) => a.includes("github.com")));
const dryRun = process.argv.includes("--dry-run");
if (!target) {
  console.error("usage: node src/review.js https://github.com/owner/repo/pull/123 [--dry-run]");
  process.exit(2);
}

const res = reviewPR(loadConfig(), target.repo, target.number, { force: true, dryRun });
if (res.skipped) console.log(`skipped: ${res.skipped}`);
else if (dryRun) console.log(JSON.stringify(res.draft, null, 2));
else console.log(`${res.status}: ${res.event ?? res.draft.verdict}`);
