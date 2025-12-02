/**
 * Groq Service - The inference backbone
 *
 * Handles all communication with Groq's LPU-powered API.
 * Implements streaming, tool use accumulation, and metrics tracking.
 */

import Groq from 'groq-sdk';
import type { ChatCompletionMessageParam, ChatCompletionTool } from 'groq-sdk/resources/chat/completions';
import type { InferenceMetrics, TokenUsage } from '@/types';

// API Key from environment variable
// Set VITE_GROQ_API_KEY in your .env file or environment
const getApiKey = (): string => {
  // Try Vite env first, then fallback to window config
  const key = (import.meta as { env?: { VITE_GROQ_API_KEY?: string } }).env?.VITE_GROQ_API_KEY
    || (window as { GROQ_API_KEY?: string }).GROQ_API_KEY
    || '';

  if (!key) {
    console.warn('GROQ API key not configured. Set VITE_GROQ_API_KEY environment variable.');
  }
  return key;
};

// Initialize client for browser execution
const client = new Groq({
  apiKey: getApiKey(),
  dangerouslyAllowBrowser: true,
});

// Available models
export const MODELS = {
  FAST: 'llama-3.3-70b-versatile',
  REASONING: 'deepseek-r1-distill-llama-70b',
  SMALL: 'llama-3.1-8b-instant',
} as const;

export type ModelId = typeof MODELS[keyof typeof MODELS];

// Tool definitions for the RPG simulator
export const SIMULATOR_TOOLS: ChatCompletionTool[] = [
  {
    type: 'function',
    function: {
      name: 'log_world_event',
      description: 'Record an event that occurred in the world. Every action, dialogue, or state change MUST be logged.',
      parameters: {
        type: 'object',
        properties: {
          eventType: {
            type: 'string',
            enum: ['action', 'dialogue', 'observation', 'state_change', 'combat', 'death', 'item_transfer', 'location_change'],
            description: 'The type of event',
          },
          description: {
            type: 'string',
            description: 'A detailed description of what happened',
          },
          actorId: {
            type: 'string',
            description: 'The ID of the entity that initiated this event (or "player")',
          },
          targetIds: {
            type: 'array',
            items: { type: 'string' },
            description: 'IDs of entities affected by this event',
          },
          stateChanges: {
            type: 'object',
            description: 'Key-value pairs of state changes (e.g., {"health": -10})',
          },
          isPublic: {
            type: 'boolean',
            description: 'Whether this event is observable by nearby entities',
          },
        },
        required: ['eventType', 'description', 'actorId'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'update_npc_state',
      description: 'Update an NPC\'s internal state, goals, or knowledge',
      parameters: {
        type: 'object',
        properties: {
          npcId: {
            type: 'string',
            description: 'The ID of the NPC to update',
          },
          currentActivity: {
            type: 'string',
            description: 'What the NPC is currently doing',
          },
          newKnowledge: {
            type: 'array',
            items: { type: 'string' },
            description: 'New facts the NPC has learned',
          },
          goalUpdates: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                goalId: { type: 'string' },
                progress: { type: 'number' },
                isComplete: { type: 'boolean' },
              },
            },
            description: 'Updates to NPC goals',
          },
          emotionalState: {
            type: 'string',
            description: 'The NPC\'s current emotional state',
          },
        },
        required: ['npcId'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'draft_response',
      description: 'Draft the narrative response to show the player. This is the text they will see.',
      parameters: {
        type: 'object',
        properties: {
          narrative: {
            type: 'string',
            description: 'The narrative text describing what the player perceives',
          },
          sensoryDetails: {
            type: 'object',
            properties: {
              visual: { type: 'string' },
              audio: { type: 'string' },
              smell: { type: 'string' },
              tactile: { type: 'string' },
            },
            description: 'Sensory details for immersion',
          },
          availableActions: {
            type: 'array',
            items: { type: 'string' },
            description: 'Suggested actions the player could take',
          },
          threatLevel: {
            type: 'string',
            enum: ['safe', 'cautious', 'dangerous', 'critical'],
            description: 'The current threat level',
          },
        },
        required: ['narrative'],
      },
    },
  },
];

// Critic tools for validation
export const CRITIC_TOOLS: ChatCompletionTool[] = [
  {
    type: 'function',
    function: {
      name: 'validation_result',
      description: 'Report the validation result for the proposed reality',
      parameters: {
        type: 'object',
        properties: {
          isValid: {
            type: 'boolean',
            description: 'Whether the proposed reality is consistent',
          },
          errors: {
            type: 'array',
            items: { type: 'string' },
            description: 'Critical inconsistencies that must be fixed',
          },
          warnings: {
            type: 'array',
            items: { type: 'string' },
            description: 'Minor issues or concerns',
          },
          factsChecked: {
            type: 'number',
            description: 'Number of facts verified against memory',
          },
          contradictions: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                claim: { type: 'string' },
                fact: { type: 'string' },
                severity: { type: 'string', enum: ['minor', 'major', 'critical'] },
              },
            },
            description: 'Specific contradictions found',
          },
        },
        required: ['isValid', 'errors', 'warnings', 'factsChecked'],
      },
    },
  },
];

// Helper to safely parse JSON that might be wrapped in markdown
export function safeJsonParse<T>(text: string): T | null {
  try {
    // Try direct parse first
    return JSON.parse(text);
  } catch {
    // Try extracting from markdown code block
    const jsonMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (jsonMatch) {
      try {
        return JSON.parse(jsonMatch[1].trim());
      } catch {
        return null;
      }
    }
    return null;
  }
}

// Accumulated tool call type
export interface AccumulatedToolCall {
  id: string;
  name: string;
  arguments: string;
}

// Stream result type
export interface StreamResult {
  content: string;
  reasoning: string;
  toolCalls: AccumulatedToolCall[];
  usage: TokenUsage | null;
  metrics: InferenceMetrics;
}

// Callback types for streaming
export interface StreamCallbacks {
  onContent?: (delta: string, accumulated: string) => void;
  onReasoning?: (delta: string, accumulated: string) => void;
  onToolCall?: (toolCall: AccumulatedToolCall) => void;
  onMetricsUpdate?: (metrics: Partial<InferenceMetrics>) => void;
}

/**
 * Stream a chat completion with full metrics tracking
 */
export async function streamCompletion(
  messages: ChatCompletionMessageParam[],
  options: {
    model?: ModelId;
    tools?: ChatCompletionTool[];
    useReasoning?: boolean;
    maxTokens?: number;
  } = {},
  callbacks: StreamCallbacks = {}
): Promise<StreamResult> {
  const model = options.model ?? MODELS.FAST;
  const startTime = performance.now();
  let firstTokenTime: number | null = null;

  const metrics: InferenceMetrics = {
    startTime,
    endTime: null,
    firstTokenTime: null,
    usage: null,
    tokensGenerated: 0,
    chunksReceived: 0,
    tokensPerSecond: 0,
    timeToFirstToken: null,
    totalLatency: null,
    model,
    requestId: null,
  };

  let content = '';
  let reasoning = '';
  const accumulatedToolCalls: Record<number, AccumulatedToolCall> = {};
  let finalUsage: TokenUsage | null = null;

  try {
    // Build request parameters
    const requestParams: Parameters<typeof client.chat.completions.create>[0] = {
      model,
      messages,
      stream: true,
      stream_options: { include_usage: true },
      max_tokens: options.maxTokens ?? 4096,
    };

    // Add tools if provided
    if (options.tools && options.tools.length > 0) {
      requestParams.tools = options.tools;
    }

    // Add reasoning format for supported models
    if (options.useReasoning && model === MODELS.REASONING) {
      (requestParams as Record<string, unknown>).reasoning_format = 'parsed';
    }

    const stream = await client.chat.completions.create(requestParams);

    for await (const chunk of stream) {
      metrics.chunksReceived++;

      // Track first token time
      if (firstTokenTime === null && chunk.choices[0]?.delta?.content) {
        firstTokenTime = performance.now();
        metrics.firstTokenTime = firstTokenTime;
        metrics.timeToFirstToken = firstTokenTime - startTime;
      }

      // Extract usage from final chunk (check both locations)
      if (chunk.usage) {
        finalUsage = {
          promptTokens: chunk.usage.prompt_tokens,
          completionTokens: chunk.usage.completion_tokens,
          totalTokens: chunk.usage.total_tokens,
        };
      }
      // Legacy Groq field
      const xGroq = (chunk as Record<string, unknown>).x_groq as { usage?: { prompt_tokens: number; completion_tokens: number; total_tokens: number } } | undefined;
      if (xGroq?.usage) {
        finalUsage = {
          promptTokens: xGroq.usage.prompt_tokens,
          completionTokens: xGroq.usage.completion_tokens,
          totalTokens: xGroq.usage.total_tokens,
        };
      }

      // Handle content delta
      const contentDelta = chunk.choices[0]?.delta?.content;
      if (contentDelta) {
        content += contentDelta;
        metrics.tokensGenerated++;
        callbacks.onContent?.(contentDelta, content);
      }

      // Handle reasoning delta (for DeepSeek R1 style models)
      const reasoningDelta = (chunk.choices[0]?.delta as Record<string, unknown>)?.reasoning as string | undefined;
      if (reasoningDelta) {
        reasoning += reasoningDelta;
        callbacks.onReasoning?.(reasoningDelta, reasoning);
      }

      // Handle tool calls (accumulate by index)
      const toolCallDeltas = chunk.choices[0]?.delta?.tool_calls;
      if (toolCallDeltas) {
        for (const tc of toolCallDeltas) {
          const idx = tc.index;
          if (!accumulatedToolCalls[idx]) {
            accumulatedToolCalls[idx] = {
              id: tc.id ?? `tool_${idx}`,
              name: tc.function?.name ?? '',
              arguments: '',
            };
          }
          if (tc.function?.name) {
            accumulatedToolCalls[idx].name = tc.function.name;
          }
          if (tc.function?.arguments) {
            accumulatedToolCalls[idx].arguments += tc.function.arguments;
          }
        }
      }

      // Update metrics callback
      const elapsed = (performance.now() - startTime) / 1000;
      metrics.tokensPerSecond = metrics.tokensGenerated / Math.max(elapsed, 0.001);
      callbacks.onMetricsUpdate?.(metrics);
    }

    // Finalize metrics
    const endTime = performance.now();
    metrics.endTime = endTime;
    metrics.totalLatency = endTime - startTime;
    metrics.usage = finalUsage;

    if (finalUsage) {
      metrics.tokensGenerated = finalUsage.completionTokens;
      const elapsed = (endTime - startTime) / 1000;
      metrics.tokensPerSecond = finalUsage.completionTokens / Math.max(elapsed, 0.001);
    }

    // Notify about completed tool calls
    const toolCallsList = Object.values(accumulatedToolCalls);
    for (const tc of toolCallsList) {
      callbacks.onToolCall?.(tc);
    }

    return {
      content,
      reasoning,
      toolCalls: toolCallsList,
      usage: finalUsage,
      metrics,
    };
  } catch (error) {
    // Handle Groq-specific errors
    const groqError = error as { code?: string; message?: string };
    if (groqError.code === 'tool_use_failed' || groqError.code === 'json_validate_failed') {
      console.error(`Groq validation error: ${groqError.code}`, groqError.message);
    }
    throw error;
  }
}

/**
 * Retry wrapper with exponential backoff for transient errors
 */
export async function streamWithRetry(
  messages: ChatCompletionMessageParam[],
  options: Parameters<typeof streamCompletion>[1] = {},
  callbacks: StreamCallbacks = {},
  maxRetries: number = 3
): Promise<StreamResult> {
  let lastError: Error | null = null;

  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      return await streamCompletion(messages, options, callbacks);
    } catch (error) {
      lastError = error as Error;
      const groqError = error as { code?: string };

      // Don't retry validation errors - they need to be fixed
      if (groqError.code === 'tool_use_failed' || groqError.code === 'json_validate_failed') {
        throw error;
      }

      // Exponential backoff for other errors
      if (attempt < maxRetries - 1) {
        const delay = Math.pow(2, attempt) * 1000;
        await new Promise(resolve => setTimeout(resolve, delay));
      }
    }
  }

  throw lastError;
}

export { client };
