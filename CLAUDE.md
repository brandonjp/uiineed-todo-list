# uiineed-todo-list — notes for Claude sessions

**Landing policy:** merge verified work to `main` and push, then deploy it to
production once it is verified safe — tests pass, and the live data plus any server
config being changed are backed up first. No need to ask. Brandon, 2026-09-15:
"deploy if it's safe to. let's get this working, no reason to wait." Carve-out
(derived, not stated by Brandon): ask first before anything that deletes or migrates
stored list data.

This repo is a **public fork**. Deployment specifics (host, paths, the rsync command,
verification steps) live in the git-ignored `DEPLOY.local.md` — never commit them.

Tests: `node test/logic.test.js`, `php test/auth.test.php`, `bash test/api.e2e.sh`.
Tracker: `ROADMAP.md` (API + MCP follow-ups are in §11).
