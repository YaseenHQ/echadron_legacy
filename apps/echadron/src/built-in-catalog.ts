// Filled by tsdown define in release builds. Source stays empty so the
// generated models.dev snapshot is not committed.
declare const __ECHADRON_BUILT_IN_CATALOG__: string | undefined;
declare const __KIMI_CODE_BUILT_IN_CATALOG__: string | undefined;

export const BUILT_IN_CATALOG_JSON: string | undefined =
  typeof __ECHADRON_BUILT_IN_CATALOG__ === 'string'
    ? __ECHADRON_BUILT_IN_CATALOG__
    : typeof __KIMI_CODE_BUILT_IN_CATALOG__ === 'string'
      ? __KIMI_CODE_BUILT_IN_CATALOG__
      : undefined;
