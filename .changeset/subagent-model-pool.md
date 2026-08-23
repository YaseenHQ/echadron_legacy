---
"echadron": minor
---

Declare a pool of subagent models. `[secondary_model]` now accepts `models` (a map of `[models]` entry id to the selection hint shown in the Agent and AgentSwarm tool descriptions), `default_model` (the spawn model used when the caller passes none), and `force` (always spawn on the default and ignore the caller's choice). `/secondary_model` and the existing configuration continue to work unchanged.
