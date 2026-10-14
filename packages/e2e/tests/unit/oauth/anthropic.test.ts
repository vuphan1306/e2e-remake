import { generateText } from 'ai';
import type { LanguageModelV4 } from '@ai-sdk/provider';
import { describe, expect, it } from 'vitest';
import { claude } from '../../../src/oauth/claude.ts';

interface TestInvocation {
  readonly modelId: string;
  readonly mode: 'text' | 'structured' | 'tools';
  readonly input: string;
  readonly jsonSchema: string | undefined;
}

const testClaude = claude as unknown as (
  modelId: string,
  options: { run: (call: TestInvocation) => Promise<Record<string, unknown>> },
) => LanguageModelV4;

describe('Claude Code subscription model', () => {
  it('serves an AI SDK generateText call through the Claude Code runner', async () => {
    const calls: unknown[] = [];
    const result = await generateText({
      model: testClaude('sonnet', {
        run: async (call) => {
          calls.push(call);
          return {
            result: 'hello',
            stop_reason: 'end_turn',
            uuid: 'message-1',
            total_cost_usd: 0.01,
            usage: { input_tokens: 3, cache_read_input_tokens: 2, output_tokens: 1 },
          };
        },
      }),
      prompt: 'hi',
    });
    expect(result.text).toBe('hello');
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({ modelId: 'sonnet', mode: 'text', jsonSchema: undefined });
    expect(JSON.parse((calls[0] as { input: string }).input)).toMatchObject({
      mode: 'text',
      conversation: [{ role: 'user', content: [{ type: 'text', text: 'hi' }] }],
    });
  });

  it('converts Claude Code structured decisions into AI SDK tool calls', async () => {
    const model = testClaude('haiku', {
      run: async (call) => {
        expect(call.mode).toBe('tools');
        expect(call.jsonSchema).toContain('tool-call');
        const input = JSON.parse(call.input) as { tools: unknown[] };
        expect(input.tools).toEqual([
          { name: 'tap', description: 'Tap one node', inputSchema: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'] } },
        ]);
        return {
          structured_output: { kind: 'tool-call', toolName: 'tap', input: { id: 'n9' } },
          usage: { input_tokens: 5, output_tokens: 2 },
        };
      },
    });
    const result = await model.doGenerate({
      prompt: [{ role: 'user', content: [{ type: 'text', text: 'Tap Login' }] }],
      tools: [{
        type: 'function',
        name: 'tap',
        description: 'Tap one node',
        inputSchema: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'] },
      }],
    });
    expect(result.finishReason.unified).toBe('tool-calls');
    expect(result.content).toEqual([
      expect.objectContaining({ type: 'tool-call', toolName: 'tap', input: '{"id":"n9"}' }),
    ]);
  });

  it('passes the caller schema to Claude Code structured output', async () => {
    const schema = { type: 'object' as const, properties: { ok: { type: 'boolean' as const } }, required: ['ok'] };
    const model = testClaude('sonnet', {
      run: async (call) => {
        expect(JSON.parse(call.jsonSchema ?? '')).toEqual(schema);
        return { structured_output: { ok: true }, usage: { input_tokens: 1, output_tokens: 1 } };
      },
    });
    const result = await model.doGenerate({
      prompt: [{ role: 'user', content: [{ type: 'text', text: 'Judge this' }] }],
      responseFormat: { type: 'json', schema },
    });
    expect(result.content).toEqual([{ type: 'text', text: '{"ok":true}' }]);
  });

  it('constructs an AI SDK v4 model', () => {
    expect(claude('sonnet')).toMatchObject({ provider: 'anthropic.claude-code', modelId: 'sonnet' });
  });
});
