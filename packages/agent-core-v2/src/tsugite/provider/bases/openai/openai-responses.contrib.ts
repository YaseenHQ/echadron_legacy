/**
 * `tsugite/provider` domain (L2) — side-effect module: registers the OpenAI
 * Responses base (`id: 'openai_responses'`).
 *
 * Same factory shape as the Chat Completions contrib: endpoint aggregation,
 * `provides` under explicit config, composed headers — and the same
 * `apiKey ?? ''` suppression of the base's `OPENAI_API_KEY` environment
 * fallback once a trait declared an endpoint.
 */

import { registerProtocolBase } from '#/tsugite/protocol/protocolBase';
import { traitConvertError, traitDefaultHeaders } from '#/tsugite/protocol/protocolTrait';

import { getOpenAIResponsesModelCapability, OpenAIResponsesChatProvider } from './openai-responses';
import { compactObject, firstProcessEnv, traitEndpoint, traitProvides } from './openaiHooks';

registerProtocolBase({
  id: 'openai_responses',
  capability: getOpenAIResponsesModelCapability,
  createChatProvider({ config, traits }) {
    const endpoint = traitEndpoint(traits);
    return new OpenAIResponsesChatProvider({
      ...(traitProvides(traits) as Partial<
        ConstructorParameters<typeof OpenAIResponsesChatProvider>[0]
      >),
      model: config.modelName,
      ...compactObject({
        apiKey:
          config.apiKey ??
          firstProcessEnv(endpoint?.apiKeyEnv) ??
          (endpoint === undefined ? undefined : ''),
        baseUrl:
          config.baseUrl ?? firstProcessEnv(endpoint?.baseUrlEnv) ?? endpoint?.defaultBaseUrl,
        defaultHeaders: traitDefaultHeaders(traits),
        maxOutputTokens: config.providerOptions?.defaultMaxTokens,
        offEffort: config.providerOptions?.offEffort,
        generationKwargs: config.providerOptions?.requestBody,
        convertError: traitConvertError(traits),
      }),
    });
  },
});
