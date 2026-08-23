# Task Completion and GitHub Handoff

This workflow makes each workspace-changing task reproducible, reviewable, and easy for the next
developer or agent to continue. A task is not complete when the code only exists in the local
worktree; completion includes durable documentation, validation, commits, a verified push, and
clickable GitHub links.

## Scope

Follow this workflow for every task that changes code, configuration, tests, documentation, or
generated project artifacts. Read-only investigations do not require an empty commit or a redundant
handoff document, but their final response must clearly say that no workspace files changed.

Do not create a pull request, release, tag, or force-push unless the user explicitly requests it.

## Required Sequence

### 1. Protect the Worktree

1. Confirm the primary worktree, current branch, upstream, and status.
2. Treat pre-existing changes as user-owned. Do not edit, stage, commit, or discard unrelated paths.
3. Fetch the current `origin` branch before the final commit/push check.
4. If local and remote history diverged, stop before rewriting or merging history unless that action
   is already within the user's request.
5. Never stage secrets, private keys, tokens, `.env` files, or credential-bearing diagnostics.

### 2. Leave a Durable Task Record

Use the most specific existing documentation location:

| Work type                | Record location                                                                             |
| ------------------------ | ------------------------------------------------------------------------------------------- |
| Bug diagnosis or fix     | `.agents/results/bugs/bug-YYYYMMDD-<slug>.md`                                               |
| Architecture decision    | `.agents/results/architecture/adr-<slug>.md`                                                |
| Other substantive change | `.agents/results/handoffs/handoff-YYYYMMDD-<slug>.md`                                       |
| Documentation-only task  | The changed documentation may serve as the record when it contains the required information |

Update an existing record instead of creating a duplicate when the task continues earlier work.
The record must contain enough context to resume without reconstructing the conversation:

- objective and user-visible outcome;
- root cause or design rationale;
- important files and boundaries changed;
- exact validation commands and results;
- compatibility, security, migration, and operational considerations that apply;
- known limitations, unresolved risks, and concrete next steps;
- date and completion status.

Do not include secrets, temporary credentials, private host details, or machine-specific key paths.

### 3. Validate Before Committing

1. Run the narrow regression test that would fail without the change.
2. Run the affected type, lint, formatting, and build checks required by the touched area.
3. Prefer the repository's changed-scope validation task when one exists.
4. Run `git diff --check`, then inspect `git status --short` and the complete task-owned diff.
5. Record every meaningful command and result in the task record. Never hide, ignore, or relabel a
   failing check; either fix it or document the blocker.

Use the repository-required runtime. Orca currently requires Node 24, so invoke the project commands
under Node 24 when the active shell uses another version.

### 4. Create Reviewable Commits

1. Split independent concerns into separate commits; keep implementation, its regression tests, and
   its task record together when they describe one outcome.
2. Stage only explicit paths with `git add <path>...`. Do not use `git add .` or `git add -A`.
3. Review `git diff --cached` before each commit.
4. Use a Conventional Commit message such as `fix(ssh): ...`, `perf(relay): ...`, or
   `docs(workflow): ...`. Keep the subject imperative, lowercase, and at most 72 characters.
5. Run any configured commit hooks. Do not bypass them unless the user explicitly authorizes it and
   the final report explains why.

After committing, confirm that no task-owned changes remain unstaged. Unrelated user-owned changes
may remain and must be reported without being included.

### 5. Push and Verify GitHub State

Push the checked-out branch to `origin` without force:

```bash
git push -u origin HEAD
```

If the branch already tracks `origin`, a normal `git push` is sufficient. Never use `--force` or
`--force-with-lease` as part of routine task completion.

After pushing:

1. Compare `git rev-parse HEAD` with the SHA published at the corresponding `origin` branch.
2. Confirm `git status -sb` reports the expected tracking relationship.
3. Obtain the canonical repository URL with one batched `gh repo view` request when `gh` is
   available; otherwise use the `origin` URL.
4. Build and verify a GitHub commit URL and branch URL. Prefer the immutable commit URL as the main
   handoff link.

Authentication failure, protected-branch rejection, non-fast-forward rejection, rate limiting, or
network failure means the push is incomplete. Preserve the commits locally and report the exact
error and recovery command instead of claiming success.

### 6. Final Response Contract

The final response must be self-contained and include:

- the completed user-visible outcome;
- branch name and abbreviated commit SHA(s) with commit subjects;
- tests and quality checks that passed, plus any checks that could not run;
- clickable local link to the durable task record;
- clickable GitHub commit link, and a branch link when useful;
- known limitations or next steps that materially affect the user.

Use this compact handoff format:

```markdown
Completed: <outcome>

- Branch: `<branch>`
- Commits: `<sha> <subject>`
- Verification: <commands/results>
- Task record: [document](/absolute/worktree/path/to/document.md)
- GitHub: [commit](https://github.com/<owner>/<repo>/commit/<sha>) · [branch](https://github.com/<owner>/<repo>/tree/<branch>)
- Remaining: <none or explicit limitation>
```
