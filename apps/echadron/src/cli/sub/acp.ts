/**
 * `echadron acp` sub-command.
 *
 * Starts the Agent Client Protocol (ACP) server over stdio so that
 * ACP-compatible clients (editors, IDEs, custom front-ends) can drive
 * an Echadron session.
 *
 * Wire-up:
 *  - A {@link KimiHarness} is constructed with the Echadron host identity
 *    and a dedicated `uiMode: 'acp'`. Hosts that inject a telemetry client
 *    can use that mode to distinguish ACP sessions from the TUI; the CLI ACP
 *    entry point intentionally uses the SDK's no-op telemetry default.
 *  - {@link runAcpServer} owns the JSON-RPC stdio bridge and redirects
 *    rogue `console.*` traffic to stderr.
 *  - `--login` pivots into the device-code login flow instead of
 *    starting the server. This is the entry point ACP clients hit
 *    via the first-class `AuthMethodTerminal` path when they re-invoke
 *    the agent binary with the advertised `args:['--login']` appended.
 *  - On stream close or unhandled error the process exits with the
 *    appropriate code.
 */

import type { Command } from 'commander';

import {
  ACP_BUILTIN_SLASH_COMMANDS,
  runAcpServer,
  type AvailableCommand,
  type SlashCommandsSnapshot,
} from '@yaseenhq/acp-adapter';
import { createKimiHarness, type Session, type SkillSummary } from '@yaseenhq/echadron-sdk';

import {
  ECHADRON_HOME_ENV,
  IMPERIUM_HOME_ENV,
  KIMI_CODE_HOME_ENV,
} from '#/constant/app';
import { createKimiCodeHostIdentity, getVersion } from '#/cli/version';
import { buildSkillSlashCommands } from '#/tui/commands/skills';
import { getDataDir } from '#/utils/paths';

import { isLegacyEnabled } from '../engine-routing';
import { detectAcpProtocol } from './acp-protocol';
import { runNativeAcpServer } from './acp-v2';
import { runLoginFlow } from './login-flow';

export function registerAcpCommand(parent: Command): void {
  parent
    .command('acp')
    .description('Run Echadron as an Agent Client Protocol (ACP) server over stdio.')
    .option(
      '--login',
      'Run the device-code login flow then exit (entry point for ACP terminal-auth).',
      false,
    )
    .action(async (opts: { login?: boolean }) => {
      if (opts.login === true) {
        await runLoginFlow();
        return;
      }
      const detected = await (isLegacyEnabled()
        ? Promise.resolve({ protocol: 'v1' as const, input: process.stdin })
        : detectAcpProtocol(process.stdin)
      ).catch((error: unknown) => {
        process.stderr.write(`acp server: fatal error: ${String(error)}\n`);
        process.exit(1);
        return undefined;
      });
      if (detected === undefined) return;
      if (detected.protocol === 'v2') {
        try {
          await runNativeAcpServer(detected.input);
          process.exit(0);
        } catch (error) {
          process.stderr.write(`acp server: fatal error: ${String(error)}\n`);
          process.exit(1);
        }
        return;
      }
      const identity = createKimiCodeHostIdentity();
      // Capture the caller's home before constructing the harness. Harness
      // startup normalizes environment aliases for legacy SDK consumers; it
      // must not make an unset terminal-auth sandbox appear configured.
      const sandboxHome =
        process.env[ECHADRON_HOME_ENV] ??
        process.env['ECHADRON_CODE_HOME'] ??
        process.env[IMPERIUM_HOME_ENV] ??
        process.env[KIMI_CODE_HOME_ENV];
      const terminalAuthEnv =
        sandboxHome !== undefined && sandboxHome.length > 0
          ? {
              [ECHADRON_HOME_ENV]: sandboxHome,
              ECHADRON_CODE_HOME: sandboxHome,
              [IMPERIUM_HOME_ENV]: sandboxHome,
              [KIMI_CODE_HOME_ENV]: sandboxHome,
            }
          : undefined;
      const harness = createKimiHarness({
        homeDir: getDataDir(),
        identity,
        uiMode: 'acp',
      });
      // Forward the resolved data root into terminal-auth so the login
      // subprocess writes credentials where this ACP server reads them. Send
      // the modern Echadron spelling plus both migration aliases: ACP clients
      // may launch the auth subprocess with a clean environment and older
      // clients may still understand only the historical variable names.
      // Legacy `_meta.terminal-auth` fallback for clients that don't yet
      // honor the first-class `type:'terminal'` (Zed without the
      // AcpBetaFeatureFlag, current JetBrains plugin, etc.). `command` is
      // the absolute path to this very binary (`process.argv[1]`) so the
      // client can spawn it with `args:['login']` for the top-level
      // The top-level login subcommand matches the historical ACP adapter
      // contract (`acp/server.py:77-96`).
      const legacyCommand = process.argv[1];
      const builtinCommands: AvailableCommand[] = (ACP_BUILTIN_SLASH_COMMANDS as readonly AvailableCommand[]).map((cmd) => ({
        name: cmd.name,
        description: cmd.description,
        input: cmd.input,
      }));
      // Skills are session-scoped (per-cwd config), so we defer the
      // listSkills() call until the adapter hands us the just-created
      // Session — mirrors opencode's per-directory snapshot. A
      // listSkills() failure degrades to builtins-only so a broken
      // skill source never blanks the palette.
      const resolveSlashCommands = async (
        session: Session,
      ): Promise<SlashCommandsSnapshot> => {
        let skills: readonly SkillSummary[] = [];
        try {
          skills = await session.listSkills();
        } catch {
          skills = [];
        }
        // `buildSkillSlashCommands` already returns both views — the
        // palette entries (advertised via `available_commands_update`)
        // and the `commandName → skillName` map the adapter uses to
        // intercept `/skill:<name>` inputs and route them to
        // `Session.activateSkill`. Passing both through keeps the two
        // surfaces in lockstep (palette ↔ interceptable set) without
        // a second `listSkills()` round trip.
        const built = buildSkillSlashCommands(skills);
        const skillCommands = built.commands.map((cmd) => ({
          name: cmd.name,
          description: cmd.description,
        }));
        return {
          commands: [...builtinCommands, ...skillCommands],
          skillCommandMap: built.commandMap,
        };
      };
      try {
        await runAcpServer(harness, {
          input: detected.input,
          agentInfo: { name: 'Echadron', version: getVersion() },
          slashCommands: resolveSlashCommands,
          ...(terminalAuthEnv ? { terminalAuthEnv } : {}),
          ...(legacyCommand !== undefined && legacyCommand.length > 0
            ? { terminalAuthLegacyCommand: legacyCommand }
            : {}),
        });
        process.exit(0);
      } catch (error) {
        process.stderr.write(`acp server: fatal error: ${String(error)}\n`);
        process.exit(1);
      }
    });
}
