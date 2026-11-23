# Changelog

## Unreleased

- **Changed: only the repos you list are reviewed.** Before, a PR you were asked to review in a repo you never added was reviewed too.
  Now it is ignored unless you turn on `"onlyListedRepos": false` (Settings → **Which repos**). If you rely on the old behaviour,
  set that, or add the repos in the Repos tab. With no repos listed, the watcher waits and PR Panel tells you to add one.
- **Many more settings in PR Panel.** The Settings tab now also has: your own instructions, the smarter-model options (cheap effort,
  what counts as small, risky and docs paths), the diff limit and most parts, paths left out of the diff, the time limit per review,
  repos to never review, authors to skip, and start with herdr. Lists are typed as comma separated text.

## 0.5.0

- **Smarter model choice (opt-in).** With `"smartModel": true`, docs-only PRs and small ones (at most 3 files and 60 lines)
  are reviewed by a cheaper model (`cheapModel`, default Sonnet at medium effort). Big PRs, and any PR that touches a risky path
  (auth, security, migrations, SQL, workflows, `package.json`, secrets...), keep your model and effort. The inbox header says which
  model reviewed and why. Also in the Settings tab.
- **Security policy.** `SECURITY.md` says how to report a problem privately and what counts as one.
- **README brought up to date** with 0.4.0: big PRs are reviewed in parts, `REVIEW.md`, `pr-panel doctor`, and the inbox keys.

## 0.4.0

- **`pr-panel doctor`.** Runs a tiny review (a one-line PR with a planted bug) on Claude Code and says what to fix if it
  fails: not installed, not signed in, timed out, or an answer the reviewer can't read. Also an action, `pr-reviewer.doctor`.
  Errors from the Claude command now show the end of its output, where the reason is.
- **Resolve fixed comments (opt-in).** With `"resolveFixed": true`, a re-review numbers its earlier comments and the AI names the ones the
  new commits clearly fixed. The inbox lists them (press `x` to turn it off for that review) and posting also marks those threads
  resolved on GitHub. Only your own open threads with the same file and text are touched.
- **Big PRs are reviewed in parts.** A diff over `maxDiffChars` used to be cut off. Now it is split into passes of whole
  files (at most `maxParts`, default 4), each reviewed on its own and merged: strictest verdict, all comments, each
  part's summary. Off with `"splitLarge": false`. Each part is a full AI run, so a big PR costs that many reviews.
- **How long each review took.** History has a TOOK column and the inbox header says "in 42s".
- **Severity on every comment.** The AI marks each comment `blocker`, `important` or `nit`. The inbox lists blockers first
  and tags them, posted comments say `**blocker:**` or `**nit:**`, and the new `minSeverity` setting (also in the Settings tab)
  hides what's below a level. The summary is always kept.
- **Multi-line suggestions.** A fix can now replace several lines (`start_line`), not just one. A suggestion that can't
  be applied where it lands (whole-file comment, line outside the diff, a range that crosses a gap) is shown as
  plain code instead of a button that would change the wrong lines.
- **Review rules in the repo.** A `REVIEW.md` (or `.github/REVIEW.md`) in a repo is followed by every review of it.
  Read from the PR's base branch, never from the PR itself. Off with `"repoRules": false`, or in the Settings tab.

## 0.3.0

- **PR Panel.** The inbox is now PR Panel, with four tabs: Inbox, Repos, Settings and History. Move with
  Tab or `i` `r` `s` `h`; the bottom line shows the keys you can use, `?` shows them all.
- **Repos tab.** Add a repo by picking from your GitHub repos (type to search), or type owner/repo or paste
  a link, then choose every PR or only when asked. Remove with `x`. Final word and model per repo.
- **Settings tab.** Model, effort, final word, polling and more, saved straight to `config.json`; a change
  that would break the config isn't saved.
- **`pr-inbox` is now `pr-panel`.** The command is swapped for you when herdr starts. The action is
  `pr-reviewer.panel`; `pr-reviewer.inbox` still works.
- **Reviews use Opus at high effort.** `--restricted` ignores your Claude settings, so reviews were quietly
  running on the default model. Now set explicitly with `"model"` and `"effort"` (also per repo), and
  changeable in the Settings tab.
- **Findings on the lines they're about.** The AI is told exactly which lines it can comment on. A finding
  that doesn't fit a changed line is posted as a comment on the whole file instead of being lost.
- **PR Reviewer in herdr's agent list.** The watcher shows "reviewing …", "3 waiting" (needs you) or
  "inbox empty".
- **Safe mode.** Reviews run with Claude Code's `--safe-mode`: no `CLAUDE.md` from the PR, no hooks,
  skills or plugins.

## 0.2.0

- **Reviews read the code, not just the diff.** The PR is checked out (read-only) and the AI can open
  any file, so big PRs whose diff gets truncated are still reviewed properly. Turn off with `"readCode": false`.
- **Follow-up reviews.** After new commits, the AI gets its previous review and the changes since, says
  what's fixed, and doesn't repeat itself.
- **Doesn't repeat other reviewers.** Existing review comments on the PR are included.
- **One-click fixes.** Inline comments can include GitHub `suggestion` blocks.
- **`ignorePaths`.** Lockfiles, minified and build output are left out of the diff by default.
- **Locked-down AI.** The default commands use Claude Code's `--restricted` and `--strict-mcp-config`:
  no shell or code-running tools, none of your settings or MCP servers, file access limited to the checkout.
- **Parallel reviews.** The watcher runs up to `maxParallel` (2) reviews at once.
- **`pr-inbox` that survives updates.** New action `pr-reviewer.install-cli`.
- **New inbox.** Arrow keys, preview, scrolling, turn single comments on/off, verdict keys, Markdown
  editing, new-commit warnings, background reviews by URL, history.
- Tests for the manifest, prompt, diff filtering and checkout.
- README redesign: logos, badges, inbox screenshot, flow diagram, feature grid, collapsible keys and settings.
- Node 22 or newer (Node 20 is end-of-life).

## 0.1.0

- First release: watcher, AI review drafts, inbox, final word on/off, per-repo `review: all | requested`.
