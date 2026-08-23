---
"echadron": patch
---

The `/tasks` API now reports `agent_id`, `subagent_type` and `parent_tool_call_id` for subagent tasks, so a client can tell which agent a task belongs to and which tool call spawned it.
