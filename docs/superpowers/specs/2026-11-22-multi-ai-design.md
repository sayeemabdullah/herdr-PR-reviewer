# Work with more than Claude: design

## Intent
People who don't use Claude Code should be able to use PR Reviewer with the coding AI they already have:
Codex, Gemini CLI, Cursor or opencode. One AI per setup (or per repo), not several reviewers on one PR.

## Goals
- Auto-detect installed AI CLIs; pick one in the Settings tab or with `ai` in `config.json` (also per repo).
- Same inbox, History and GitHub output whichever AI wrote the review.
- Existing configs, including a hand-written `agent.command`, keep working.

## Non-goals
- Running several AIs on the same PR. Docker sandboxing. Per-repo AI in the panel (config only).

## Anti-goal
A weaker AI sandbox must never mean a stranger's PR can reach your files or get an auto-approval.

## Approaches considered
1. Only AIs that can be locked down like Claude: safest, but most CLIs can't.
2. **Chosen:** lock each AI down as far as it allows, mark the rest "partial", and force final word on and no
   approvals for them. The inbox is the safety net.
3. Run every AI in Docker: strongest, but needs Docker, which defeats "easy for non-Claude users".

## Design
- `src/agents.js`: one adapter per AI (`build`, optional `parse`, `models`, `efforts`, `lockdown`), `detectAgents`,
  `pickAgent`, `planRun`, `hardenCheckout`. Claude keeps its current command.
- `reviewPR`: picks the adapter; for `lockdown: "partial"` it forces `finalWord: true`, `allowApprove: false`.
- Before any AI reads a checkout: remove symlinks and instruction/settings files (`AGENTS.md`, `.cursor/`, ...).
- Cursor and opencode read the prompt from a file in the working folder (no documented stdin); Codex replies via
  `-o <file>`. Cursor gets our own deny list in `.cursor/cli.json`; opencode gets `OPENCODE_CONFIG_CONTENT`.
- Settings tab: an **AI** row; model and effort options follow the AI; final word / approve rows show what
  really happens (fixed) for partial AIs. Inbox detail and History show which AI wrote a review.

## Left to the builder / verified later
Flags were checked against codex 0.171, gemini 0.70, opencode 1.19 (run for real) and Cursor's docs (not run).
Cursor's permission syntax and Gemini/Codex login flows are unverified without an account.
