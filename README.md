<div align="center">

<img src="assets/header.png" alt="herdr + AI + GitHub" width="420">

# PR Reviewer for herdr

**Your AI reviews the pull requests you're asked to review.**<br>
**Claude Code, Codex, Gemini CLI, Cursor or opencode: use whichever you already have.**<br>
**You read each review in PR Panel and press _post_, or let it post on its own.**

<p><a href="https://github.com/sayeemabdullah/herdr-PR-reviewer/actions/workflows/ci.yml"><img alt="CI" src="https://img.shields.io/github/actions/workflow/status/sayeemabdullah/herdr-PR-reviewer/ci.yml?branch=master&style=flat-square&label=CI"></a> <a href="https://herdr.dev/plugins/"><img alt="herdr plugin, 0.8 or newer" src="https://img.shields.io/badge/herdr%20plugin-%E2%89%A5%200.8-222?style=flat-square"></a> <a href="https://nodejs.org"><img alt="Node 22 or newer" src="https://img.shields.io/badge/node-%E2%89%A5%2022-339933?style=flat-square&logo=node.js&logoColor=white"></a> <a href="#which-ai"><img alt="Works with Claude Code, Codex, Gemini CLI, Cursor and opencode" src="https://img.shields.io/badge/AI-Claude%20%C2%B7%20Codex%20%C2%B7%20Gemini%20%C2%B7%20Cursor%20%C2%B7%20opencode-D97757?style=flat-square"></a> <a href="LICENSE"><img alt="MIT license" src="https://img.shields.io/badge/license-MIT-0969da?style=flat-square"></a></p>

[Quick start](#quick-start) · [How it works](#how-it-works) · [PR Panel](#panel) · [Settings](#settings) · [Safety](#safety) · [Contributing](CONTRIBUTING.md)

<br>

<img src="assets/inbox.svg" alt="PR Panel, Inbox tab" width="860">

</div>

<br>

## Features

<table>
<tr>
<td width="33%" valign="top">

### Reads the code
Your AI gets a read-only checkout of the PR, so it can open callers, types and tests, and still review big PRs whose diff gets cut off.

</td>
<td width="33%" valign="top">

### Your final word
Reviews wait in an inbox until you **post**, edit or discard them. Or turn that off per repo and let it post on its own.

</td>
<td width="33%" valign="top">

### Follow-ups
After new commits it gets its previous review and the changes since, says what's fixed, and doesn't repeat itself.

</td>
</tr>
<tr>
<td valign="top">

### Signal, not noise
It skips points other reviewers already made, leaves lockfiles and build output out, and suggests one-click fixes.

</td>
<td valign="top">

### Locked down
Claude runs with no shell, none of your MCP servers and none of your settings. Other AIs get the tightest settings they offer, and always wait for your final word. [Details](#safety)

</td>
<td valign="top">

### Fits herdr
A watcher tab, a PR Panel pane, shortcuts and notifications. A `pr-panel` command works in any terminal.

</td>
</tr>
</table>

### Works with

<table>
<tr>
<td align="center" width="20%"><img src="assets/claude.jpeg" width="56" alt="Claude Code"><br><b>Claude Code</b><br><sub><code>claude</code></sub></td>
<td align="center" width="20%"><img src="assets/codex.png" width="56" alt="Codex"><br><b>Codex</b><br><sub><code>codex</code></sub></td>
<td align="center" width="20%"><img src="assets/gemini.png" width="56" alt="Gemini CLI"><br><b>Gemini CLI</b><br><sub><code>gemini</code></sub></td>
<td align="center" width="20%"><img src="assets/cursor.png" width="56" alt="Cursor"><br><b>Cursor</b><br><sub><code>cursor-agent</code></sub></td>
<td align="center" width="20%"><img src="assets/opencode.png" width="56" alt="opencode"><br><b>opencode</b><br><sub><code>opencode</code></sub></td>
</tr>
</table>

You don't need Claude. Install any of these and sign in, and PR Reviewer finds it by itself. See [Which AI](#which-ai).

<a id="quick-start"></a>

## Quick start

> [!NOTE]
> You need **herdr 0.8+**, **Node 22+**, `git`, the [GitHub CLI](https://cli.github.com) signed in (`gh auth status`), and **at least one AI CLI, signed in**: [Claude Code](https://claude.com/claude-code), [Codex](https://github.com/openai/codex), [Gemini CLI](https://github.com/google-gemini/gemini-cli), [Cursor](https://cursor.com/cli) or [opencode](https://opencode.ai). Which one is used is up to you, see [Which AI](#which-ai).

**1. Install**

```sh
herdr plugin install sayeemabdullah/herdr-PR-reviewer
herdr plugin action invoke pr-reviewer.install-cli   # optional: adds the `pr-panel` command
```

**2. Pick your repos.** This is optional: with no list, it reviews any PR where you're a requested reviewer.
Open [PR Panel](#panel) and go to the **Repos** tab (<kbd>r</kbd>): press <kbd>a</kbd> and pick from your
GitHub repos. The model and final word are in the **Settings** tab (<kbd>s</kbd>). Or edit the file yourself:

```sh
$EDITOR "$(herdr plugin config-dir pr-reviewer)/config.json"
```

```json
"repos": [
  { "repo": "your-name/your-repo", "review": "all" },
  { "repo": "your-team/team-repo", "review": "requested" }
]
```

| `review` | Reviews |
|---|---|
| `"requested"` | only PRs where you're added as a reviewer **(default)** |
| `"all"` | every open PR in the repo |

**3. Check your AI works.** Runs a tiny review with the AI you chose, and tells you what to fix if it can't (a missing sign-in, for example). Add `--all` to check every AI you have installed, or `--ai codex` to pick one.

```sh
pr-panel doctor        # or: herdr plugin action invoke pr-reviewer.doctor
```

**4. Start the watcher.** It also starts by itself with herdr, in a tab called **PR watcher**.

```sh
herdr plugin action invoke pr-reviewer.watch
```

> [!TIP]
> Config changes apply on the next check, within 3 minutes. Nothing needs restarting.

<a id="how-it-works"></a>

## How it works

```mermaid
flowchart LR
    gh["GitHub<br/>PR needs your review"] --> w["Watcher<br/>checks every 3 min"]
    w --> co["Read-only checkout<br/>of the PR"]
    co --> ai["Your AI<br/>read-only"]
    ai --> fw{"Final word?"}
    fw -- "on (default)" --> inbox["Inbox<br/>you read, edit, post"]
    fw -- "off" --> post["Posted to GitHub<br/>as you"]
    inbox --> post
```

For each PR, the AI gets:

- **the diff**, minus lockfiles and build output (`ignorePaths`)
- **the whole repo** at the PR's commit, so it can check callers, types and tests
- **what other reviewers already said**, so it doesn't repeat them
- on a re-review, **its previous review and the changes since**

It replies with a verdict (**approve**, **request changes** or **comment**), a summary, and comments on specific lines. Small, certain fixes come as GitHub **suggestions**. Up to 2 PRs are reviewed at once.

<details>
<summary><b>The details</b></summary>

- When you're only a *requested* reviewer, re-reviews stop once you've posted, because GitHub then takes you off the requested list. If the author asks you again, it reviews again.
- On your own PRs, GitHub only allows a comment, so the review is posted as one.
- Draft PRs wait until they're marked ready for review.
- When you post, GitHub gets **one review from your account**: the summary as the body, the line comments that are on, and a short "AI-assisted" note at the bottom.

</details>

<a id="final-word"></a>

## Your final word: on or off

`finalWord` decides whether you check each review before it goes out. Set it for everything, or per repo:

```json
{
  "finalWord": true,
  "repos": [
    { "repo": "your-name/side-project", "review": "all",       "finalWord": false },
    { "repo": "your-team/team-repo",    "review": "requested", "finalWord": true  }
  ]
}
```

| You want | Set |
|---|---|
| To read every review before it's posted | `"finalWord": true` **(default)** |
| Reviews posted by themselves, no inbox | `"finalWord": false` |
| Posted by themselves, but **never an approval** | `"finalWord": false, "allowApprove": false` |

A setting on a repo wins over the one at the top.

<a id="inbox"></a>
<a id="panel"></a>

## PR Panel

Everything in one place, in four tabs. Move between them with <kbd>Tab</kbd>, or jump with
<kbd>i</kbd> <kbd>r</kbd> <kbd>s</kbd> <kbd>h</kbd>. The bottom line always shows the keys you can press
right now, and <kbd>?</kbd> shows all of them.

| Tab | What it's for |
|---|---|
| **Inbox** | AI reviews waiting for your final word: read, change, post or discard them |
| **Repos** | which repos are watched. Add one by picking from your GitHub repos, remove one with <kbd>x</kbd> |
| **Settings** | model, effort, final word, how often to check, and the rest |
| **History** | what was posted, discarded or failed, and why |

Open it with any of:

| Where | How |
|---|---|
| any terminal, incl. the Herdr desktop app | `pr-panel` (set up once with `herdr plugin action invoke pr-reviewer.install-cli`) |
| inside herdr | <kbd>Ctrl</kbd>+<kbd>b</kbd> <kbd>i</kbd> with the [shortcut](#shortcuts), or `herdr plugin action invoke pr-reviewer.panel` |

> Upgrading? The `pr-inbox` command is now `pr-panel`. It's swapped for you the next time herdr starts,
> and the `pr-reviewer.inbox` shortcut keeps working.

You don't have to open it to know what's going on: the watcher shows up in herdr's agent list as **PR Reviewer**, with its status:

| Status | Means |
|---|---|
| working, "reviewing api#212" | a review is running |
| needs you, "3 waiting" | reviews are waiting for your final word |
| idle, "inbox empty" | nothing to do |

### Inbox

The top line shows whether the watcher is running and which PR it's reviewing right now. The list updates by itself. Each review is checked against GitHub:

| Shows | Means |
|---|---|
| up to date (green) | the review matches the PR as it is now |
| new commits since this review (yellow, and `!` in the list) | the author pushed after the review. You can still post, and you'll be warned first |
| PR is merged / closed (yellow) | the PR is finished. You'll probably want to discard the review |

<details>
<summary><b>Keys in the list</b></summary>

| Key | Does |
|---|---|
| <kbd>↑</kbd> <kbd>↓</kbd> | move |
| <kbd>Enter</kbd> or <kbd>1</kbd>–<kbd>9</kbd> | open a review |
| <kbd>p</kbd> | post the selected review (asks first) |
| <kbd>d</kbd> | discard it. Nothing goes to GitHub |
| <kbd>o</kbd> | open the PR in your browser |
| <kbd>n</kbd> | review any PR now: paste its link. It runs in the background |
| <kbd>q</kbd> | quit |

</details>

<details>
<summary><b>Keys inside a review</b></summary>

| Key | Does |
|---|---|
| <kbd>↑</kbd> <kbd>↓</kbd> <kbd>Space</kbd> | scroll (<kbd>g</kbd> top, <kbd>G</kbd> bottom) |
| <kbd>1</kbd>–<kbd>9</kbd> | turn a comment **off or on**. Off comments are struck through and not posted |
| <kbd>a</kbd> / <kbd>r</kbd> / <kbd>c</kbd> | set the verdict: approve / request changes / comment |
| <kbd>e</kbd> | edit the summary in your editor, as Markdown |
| <kbd>E</kbd> | edit everything (verdict, summary, comments) as JSON |
| <kbd>p</kbd> | post. It asks first: *"Post COMMENT with 3 comment(s) to …#415?"* |
| <kbd>d</kbd> | discard |
| <kbd>o</kbd> | open the PR in your browser |
| <kbd>Esc</kbd> | back to the list |

<kbd>e</kbd> and <kbd>E</kbd> use `$EDITOR`. If that isn't set, they use VS Code when it's installed, otherwise `vi`.

</details>

<a id="repos-tab"></a>

### Repos

Press <kbd>a</kbd> to add a repo. You get a list of your GitHub repos, most recently updated first: type a few
letters to narrow it down and press <kbd>Enter</kbd>. A repo that isn't in the list (someone else's, say)
can be typed as `owner/repo` or pasted as a link. Then choose **every PR** or **only when I'm asked**.

| Key | Does |
|---|---|
| <kbd>a</kbd> | add a repo |
| <kbd>x</kbd> | remove the selected repo (asks first) |
| <kbd>Enter</kbd> | switch between every PR and only when you're asked |
| <kbd>f</kbd> | final word for this repo only: you approve / the AI posts / back to the global setting |
| <kbd>m</kbd> | model for this repo only: each press picks the next one, then back to the global model |

Under **Other repos**, choose whether PRs you're asked to review in repos that aren't listed are reviewed too.

<a id="settings-screen"></a>

### Settings

Every change is saved to `config.json` straight away, and the watcher uses it from its next check.
A change that would break the config isn't saved, and the panel tells you why.

| Section | What you can change |
|---|---|
| Reviews | **AI** (auto or any installed one), final word, **model** (that AI's models, or type any model name), effort, read the whole repo, AI may approve, re-review new commits, skip draft PRs |
| Watcher | how often to check, reviews at once, desktop notifications |

| Key | Does |
|---|---|
| <kbd>↑</kbd> <kbd>↓</kbd> | move |
| <kbd>Enter</kbd> | change: on/off, next option, or type a number |
| <kbd>→</kbd> / <kbd>←</kbd> | next / previous option (AI, model, effort) |
| <kbd>t</kbd> | type a model name, e.g. a full one like `claude-opus-5-5` or `gpt-5.5` |
| <kbd>E</kbd> | open `config.json` in your editor, for everything else (`ignorePaths`, `instructions`, …) |

### Shortcuts

Add these to `~/.config/herdr/config.toml`, then run `herdr server reload-config`. `prefix` is <kbd>Ctrl</kbd>+<kbd>b</kbd> unless you changed it.

```toml
[[keys.command]]
key = "prefix+i"
type = "plugin_action"
command = "pr-reviewer.panel"
description = "PR Panel"

[[keys.command]]
key = "prefix+shift+i"
type = "plugin_action"
command = "pr-reviewer.watch"
description = "PR review watcher"
```

<a id="settings"></a>

## Settings

All of these go in `config.json`, and the common ones can be changed in [PR Panel](#panel), in the Repos and Settings tabs. Any of them can also go on one repo, like `{ "repo": "…", "finalWord": false }`.

<details open>
<summary><b>What to review</b></summary>

| Setting | Default | What it does |
|---|---|---|
| `review` | `"requested"` | `"all"` or `"requested"`, see [Quick start](#quick-start) |
| `onlyListedRepos` | `false` | `true`: only the repos in `repos` |
| `ignoreRepos` | `[]` | repos that are never sent to the AI |
| `ignoreAuthors` | bots | PR authors to skip |
| `skipDrafts` | `true` | leave draft PRs alone |
| `rereviewOnPush` | `true` | review again when new commits are pushed |

</details>

<details open>
<summary><b>What happens to a review</b></summary>

| Setting | Default | What it does |
|---|---|---|
| `finalWord` | `true` | `true`: you post each review. `false`: it posts by itself |
| `allowApprove` | `true` | `false`: it never approves, only comments or asks for changes |
| `desktopNotifications` | `true` | also show a macOS notification |

</details>

<details>
<summary><b>How it reviews</b></summary>

| Setting | Default | What it does |
|---|---|---|
| `ai` | `"auto"` | which AI reviews: `"auto"`, `"claude"`, `"codex"`, `"gemini"`, `"cursor"` or `"opencode"`. Can go on one repo too |
| `model` | `"opus"` | that AI's model, e.g. `"opus"` for Claude or `"gpt-5.5"` for Codex. `"default"` (or a Claude name like `"opus"` when the AI isn't Claude) lets the AI choose |
| `effort` | `"high"` | how hard it thinks: `low`, `medium`, `high`, `xhigh`, `max`. Higher is slower and costs more. Only Claude and Codex have it |
| `readCode` | `true` | let the AI read the whole repo at the PR's commit (read-only). `false`: diff only |
| `ignorePaths` | lockfiles, `*.min.js`, `dist/`, `vendor/`, `*.snap` | left out of the diff, as globs like `"**/*.generated.ts"`. Setting this replaces the defaults |
| `instructions` | `""` | extra things the reviewer should check |
| `repoRules` | `true` | also follow the repo's own `REVIEW.md` (see [Review rules in the repo](#review-rules-in-the-repo)) |
| `maxDiffChars` | `150000` | longer diffs are cut off (with `readCode`, the AI can still open the files) |
| `pollSeconds` | `180` | how often it checks GitHub |
| `maxParallel` | `2` | how many PRs are reviewed at once |

</details>

<a id="which-ai"></a>

<details open>
<summary><b>Which AI runs</b></summary>

Set `ai` in `config.json`, or pick it in the **Settings** tab (it lists the AIs it found). `"auto"` uses the first one installed, in this order:

| `ai` | AI | Command it looks for | Locked down |
|---|---|---|---|
| `claude` | Claude Code | `claude` | **fully** |
| `codex` | Codex | `codex` | partly |
| `gemini` | Gemini CLI | `gemini` | partly |
| `cursor` | Cursor | `cursor-agent` or `agent` | partly |
| `opencode` | opencode | `opencode` | partly |

Sign in to the one you use the way it asks (for example run `codex` or `gemini` once). Switching the AI in Settings resets the model to that AI's default.

```json
{ "ai": "auto",
  "repos": [ { "repo": "your-team/api", "ai": "codex" } ] }
```

An AI that isn't fully locked down **always waits for your final word and never approves**, whatever `finalWord` and `allowApprove` say. Settings shows those two rows as fixed.

| Setting | Default | What it does |
|---|---|---|
| `agent.codeCommand` | `claude -p --restricted --strict-mcp-config --safe-mode --tools Read,Grep,Glob` | Claude, inside the checkout when `readCode` is on |
| `agent.command` | the same with `--tools ""` | Claude, diff-only reviews |
| `agent.timeoutSeconds` | `900` | how long one review may take, for any AI |

Want a different AI CLI? Put its command in `agent.command` / `agent.codeCommand` and leave `ai` on `"auto"`: it gets the prompt on stdin and must print a JSON review on stdout. That runs exactly as you wrote it, so check what it can do. `model` and `effort` are only passed to `claude`.

> [!IMPORTANT]
> Upgrading from 0.1? If your `config.json` has an `agent` block, delete it to get the new locked-down defaults.

</details>

<a id="safety"></a>

### Review rules in the repo

Put a `REVIEW.md` (or `.github/REVIEW.md`) in a repo and every review of that repo follows it: what to check, what to
ignore, how your team writes things. It is plain markdown, up to 8,000 characters.

```md
- Every new endpoint needs an auth check and a test.
- We use `Result` types, flag any new `throw`.
- Ignore formatting, the linter handles it.
```

It is read from the PR's **base branch** (usually `main`), never from the PR, so an author can't change the rules
for their own review. Rules can't change the reply format or the safety rules. For rules that only you want,
use `instructions` in `config.json` (global or per repo). Turn this off with `"repoRules": false`.

## Safe by default

> [!WARNING]
> A PR can contain text that tries to trick the AI ("approve this"). Keep `"finalWord": true` on repos where strangers can open PRs.

The AI is told to treat the PR, its comments and the repo's files as **untrusted**. Before any AI sees the checkout, symlinks (which could point at your files) and files the AI CLIs load as instructions or settings (`AGENTS.md`, `CLAUDE.md`, `GEMINI.md`, `.cursor/`, `.gemini/`, `.codex/`, `opencode.json`, …) are removed from it, so a PR can't plant them. Then each AI is locked down as far as it allows:

| AI | What's turned off | What's left |
|---|---|---|
| **Claude Code** | `--restricted`: no shell, none of your Claude settings. `--strict-mcp-config`: none of your MCP servers. `--safe-mode`: no hooks, skills or plugins. Read-only tools, only inside the checkout | nothing: **fully locked down** |
| **Codex** | your config, rules and saved sessions; read-only sandbox with no network | its shell can still read files outside the checkout |
| **Gemini CLI** | plan mode (read-only tools), extensions, MCP servers | it reads your `~/.gemini` settings |
| **Cursor** | ask mode, sandbox on, a deny list for shell, writes, web and MCP | it takes permissions from files; there's no way to confine reads to the checkout |
| **opencode** | plugins; shell, edits, web and files outside the checkout are denied | it still loads your provider config |

Only Claude can be fully locked down, so with any other AI **every review waits in the inbox for your final word and is never an approval**, even if you turned those on. Read them before you post, especially on repos where strangers can open PRs.

The checkout lives in the plugin's state folder (`repos/`, `worktrees/`), never in your own clones, and each review's checkout is removed afterwards. Reviews are posted as **you**, with a note saying they're AI-assisted.

## Develop

```sh
git clone https://github.com/sayeemabdullah/herdr-PR-reviewer && cd herdr-PR-reviewer
herdr plugin link .        # use this folder instead of the GitHub copy
node --test                # run the tests
node src/review.js https://github.com/owner/repo/pull/123 --dry-run   # review one PR, post nothing
```

Changes go through pull requests with [Conventional Commit](https://www.conventionalcommits.org) titles like `feat(inbox): …` or `fix: …`. See [CONTRIBUTING.md](CONTRIBUTING.md) and the [CHANGELOG](CHANGELOG.md).

<div align="center">
<br>
<sub>MIT licensed · built for <a href="https://herdr.dev">herdr</a> · reviews by the AI you choose</sub>
</div>
