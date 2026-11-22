<p align="center">
  <a href="https://herdr.dev"><img src="assets/herdr.png" alt="herdr" height="72"></a>
  &nbsp;&nbsp;<b>+</b>&nbsp;&nbsp;
  <a href="https://claude.com/claude-code"><img src="assets/claude.jpeg" alt="Claude" height="72"></a>
  &nbsp;&nbsp;<b>+</b>&nbsp;&nbsp;
  <a href="https://github.com"><img src="assets/github.png" alt="GitHub" height="72"></a>
</p>

<h1 align="center">PR Reviewer for herdr</h1>

<p align="center">
  Claude reviews the pull requests you're asked to review.<br>
  You read each review in an inbox and press <b>post</b>, or let it post on its own.
</p>

<p align="center">
  <a href="https://github.com/sayeemabdullah/herdr-PR-reviewer/actions/workflows/test.yml"><img src="https://github.com/sayeemabdullah/herdr-PR-reviewer/actions/workflows/test.yml/badge.svg" alt="tests"></a>
  <img src="https://img.shields.io/badge/herdr-%E2%89%A5%200.8-black" alt="herdr ≥ 0.8">
  <img src="https://img.shields.io/badge/node-%E2%89%A5%2020-339933" alt="node ≥ 20">
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-MIT-blue" alt="MIT license"></a>
</p>

A [herdr](https://herdr.dev) plugin. It watches GitHub for PRs that need your review and has [Claude](https://claude.com/claude-code) review them, reading the whole repo and not just the diff. Reviews are posted with the [GitHub CLI](https://cli.github.com) as you, after your final word.

## Install

You need herdr 0.8 or newer, Node 20 or newer, `git`, [`gh`](https://cli.github.com) signed in (`gh auth status`), and an up-to-date [Claude Code](https://claude.com/claude-code) (`claude`). The reviewer uses its `--restricted` mode.

```sh
herdr plugin install sayeemabdullah/herdr-PR-reviewer
herdr plugin action invoke pr-reviewer.install-cli   # optional: adds the pr-inbox command
```

The watcher starts with herdr, in a tab called **PR watcher**. To start it now:

```sh
herdr plugin action invoke pr-reviewer.watch
```

## Pick your repos

Open the config file:

```sh
$EDITOR "$(herdr plugin config-dir pr-reviewer)/config.json"
```

List your repos and say which PRs to review in each:

```json
"repos": [
  { "repo": "your-name/your-repo",        "review": "all" },
  { "repo": "your-team/team-repo",        "review": "requested" }
]
```

| `review` | Reviews |
|---|---|
| `"all"` | every open PR in the repo |
| `"requested"` | only PRs where you're added as a reviewer (the default) |

Repos you don't list still get reviewed when someone adds you as a reviewer. To stop that, set `"onlyListedRepos": true`.

Changes are picked up on the next check, within 3 minutes. You don't need to restart anything.

## How it works

1. The **watcher** checks GitHub every 3 minutes for PRs to review (see [Pick your repos](#pick-your-repos)).
2. For each one it checks out the PR (read-only) and asks the AI for a review: a verdict (**approve**, **request changes** or **comment**), a summary, and comments on specific lines. The AI gets:
   - the diff, minus lockfiles and build output ([`ignorePaths`](#settings)),
   - the **whole repo** at the PR's commit, so it can look up callers, types and tests, and still review big PRs whose diff gets cut off,
   - what other reviewers already said, so it doesn't repeat them,
   - on a re-review, **its previous review and the changes since**, so it says what's fixed instead of starting over.

   Small, certain fixes come as GitHub **suggestions** the author can apply with one click. Up to 2 PRs are reviewed at once (`maxParallel`).
3. What happens next depends on your **final word** setting:
   - **On** (the default): the review waits in your **inbox** and you get a notification. Nothing reaches GitHub until you post it.
   - **Off**: the review is posted to GitHub straight away, as you.
4. When new commits are pushed, the PR is reviewed again. When you're only a requested reviewer, this stops once you've posted, because GitHub then takes you off the requested list.

On your own PRs, GitHub only allows a comment, so the review is posted as one.
Draft PRs wait until they're marked ready for review.

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
| To read every review before it's posted | `"finalWord": true` (the default) |
| Reviews posted by themselves, no inbox | `"finalWord": false` |
| Reviews posted by themselves, but never an approval | `"finalWord": false, "allowApprove": false`. The AI comments or asks for changes, and approving stays with a person |

A setting on a repo wins over the one at the top. Changes apply on the next check; nothing needs restarting.

## The inbox

The inbox is where reviews wait for your final word. Open it with any of:

- `herdr plugin action invoke pr-reviewer.inbox` (opens in herdr)
- `Ctrl+b` then `i` in herdr, if you added the [shortcut](#shortcuts-optional)
- `pr-inbox` in **any** terminal, including the Herdr desktop app. Set it up once with `herdr plugin action invoke pr-reviewer.install-cli`. It adds `~/.local/bin/pr-inbox` and keeps working after `herdr plugin update`.

```
 PR Review Inbox 2 waiting                                  ● watching  ·  ⟳ reviewing web-app#418
──────────────────────────────────────────────────────────────────────────────────────────────────────────
 ▸  CHANGES  api-server #212   fix(auth): refresh tokens are not revoked on logout             5 notes  31m
    COMMENT  web-app    #415   feat(settings): let users export their data as CSV              3 notes  29m
──────────────────────────────────────────────────────────────────────────────────────────────────────────
 acme/api-server#212  by a-teammate  ✓ up to date
 What this PR does …                                          ← preview of the selected review
```

The top line shows whether the watcher is running and which PR it's reviewing right now. The list updates by itself.

Next to each PR you'll see one of:

| Shows | Means |
|---|---|
| ✓ up to date | the review matches the PR as it is now |
| ⚠ new commits since this review | the author pushed after the review was written. You can still post, and you'll be warned first |
| ⚠ PR is merged / closed | the PR is finished, so you'll probably want to discard the review |

### Keys in the list

| Key | Does |
|---|---|
| `↑` `↓` | move |
| `Enter` or `1`–`9` | open a review |
| `p` | post the selected review (asks y/N first) |
| `d` | discard it. Nothing goes to GitHub |
| `o` | open the PR in your browser |
| `n` | review any PR now: paste its link. It runs in the background and shows up when ready |
| `h` | history: what was posted, discarded or failed, and why |
| `q` | quit |

### Keys inside a review

| Key | Does |
|---|---|
| `↑` `↓`, `space` | scroll (`g` top, `G` bottom) |
| `1`–`9` | turn a line comment **off or on**. Off comments are struck through and not posted |
| `a` / `r` / `c` | set the verdict to approve / request changes / comment |
| `e` | edit the summary in your editor, as plain Markdown |
| `E` | edit everything (verdict, summary, comments) as JSON |
| `p` | post. It asks first, e.g. "Post COMMENT with 3 inline comment(s) to …#415? [y/N]" |
| `d` | discard |
| `o` | open the PR in your browser |
| `←` or `Esc` | back to the list |

`e` and `E` use `$EDITOR`. If that isn't set, they use VS Code when it's installed, otherwise `vi`. Save and close the file to come back to the inbox.

When you post, GitHub gets one review from your account: the summary as the body, the line comments that are on, and a short "AI-assisted" note at the bottom.

### Shortcuts (optional)

Add these to `~/.config/herdr/config.toml`, then run `herdr server reload-config`. `prefix` is `Ctrl+b` unless you changed it.

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

## Settings

All of these go in `config.json`. Any of them can also go on one repo, like `{ "repo": "...", "finalWord": false }`.

| Setting | Default | What it does |
|---|---|---|
| `review` | `"requested"` | `"all"` or `"requested"`, see above |
| `finalWord` | `true` | `true`: you post each review. `false`: it posts by itself |
| `allowApprove` | `true` | `false`: it never approves, only comments or asks for changes |
| `rereviewOnPush` | `true` | review again when new commits are pushed |
| `skipDrafts` | `true` | leave draft PRs alone |
| `ignoreRepos` | `[]` | repos it must never send to the AI |
| `ignoreAuthors` | bots | PR authors to skip |
| `onlyListedRepos` | `false` | `true`: only the repos in `repos` |
| `instructions` | `""` | extra things the reviewer should check |
| `pollSeconds` | `180` | how often it checks GitHub |
| `maxParallel` | `2` | how many PRs are reviewed at the same time |
| `readCode` | `true` | let the AI read the whole repo at the PR's commit (read-only). `false`: diff only |
| `ignorePaths` | lockfiles, `*.min.js`, `dist/`, `vendor/`, `*.snap` | files left out of the diff, as globs like `"**/*.generated.ts"`. Setting this replaces the defaults |
| `maxDiffChars` | `150000` | longer diffs are cut off (with `readCode` the AI can still open the files) |
| `agent.codeCommand` | `claude -p --restricted --strict-mcp-config --tools Read,Grep,Glob` | the AI command when it can read the code. It runs inside the checkout |
| `agent.command` | the same with `--tools ""` | the AI command for diff-only reviews |
| `agent.timeoutSeconds` | `900` | how long one review may take |

Any AI CLI works for `agent.command` / `agent.codeCommand`: it gets the prompt on stdin and must print a JSON review on stdout. If you upgraded from 0.1 and your `config.json` has an `agent` block, delete it to get the new locked-down defaults.

## Safe by default

- A PR can contain text that tries to trick the AI ("approve this"). The AI is told to treat the PR, its comments and the repo's files as untrusted, and it's locked down:
  - `--restricted`: no shell or other code-running tools, and none of your Claude settings are loaded.
  - `--strict-mcp-config`: none of your MCP servers (mail, drive, …) are available.
  - It can only **read** files, and only inside the PR's checkout.

  Still, keep `finalWord: true` on repos where strangers can open PRs.
- The checkout lives in the plugin's state folder (`repos/` and `worktrees/`), never in your own clones. Each review's checkout is removed when it's done.
- Reviews are posted as **you**, with a note at the bottom saying they're AI-assisted.

## Develop

```sh
herdr plugin link .        # use this folder instead of the GitHub copy
node --test                # run the tests
node src/review.js https://github.com/owner/repo/pull/123 --dry-run   # review one PR, post nothing
```
