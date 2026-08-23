export { KimiHarness } from '#/kimi-harness';
export type { KimiHarnessRuntimeOptions } from '#/kimi-harness';
export { Session } from '#/session';
export { KimiAuthFacade } from '#/auth';
export { createKimiHarness, SDKRpcClient, type SDKRpcClientOptions } from '#/sdk-rpc-client';
export {
  createKimiHarnessV2,
  SDKRpcClientV2,
  type SDKRpcClientV2Options,
} from '#/sdk-rpc-client-v2';
export {
  createKimiConfigRpc,
  KimiConfigRpcClient,
  type KimiConfigRpc,
  type KimiConfigValidationIssue,
  type KimiConfigValidationPathSegment,
  type ResolveKimiConfigPathInput,
  type ValidateKimiConfigTomlInput,
} from '#/config-rpc';
export { SDKRpcClientBase } from '#/rpc';
export { KimiForCodingProvider } from '#/kimi-code-model-provider';
export type { KimiForCodingProviderOptions } from '#/kimi-code-model-provider';

export {
  applyCatalogProvider,
  catalogBaseUrl,
  catalogModelToAlias,
  catalogProviderModels,
  CatalogFetchError,
  DEFAULT_CATALOG_URL,
  fetchCatalog,
  inferWireType,
  loadBuiltInCatalog,
  mergeXaiCatalogModels,
  resolveCatalogImport,
  xaiCatalogModelCount,
} from '#/catalog';
export type {
  ApplyCatalogProviderOptions,
  Catalog,
  CatalogImportInvalidReason,
  CatalogImportResolution,
  CatalogModel,
  CatalogProviderEntry,
  CatalogProviderSource,
  FetchCatalogOptions,
} from '#/catalog';

export {
  ErrorCodes,
  KimiError,
  type KimiErrorCode,
  type KimiErrorInfo,
  type KimiErrorOptions,
  type KimiErrorPayload,
  KIMI_ERROR_INFO,
  fromKimiErrorPayload,
  isKimiError,
  toKimiErrorPayload,
} from '@yaseenhq/agent-core';

// Diagnostic logging — public surface only.
// RootLogger / getRootLogger / LoggingConfig stay inside agent-core.
export {
  flushDiagnosticLogs,
  flushDiagnosticLogsSync,
  log,
  redact,
  resolveGlobalLogPath,
  resolveKimiHome,
} from '@yaseenhq/agent-core';
export type { LogContext, LogLevel, LogPayload, Logger } from '@yaseenhq/agent-core';

// Host-side config helpers — safe config reader + config path resolution, used
// by hosts (e.g. the CLI's server telemetry bootstrap) that need to inspect
// config without spinning up a full KimiCore.
export { effectiveModelAlias, loadRuntimeConfigSafe, resolveConfigPath } from '@yaseenhq/agent-core';
export { limitAgentReplayByTurns } from '@yaseenhq/agent-core';
export { parseAgentFileText, resolveAgentPath } from '@yaseenhq/agent-core';
// The synthesized `[models]` alias a `[secondary_model]` recipe with patch
// fields materializes at runtime — hosts filter it out of model pickers.
export { SECONDARY_DERIVED_MODEL_ALIAS } from '@yaseenhq/agent-core';

// Process-wide HTTP proxy bootstrap — installed once at CLI startup so all
// outbound fetch honors HTTP_PROXY / HTTPS_PROXY / NO_PROXY.
export { installGlobalProxyDispatcher } from '@yaseenhq/agent-core';

// Image compression — ingestion sites (e.g. the CLI's clipboard paste, the ACP
// adapter) shrink oversized images while constructing the content part, before
// it enters a prompt. Best effort: returns the original on any failure.
// Compression is never silent: buildImageCompressionCaption renders the note
// placed next to a compressed image, and persistOriginalImage keeps the
// pre-compression bytes readable (ReadMediaFile + region) for detail.
export {
  buildImageCompressionCaption,
  buildUnsupportedImageNotice,
  compressImageForModel,
  compressBase64ForModel,
  gateImageFormatParts,
  isModelAcceptedImageMime,
  normalizeImageMime,
  parseImageDataUrl,
  persistOriginalImage,
  sessionMediaOriginalsDir,
  IMAGE_BYTE_BUDGET,
  MAX_IMAGE_EDGE_PX,
} from '@yaseenhq/agent-core';
export { ImageLimits } from '@yaseenhq/agent-core';
export type {
  CompressImageOptions,
  CompressImageResult,
  CompressBase64Result,
  ImageCompressionCaptionInput,
  ImageCompressionTelemetry,
} from '@yaseenhq/agent-core';

// Experimental feature flags — types only. Resolved values come from
// `KimiHarness.getExperimentalFeatures()` over RPC, not from a re-exported runtime value.
export type {
  ExperimentalFeatureState,
  ExperimentalFlagMap,
  ExperimentalFlagSource,
  FlagDefinition,
  FlagDefinitionInput,
  FlagId,
  FlagSurface,
} from '@yaseenhq/agent-core';

export type {
  KimiAuthCompleteFeedbackUploadInput,
  KimiAuthCompleteFeedbackUploadPart,
  KimiAuthCreateFeedbackUploadUrlInput,
  KimiAuthCreateFeedbackUploadUrlOk,
  KimiAuthCreateFeedbackUploadUrlResult,
  KimiAuthFeedbackUploadPart,
  KimiAuthLoginResult,
  KimiAuthLogoutOptions,
  KimiAuthLogoutResult,
  KimiAuthSubmitFeedbackInput,
} from '#/auth';

export * from '#/events';
export type * from '#/types';
