import { LifecycleScope, ScopeActivation, registerScopedService } from '#/_base/di/scope';
import { CoreErrors } from '#/_base/errors/codes';
import { Error2 } from '#/_base/errors/errors';
import { IConfigService } from '#/app/config/config';
import { IHostRequestHeaders } from '#/tsugite/model/hostRequestHeaders';

import {
  buildAgentIdentitySnapshot,
  IAgentIdentity,
  type AgentIdentitySnapshot,
} from './agentIdentity';
import { IDENTITY_SECTION, type IdentityConfig } from './configSection';

export class AgentIdentityService implements IAgentIdentity {
  declare readonly _serviceBrand: undefined;

  private snapshot: AgentIdentitySnapshot | undefined;
  private readonly frozen: Promise<AgentIdentitySnapshot>;

  constructor(
    @IConfigService config: IConfigService,
    // Upstream reads these off bootstrap args; here the host's request headers
    // are their own service, so the identity is built from that instead.
    @IHostRequestHeaders hostRequestHeaders: IHostRequestHeaders,
  ) {
    this.frozen = config.ready
      .catch(() => undefined)
      .then(() => {
        const section = config.get<IdentityConfig | undefined>(IDENTITY_SECTION) ?? {};
        this.snapshot = buildAgentIdentitySnapshot({
          name: section.name,
          slug: section.slug,
          hostDisplayName: undefined,
          hostRequestHeaders: hostRequestHeaders.headers,
        });
        return this.snapshot;
      });
  }

  resolved(): Promise<AgentIdentitySnapshot> {
    return this.frozen;
  }

  current(): AgentIdentitySnapshot {
    if (this.snapshot === undefined) {
      throw new Error2(
        CoreErrors.codes.INTERNAL,
        'agent identity read before config load completed',
      );
    }
    return this.snapshot;
  }
}

registerScopedService(
  LifecycleScope.App,
  IAgentIdentity,
  AgentIdentityService,
  ScopeActivation.OnScopeCreated,
  'agentIdentity',
);
