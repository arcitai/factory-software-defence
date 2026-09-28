// Explicitly mounted Factory adapter, never discovered from the host/repository.
import { readFileSync, writeSync } from 'node:fs';
import { openAICompletionsApi } from '@earendil-works/pi-ai';
import { generateSummaryWithUsage } from '@earendil-works/pi-coding-agent';
import { historyPressure, bytes, fitToolText, projectedTokens, restoreOutputBudget, validatePairs } from './pi-context-budget.mjs';

export default function factoryLocalContext(pi) {
  const registry = JSON.parse(readFileSync(new URL('./models.json', import.meta.url), 'utf8'));
  const configured = registry.providers['factory-local'].models[0];
  const window = configured.contextWindow, output = configured.maxTokens;
  let task, taskEntryId, envelope = 0, recoveries = 0, nextRecovery = 0;
  // Pi catches extension exceptions and can continue. Budget violations must
  // stop before transport, even during summarization, with a durable diagnostic.
  const fatal = error => {
    writeSync(2, `Factory local Pi context protection failed: ${error.message}\n`);
    process.exit(1);
  };
  // Pi 0.87.1's public manual compact() aborts the active run. Use its
  // supported completed-turn compaction draft instead: all tools have finished,
  // and the next request rebuilds the canonical projection from this entry.
  pi.on('turn_end', async (event, ctx) => {
    if (event.outcome !== 'completed' || event.message.stopReason !== 'toolUse') return;
    try {
      const entries = event.context.contextEntries;
      taskEntryId ??= entries.find(entry => entry.messages.some(m => m.role === 'user'))?.sourceEntry.id;
      // Pi includes the system message in its boundary projection. The wire
      // envelope already counts it and the restored task: count each once and
      // use the same basis before/after, so removal cannot fake progress.
      const history = list => list.filter(entry => entry.sourceEntry.id !== taskEntryId)
        .flatMap(entry => entry.messages).filter(message => message.role !== 'system');
      const budget = window - output;
      const threshold = Math.max(Math.floor(budget * 0.65), nextRecovery);
      const pressure = historyPressure(history(entries), envelope);
      if (pressure < threshold) return;
      const starts = entries.flatMap((entry, index) => entry.messages.some(m => m.role === 'assistant'
        && m.content?.some(p => p.type === 'toolCall')) ? [index] : []);
      // The newest complete group is the retention floor, including immutable
      // write arguments. Summarize the older prefix once; after seeing its real
      // size we can retain up to four groups as additional recent evidence.
      // Never split a group or summarize only part of a pending tool batch.
      if (starts.length < 2) return;
      const newest = starts.at(-1);
      const floor = historyPressure(history(entries.slice(newest)), envelope);
      const headroom = Math.min(8192, Math.floor(budget * 0.15));
      // A large current call may leave no useful recovery yet. Let it reach the
      // next ordinary turn under the unchanged wire guard, then it can enter
      // the summarized prefix. Avoid paying for a predictably futile summary.
      if (floor + 1024 > budget - headroom || pressure - floor < 4096) return;
      if (++recoveries > 16) throw new Error('Local Pi proactive recovery limit reached; split the task. No fallback.');
      if (ctx.signal?.aborted) throw new Error('Local Pi proactive recovery cancelled');
      // Pi's summary serializer ignores system messages. Do not charge their
      // bytes against the summary input projection; generation still keeps the
      // exact system envelope. Keep the task and all summarized tool pairs.
      const older = entries.slice(0, newest).flatMap(entry => entry.messages).filter(m => m.role !== 'system');
      writeSync(1, `${JSON.stringify({ type: 'factory_context_recovery', phase: 'start', pressure, threshold, floor, envelope, groups: starts.length, recovery: recoveries })}\n`);
      const input = fitToolText(older, window - output - 8192, bytes, true);
      const result = await generateSummaryWithUsage(input, ctx.model, Math.min(16384, output),
        'factory-local-keyless', undefined, ctx.signal,
        'Preserve the task, verified edits, failed attempts, discoveries and remaining work. Do not claim completion without evidence.',
        undefined, ctx.thinkingLevel, streamLocal, undefined, { enabled: true, maxRetries: 2, baseDelayMs: 250 });
      if (ctx.signal?.aborted) throw new Error('Local Pi proactive recovery cancelled');
      if (!result.text?.trim()) throw new Error('Local Pi proactive recovery returned an empty summary');
      // Include framing for Pi's summary message. A fixed percentage cannot be
      // required below the immutable envelope/newest-group floor. Bound both
      // remaining headroom and actual progress instead, using the real summary.
      const summaryBytes = bytes(result.text) + 1024;
      const target = Math.min(budget - headroom, pressure - 4096,
        Math.max(Math.floor(budget * 0.65 * 0.75), floor + summaryBytes));
      let cut, after;
      for (const candidate of starts.slice(-4)) {
        const candidatePressure = historyPressure(history(entries.slice(candidate)), envelope + summaryBytes);
        if (candidatePressure <= target) { cut = candidate; after = candidatePressure; break; }
      }
      if (cut === undefined) throw new Error('Local Pi proactive recovery did not free enough budget; split the task. No fallback.');
      // Re-arm above the measured retained floor, so a productive large write
      // does not cause an immediate repeat summary with nothing new to reclaim.
      nextRecovery = Math.min(budget - Math.floor(headroom / 2), after + 4096);
      writeSync(1, `${JSON.stringify({ type: 'factory_context_recovery', phase: 'complete', pressure: after, target,
        summaryBytes, keptGroups: starts.filter(index => index >= cut).length, recovery: recoveries })}\n`);
      return { entries: [{ type: 'compaction', summary: result.text,
        firstKeptEntryId: entries[cut].sourceEntry.id, usage: result.usage,
        details: { factoryLocalRecovery: 1 } }] };
    } catch (error) { fatal(error); }
  });
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
  function streamLocal(model, context, options) {
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
            envelope = bytes(payload.tools) + bytes(payload.messages.filter(m => m.role === 'system'))
              + bytes(task) + 4096;
          }
          if (!payload.messages.some(m => m.role === 'user')) throw new Error('Missing required user message');
          // Restore BEFORE measuring so the final output field is counted.
          // No request is sent unless projection fits with the full configured
          // reserve, even when a summary requests a smaller bounded output.
          return fitToolText(payload, window - output, projectedTokens);
        } catch (error) { fatal(error); }
      },
    });
  }
  pi.registerProvider('factory-local', { api: 'openai-completions', streamSimple: streamLocal });
  // Launcher requires this handshake; an extension load failure cannot bypass it.
  writeSync(1, `${JSON.stringify({ type: 'factory_context_ready', version: 1 })}\n`);
}
