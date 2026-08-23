/**
 * Shared device-code login flow used by both `kimi login` (top-level
 * subcommand) and `kimi acp --login` (the first-class ACP terminal-auth
 * entry point). Exiting the process is part of the contract — callers
 * MUST treat the returned promise as `Promise<never>`.
 */

import { kimiRegionLoginHosts, type KimiRegion } from '@yaseenhq/echadron-oauth';
import { createKimiHarness } from '@yaseenhq/echadron-sdk';

import { createKimiCodeHostIdentity } from '#/cli/version';
import { openUrl } from '#/utils/open-url';
import { getDataDir } from '#/utils/paths';

export interface LoginFlowOptions {
  /**
   * Which Kimi Code deployment to sign in against. Omitted means "whatever
   * the environment and existing config already resolve to", which keeps a
   * bare `echadron login` behaving exactly as before.
   */
  readonly region?: KimiRegion;
}

export async function runLoginFlow(options: LoginFlowOptions = {}): Promise<never> {
  const identity = createKimiCodeHostIdentity();
  // Only an explicit --region supplies hosts; kimiRegionLoginHosts itself
  // yields to env overrides so a pinned endpoint still wins.
  const hosts = options.region === undefined ? undefined : kimiRegionLoginHosts(options.region);
  const harness = createKimiHarness({
    homeDir: getDataDir(),
    identity,
    uiMode: 'cli',
  });
  const controller = new AbortController();
  process.once('SIGINT', () => {
    controller.abort();
  });
  try {
    const result = await harness.auth.login(undefined, {
      signal: controller.signal,
      baseUrl: hosts?.baseUrl,
      oauthHost: hosts?.oauthHost,
      onDeviceCode: (data) => {
        const url = data.verificationUriComplete || data.verificationUri;
        // Print the manual fallback before attempting to open the user's
        // browser so headless/browser-opener failures never hide the URL
        // and code needed to complete login.
        process.stderr.write(
          [
            '',
            `Opening browser for Echadron managed-account login: ${url}`,
            `If the browser did not open, paste the URL above and enter code: ${data.userCode}`,
            data.expiresIn !== null && data.expiresIn !== undefined
              ? `Code expires in ${data.expiresIn}s.`
              : undefined,
            'Waiting for authorization to complete...',
            '',
          ]
            .filter((line): line is string => line !== undefined)
            .join('\n'),
        );
        try {
          openUrl(url);
        } catch {
          // Best effort only: the manual fallback has already been printed.
        }
      },
    });
    process.stderr.write(`Logged in to ${result.providerName}.\n`);
    process.exit(0);
  } catch (error) {
    if (controller.signal.aborted) {
      process.stderr.write('Login cancelled.\n');
    } else {
      const message = error instanceof Error ? error.message : String(error);
      process.stderr.write(`Login failed: ${message}\n`);
    }
    process.exit(1);
  }
}
