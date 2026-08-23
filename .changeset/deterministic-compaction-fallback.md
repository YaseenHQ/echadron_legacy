---
'@yaseenhq/agent-core-v2': minor
---

Never dead-end a session when the compaction summarizer fails

Compaction asks a model to summarize the history. That call can fail — the
provider is down, the key expired mid-session, every shrink attempt still
overflows. Until now the session ended there, and the position was circular:
the context was too large to send, and the only path that shrinks it needed the
very model that was failing.

Compaction now has a path that needs no model call. The budget is a pure
function of the effective context window, clamped, and the replacement text
states only facts read off the history: how many messages were folded, how they
split by role, and which tool calls ran under which ids. It writes no prose,
because there is nothing in that path that could.

The fold is applied only when it genuinely helps. The result is projected first
with the same function the normal path uses, and if it would not make the
context smaller it is not applied and the original failure is reported as
before — a handful of short messages cannot be usefully folded, and applying
one there would grow the context and overflow again on the next step.

Cancellation and authentication failures are unaffected: a cancelled compaction
never rewrites history, and an expired login still surfaces as an auth error
rather than being papered over. Telemetry reports one terminal outcome per
compaction, with `compaction_mode` naming which path produced it.
