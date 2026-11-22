# PR Reviewer for herdr

A [herdr](https://herdr.dev) plugin. It watches your GitHub repos and has Claude review new pull requests. You read each review and press **post**, or let it post on its own.

## Install

You need herdr 0.8 or newer, Node 20 or newer, [`gh`](https://cli.github.com) signed in (`gh auth status`), and `claude`.

```sh
herdr plugin install sayeemabdullah/herdr-PR-reviewer
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

## Read and post reviews

Each review waits in the **inbox** until you decide. You also get a notification.

- Open it with `herdr plugin action invoke pr-reviewer.inbox`, or a shortcut (below).
- For each review you can **post** it, change the verdict, edit it, or **discard** it.
- Press `n` to review any PR right now from its link.

On your own PRs, GitHub only allows a comment, so the review is posted as one.
Draft PRs wait until they're marked ready for review.

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
| `agent.command` | `claude -p --tools ""` | the AI to run. It gets the PR on stdin and replies on stdout |

## Safe by default

- A PR can contain text that tries to trick the AI ("approve this"). The AI is told to ignore it and runs with no tools, so it can't run code. Keep `finalWord: true` on repos where strangers can open PRs.
- Reviews are posted as **you**, with a note at the bottom saying they're AI-assisted.

## Develop

```sh
herdr plugin link .        # use this folder instead of the GitHub copy
node --test                # run the tests
node src/review.js https://github.com/owner/repo/pull/123 --dry-run   # review one PR, post nothing
```
