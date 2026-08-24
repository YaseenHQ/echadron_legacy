/**
 * Service name → DI token registry for the in-process dispatcher. Only leaf
 * modules are imported (tokens + types) — never the engine root barrel, so
 * hosting klient in-process does not force the full registration side effects
 * beyond what the host already bootstrapped.
 */

import type { ServiceIdentifier } from '@yaseenhq/agent-core-v2/_base/di/instantiation';
import { ISessionIndex } from '@yaseenhq/agent-core-v2/app/sessionIndex/sessionIndex';
import { IWorkspaceService } from '@yaseenhq/agent-core-v2/app/workspace/workspace';
import { IConfigService } from '@yaseenhq/agent-core-v2/app/config/config';
import { IModelService } from '@yaseenhq/agent-core-v2/tsugite/model/model';
import { IModelCatalog } from '@yaseenhq/agent-core-v2/tsugite/model/catalog';
import { IProviderDiscoveryService } from '@yaseenhq/agent-core-v2/app/tsugiteConfig/discovery';
import { IProviderService } from '@yaseenhq/agent-core-v2/tsugite/provider/provider';
import {
  IAuthSummaryService,
  IOAuthService,
} from '@yaseenhq/agent-core-v2/app/auth/auth';
import { IFlagService } from '@yaseenhq/agent-core-v2/app/flag/flag';
import { IPluginService } from '@yaseenhq/agent-core-v2/app/plugin/plugin';
import { IBootstrapService } from '@yaseenhq/agent-core-v2/app/bootstrap/bootstrap';
import { IEventService } from '@yaseenhq/agent-core-v2/app/event/event';
import { IHostFolderBrowser } from '@yaseenhq/agent-core-v2/app/hostFolderBrowser/hostFolderBrowser';
import { ISessionLifecycleService } from '@yaseenhq/agent-core-v2/app/sessionLifecycle/sessionLifecycle';
import { ISessionMetadata } from '@yaseenhq/agent-core-v2/session/sessionMetadata/sessionMetadata';
import { ISessionInteractionService } from '@yaseenhq/agent-core-v2/session/interaction/interaction';
import { ISessionApprovalService } from '@yaseenhq/agent-core-v2/session/approval/approval';
import { ISessionQuestionService } from '@yaseenhq/agent-core-v2/session/question/question';
import { IAgentRPCService } from '@yaseenhq/agent-core-v2/agent/rpc/rpc';
import { IAgentActivityView } from '@yaseenhq/agent-core-v2/agent/activityView/activityView';
import { IAgentPlanService } from '@yaseenhq/agent-core-v2/agent/plan/plan';
import { IAgentProfileService } from '@yaseenhq/agent-core-v2/agent/profile/profile';
import { IAgentShellCommandService } from '@yaseenhq/agent-core-v2/agent/shellCommand/shellCommand';
import { IAgentTaskService } from '@yaseenhq/agent-core-v2/agent/task/task';
import { IAgentUsageService } from '@yaseenhq/agent-core-v2/agent/usage/usage';

/** Wire service name (decorator id string) → token. */
export const serviceTokens: Readonly<Record<string, ServiceIdentifier<unknown>>> = {
  sessionIndex: ISessionIndex,
  workspaceService: IWorkspaceService,
  configService: IConfigService,
  modelService: IModelService,
  modelResolver: IModelCatalog,
  providerDiscovery: IProviderDiscoveryService,
  providerService: IProviderService,
  oauthService: IOAuthService,
  authSummaryService: IAuthSummaryService,
  flagService: IFlagService,
  pluginService: IPluginService,
  hostFolderBrowser: IHostFolderBrowser,
  bootstrapService: IBootstrapService,
  sessionLifecycleService: ISessionLifecycleService,
  sessionMetadata: ISessionMetadata,
  sessionInteractionService: ISessionInteractionService,
  sessionApprovalService: ISessionApprovalService,
  sessionQuestionService: ISessionQuestionService,
  agentRPCService: IAgentRPCService,
  agentActivityView: IAgentActivityView,
  agentShellCommandService: IAgentShellCommandService,
  agentProfileService: IAgentProfileService,
  agentUsageService: IAgentUsageService,
  agentPlanService: IAgentPlanService,
  agentTaskService: IAgentTaskService,
};

export { IEventService };
