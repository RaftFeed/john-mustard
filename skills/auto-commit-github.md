---
name: auto-commit-github
description: Automatically commit each completed, verified logical change in a Git repository and push to its configured GitHub remote when available. Use by default for tasks that modify repository files, unless the user opts out.
---

# Auto commit and GitHub push

The user requests automatic commits and GitHub pushes as their default workflow. Do not ask for routine commit/push confirmation when this preference applies; respect current user instructions, repository policy, and execution permissions.

- Record the initial branch, status, staged changes, and remotes before editing. Commit each completed logical change after required checks pass, not each file save or unfinished edit. Read-only tasks need no commit.
- Review the diff and stage only this task's changes using explicit paths or selected hunks. Preserve pre-existing edits and staged work; never include unrelated work, secrets, credentials, or generated private data. If ownership cannot be separated safely, leave the changes intact and report the blocker.
- Run repository-required tests and checks before committing. Do not weaken tests or bypass hooks. If checks fail, fix task-related failures; otherwise report the failure and leave the work uncommitted.
- Create a concise descriptive commit. Preserve the existing branch unless repository rules require a task branch; use codex/ for new branches. Do not amend existing commits, reset work, or rewrite history automatically.
- When a configured push remote is GitHub (including a verified GitHub Enterprise host) and authentication/network access works, push the task branch after committing. Prefer its configured upstream; otherwise use an unambiguous GitHub remote and establish the same-name upstream. If the destination is ambiguous, request only the missing destination information.
- Inspect outgoing commits first. If pushing would also publish pre-existing, unrelated commits, retain the new local commit and report why push was skipped. Never force-push, merge, publish releases, or create a new remote repository as part of this skill.
- If no GitHub remote exists, keep the local commit and explain that no push destination is configured. If authentication, connectivity, branch protection, or a non-fast-forward rejection blocks push, preserve the commit and report the actionable error; do not loop or change credentials, remotes, or protections.
- Verify the resulting local commit and, after a successful push, that the destination branch points to that commit. Report the commit hash, branch, check results, and whether push succeeded or was skipped.

## John Mustard runtime

Apply this workflow by default when an owner-authorized coding task changes a Git repository. This playbook does not add Git execution tools or access to the host checkout. Use only an available authorized executor with access to the intended repository and GitHub credentials. If no such executor exists, report that commit/push cannot run in this runtime; never claim success or use an unrelated Python sandbox as though it were the host repository. Pass this workflow along when delegating coding work to an authorized agent. Ordinary WhatsApp tasks, logbook entries, database updates, and skill synchronization are not repository coding changes and must not trigger Git commits.
