# GitHub Copilot setup

The repository now contains Copilot instructions, issue templates, a pull-request template and mandatory PR quality checks.

GitHub Copilot automatic code review is an account/repository setting and cannot be enabled through a committed workflow file. Enable it in GitHub under repository or organization Copilot settings, and require `Pull request quality / quality` before merge.

Recommended use:

1. Let the health workflow create or update a deduplicated issue.
2. Assign a small, well-scoped issue to Copilot or Codex.
3. Review the generated branch and pull request.
4. Merge only after required checks pass.
