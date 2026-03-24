---
name: refactor-autonom
description: Autonomously refactor a change across the codebase, running tests in a loop until green, then rebuild and commit.
argument-hint: <change description>
---

I need you to autonomously refactor the following across the codebase: $ARGUMENTS .

Here's the approach:

1. Make the change across all affected files
2. Run the full test suite with `make test`
3. If any tests fail, analyze the failure, fix the root cause, and re-run,
4. Repeat until ALL tests pass with zero regressions.

Do NOT stop to ask me questions — use your judgment. After all tests pass, run `make schema` and rebuild HTMLs, verify those pass too, then commit with a descriptive message. Track each iteration so you can summarize what you fixed at the end.
