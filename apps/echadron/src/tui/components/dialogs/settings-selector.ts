import { ChoicePickerComponent, type ChoiceOption } from './choice-picker';

export type SettingsSelection =
  | 'model'
  | 'secondaryModel'
  | 'theme'
  | 'displayMode'
  | 'editor'
  | 'permission'
  | 'experiments'
  | 'upgrade'
  | 'usage';

/** Every selection `/settings` can route to. Exported so tests can assert that
 * no command is hidden from the palette without a settings entry to reach it. */
export const SETTINGS_SELECTION_VALUES = [
  'model',
  'secondaryModel',
  'permission',
  'theme',
  'displayMode',
  'editor',
  'experiments',
  'upgrade',
  'usage',
] as const satisfies readonly SettingsSelection[];

export const SETTINGS_OPTIONS: readonly ChoiceOption[] = [
  {
    value: 'model',
    label: 'Model',
    description: 'Switch the active model and thinking mode.',
  },
  {
    value: 'secondaryModel',
    label: 'Secondary model',
    description: 'Pick the model newly spawned subagents use by default.',
  },
  {
    value: 'permission',
    label: 'Permission',
    description: 'Choose how tool actions are approved.',
  },
  {
    value: 'theme',
    label: 'Theme',
    description: 'Change the terminal UI theme.',
  },
  {
    value: 'displayMode',
    label: 'Display mode',
    description: 'Flow through terminal scrollback, or dock the chrome fullscreen.',
  },
  {
    value: 'editor',
    label: 'Editor',
    description: 'Set the external editor command.',
  },
  {
    value: 'experiments',
    label: 'Feature controls',
    description: 'Manage released feature defaults and rollback controls.',
  },
  {
    value: 'upgrade',
    label: 'Automatic updates',
    description: 'Turn automatic CLI updates on or off.',
  },
  {
    value: 'usage',
    label: 'Usage',
    description: 'Show session tokens, context window, and plan quotas.',
  },
];

/**
 * Derived from `SETTINGS_SELECTION_VALUES` rather than hand-listed. A
 * hardcoded whitelist silently drops any entry added to the menu but missed
 * here — the row renders and selecting it does nothing at all, with no error.
 */
function isSettingsSelection(value: string): value is SettingsSelection {
  return (SETTINGS_SELECTION_VALUES as readonly string[]).includes(value);
}

export interface SettingsSelectorOptions {
  readonly onSelect: (value: SettingsSelection) => void;
  readonly onCancel: () => void;
}

export class SettingsSelectorComponent extends ChoicePickerComponent {
  constructor(opts: SettingsSelectorOptions) {
    super({
      title: 'Settings',
      options: [...SETTINGS_OPTIONS],
      onSelect: (value) => {
        if (isSettingsSelection(value)) opts.onSelect(value);
      },
      onCancel: opts.onCancel,
    });
  }
}
