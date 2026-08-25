# @moonshot-ai/kimi-code-oauth

## 0.4.0

### Minor Changes

- [#80](https://github.com/YaseenHQ/echadron_legacy/pull/80) [`5049cc3`](https://github.com/YaseenHQ/echadron_legacy/commit/5049cc3aaa323d3aeae21ca64e2323e0049e778f) Thanks [@YaseenHQ](https://github.com/YaseenHQ)! - Complete the MCP management plane and add the runtime layer

  The management API, the App-scoped OAuth service and the runtime layer now land
  alongside the config store and registry:

  - `runtime` — the runtime abstraction, registry, local runtime and unit host
  - `app/agentIdentity` — the identity a client advertises on MCP initialize
  - `app/mcpManagement` — list, add, update, remove and probe servers
  - `app/mcpConfig/oauthService` — proactive token refresh at App scope

  The OAuth layer takes upstream's implementation, which is materially better than
  what was here: token transactions that invalidate a spent grant, proactive
  refresh, and `obtained_at` stamped on save so refresh can tell a token's age.
  Two behaviours from this fork are preserved on top of it — the loopback client
  still registers as a native application per SEP-837, and the whole layer runs on
  `@modelcontextprotocol/client` 2.0 rather than the 1.x SDK.

  A refresh token the authorization server rejects now moves a server to
  `needs-auth` instead of `failed`. The grant is spent and no retry recovers it,
  so the only way forward is to log in again, and the status now says so.

  Stdio probes always run on the local runtime. Upstream binds them to the
  workspace instance containing the cwd; there is no workspace-instance layer
  here yet, and every stdio server already runs locally.

### Patch Changes

- Updated dependencies [[`5049cc3`](https://github.com/YaseenHQ/echadron_legacy/commit/5049cc3aaa323d3aeae21ca64e2323e0049e778f)]:
  - @yaseenhq/tsugite@0.6.0

## 0.3.0

### Minor Changes

- [#13](https://github.com/YaseenHQ/kimi/pull/13) [`f2830f8`](https://github.com/YaseenHQ/kimi/commit/f2830f8f7a18f54470e979d992107f3fc2a7a886) Thanks [@YaseenHQ](https://github.com/YaseenHQ)! - Rework the host identity type: rename `userAgentProduct` to `productName` and add a required `platform` field, so every host explicitly declares the `X-Msh-Platform` value it reports instead of silently inheriting the CLI's. OAuth requests now also send the product User-Agent (with the optional runtime suffix), so the OAuth host can tell client families and surfaces apart.

- [#1](https://github.com/YaseenHQ/kimi/pull/1) [`02606aa`](https://github.com/YaseenHQ/kimi/commit/02606aa7218b4b01a26a28889d025fd3b6c5afee) Thanks [@YaseenHQ](https://github.com/YaseenHQ)! - Add unified account (OAuth) and API-key login routes with Kimi Code, xAI, OpenAI Codex, known catalog providers, and custom registries. Browser and device-code login methods are available for the supported OAuth providers. `/logout` supports individual and clearly described credential bundles plus separately confirmed provider-configuration removal; the redundant `/provider` slash command is removed.

### Patch Changes

- [#26](https://github.com/YaseenHQ/kimi/pull/26) [`a9b1250`](https://github.com/YaseenHQ/kimi/commit/a9b125062ac298a4dab1714e292e0699400eb79b) Thanks [@YaseenHQ](https://github.com/YaseenHQ)! - Run Echadron's interactive TUI, print mode, doctor, ACP, export, and provider commands on the native agent-core-v2 engine by default. Set `ECHADRON_LEGACY_FLAG=1` (or `KIMI_CODE_LEGACY_FLAG=1`) to use the v1 compatibility path. Remove the dead v1 micro-compaction implementation while preserving historical replay records.

- [#1](https://github.com/YaseenHQ/kimi/pull/1) [`d92ccad`](https://github.com/YaseenHQ/kimi/commit/d92ccad95aa6310c2ad9143213a61529a3c2b4a4) Thanks [@YaseenHQ](https://github.com/YaseenHQ)! - Suppress the `Skipped refreshing managed:kimi-code: ... requires login` warning when switching models. The refresh orchestrator now treats an unauthenticated managed provider as not-yet-logged-in rather than a refresh failure.

- [#1](https://github.com/YaseenHQ/kimi/pull/1) [`1889925`](https://github.com/YaseenHQ/kimi/commit/188992554ca1d500d8bb67792e68d29da41a5303) Thanks [@YaseenHQ](https://github.com/YaseenHQ)! - Listen for OAuth browser callbacks on both IPv4 (`127.0.0.1`) and IPv6 (`::1`) loopback addresses while keeping the `localhost` redirect URI. This fixes browser login failures on systems where `localhost` resolves to `::1` first (e.g., Codex and Anthropic PKCE flows).

- [#30](https://github.com/YaseenHQ/kimi/pull/30) [`07b4780`](https://github.com/YaseenHQ/kimi/commit/07b478055ecafb330a1fb3cfc2a9869baae6998a) Thanks [@YaseenHQ](https://github.com/YaseenHQ)! - Keep the managed Kimi subscription labeled as Kimi Code inside the Echadron host, identify ChatGPT Codex requests as Echadron, make device OAuth network waits and polling sleeps cancel immediately, expose model capabilities when agents choose between primary and secondary subagent models, and add v2 config deprecation guidance without breaking existing Echadron config files.

- [#7](https://github.com/YaseenHQ/kimi/pull/7) [`cf99ad9`](https://github.com/YaseenHQ/kimi/commit/cf99ad9a76c306226a0420c292de57a7154483b0) Thanks [@YaseenHQ](https://github.com/YaseenHQ)! - Derive the /usage plan usage window labels and reset hints from structured usage data instead of preformatted text.

## 0.2.2

### Patch Changes

- [#399](https://github.com/MoonshotAI/kimi-code/pull/399) [`232ed87`](https://github.com/MoonshotAI/kimi-code/commit/232ed874d41de777e6ff9c539ac22d830d0b5c3a) - Keep managed OAuth credentials scoped to their configured authentication and API endpoints.

## 0.2.1

### Patch Changes

- [#335](https://github.com/MoonshotAI/kimi-code/pull/335) [`7284f30`](https://github.com/MoonshotAI/kimi-code/commit/7284f30479142fd66b1e8a731fd00198b1e8684f) - Fix custom registry provider handling during re-import. Prevent loss of multi-provider entries and remove stale providers along with their model aliases and default model references.

## 0.2.0

### Minor Changes

- [#264](https://github.com/MoonshotAI/kimi-code/pull/264) [`42bb914`](https://github.com/MoonshotAI/kimi-code/commit/42bb9141d8ee7023639f943dd4c6a0f6c8fa8945) - Add `/provider` command for managing AI providers, support custom registry imports, and introduce a tabbed model selector.

### Patch Changes

- [#274](https://github.com/MoonshotAI/kimi-code/pull/274) [`a1dfbfe`](https://github.com/MoonshotAI/kimi-code/commit/a1dfbfeb16bcad0c2c8faa232d6d1ce4a2681d57) - Clarify Kimi Platform API key login labels and prompt details.

## 0.1.2

### Patch Changes

- [#52](https://github.com/MoonshotAI/kimi-code/pull/52) [`064343a`](https://github.com/MoonshotAI/kimi-code/commit/064343a6e565a525fbf38b3a1f70f7ff0235a5ed) - Correct the `X-Msh-Platform` header value to `kimi_code_cli`.

- [#11](https://github.com/MoonshotAI/kimi-code/pull/11) [`15b018f`](https://github.com/MoonshotAI/kimi-code/commit/15b018fc84a36a9ebde598970e5b44bebe5d68c6) - Surface API-provided error messages during feedback, usage, login, and model setup failures.
