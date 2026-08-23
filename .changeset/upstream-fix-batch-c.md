---
"echadron": patch
---

Two engine fixes. Tool-call ids are now minted by the engine, so a self-hosted OpenAI-compatible endpoint that renumbers ids between responses no longer has its approvals, questions and user-tool prompts silently swallowed as duplicates. And the subagent `model` parameter is no longer advertised while the secondary-model experiment is off, so the concept stays out of the prompt and a stray `model` argument is rejected instead of quietly inheriting the caller's model.
