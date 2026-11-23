# Security policy

PR Reviewer runs an AI on pull requests that anyone can write, so security reports matter here. Thank you for taking the time.

## Reporting a problem

Please **don't open a public issue** with the details.

1. Go to the **Security** tab of this repo and choose **Report a vulnerability**. That opens a private report only the maintainer can see.
2. If that button isn't there, open a public issue that says only "I have a security report" (no details), and a private way to talk will be arranged.

Useful to include: what you did, what happened, what you expected, your PR Reviewer version (`herdr-plugin.toml`) and which AI CLI version you use (`claude --version`).

This is a one-person project, so replies are best effort, but a report is read and answered.

## What counts

Things this plugin promises, and that a PR author (a stranger) should not be able to break:

- **Posting without your say.** A PR making the reviewer approve, or post, when `finalWord` is on.
- **Leaving the checkout.** Reading files outside the PR's checkout (your home folder, tokens, SSH keys), for example through symlinks or paths in a PR.
- **Running code.** Getting a shell, a hook or a command to run on your machine from PR content, branch names, file names or `REVIEW.md`.
- **Taking over the reviewer's settings.** A PR adding a `CLAUDE.md`, settings, hooks or MCP servers that the reviewer then loads.
- **Leaking secrets.** Your GitHub or Claude credentials ending up in a comment, a log or a file.
- **Rules from the wrong place.** The repo's `REVIEW.md` being read from the PR instead of the base branch.

How these are meant to be prevented is in the README under [Safe by default](README.md#safe-by-default).

## What doesn't count

- The AI being wrong, missing a bug or being talked into a bad opinion. Reviews are advice, and `finalWord` exists so you read them first.
- Risks that the README already describes, such as turning `finalWord` off on a repo where strangers can open PRs.
- Problems in Claude Code, `gh`, git or herdr themselves. Please report those to their own projects.

## Supported versions

Fixes go into the latest release. Please check that the problem still exists there before reporting.
