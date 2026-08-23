---
"echadron": patch
---

More upstream reliability fixes: cancelling an MCP authorization no longer leaves the flow hanging until its timeout, `/feedback` now works for any signed-in user rather than only those running a managed model, a missing Git Bash on Windows reports what it looked for instead of a raw probe failure, web session export is no longer capped at 64 MiB, and a multi-select question in the VS Code panel waits for every answer.
