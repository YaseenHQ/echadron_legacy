---
"echadron": minor
---

Declare a pool of subagent models. `[secondary_model]` now accepts `models` (a map of `[models]` entry id to the hint shown in the Agent and AgentSwarm tool descriptions), `default_model` (the spawn model used when the caller passes none), and `force` (always spawn on the default, refusing an explicit choice). The tool descriptions render the pool with `[default]` and `[main model]` markers, an unresolvable alias fails at session start instead of at spawn, and `primary` is reserved for the caller's own model. `/secondary_model` and existing configuration keep working; without a pool a subagent still inherits the caller's model.
