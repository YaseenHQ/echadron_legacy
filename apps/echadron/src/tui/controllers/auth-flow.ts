import { isDeepStrictEqual } from 'node:util';

import { XAI_PROVIDER_NAME } from '@yaseenhq/echadron-oauth';
import {
  DEFAULT_CATALOG_URL,
  fetchCatalog,
  mergeXaiCatalogModels,
  type CreateSessionOptions,
  type KimiHarness,
  type Session,
} from '@yaseenhq/echadron-sdk';

import { refreshModelsDevCatalog } from '#/cli/models/catalog-cache';
import { createKimiCodeUserAgent } from '#/cli/version';

import type { SkillListSession } from '../commands';

import { OAUTH_LOGIN_REQUIRED_STARTUP_NOTICE } from '../constant/kimi-tui';
import {
  refreshAllProviderModels,
  type RefreshProviderScope,
  type RefreshResult,
} from '../utils/refresh-providers';
import { thinkingEffortFromConfig } from '../utils/thinking-config';
import type { SessionEventHandler } from './session-event-handler';
import type { AppState, KimiTUIOptions } from '../types';
import type { TUIState } from '../tui-state';

type MutableCreateSessionOptions = {
  -readonly [P in keyof CreateSessionOptions]: CreateSessionOptions[P];
};

export interface AuthFlowHost {
  state: TUIState;
  session: Session | undefined;
  readonly harness: KimiHarness;
  readonly options: KimiTUIOptions;

  setAppState(patch: Partial<AppState>): void;
  setStartupReady(): void;
  resetSessionRuntime(): void;
  setSession(session: Session): Promise<void>;
  syncRuntimeState(session?: Session): Promise<void>;
  closeSession(reason: string): Promise<void>;
  appendStartupNotice(extra: string): void;
  readonly sessionEventHandler: SessionEventHandler;
  fetchSessions(): Promise<void>;
  updateTerminalTitle(): void;
  refreshSkillCommands(session?: SkillListSession): Promise<void>;
  refreshPluginCommands(session?: Session): Promise<void>;
}

export class AuthFlowController {
  constructor(private readonly host: AuthFlowHost) {}

  async refreshAvailableModels(): Promise<void> {
    const config = await this.host.harness.getConfig({ reload: true });
    this.host.setAppState({
      availableModels: config.models ?? {},
      availableProviders: config.providers ?? {},
    });
  }

  enterLoginRequiredStartupState(): void {
    this.host.resetSessionRuntime();
    this.host.setAppState({
      sessionId: '',
      model: '',
      thinkingEffort: 'off',
      contextTokens: 0,
      maxContextTokens: 0,
      contextUsage: 0,
      sessionTitle: null,
    });
    this.host.appendStartupNotice(OAUTH_LOGIN_REQUIRED_STARTUP_NOTICE);
    this.host.setStartupReady();
  }

  async activateModelAfterLogin(model: string, effort?: string): Promise<void> {
    const { host } = this;
    if (host.session !== undefined) {
      await host.session.setModel(model);
      if (effort !== undefined) {
        await host.session.setThinking(effort);
      }
      return;
    }

    const options: MutableCreateSessionOptions = {
      workDir: host.state.appState.workDir,
      model,
      thinking: effort,
      permission: host.options.startup.auto
        ? 'auto'
        : host.options.startup.yolo
          ? 'yolo'
          : undefined,
      planMode: host.state.appState.planMode ? true : undefined,
      // The post-login session is still the startup session: carry the
      // --agent/--agent-file binding resolved at launch.
      agentProfile: host.options.startup.agentProfile,
      agentFiles: host.options.startup.agentFiles?.length
        ? [...host.options.startup.agentFiles]
        : undefined,
    };
    if (host.state.appState.additionalDirs.length > 0) {
      options.additionalDirs = [...host.state.appState.additionalDirs];
    }
    const session = await host.harness.createSession(options);
    await host.setSession(session);
    host.setAppState({
      sessionId: session.id,
      sessionTitle: session.summary?.title ?? null,
    });
    await host.syncRuntimeState(session);
    host.sessionEventHandler.startSubscription();
    void host.fetchSessions();
    host.updateTerminalTitle();
    void host.refreshSkillCommands(host.session);
    void host.refreshPluginCommands(host.session);
  }

  async clearActiveSessionAfterLogout(): Promise<void> {
    await this.host.closeSession('logged out');
    this.host.resetSessionRuntime();
    this.host.setAppState({
      sessionId: '',
      model: '',
      sessionTitle: null,
    });
    await this.host.refreshSkillCommands();
    await this.host.refreshPluginCommands();
  }

  async refreshConfigAfterLogin(): Promise<void> {
    const { host } = this;
    const config = await host.harness.getConfig({ reload: true });
    const availableModels = config.models ?? {};
    const availableProviders = config.providers ?? {};
    const defaultModel = host.options.startup.model ?? config.defaultModel;
    const selected = defaultModel !== undefined ? availableModels[defaultModel] : undefined;

    if (defaultModel === undefined || selected === undefined) {
      host.setAppState({ availableModels, availableProviders });
      return;
    }

    await this.activateModelAfterLogin(defaultModel, thinkingEffortFromConfig(config.thinking));
    const appStatePatch: Partial<AppState> = {
      availableModels,
      availableProviders,
      model: defaultModel,
      maxContextTokens: selected.maxContextSize,
    };
    host.setAppState(appStatePatch);
  }

  async refreshConfigAfterLogout(): Promise<void> {
    const config = await this.host.harness.getConfig({ reload: true });
    this.host.setAppState({
      availableModels: config.models ?? {},
      availableProviders: config.providers ?? {},
      model: '',
      thinkingEffort: 'off',
      maxContextTokens: 0,
      contextUsage: 0,
      contextTokens: 0,
      usage: undefined,
    });
  }

  /**
   * Re-fetch model lists from every provider whose upstream supports it
   * (managed OAuth, open platforms, custom registries) and update local
   * config.  Runs best-effort: individual provider failures are collected
   * and returned instead of thrown.
   */
  async refreshProviderModels(): Promise<RefreshResult> {
    return this.refreshProviderModelsWithScope('all');
  }

  async refreshOAuthProviderModels(): Promise<RefreshResult> {
    return this.refreshProviderModelsWithScope('oauth');
  }

  private async refreshProviderModelsWithScope(scope: RefreshProviderScope): Promise<RefreshResult> {
    const { host } = this;
    let result = await refreshAllProviderModels(
      {
        getConfig: () => host.harness.getConfig({ reload: true }),
        removeProvider: (id) => host.harness.removeProvider(id),
        setConfig: (patch) => host.harness.setConfig(patch),
        resolveOAuthToken: async (providerName, oauthRef) => {
          const tokenProvider = host.harness.auth.resolveOAuthTokenProvider(providerName, oauthRef);
          return tokenProvider.getAccessToken();
        },
        userAgent: createKimiCodeUserAgent(),
      },
      { scope },
    );
    const xai = await this.refreshXaiCatalogModels();
    if (result.changed.length > 0 || xai.changed) {
      await this.refreshAvailableModels();
    }
    if (xai.changed) {
      result = {
        ...result,
        changed: [
          ...result.changed,
          {
            providerId: XAI_PROVIDER_NAME,
            providerName: 'xAI',
            added: xai.added,
            removed: 0,
          },
        ],
      };
    }
    return result;
  }

  /**
   * Re-import xAI aliases from models.dev. Login writes a snapshot; without
   * this pass, later models (Grok 4.6) never appear in `/model`.
   */
  async refreshXaiCatalogModels(): Promise<{ changed: boolean; added: number }> {
    const { host } = this;
    const config = await host.harness.getConfig({ reload: true });
    if (config.providers?.[XAI_PROVIDER_NAME] === undefined) {
      return { changed: false, added: 0 };
    }
    try {
      const refreshed = await refreshModelsDevCatalog({
        force: true,
        userAgent: createKimiCodeUserAgent(),
      });
      const catalog =
        refreshed.cache.catalog ??
        (await fetchCatalog(DEFAULT_CATALOG_URL, { userAgent: createKimiCodeUserAgent() }));
      const current = config.models ?? {};
      const next = mergeXaiCatalogModels(current, catalog);
      const added = Object.keys(next).filter((alias) => current[alias] === undefined).length;
      if (added === 0 && modelTablesEqual(current, next)) {
        return { changed: false, added: 0 };
      }
      await host.harness.setConfig({ models: next });
      return { changed: true, added };
    } catch {
      return { changed: false, added: 0 };
    }
  }
}

export function modelTablesEqual(
  left: Record<string, unknown>,
  right: Record<string, unknown>,
): boolean {
  return isDeepStrictEqual(left, right);
}
