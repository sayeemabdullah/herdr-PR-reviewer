// CLI used by PR Panel: post one saved draft to GitHub, so the panel stays usable while it runs.
//   node src/post.js <draft key>   → prints one JSON line: { ok: true, event, resolved } or { ok: false, error }
import { loadConfig, postStoredDraft } from "./lib.js";

const key = process.argv[2];
try {
  if (!key) throw new Error("usage: node src/post.js <draft key>");
  console.log(JSON.stringify({ ok: true, ...postStoredDraft(key, loadConfig()) }));
} catch (e) {
  console.log(JSON.stringify({ ok: false, error: String(e.message).split("\n")[0] }));
  process.exit(1);
}
