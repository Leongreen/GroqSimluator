/**
 * Adversarial Architecture - Truth > Creativity
 *
 * This module implements the "Trust but Verify" loop that anchors
 * the simulation in reality. A Generator proposes, a Critic inspects.
 *
 * Philosophy: A single AI, no matter how smart, is prone to dreaming.
 * We employ adversarial validation to eliminate hallucination.
 */

import type { ChatCompletionMessageParam } from 'groq-sdk/resources/chat/completions';
import {
  streamWithRetry,
  SIMULATOR_TOOLS,
  CRITIC_TOOLS,
  safeJsonParse,
  MODELS,
  type StreamCallbacks,
  type AccumulatedToolCall,
} from '@/services/groqService';
import { realityEngine, type WorldSituation } from './realityEngine';
import { atomicMemory, type Fact } from '@/memory/atomicMemory';
import type { InferenceMetrics, ValidationResult, ThinkingTrace, WorldEvent, EventType } from '@/types';
import { v4 as uuid } from 'uuid';

// ========== GENERATOR ==========

const GENERATOR_SYSTEM_PROMPT = `You are the REALITY ENGINE for a dark fantasy RPG simulation.

CORE DIRECTIVES:
1. SIMULATION > NARRATION: You simulate physics, not drama. The world exists independently of the player.
2. CONSISTENCY > CREATIVITY: Every statement must be verifiable against established facts.
3. PERMANENCE: Objects, NPCs, and consequences persist. Nothing is forgotten.
4. AGENCY: NPCs have goals, fears, and knowledge. They act rationally based on what THEY know.
5. CAUSALITY: Every effect has a cause. No deus ex machina.

MANDATORY PROTOCOL:
- For EVERY player action, you MUST call log_world_event to record what happened
- For EVERY NPC state change, you MUST call update_npc_state
- After processing events, call draft_response with the narrative the player sees

ANTI-PATTERNS (NEVER DO):
- Do NOT invent items or NPCs not established in the world state
- Do NOT have NPCs know things they haven't witnessed or been told
- Do NOT bend physics for dramatic effect
- Do NOT assume player success - check skills and circumstances
- Do NOT summarize time passage without simulating NPC actions

You are a physics engine, not a storyteller. Simulate, don't narrate.`;

const CRITIC_SYSTEM_PROMPT = `You are the CONSISTENCY ENGINE - a rigorous fact-checker for an RPG simulation.

Your job is to verify that the proposed reality respects established facts and physics.

CHECK FOR:
1. SPATIAL CONSISTENCY: Are entities where they should be? Can the actor reach the target?
2. TEMPORAL CONSISTENCY: Does the timeline make sense? Are causes before effects?
3. KNOWLEDGE CONSISTENCY: Do NPCs only know what they've witnessed or been told?
4. INVENTORY CONSISTENCY: Do characters possess the items they're using?
5. STATE CONSISTENCY: Are health, status, and conditions properly tracked?
6. PHYSICS VIOLATIONS: Is anything impossible happening?

VALIDATION SEVERITY:
- CRITICAL: Contradicts established facts - MUST be rejected
- MAJOR: Breaks physics or causality - should be rejected
- MINOR: Slight inconsistency - can proceed with warning

You must call validation_result with your findings. Be thorough but fair.`;

// ========== TYPES ==========

export interface GeneratorResult {
  narrative: string;
  events: WorldEvent[];
  npcUpdates: NPCUpdate[];
  metrics: InferenceMetrics;
  thinking: ThinkingTrace[];
  toolCalls: AccumulatedToolCall[];
}

export interface NPCUpdate {
  npcId: string;
  currentActivity?: string;
  newKnowledge?: string[];
  goalUpdates?: Array<{ goalId: string; progress: number; isComplete: boolean }>;
  emotionalState?: string;
}

export interface CriticResult {
  validation: ValidationResult;
  metrics: InferenceMetrics;
  thinking: ThinkingTrace[];
}

export interface AdversarialResult {
  finalNarrative: string;
  wasModified: boolean;
  generatorResult: GeneratorResult;
  criticResult: CriticResult;
  resolutionAttempts: number;
  totalMetrics: {
    totalTokens: number;
    totalTime: number;
    averageTPS: number;
  };
}

// ========== GENERATOR ==========

export async function runGenerator(
  playerInput: string,
  worldContext: string,
  callbacks: {
    onThinking?: (trace: ThinkingTrace) => void;
    onToolCall?: (toolCall: AccumulatedToolCall) => void;
    onMetrics?: (metrics: Partial<InferenceMetrics>) => void;
    onContentStream?: (delta: string, accumulated: string) => void;
  } = {}
): Promise<GeneratorResult> {
  const thinkingTraces: ThinkingTrace[] = [];
  const events: WorldEvent[] = [];
  const npcUpdates: NPCUpdate[] = [];
  let narrative = '';

  const messages: ChatCompletionMessageParam[] = [
    { role: 'system', content: GENERATOR_SYSTEM_PROMPT },
    { role: 'user', content: `=== CURRENT WORLD STATE ===\n${worldContext}\n\n=== PLAYER INPUT ===\n${playerInput}` },
  ];

  const streamCallbacks: StreamCallbacks = {
    onContent: (delta, accumulated) => {
      callbacks.onContentStream?.(delta, accumulated);
    },
    onReasoning: (delta, accumulated) => {
      const trace: ThinkingTrace = {
        id: uuid(),
        timestamp: Date.now(),
        phase: 'generator',
        content: accumulated,
        isComplete: false,
      };
      thinkingTraces.push(trace);
      callbacks.onThinking?.(trace);
    },
    onToolCall: (tc) => {
      callbacks.onToolCall?.(tc);
    },
    onMetricsUpdate: (m) => {
      callbacks.onMetrics?.(m);
    },
  };

  const result = await streamWithRetry(
    messages,
    { model: MODELS.FAST, tools: SIMULATOR_TOOLS },
    streamCallbacks
  );

  // Process tool calls
  for (const tc of result.toolCalls) {
    const args = safeJsonParse<Record<string, unknown>>(tc.arguments);
    if (!args) continue;

    switch (tc.name) {
      case 'log_world_event': {
        const event: WorldEvent = {
          id: uuid(),
          turn: realityEngine.getState().currentTurn,
          timestamp: Date.now(),
          type: args.eventType as EventType,
          description: args.description as string,
          locationId: realityEngine.getPlayer()?.locationId ?? null,
          actorId: args.actorId as string,
          targetIds: (args.targetIds as string[]) ?? [],
          stateBefore: {},
          stateAfter: args.stateChanges as Record<string, unknown> ?? {},
          validated: false,
          validatorNotes: '',
          isPublic: (args.isPublic as boolean) ?? true,
          witnessIds: [],
        };
        events.push(event);
        break;
      }

      case 'update_npc_state': {
        const update: NPCUpdate = {
          npcId: args.npcId as string,
          currentActivity: args.currentActivity as string | undefined,
          newKnowledge: args.newKnowledge as string[] | undefined,
          goalUpdates: args.goalUpdates as NPCUpdate['goalUpdates'],
          emotionalState: args.emotionalState as string | undefined,
        };
        npcUpdates.push(update);
        break;
      }

      case 'draft_response': {
        narrative = args.narrative as string;
        break;
      }
    }
  }

  // If no draft_response was called, use any content as narrative
  if (!narrative && result.content) {
    narrative = result.content;
  }

  return {
    narrative,
    events,
    npcUpdates,
    metrics: result.metrics,
    thinking: thinkingTraces,
    toolCalls: result.toolCalls,
  };
}

// ========== CRITIC ==========

export async function runCritic(
  generatorResult: GeneratorResult,
  worldContext: string,
  relevantFacts: Fact[],
  callbacks: {
    onThinking?: (trace: ThinkingTrace) => void;
    onMetrics?: (metrics: Partial<InferenceMetrics>) => void;
  } = {}
): Promise<CriticResult> {
  const thinkingTraces: ThinkingTrace[] = [];

  // Build the proposal for the critic to review
  const proposal = `
=== PROPOSED NARRATIVE ===
${generatorResult.narrative}

=== PROPOSED EVENTS ===
${generatorResult.events.map(e => `- [${e.type}] ${e.description}`).join('\n') || 'No events logged'}

=== PROPOSED NPC UPDATES ===
${generatorResult.npcUpdates.map(u => `- NPC ${u.npcId}: ${u.currentActivity ?? 'no change'}`).join('\n') || 'No NPC updates'}

=== ESTABLISHED FACTS TO CHECK AGAINST ===
${relevantFacts.map(f => `- [${f.subjectType}:${f.subjectId}] ${f.predicate} = ${JSON.stringify(f.value)}`).join('\n') || 'No established facts'}
`;

  const messages: ChatCompletionMessageParam[] = [
    { role: 'system', content: CRITIC_SYSTEM_PROMPT },
    {
      role: 'user',
      content: `=== CURRENT WORLD STATE ===\n${worldContext}\n\n=== PROPOSAL TO VERIFY ===\n${proposal}`,
    },
  ];

  const streamCallbacks: StreamCallbacks = {
    onReasoning: (delta, accumulated) => {
      const trace: ThinkingTrace = {
        id: uuid(),
        timestamp: Date.now(),
        phase: 'critic',
        content: accumulated,
        isComplete: false,
      };
      thinkingTraces.push(trace);
      callbacks.onThinking?.(trace);
    },
    onMetricsUpdate: (m) => {
      callbacks.onMetrics?.(m);
    },
  };

  const result = await streamWithRetry(
    messages,
    { model: MODELS.SMALL, tools: CRITIC_TOOLS },  // Use smaller model for critic (faster)
    streamCallbacks
  );

  // Extract validation result from tool call
  let validation: ValidationResult = {
    isValid: true,
    errors: [],
    warnings: [],
    factsChecked: 0,
    contradictionsFound: 0,
    timestamp: Date.now(),
  };

  for (const tc of result.toolCalls) {
    if (tc.name === 'validation_result') {
      const args = safeJsonParse<Record<string, unknown>>(tc.arguments);
      if (args) {
        validation = {
          isValid: args.isValid as boolean,
          errors: (args.errors as string[]) ?? [],
          warnings: (args.warnings as string[]) ?? [],
          factsChecked: (args.factsChecked as number) ?? 0,
          contradictionsFound: ((args.contradictions as unknown[]) ?? []).length,
          timestamp: Date.now(),
        };
      }
    }
  }

  return {
    validation,
    metrics: result.metrics,
    thinking: thinkingTraces,
  };
}

// ========== ADVERSARIAL LOOP ==========

const MAX_RESOLUTION_ATTEMPTS = 3;

export async function runAdversarialLoop(
  playerInput: string,
  callbacks: {
    onPhaseChange?: (phase: 'generator' | 'critic' | 'resolution') => void;
    onThinking?: (trace: ThinkingTrace) => void;
    onToolCall?: (toolCall: AccumulatedToolCall) => void;
    onMetrics?: (metrics: Partial<InferenceMetrics>) => void;
    onContentStream?: (delta: string, accumulated: string) => void;
    onValidation?: (result: ValidationResult) => void;
  } = {}
): Promise<AdversarialResult> {
  const worldContext = await realityEngine.buildGeneratorContext();
  const allFacts = await atomicMemory.getAllActiveFacts();

  let attempts = 0;
  let generatorResult: GeneratorResult | null = null;
  let criticResult: CriticResult | null = null;
  let totalTokens = 0;
  const startTime = performance.now();

  while (attempts < MAX_RESOLUTION_ATTEMPTS) {
    attempts++;

    // === GENERATOR PHASE ===
    callbacks.onPhaseChange?.('generator');

    const inputWithFeedback = attempts > 1 && criticResult
      ? `${playerInput}\n\n[SYSTEM: Previous attempt was rejected. Errors: ${criticResult.validation.errors.join(', ')}. Please fix and try again.]`
      : playerInput;

    generatorResult = await runGenerator(inputWithFeedback, worldContext, {
      onThinking: callbacks.onThinking,
      onToolCall: callbacks.onToolCall,
      onMetrics: callbacks.onMetrics,
      onContentStream: callbacks.onContentStream,
    });

    totalTokens += generatorResult.metrics.usage?.totalTokens ?? 0;

    // === CRITIC PHASE ===
    callbacks.onPhaseChange?.('critic');

    criticResult = await runCritic(generatorResult, worldContext, allFacts, {
      onThinking: callbacks.onThinking,
      onMetrics: callbacks.onMetrics,
    });

    totalTokens += criticResult.metrics.usage?.totalTokens ?? 0;
    callbacks.onValidation?.(criticResult.validation);

    // If valid, we're done
    if (criticResult.validation.isValid) {
      break;
    }

    // If critical errors persist after max attempts, proceed with warnings
    if (attempts >= MAX_RESOLUTION_ATTEMPTS) {
      console.warn('Adversarial loop exhausted attempts. Proceeding with warnings.');
      break;
    }

    // Otherwise, loop back to generator with feedback
    callbacks.onPhaseChange?.('resolution');
  }

  const endTime = performance.now();
  const totalTime = endTime - startTime;

  // Apply the validated changes to the world
  if (generatorResult) {
    // Log events to memory
    for (const event of generatorResult.events) {
      event.validated = criticResult?.validation.isValid ?? false;
      event.validatorNotes = criticResult?.validation.warnings.join('; ') ?? '';
      await atomicMemory.logEvent(event);
    }

    // Apply NPC updates
    for (const update of generatorResult.npcUpdates) {
      const npc = realityEngine.getNPC(update.npcId);
      if (npc) {
        if (update.currentActivity) npc.currentActivity = update.currentActivity;
        if (update.newKnowledge) {
          for (const knowledge of update.newKnowledge) {
            if (!npc.knowledge.includes(knowledge)) {
              npc.knowledge.push(knowledge);
            }
          }
        }
        if (update.goalUpdates) {
          for (const goalUpdate of update.goalUpdates) {
            const goal = npc.goals.find(g => g.id === goalUpdate.goalId);
            if (goal) {
              goal.progress = goalUpdate.progress;
              goal.isComplete = goalUpdate.isComplete;
            }
          }
        }
      }
    }
  }

  return {
    finalNarrative: generatorResult?.narrative ?? 'The world remains silent.',
    wasModified: attempts > 1,
    generatorResult: generatorResult!,
    criticResult: criticResult!,
    resolutionAttempts: attempts,
    totalMetrics: {
      totalTokens,
      totalTime,
      averageTPS: totalTokens / (totalTime / 1000),
    },
  };
}

// ========== SINGLETON ==========

export const adversarialEngine = {
  runGenerator,
  runCritic,
  runAdversarialLoop,
};
