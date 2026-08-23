import { beforeEach, describe, expect, it, vi } from 'vitest';
import { promptOAuthAuthorizationCode } from '#/tui/commands/prompts';
import { openUrl } from '#/utils/open-url';

vi.mock('#/utils/open-url', () => ({ openUrl: vi.fn() }));

interface MountedDialog {
  handleInput(data: string): void;
}

describe('OAuth authorization prompt', () => {
  beforeEach(() => {
    vi.mocked(openUrl).mockReset();
  });

  it('opens the browser and keeps a manual redirect fallback visible', async () => {
    let dialog: MountedDialog | undefined;
    const host = {
      mountEditorReplacement: vi.fn((value: MountedDialog) => {
        dialog = value;
      }),
      restoreEditor: vi.fn(),
    };
    const url =
      'https://auth.openai.com/oauth/authorize?client_id=test&state=expected-state';

    const result = promptOAuthAuthorizationCode(host as never, 'OpenAI Codex', {
      url,
      instructions: 'Complete login in your browser.',
      placeholder: 'http://localhost:1455/auth/callback',
    });

    expect(openUrl).toHaveBeenCalledOnce();
    expect(openUrl).toHaveBeenCalledWith(url);
    expect(dialog).toBeDefined();

    dialog!.handleInput(String.fromCodePoint(27));
    await expect(result).resolves.toBeUndefined();
    expect(host.restoreEditor).toHaveBeenCalledOnce();
  });

  it('still mounts the manual fallback when the browser opener throws', async () => {
    vi.mocked(openUrl).mockImplementationOnce(() => {
      throw new Error('no browser available');
    });
    let dialog: MountedDialog | undefined;
    const host = {
      mountEditorReplacement: vi.fn((value: MountedDialog) => {
        dialog = value;
      }),
      restoreEditor: vi.fn(),
    };

    const result = promptOAuthAuthorizationCode(host as never, 'OpenAI Codex', {
      url: 'https://auth.openai.com/oauth/authorize',
      instructions: 'Complete login in your browser.',
      placeholder: 'http://localhost:1455/auth/callback',
    });

    expect(dialog).toBeDefined();
    dialog!.handleInput(String.fromCodePoint(27));
    await expect(result).resolves.toBeUndefined();
  });
});
