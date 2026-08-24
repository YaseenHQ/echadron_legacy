# Echadron branding

Echadron is the fork-owned product name for this multi-provider agent harness.

The Echadron package exposes `echadron`, `chad`, and `maker` aliases. It must
never install an upstream executable: Kimi Code can be installed alongside
Echadron. The `ec` alias is
intentionally not
installed by default because it is a plausible user-defined/editor command and
an npm `bin` entry could overwrite it during a global install.

The `@yaseenhq/*` package scopes, provider identifiers, storage paths, and
OAuth keys remain compatibility interfaces. Runtime `KIMI_*` and `IMPERIUM_*`
environment names are accepted as legacy aliases, but new documentation and
hosts should use the `ECHADRON_*` spelling. Provider credential keys inside
`config.toml` remain protocol-specific and are not renamed by this migration.

The model directory is different: Echadron owns its persisted model catalog
snapshot and refreshes it with `echadron update --models`. The inherited Kimi
release updater is disabled
until a separate Echadron release channel exists.
