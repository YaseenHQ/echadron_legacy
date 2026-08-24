---
'@yaseenhq/agent-core-v2': minor
---

Add the actor-runtime foundation for upstream PR #3175 (agent domain migration)

This lands the state-machine substrate a set of session domains will migrate
onto — nothing consumes it yet, so this changes no behaviour on its own:

- `agent/runtime` — `defineAgentRuntime`, the per-agent `AgentRuntimeSet` that
  materializes an xstate actor lazily on first use, and durable-state folding
  for runtimes whose state must survive a restart
- `state/state`, `state/eventDispatcher` — the durable state-fold contract and
  its event dispatch, layered on `wire`'s persisted-record model
- `agent/agentContext`, `app/event/event2` — the per-agent identity a runtime
  runs under, and the typed, schema-validated event class registry it dispatches
- `_base/di/collection` — multi-provider contribution points
  (`@SomeToken items: CollectionView<T>`) and single-provider `definition()`
  slots, for a domain to register itself with a shared point like
  `AgentRuntimeContributionPoint` without every consumer knowing every provider

Adds `xstate` and `immer` as dependencies of `@yaseenhq/agent-core-v2`.

One adaptation from upstream's shape: their `collection()` is backed by a
Fiber-based dynamic provide/unprovide DI container that this fork does not
have — this fork's scoped-service registration is the simpler static
`registerScopedService` model. `collection()` here keeps the identical public
surface (so nothing written against it needs to differ) but is backed by a
flat, scope-unaware registry, matching the pattern `toolContribution.ts`
already used for tool registration. Visibility is process-wide rather than
scope-filtered; nothing in this fork needs scope-filtered contribution
visibility today.

`_base/state/stateRegistry.ts`'s `register()` keeps its existing name and
call sites (used across ~15 files) but gains upstream's richer internals:
duplicate-registration guarding via a returned `IDisposable`, a
`snapshotExcluded` key flag, and a hierarchical `inspect()` for nested
scope views.
