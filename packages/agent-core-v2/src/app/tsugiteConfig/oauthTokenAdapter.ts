/**
 * `tsugiteConfig` domain (L3) — `IModelOAuthTokens` implementation.
 *
 * Delegates tsugite's OAuth token port to `IOAuthService` and owns the
 * `auth.login_required` error contract (the code is registered by
 * `app/auth/errors`): tsugite's model catalog only sees the port.
 */

import { LifecycleScope, ScopeActivation, registerScopedService } from '#/_base/di/scope';
import { Error2 } from '#/_base/errors/errors';

import { IOAuthService } from '#/app/auth/auth';
import { AuthErrors } from '#/app/auth/errors';
import type { ProviderRequestAuth } from '#/tsugite/contract/provider';
import { nonEmpty } from '#/tsugite/model/modelAuth';
import { IModelOAuthTokens } from '#/tsugite/model/modelOAuth';
import type { OAuthRef } from '#/tsugite/provider/provider';

export class ModelOAuthTokenAdapter implements IModelOAuthTokens {
  declare readonly _serviceBrand: undefined;

  constructor(@IOAuthService private readonly oauth: IOAuthService) {}

  async hasCachedAccessToken(provider: string, oauthRef: OAuthRef): Promise<boolean> {
    try {
      const token = await this.oauth.getCachedAccessToken(provider, oauthRef);
      return nonEmpty(token) !== undefined;
    } catch {
      return false;
    }
  }

  async getRequestAuth(
    provider: string,
    oauthRef: OAuthRef,
    options?: { readonly force?: boolean },
  ): Promise<ProviderRequestAuth> {
    const tokenProvider = this.oauth.resolveTokenProvider(provider, oauthRef);
    if (tokenProvider === undefined) throw loginRequired(provider);
    const refreshOptions = options?.force === true ? { force: true } : undefined;
    const auth =
      tokenProvider.getRequestAuth !== undefined
        ? await tokenProvider.getRequestAuth(refreshOptions)
        : { apiKey: await tokenProvider.getAccessToken(refreshOptions) };
    if (nonEmpty(auth.apiKey) === undefined) throw loginRequired(provider);
    return auth;
  }
}

function loginRequired(providerKey: string): Error2 {
  return new Error2(
    AuthErrors.codes.AUTH_LOGIN_REQUIRED,
    `OAuth provider "${providerKey}" requires login before it can be used.`,
  );
}

registerScopedService(
LifecycleScope.App,
  IModelOAuthTokens,
  ModelOAuthTokenAdapter,
  ScopeActivation.OnScopeCreated,
  'tsugiteConfig',
);
