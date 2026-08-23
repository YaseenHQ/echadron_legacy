import type { AutocompleteItem, SlashCommand } from '@yaseenhq/pi-tui';
import type { FlagId } from '@yaseenhq/echadron-sdk';

export type SlashCommandAvailability = 'always' | 'idle-only';

export interface KimiSlashCommand<Name extends string = string> extends SlashCommand {
  readonly name: Name;
  readonly aliases: readonly string[];
  readonly description: string;
  readonly priority?: number;
  readonly availability?: SlashCommandAvailability | ((args: string) => SlashCommandAvailability);
  /** When set, the command is hidden from the palette and blocked unless this flag is enabled. */
  readonly experimentalFlag?: FlagId;
  /**
   * Keep the command out of the palette and `/help` while leaving it fully
   * usable when typed. Used for settings that are configured once and belong
   * under `/settings`, so the browsable list stays short without breaking
   * anyone's muscle memory or existing scripts.
   */
  readonly hidden?: boolean;
  /**
   * Generic argument autocompletion. `argumentPrefix` is the text typed after
   * `/<command> `; return suggestions or `null`. Declared as a plain function
   * property (not a method) so passing it around is `this`-free. Adapted to
   * pi-tui's `getArgumentCompletions` in the autocomplete setup.
   */
  readonly completeArgs?: (argumentPrefix: string) => AutocompleteItem[] | null;
}

export interface ParsedSlashInput {
  readonly name: string;
  readonly args: string;
}

export type SlashCommandBusyReason = 'streaming' | 'compacting';

export type SlashCommandInvalidReason = 'unknown';
