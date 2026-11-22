# Changelog

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
