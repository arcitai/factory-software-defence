// Explicitly mounted Factory adapter, never discovered from the host/repository.
import { readFileSync, writeSync } from 'node:fs';
import { openAICompletionsApi } from '@earendil-works/pi-ai';
import { bytes, fitToolText, projectedTokens, restoreOutputBudget, validatePairs } from './pi-context-budget.mjs';

export default function factoryLocalContext(pi) {
  const registry = JSON.parse(readFileSync(new URL('./models.json', import.meta.url), 'utf8'));
  const configured = registry.providers['factory-local'].models[0];
  const window = configured.contextWindow, output = configured.maxTokens;
  let task;
  // Pi catches extension exceptions and can continue. Budget violations must
  // stop before transport, even during summarization, with a durable diagnostic.
  const fatal = error => {
    writeSync(2, `Factory local Pi context protection failed: ${error.message}\n`);
    process.exit(1);
  };
  pi.on('session_before_compact', event => {
    try {
      // These are request-local copies. Upstream still selects cut points and
      // generates the summary. Reserve space for its pinned summary templates;
      // the provider wrapper checks the exact serialized request as well.
      const preparation = event.preparation;
      const budget = window - output - 8192 - bytes(preparation.previousSummary || '');
      for (const key of ['messagesToSummarize', 'turnPrefixMessages'])
        preparation[key] = fitToolText(preparation[key], budget, bytes, true);
    } catch (error) { fatal(error); }
  });
  pi.registerProvider('factory-local', {
    api: 'openai-completions',
    streamSimple(model, context, options) {
      if (model.id !== configured.id || model.provider !== 'factory-local') fatal(new Error('Selected local model changed'));
      // Capture before streamSimple/buildBaseOptions clamps against unprojected
      // history. Generation defaults to the binding; summaries supply their cap.
      const requestedOutput = options?.maxTokens ?? output;
      return openAICompletionsApi().streamSimple(model, context, {
        ...options,
        onPayload: async (payload, requestModel) => {
          try {
            payload = await options?.onPayload?.(payload, requestModel) ?? payload;
            payload = structuredClone(payload);
            if (payload.model !== configured.id
              || !payload.messages?.some(m => m.role === 'system')) throw new Error('Unsupported local request structure or output budget');
            restoreOutputBudget(payload, configured, requestedOutput, options?.reasoning);
            if (payload.tools?.length) {
              task ??= structuredClone(payload.messages.find(m => m.role === 'user'));
              if (!task) throw new Error('Missing required task');
              if (!payload.messages.some(m => m.role === 'user' && JSON.stringify(m) === JSON.stringify(task)))
                payload.messages.splice(1, 0, structuredClone(task));
              validatePairs(payload.messages);
            }
            if (!payload.messages.some(m => m.role === 'user')) throw new Error('Missing required user message');
            // Restore BEFORE measuring so the final output field is counted.
            // No request is sent unless projection fits with the full configured
            // reserve, even when a summary requests a smaller bounded output.
            return fitToolText(payload, window - output, projectedTokens);
          } catch (error) { fatal(error); }
        },
      });
    },
  });
  // Launcher requires this handshake; an extension load failure cannot bypass it.
  writeSync(1, `${JSON.stringify({ type: 'factory_context_ready', version: 1 })}\n`);
}
