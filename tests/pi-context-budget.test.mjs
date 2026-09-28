import test from 'node:test';
import assert from 'node:assert/strict';
import { fitToolText, projectedTokens, restoreOutputBudget, validatePairs } from '../factory/pi-context-budget.mjs';

test('wire output uses the pre-clamp caller limit, preserving summary and reasoning caps', () => {
  for (const field of ['max_tokens', 'max_completion_tokens']) {
    const configured = { maxTokens: 16384, compat: { maxTokensField: field }, reasoning: true };
    for (const requested of [8192, 13107, 16384]) {
      const payload = { [field]: 1, reasoning_effort: 'high' };
      restoreOutputBudget(payload, configured, requested, 'high');
      assert.deepEqual(payload, { [field]: requested, reasoning_effort: 'high' });
    }
    const payload = { [field]: 1, reasoning_effort: 'none' };
    restoreOutputBudget(payload, { ...configured, thinkingLevelMap: { off: 'none' } }, 16384, undefined);
    assert.equal(payload.reasoning_effort, 'none');
    assert.equal(payload[field], 16384);
  }
});

test('unsafe output and reasoning overrides fail before projection/transport', () => {
  const configured = { maxTokens: 8192, compat: { maxTokensField: 'max_tokens' }, reasoning: false };
  for (const requested of [0, -1, 8193, 1.5, NaN, Infinity])
    assert.throws(() => restoreOutputBudget({ max_tokens: 1 }, configured, requested), /output budget/);
  for (const payload of [{}, { max_completion_tokens: 1 }, { max_tokens: 1, max_completion_tokens: 1 },
    { max_tokens: 9000 }, { max_tokens: 0 }, { max_tokens: '1' }, { max_tokens: 1.5 }])
    assert.throws(() => restoreOutputBudget(payload, configured, 8192), /output budget/);
  for (const key of ['thinking', 'reasoning', 'thinking_token_budget', 'reasoning_budget', 'chat_template_kwargs', 'chat_template_args', 'enable_thinking'])
    assert.throws(() => restoreOutputBudget({ max_tokens: 1, [key]: { budget_tokens: 1 } }, configured, 8192), /Unsupported local reasoning budget/);
  assert.throws(() => restoreOutputBudget({ max_tokens: 1, reasoning_effort: 'high' }, configured, 8192), /reasoning effort/);
  assert.throws(() => restoreOutputBudget({ max_tokens: 1 }, configured, 8192, 'max'), /reasoning budget/);
});

test('projection bounds UTF-8, escapes, tools and full fixed text without modifying history', () => {
  const messages = [{ role: 'system', content: 'Required policy' }, { role: 'user', content: 'Required task' },
    { role: 'assistant', tool_calls: [{ id: 'read', function: { name: 'read', arguments: '{"path":"original.txt"}' } }, { id: 'write', function: { name: 'write', arguments: '{}' } }] },
    { role: 'tool', tool_call_id: 'read', content: '👩漢字"\\\n'.repeat(10000) },
    { role: 'tool', tool_call_id: 'write', content: 'OK' }];
  const payload = { model: 'fixture', max_tokens: 1024, tools: [{ function: { name: 'read', parameters: { description: 'fixed schema' } } }], messages };
  const snapshot = structuredClone(payload);
  const projected = fitToolText(payload, 14000, projectedTokens);
  assert(projectedTokens(projected) <= 14000);
  assert.deepEqual(payload, snapshot);
  assert.deepEqual(projected.messages.slice(0, 3), snapshot.messages.slice(0, 3));
  assert.deepEqual(projected.tools, snapshot.tools);
  assert.deepEqual(projected.messages[4], snapshot.messages[4]);
  assert.match(projected.messages[3].content, /original UTF-8 bytes.*offset\/limit/s);
  assert(!projected.messages[3].content.includes('\ufffd'));
  validatePairs(projected.messages);
  assert.throws(() => fitToolText(payload, 100, projectedTokens), /cannot fit required instructions/);
});

test('projection rejects oversized fixed arguments instead of deleting the call or user', () => {
  const payload = { messages: [{ role: 'user', content: 'task' }, { role: 'assistant', tool_calls: [{ id: 'a', function: { arguments: 'x'.repeat(20000) } }] }, { role: 'tool', tool_call_id: 'a', content: 'OK' }] };
  assert.throws(() => fitToolText(payload, 16000, projectedTokens), /cannot fit required instructions/);
});

test('request pairing rejects missing, duplicate, orphan and interrupted results', () => {
  const call = { role: 'assistant', tool_calls: [{ id: 'a' }] }, result = { role: 'tool', tool_call_id: 'a', content: 'ok' };
  for (const messages of [[call], [result], [call, result, result], [call, { role: 'user', content: 'interrupt' }, result], [call, result, call, result]])
    assert.throws(() => validatePairs(messages), /tool/);
});
