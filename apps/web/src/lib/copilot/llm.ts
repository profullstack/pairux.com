import Anthropic from '@anthropic-ai/sdk';
import { betaZodOutputFormat } from '@anthropic-ai/sdk/helpers/beta/zod';
import { z } from 'zod/v4';
import type { CopilotAccounts } from './account';
import { chargeMicros, claudeCostMicros } from './pricing';
import {
  Cooldowns,
  endpoint,
  providerChain,
  stepLabel,
  type ProviderContext,
  type ProviderStep,
} from './providers';

/** Free default: an open model behind Ollama's OpenAI-compatible API. */
const LOCAL_LLM_URL = () => endpoint(process.env.COPILOT_LLM_URL, 'http://127.0.0.1:11434/v1');
const LOCAL_LLM_MODEL = () => process.env.COPILOT_LLM_MODEL ?? 'qwen2.5:7b';
/** Paid cloud model (ours on PAYG, or the owner's Anthropic key). */
export const COPILOT_CLOUD_MODEL = process.env.COPILOT_CLOUD_MODEL ?? 'claude-opus-5-5';
const OPENAI_MODEL = process.env.COPILOT_OPENAI_MODEL ?? 'gpt-5.4';

export interface LlmRequest<T> {
  /** Short name for the schema (logs, OpenAI's json_schema name). */
  name: string;
  system: string;
  prompt: string;
  schema: z.ZodType<T>;
  maxTokens?: number;
  /** The local model gets this long before the next provider is tried. */
  localTimeoutMs?: number;
}
export interface LlmResult<T> {
  data: T;
  /** e.g. "qwen2.5:7b (free, self-hosted)". */
  provider: string;
}

export class CopilotLlmError extends Error {
  constructor(
    message: string,
    readonly problems: string[]
  ) {
    super(message);
  }
}

/**
 * The schema with every string and array bounded. A grammar-constrained local
 * model must then close each field: without bounds a small model will write a
 * thirty-question "suggestion" until it runs out of tokens. Existing bounds and
 * enums are kept.
 */
export function boundSchema(
  schema: unknown,
  bounds: { maxLength: number; maxItems: number } = { maxLength: 240, maxItems: 8 }
): unknown {
  if (Array.isArray(schema)) return schema.map((one) => boundSchema(one, bounds));
  if (!schema || typeof schema !== 'object') return schema;
  const node: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(schema)) node[key] = boundSchema(value, bounds);
  if (node.type === 'string' && !('enum' in node) && node.maxLength === undefined)
    node.maxLength = bounds.maxLength;
  if (node.type === 'array' && node.maxItems === undefined) node.maxItems = bounds.maxItems;
  return node;
}

/** Pull the JSON object out of a chat reply (models sometimes fence it). */
export function extractJson(text: string): unknown {
  const fenced = /```(?:json)?\s*([\s\S]*?)```/.exec(text);
  const body = (fenced?.[1] ?? text).trim();
  const start = body.indexOf('{');
  const end = body.lastIndexOf('}');
  if (start < 0 || end < start) throw new Error('The model did not answer with JSON.');
  return JSON.parse(body.slice(start, end + 1)) as unknown;
}

export class CopilotLlm {
  private readonly cooldowns = new Cooldowns();
  private readonly clients = new Map<string, Anthropic>();

  constructor(
    private readonly accounts: CopilotAccounts,
    private readonly fetchImpl: typeof fetch = fetch
  ) {}

  steps(ctx: ProviderContext): ProviderStep[] {
    const own: ('anthropic' | 'openai')[] = [];
    if (ctx.keys.anthropic) own.push('anthropic');
    if (ctx.keys.openai) own.push('openai');
    return providerChain(ctx.mode, {
      local: Boolean(LOCAL_LLM_URL()),
      own,
      ours: process.env.ANTHROPIC_API_KEY && !ctx.keysLocked ? 'anthropic' : null,
    });
  }

  private anthropic(key: string | undefined): Anthropic {
    const id = key ?? 'ours';
    let client = this.clients.get(id);
    if (!client) {
      client = key ? new Anthropic({ apiKey: key }) : new Anthropic();
      this.clients.set(id, client);
    }
    return client;
  }

  async run<T>(ctx: ProviderContext, request: LlmRequest<T>): Promise<LlmResult<T>> {
    const problems: string[] = [];
    for (const step of this.steps(ctx)) {
      const key = step.kind === 'local' ? 'local' : `${step.kind}:${step.provider}:${ctx.userId}`;
      if (this.cooldowns.down(key)) continue;
      try {
        if (
          step.kind === 'ours' &&
          !ctx.admin &&
          (await this.accounts.balanceMicros(ctx.userId)) <= 0
        ) {
          problems.push('Pay-as-you-go AI needs copilot credit.');
          continue;
        }
        const result = await this.call(ctx, step, request);
        this.cooldowns.ok(key);
        return result;
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        problems.push(message);
        const status = (error as { status?: number }).status;
        this.cooldowns.fail(key, status === 401 || status === 403 ? 600_000 : 60_000);
        console.warn(
          JSON.stringify({
            event: 'copilot_llm_failed',
            step: key.split(':').slice(0, 2).join(':'),
            name: request.name,
            error: message.slice(0, 200),
          })
        );
      }
    }
    throw new CopilotLlmError(problems[0] ?? 'No AI model is available for the copilot.', problems);
  }

  private async call<T>(
    ctx: ProviderContext,
    step: ProviderStep,
    request: LlmRequest<T>
  ): Promise<LlmResult<T>> {
    if (step.kind === 'local') {
      const model = LOCAL_LLM_MODEL();
      const data = await this.openAiCompatible(request, {
        url: LOCAL_LLM_URL() ?? '',
        model,
        apiKey: process.env.COPILOT_LLM_KEY,
        timeoutMs: request.localTimeoutMs ?? 45_000,
        bounded: true,
      });
      return { data, provider: stepLabel(step, model) };
    }
    if (step.provider === 'openai') {
      const data = await this.openAiCompatible(request, {
        url: 'https://api.openai.com/v1',
        model: OPENAI_MODEL,
        apiKey: ctx.keys.openai,
        timeoutMs: 30_000,
      });
      return { data, provider: stepLabel(step, OPENAI_MODEL) };
    }
    // Claude: the owner's key, or ours on pay as you go.
    const own = step.kind === 'own';
    const response = await this.anthropic(own ? ctx.keys.anthropic : undefined).beta.messages.parse(
      {
        model: COPILOT_CLOUD_MODEL,
        max_tokens: request.maxTokens ?? 4000,
        betas: ['server-side-fallback-2026-07-01'],
        fallbacks: 'default',
        output_config: { effort: 'low', format: betaZodOutputFormat(request.schema) },
        system: request.system,
        messages: [{ role: 'user', content: request.prompt }],
      },
      { timeout: 45_000, maxRetries: 1 }
    );
    if (!own && !ctx.admin) {
      const cost = claudeCostMicros(
        response.model,
        response.usage.input_tokens,
        response.usage.output_tokens
      );
      await this.accounts.charge({
        userId: ctx.userId,
        sessionId: ctx.sessionId,
        provider: `anthropic:${response.model}`,
        kind: 'llm',
        units: response.usage.input_tokens + response.usage.output_tokens,
        costMicros: cost,
        chargeMicros: chargeMicros(cost),
      });
    }
    if (response.stop_reason === 'refusal') throw new Error('The model declined this request.');
    const parsed = response.parsed_output;
    if (!parsed) throw new Error('The model returned no structured output.');
    return { data: parsed as T, provider: stepLabel(step, response.model) };
  }

  /** Chat completions with a JSON schema (Ollama, OpenAI), validated with zod. */
  private async openAiCompatible<T>(
    request: LlmRequest<T>,
    target: {
      url: string;
      model: string;
      apiKey?: string | undefined;
      timeoutMs: number;
      /** Bound strings and arrays in the schema (local grammar-constrained models). */
      bounded?: boolean;
    }
  ): Promise<T> {
    const schema = z.toJSONSchema(request.schema);
    const response = await this.fetchImpl(`${target.url}/chat/completions`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        ...(target.apiKey ? { authorization: `Bearer ${target.apiKey}` } : {}),
      },
      body: JSON.stringify({
        model: target.model,
        messages: [
          { role: 'system', content: `${request.system}\n\nAnswer with one JSON object only.` },
          { role: 'user', content: request.prompt },
        ],
        response_format: {
          type: 'json_schema',
          json_schema: {
            name: request.name,
            schema: target.bounded ? boundSchema(schema) : schema,
          },
        },
        max_tokens: request.maxTokens ?? 2000,
        stream: false,
      }),
      signal: AbortSignal.timeout(target.timeoutMs),
    });
    if (!response.ok) {
      const detail = (await response.text().catch(() => '')).slice(0, 200);
      throw Object.assign(
        new Error(`${target.model} failed (${String(response.status)}) ${detail}`.trim()),
        {
          status: response.status,
        }
      );
    }
    const body = (await response.json()) as {
      choices?: { message?: { content?: string }; finish_reason?: string }[];
    };
    const choice = body.choices?.[0];
    const content = choice?.message?.content ?? '';
    if (process.env.COPILOT_DEBUG) console.info(`[copilot] ${target.model} said:`, content);
    if (choice?.finish_reason === 'length')
      throw new Error(`${target.model} ran out of room before finishing its answer.`);
    const parsed = request.schema.safeParse(extractJson(content));
    if (!parsed.success) throw new Error(`${target.model} answered in the wrong shape.`);
    return parsed.data;
  }
}
