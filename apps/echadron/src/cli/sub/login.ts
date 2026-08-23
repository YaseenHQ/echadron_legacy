/**
 * `echadron login` — drive the OAuth device-code flow non-interactively.
 * The `authMethods.terminal-auth.args=['login']` (legacy `_meta` path)
 * advertised by the ACP server points clients at this entry point. The
 * first-class ACP `args=['--login']` path enters the same flow via
 * `echadron acp --login`.
 */

import type { Command } from 'commander';

import { parseKimiRegion, type KimiRegion } from '@yaseenhq/echadron-oauth';

import { runLoginFlow } from './login-flow';

/** Parse a `--region` value; exits with an actionable message on bad input. */
function parseRegionFlag(value: string): KimiRegion {
  const parsed = parseKimiRegion(value);
  if (parsed === undefined) {
    process.stderr.write(`Invalid --region "${value}" (expected "mainland-cn" or "global").\n`);
    process.exit(1);
  }
  return parsed;
}

export function registerLoginCommand(parent: Command): void {
  parent
    .command('login')
    .description('Authenticate with Echadron via the device-code flow.')
    .option(
      '--region <region>',
      'Kimi Code deployment to sign in against: "mainland-cn" or "global".',
      parseRegionFlag,
    )
    .action(async (options: { region?: KimiRegion }) => {
      await runLoginFlow({ region: options.region });
    });
}
