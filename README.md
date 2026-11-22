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

## How it works

1. The **watcher** checks GitHub every 3 minutes for PRs to review (see [Pick your repos](#pick-your-repos)).
2. For each one it sends the diff to the AI, which writes a review: a verdict (**approve**, **request changes** or **comment**), a summary, and comments on specific lines.
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
- `bin/pr-inbox` in **any** terminal, including the Herdr desktop app. If you cloned and linked this folder (`herdr plugin link`), you can make it a command once: `ln -s "$PWD/bin/pr-inbox" ~/.local/bin/pr-inbox`. Don't do this with a `herdr plugin install` copy: herdr puts each update in a new folder, so the link would break.

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
