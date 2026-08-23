/**
 * Server telemetry bootstrap — wires agent-core-v2's `CloudAppender` into the
 * App-scoped `ITelemetryService` so web-hosted engine events leave the process.
 * The appender is durable and privacy-filtering, and is attached before any
 * session can be created. The config toggle and both current and legacy
 * environment opt-outs are honored at startup.
 */

import {
  type CloudAppender,
  createCloudAppender,
  IBootstrapService,
  IConfigService,
  type IDisposable,
  IOAuthToolkit,
  ITelemetryService,
  type Scope,
} from '@yaseenhq/agent-core-v2';
import {
  createKimiDeviceId,
  KIMI_CODE_PROVIDER_NAME,
  ECHADRON_DISABLE_TELEMETRY_ENV,
  LEGACY_TELEMETRY_DISABLE_ENV,
} from '@yaseenhq/echadron-oauth';

const SERVER_TELEMETRY_APP_NAME = 'echadron-cli';
const SERVER_TELEMETRY_UI_MODE = 'web';
const DISABLE_VALUES = new Set(['1', 'true', 't', 'yes', 'y']);
const TELEMETRY_SHUTDOWN_TIMEOUT_MS = 3_000;

export interface ServerTelemetry {
  readonly appender?: CloudAppender;
  readonly registration?: IDisposable;
}

function isTelemetryDisabledByEnv(core: Scope): boolean {
  const bootstrap = core.accessor.get(IBootstrapService);
  return [ECHADRON_DISABLE_TELEMETRY_ENV, LEGACY_TELEMETRY_DISABLE_ENV].some((name) => {
    const value = bootstrap.getEnv(name);
    return value !== undefined && DISABLE_VALUES.has(value.trim().toLowerCase());
  });
}

export async function initializeServerTelemetry(
  core: Scope,
  homeDir: string,
): Promise<ServerTelemetry> {
  const config = core.accessor.get(IConfigService);
  await config.ready;
  if (config.get('telemetry') === false || isTelemetryDisabledByEnv(core)) return {};
  const service = core.accessor.get(ITelemetryService);
  const bootstrap = core.accessor.get(IBootstrapService);

  const auth = core.accessor.get(IOAuthToolkit);
  const appender = createCloudAppender(core.accessor, {
    deviceId: createKimiDeviceId(homeDir),
    appName: SERVER_TELEMETRY_APP_NAME,
    uiMode: SERVER_TELEMETRY_UI_MODE,
    model: config.get<string>('defaultModel') ?? undefined,
    getAccessToken: async () =>
      (await auth.getCachedAccessToken(KIMI_CODE_PROVIDER_NAME)) ?? null,
    endpoint:
      bootstrap.getEnv('ECHADRON_TELEMETRY_ENDPOINT') ??
      bootstrap.getEnv('KIMI_TELEMETRY_ENDPOINT'),
  });
  const registration = service.addAppender(appender);
  try {
    // The server is long-lived: flush on a timer, not only at the threshold.
    appender.startPeriodicFlush();
  } catch (error) {
    registration.dispose();
    throw error;
  }
  return { appender, registration };
}

export async function shutdownServerTelemetry(
  telemetry: ServerTelemetry,
  deadlineMs = Date.now() + TELEMETRY_SHUTDOWN_TIMEOUT_MS,
): Promise<void> {
  telemetry.registration?.dispose();
  if (telemetry.appender === undefined) return;
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([
      telemetry.appender.shutdown(),
      new Promise<void>((resolve) => {
        timer = setTimeout(resolve, Math.max(0, deadlineMs - Date.now()));
      }),
    ]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}
