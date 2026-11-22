# Contributing

Thanks for helping! Changes go through pull requests: `master` can't be pushed to directly.

## Workflow

1. Branch off `master`: `git checkout -b feat/short-name`
2. Link your copy into herdr so you can try it: `herdr plugin link .`
3. Run the tests: `node --test`
4. Open a PR. CI must pass before it can be merged:
   - **ci-ok**: tests on macOS and Linux (Node 22 and 24), lint, smoke tests
   - **PR title**: see below
5. PRs are **squash-merged**, and the PR title becomes the commit message on `master`.

## PR titles

PR titles follow [Conventional Commits](https://www.conventionalcommits.org):

```
type(scope): what it does
```

| type | for |
|---|---|
| `feat` | a new feature |
| `fix` | a bug fix |
| `docs` | README, CHANGELOG, comments only |
| `refactor` | code change that doesn't change behaviour |
| `perf` | faster or lighter |
| `test` | tests only |
| `ci` | GitHub Actions, Dependabot |
| `build` | packaging, manifest |
| `style` | formatting only |
| `chore` | anything else that isn't user-facing |
| `revert` | undoing an earlier change |

`scope` is optional and lowercase, e.g. `inbox`, `watcher`, `prompt`, `config`.
Add `!` for a breaking change, e.g. `feat(config)!: rename review modes`.

Examples:

- `feat(inbox): toggle inline comments with 1-9`
- `fix(watcher): keep the last good sha when a review fails`
- `docs: explain the final word setting`

## Releases

1. Bump `version` in `herdr-plugin.toml` and add a matching `## x.y.z` section at the top of `CHANGELOG.md` (CI checks they match).
2. After the PR is merged, tag it: `git tag v0.2.0 && git push origin v0.2.0`.
3. The Release workflow publishes a GitHub release with that CHANGELOG section as notes.
