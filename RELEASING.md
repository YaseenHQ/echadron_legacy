# Releasing Echadron

Echadron uses Changesets and `.github/workflows/release.yml`. Merging a user-facing
change with a changeset updates the release pull request. Merging that generated
pull request publishes `echadron`.

## npm trusted publishing

The public `echadron` package uses npm Trusted Publishing. Configure its trusted
publisher with:

- GitHub owner: `YaseenHQ`
- Repository: `echadron`
- Workflow filename: `release.yml`
- Allowed action: `npm publish`

The release job grants `id-token: write`, uses a current npm CLI, and publishes
with provenance. Do not configure an `NPM_TOKEN` Actions secret: the workflow's
OIDC identity is the only npm publishing credential.

## OAuth registrations

The ChatGPT and xAI account flows currently track Pi's public OAuth registrations
and provider-required `originator` / `referrer` values. Their client identifiers are
public identifiers, not secrets, and API-key providers remain available if either
vendor changes its allowlist.

Before calling a release stable, request dedicated native-app registrations from
OpenAI and xAI if those programs are available. A dedicated registration must be
implemented and tested as one complete flow: client id, redirect URI, scopes,
authorization parameters, token exchange, refresh, and request identity. Do not
change only the client id or remove the shared allowlist parameters speculatively.

## Native releases

Native assets are deliberately opt-in. npm publishing and documentation deployment
remain independent from Apple signing credentials.

Before enabling native releases:

1. Add the `APPLE_CERTIFICATE_P12`, `APPLE_CERTIFICATE_PASSWORD`,
   `APPLE_NOTARIZATION_KEY_P8`, `APPLE_NOTARIZATION_KEY_ID`, and
   `APPLE_NOTARIZATION_ISSUER_ID` repository secrets.
2. Run the `Manual Native Bundle` workflow and verify all six target archives.
3. Add the repository variable `ECHADRON_NATIVE_RELEASE_ENABLED=true`.

After that, publishing a new Echadron npm version also builds, signs and notarizes
macOS executables, creates checksummed archives, and uploads a manifest to the
matching GitHub release.

## Pre-release verification

Run:

```sh
pnpm install --frozen-lockfile
pnpm release:check
pnpm typecheck
pnpm lint
pnpm sherif
pnpm test
pnpm build
pnpm lint:pkg
```

For package-level verification, pack `apps/echadron`, install the tarball into an
empty project, and invoke `echadron`, `chad`, and `maker` from that installation.
