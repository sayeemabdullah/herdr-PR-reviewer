// Shows the watcher in herdr's agent list ("PR Reviewer"), with a status you can see at a glance:
//   working  "reviewing api#212"   while a review runs
//   blocked  "3 waiting"           reviews are waiting for your final word (herdr treats this as "needs you")
//   idle     "inbox empty"         nothing to do
import { HERDR, run } from "./lib.js";

const SOURCE = "pr-reviewer";
const AGENT = "pr-reviewer";

/** Pure: what to show for a given inbox + set of running reviews. Exported for tests. */
export function statusFor({ drafts = [], active = [] }) {
  const n = drafts.length;
  const waiting = `${n} waiting`;
  if (active.length) {
    const what = active.map((k) => k.split("/")[1] ?? k).join(", ");
    return {
      state: "working",
      title: n ? `reviewing ${what} · ${waiting}` : `reviewing ${what}`,
      message: `Reviewing ${active.join(", ")}`,
    };
  }
  if (n) {
    return {
      state: "blocked",
      title: waiting,
      message: `${n} review${n === 1 ? "" : "s"} waiting for your final word: ` +
        drafts.map((d) => `${d.repo}#${d.number}`).join(", "),
    };
  }
  return { state: "idle", title: "inbox empty", message: "No reviews waiting" };
}

/** Reports to herdr only when something changed. Returns a function to call as often as you like. */
export function createReporter(paneId) {
  let last = "";
  return function report(status) {
    if (!paneId) return;
    const key = JSON.stringify(status);
    if (key === last) return;
    last = key;
    // herdr ignores updates whose seq isn't higher than the last one it saw, so use the clock:
    // it keeps increasing across watcher restarts (a counter would restart at 1 and be ignored).
    run(HERDR, ["pane", "report-agent", paneId, "--source", SOURCE, "--agent", AGENT,
      "--state", status.state, "--message", status.message, "--seq", String(Date.now())], { allowFail: true });
    // Each metadata report replaces the previous one, so always send the name along with the title.
    run(HERDR, ["pane", "report-metadata", paneId, "--source", SOURCE, "--agent", AGENT,
      "--display-agent", "PR Reviewer", "--title", status.title], { allowFail: true });
  };
}

/** Hand the pane back to herdr when the watcher stops. */
export function releaseAgent(paneId) {
  if (paneId) run(HERDR, ["pane", "release-agent", paneId, "--source", SOURCE, "--agent", AGENT], { allowFail: true });
}
