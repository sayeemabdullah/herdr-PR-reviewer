<div align="center">

<img src="assets/header.png" alt="herdr + Claude + GitHub" width="420">

# PR Reviewer for herdr

**Claude reviews the pull requests you're asked to review.**<br>
**You read each review in an inbox and press _post_, or let it post on its own.**

<p><a href="https://github.com/sayeemabdullah/herdr-PR-reviewer/actions/workflows/ci.yml"><img alt="CI" src="https://img.shields.io/github/actions/workflow/status/sayeemabdullah/herdr-PR-reviewer/ci.yml?branch=master&style=flat-square&label=CI"></a> <a href="https://herdr.dev/plugins/"><img alt="herdr plugin, 0.8 or newer" src="https://img.shields.io/badge/herdr%20plugin-%E2%89%A5%200.8-222?style=flat-square"></a> <a href="https://nodejs.org"><img alt="Node 22 or newer" src="https://img.shields.io/badge/node-%E2%89%A5%2022-339933?style=flat-square&logo=node.js&logoColor=white"></a> <a href="https://claude.com/claude-code"><img alt="Claude Code, restricted mode" src="https://img.shields.io/badge/Claude%20Code-restricted-D97757?style=flat-square"></a> <a href="LICENSE"><img alt="MIT license" src="https://img.shields.io/badge/license-MIT-0969da?style=flat-square"></a></p>

[Quick start](#quick-start) · [How it works](#how-it-works) · [The inbox](#inbox) · [Settings](#settings) · [Safety](#safety) · [Contributing](CONTRIBUTING.md)

<br>

<img src="assets/inbox.svg" alt="The PR Review Inbox" width="860">

</div>

<br>

## Features

<table>
<tr>
<td width="33%" valign="top">

### Reads the code
Claude gets a read-only checkout of the PR, so it can open callers, types and tests, and still review big PRs whose diff gets cut off.

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
It runs with no shell, none of your MCP servers and none of your settings, and can only read files inside the checkout.

</td>
<td valign="top">

### Fits herdr
A watcher tab, an inbox pane, shortcuts and notifications. A `pr-inbox` command works in any terminal.

</td>
</tr>
</table>

<a id="quick-start"></a>

## Quick start

> [!NOTE]
> You need **herdr 0.8+**, **Node 22+**, `git`, the [GitHub CLI](https://cli.github.com) signed in (`gh auth status`), and an up-to-date [Claude Code](https://claude.com/claude-code) (`claude`).

**1. Install**

```sh
herdr plugin install sayeemabdullah/herdr-PR-reviewer
herdr plugin action invoke pr-reviewer.install-cli   # optional: adds the `pr-inbox` command
```

**2. Pick your repos.** This is optional: with no list, it reviews any PR where you're a requested reviewer.

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

**3. Start the watcher.** It also starts by itself with herdr, in a tab called **PR watcher**.

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
    co --> ai["Claude<br/>restricted, read-only"]
    ai --> fw{"Final word?"}
    fw -- "on (default)" --> inbox["Inbox<br/>you read, edit, post"]
    fw -- "off" --> post["Posted to GitHub<br/>as you"]
    inbox --> post
```

For each PR, Claude gets:

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

## The inbox

Reviews wait here for your final word. Open it with any of:

| Where | How |
|---|---|
| any terminal, incl. the Herdr desktop app | `pr-inbox` (set up once with `herdr plugin action invoke pr-reviewer.install-cli`) |
| inside herdr | `herdr plugin action invoke pr-reviewer.inbox`, or <kbd>Ctrl</kbd>+<kbd>b</kbd> <kbd>i</kbd> with the [shortcut](#shortcuts) |

The top line shows whether the watcher is running and which PR it's reviewing right now. The list updates by itself. Each review is checked against GitHub:

| Shows | Means |
|---|---|
| up to date (green) | the review matches the PR as it is now |
| new commits since this review (yellow) | the author pushed after the review. You can still post, and you'll be warned first |
| PR is merged / closed (yellow) | the PR is finished. You'll probably want to discard the review |

<details>
<summary><b>Keys in the list</b></summary>

| Key | Does |
|---|---|
| <kbd>↑</kbd> <kbd>↓</kbd> | move |
| <kbd>Enter</kbd> or <kbd>1</kbd>–<kbd>9</kbd> | open a review |
| <kbd>p</kbd> | post the selected review (asks y/N first) |
| <kbd>d</kbd> | discard it. Nothing goes to GitHub |
| <kbd>o</kbd> | open the PR in your browser |
| <kbd>n</kbd> | review any PR now: paste its link. It runs in the background |
| <kbd>h</kbd> | history: what was posted, discarded or failed, and why |
| <kbd>q</kbd> | quit |

</details>

<details>
<summary><b>Keys inside a review</b></summary>

| Key | Does |
|---|---|
| <kbd>↑</kbd> <kbd>↓</kbd> <kbd>Space</kbd> | scroll (<kbd>g</kbd> top, <kbd>G</kbd> bottom) |
| <kbd>1</kbd>–<kbd>9</kbd> | turn a line comment **off or on**. Off comments are struck through and not posted |
| <kbd>a</kbd> / <kbd>r</kbd> / <kbd>c</kbd> | set the verdict: approve / request changes / comment |
| <kbd>e</kbd> | edit the summary in your editor, as Markdown |
| <kbd>E</kbd> | edit everything (verdict, summary, comments) as JSON |
| <kbd>p</kbd> | post. It asks first: *"Post COMMENT with 3 inline comment(s) to …#415? [y/N]"* |
| <kbd>d</kbd> | discard |
| <kbd>o</kbd> | open the PR in your browser |
| <kbd>←</kbd> / <kbd>Esc</kbd> | back to the list |

<kbd>e</kbd> and <kbd>E</kbd> use `$EDITOR`. If that isn't set, they use VS Code when it's installed, otherwise `vi`.

</details>

### Shortcuts

Add these to `~/.config/herdr/config.toml`, then run `herdr server reload-config`. `prefix` is <kbd>Ctrl</kbd>+<kbd>b</kbd> unless you changed it.

```toml
[[keys.command]]
key = "prefix+i"
type = "plugin_action"
command = "pr-reviewer.inbox"
description = "PR review inbox"

[[keys.command]]
key = "prefix+shift+i"
type = "plugin_action"
command = "pr-reviewer.watch"
description = "PR review watcher"
```

<a id="settings"></a>

## Settings

All of these go in `config.json`. Any of them can also go on one repo, like `{ "repo": "…", "finalWord": false }`.

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
| `model` | `"opus"` | the Claude model for reviews, e.g. `"opus"`, `"sonnet"`, or `""` for Claude's default |
| `effort` | `"high"` | how hard it thinks: `low`, `medium`, `high`, `xhigh`, `max`. Higher is slower and costs more |
| `readCode` | `true` | let the AI read the whole repo at the PR's commit (read-only). `false`: diff only |
| `ignorePaths` | lockfiles, `*.min.js`, `dist/`, `vendor/`, `*.snap` | left out of the diff, as globs like `"**/*.generated.ts"`. Setting this replaces the defaults |
| `instructions` | `""` | extra things the reviewer should check |
| `maxDiffChars` | `150000` | longer diffs are cut off (with `readCode`, the AI can still open the files) |
| `pollSeconds` | `180` | how often it checks GitHub |
| `maxParallel` | `2` | how many PRs are reviewed at once |

</details>

<details>
<summary><b>Which AI runs</b></summary>

| Setting | Default | What it does |
|---|---|---|
| `agent.codeCommand` | `claude -p --restricted --strict-mcp-config --tools Read,Grep,Glob` | runs inside the checkout when `readCode` is on |
| `agent.command` | the same with `--tools ""` | diff-only reviews |
| `agent.timeoutSeconds` | `900` | how long one review may take |

Any AI CLI works: it gets the prompt on stdin and must print a JSON review on stdout. `model` and `effort` are only passed to `claude`.

> [!IMPORTANT]
> Upgrading from 0.1? If your `config.json` has an `agent` block, delete it to get the new locked-down defaults.

</details>

<a id="safety"></a>

## Safe by default

> [!WARNING]
> A PR can contain text that tries to trick the AI ("approve this"). Keep `"finalWord": true` on repos where strangers can open PRs.

The AI is told to treat the PR, its comments and the repo's files as **untrusted**, and it's locked down:

| | |
|---|---|
| `--restricted` | no shell or other code-running tools, and none of your Claude settings are loaded |
| `--strict-mcp-config` | none of your MCP servers (mail, drive, …) are available |
| read-only tools | it can only **read** files, and only inside the PR's checkout |

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
<sub>MIT licensed · built for <a href="https://herdr.dev">herdr</a> · reviews by <a href="https://claude.com/claude-code">Claude</a></sub>
</div>
