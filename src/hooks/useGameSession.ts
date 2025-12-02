/**
 * Game Session Hook - Core game state management
 *
 * Manages the game session, world state, and orchestrates
 * the adversarial loop for player actions.
 */

import { useState, useCallback, useRef, useEffect } from 'react';
import { v4 as uuid } from 'uuid';
import { realityEngine, type WorldScenario } from '@/engine/realityEngine';
import { adversarialEngine } from '@/engine/adversarialEngine';
import { atomicMemory } from '@/memory/atomicMemory';
import type {
  WorldState,
  InferenceMetrics,
  ValidationResult,
  ThinkingTrace,
} from '@/types';
import type { AccumulatedToolCall } from '@/services/groqService';
import type { TerminalMessage } from '@/components/TerminalOutput';

// ========== TYPES ==========

export interface GameSessionState {
  isInitialized: boolean;
  isProcessing: boolean;
  worldState: WorldState | null;
  messages: TerminalMessage[];
  streamingContent: string;
  thinkingTraces: ThinkingTrace[];
  toolCalls: AccumulatedToolCall[];
  currentMetrics: InferenceMetrics | null;
  lastValidation: ValidationResult | null;
  currentPhase: 'idle' | 'generator' | 'critic' | 'resolution';
  sessionStats: SessionStats;
  error: string | null;
}

export interface SessionStats {
  totalTurns: number;
  totalTokens: number;
  averageTPS: number;
  validationPassRate: number;
  sessionStartTime: number;
}

// ========== DEFAULT SCENARIO ==========

const createDefaultScenario = (): WorldScenario => {
  const playerLocationId = uuid();
  const tavernId = uuid();
  const marketId = uuid();
  const forestId = uuid();
  const playerId = uuid();
  const bartenderId = uuid();
  const merchantId = uuid();
  const strangerNpcId = uuid();
  const swordId = uuid();
  const potionId = uuid();

  return {
    name: 'The Realm of Shadows',
    player: {
      id: playerId,
      name: 'Traveler',
      description: 'A weary traveler seeking fortune and adventure.',
      locationId: playerLocationId,
      properties: {},
      createdAt: Date.now(),
      isAlive: true,
      health: 100,
      maxHealth: 100,
      level: 1,
      experience: 0,
      inventory: [],
      knownLocations: [playerLocationId],
      activeQuests: [],
      skills: {
        combat: 10,
        stealth: 5,
        persuasion: 8,
        survival: 7,
      },
    },
    locations: [
      {
        id: playerLocationId,
        name: 'Town Square',
        description: 'The central square of Ravenmoor. Cobblestones worn smooth by centuries of foot traffic. A fountain stands silent in the center, its water long since dried up. Buildings with dark windows loom around the perimeter.',
        properties: { population: 'sparse', atmosphere: 'tense' },
        connections: [
          { direction: 'north', targetId: tavernId, isLocked: false },
          { direction: 'east', targetId: marketId, isLocked: false },
          { direction: 'west', targetId: forestId, isLocked: false },
        ],
        isOutdoor: true,
        lightLevel: 0.7,
        dangerLevel: 2,
      },
      {
        id: tavernId,
        name: 'The Rusted Nail Tavern',
        description: 'A dimly lit establishment that has seen better days. The smell of stale ale and woodsmoke hangs heavy in the air. A few patrons huddle at worn tables, speaking in hushed tones.',
        properties: { warmth: 'moderate', noise: 'quiet' },
        connections: [
          { direction: 'south', targetId: playerLocationId, isLocked: false },
        ],
        isOutdoor: false,
        lightLevel: 0.4,
        dangerLevel: 1,
      },
      {
        id: marketId,
        name: 'Abandoned Market',
        description: 'Empty stalls line the street, their awnings tattered and faded. Whatever goods were once sold here have long since vanished. The wind whistles through broken crates.',
        properties: { state: 'abandoned' },
        connections: [
          { direction: 'west', targetId: playerLocationId, isLocked: false },
        ],
        isOutdoor: true,
        lightLevel: 0.8,
        dangerLevel: 3,
      },
      {
        id: forestId,
        name: 'Edge of the Dark Forest',
        description: 'Ancient trees rise like twisted columns, their branches blocking out most light. Strange sounds echo from deeper within. Few who enter return unchanged.',
        properties: { atmosphere: 'ominous' },
        connections: [
          { direction: 'east', targetId: playerLocationId, isLocked: false },
        ],
        isOutdoor: true,
        lightLevel: 0.2,
        dangerLevel: 7,
      },
    ],
    npcs: [
      {
        id: bartenderId,
        name: 'Grigor',
        description: 'A grizzled bartender with a missing eye and hands scarred from old burns. He speaks little but sees everything.',
        locationId: tavernId,
        properties: { occupation: 'bartender' },
        createdAt: Date.now(),
        isAlive: true,
        health: 80,
        maxHealth: 80,
        level: 3,
        goals: [
          { id: uuid(), description: 'Keep the tavern running', priority: 1, progress: 0.5, isComplete: false },
          { id: uuid(), description: 'Protect his secret', priority: 2, progress: 0, isComplete: false },
        ],
        fears: ['fire', 'the shadows that took his eye'],
        knowledge: [
          'The merchant Vex deals in more than trinkets',
          'Strangers have been disappearing from the forest road',
          'The old well in the square was sealed for a reason',
        ],
        personality: {
          aggression: 0.2,
          curiosity: 0.3,
          loyalty: 0.7,
          greed: 0.4,
          courage: 0.6,
        },
        currentActivity: 'cleaning glasses',
        schedule: {
          6: 'waking up',
          7: 'opening tavern',
          8: 'serving breakfast',
          12: 'serving lunch',
          18: 'busy with dinner crowd',
          22: 'closing tavern',
          23: 'sleeping',
        },
        inventory: [],
        memoryIds: [],
        lastSeenPlayer: null,
        lastKnownPlayerLocation: null,
      },
      {
        id: merchantId,
        name: 'Vex',
        description: 'A thin man with quick eyes and quicker hands. His smile never reaches his eyes. He seems to know more than he should.',
        locationId: marketId,
        properties: { occupation: 'merchant' },
        createdAt: Date.now(),
        isAlive: true,
        health: 60,
        maxHealth: 60,
        level: 2,
        goals: [
          { id: uuid(), description: 'Acquire rare artifacts', priority: 1, progress: 0.3, isComplete: false },
          { id: uuid(), description: 'Expand his network', priority: 2, progress: 0.2, isComplete: false },
        ],
        fears: ['the authorities', 'losing his connections'],
        knowledge: [
          'There is an entrance to the old tunnels beneath the market',
          'The stranger at the edge of town is looking for something valuable',
          'Blood magic has been practiced in the forest recently',
        ],
        personality: {
          aggression: 0.3,
          curiosity: 0.8,
          loyalty: 0.1,
          greed: 0.9,
          courage: 0.4,
        },
        currentActivity: 'examining his wares',
        schedule: {
          8: 'setting up stall',
          12: 'conducting business',
          18: 'packing up',
          20: 'meeting contacts',
          23: 'sleeping',
        },
        inventory: [potionId],
        memoryIds: [],
        lastSeenPlayer: null,
        lastKnownPlayerLocation: null,
      },
      {
        id: strangerNpcId,
        name: 'The Hooded Stranger',
        description: 'A figure cloaked in shadow, face hidden beneath a deep hood. They watch the town from a distance, never speaking to anyone.',
        locationId: forestId,
        properties: { role: 'mysterious' },
        createdAt: Date.now(),
        isAlive: true,
        health: 150,
        maxHealth: 150,
        level: 8,
        goals: [
          { id: uuid(), description: 'Find the artifact hidden in Ravenmoor', priority: 1, progress: 0.1, isComplete: false },
          { id: uuid(), description: 'Remain undetected', priority: 2, progress: 0.8, isComplete: false },
        ],
        fears: ['exposure', 'failure'],
        knowledge: [
          'An ancient power sleeps beneath this town',
          'The sealed well is a gateway',
          'The bartender Grigor knows more than he admits',
        ],
        personality: {
          aggression: 0.5,
          curiosity: 0.4,
          loyalty: 0.2,
          greed: 0.3,
          courage: 0.9,
        },
        currentActivity: 'watching the town',
        schedule: {
          0: 'investigating',
          6: 'retreating to forest',
          20: 'approaching town edge',
        },
        inventory: [swordId],
        memoryIds: [],
        lastSeenPlayer: null,
        lastKnownPlayerLocation: null,
      },
    ],
    items: [
      {
        id: swordId,
        name: 'Darksteel Blade',
        description: 'A sword forged from metal that seems to drink in light. Strange runes pulse faintly along its edge.',
        locationId: null,
        properties: { damage: 25, magical: true },
        createdAt: Date.now(),
        isAlive: true,
        weight: 3.5,
        value: 500,
        isConsumable: false,
        ownerId: strangerNpcId,
      },
      {
        id: potionId,
        name: 'Suspicious Vial',
        description: 'A small glass vial containing a viscous purple liquid. The label has been scratched off.',
        locationId: null,
        properties: { effect: 'unknown' },
        createdAt: Date.now(),
        isAlive: true,
        weight: 0.2,
        value: 30,
        isConsumable: true,
        ownerId: merchantId,
      },
    ],
    relationships: [
      {
        id: uuid(),
        sourceId: bartenderId,
        targetId: merchantId,
        type: 'neutral',
        strength: -0.2,
        description: 'Grigor distrusts Vex but tolerates his presence.',
        establishedAt: Date.now(),
      },
      {
        id: uuid(),
        sourceId: strangerNpcId,
        targetId: playerId,
        type: 'neutral',
        strength: 0,
        description: 'The stranger has not yet formed an opinion of the traveler.',
        establishedAt: Date.now(),
      },
    ],
  };
};

// ========== HOOK ==========

export function useGameSession() {
  const [state, setState] = useState<GameSessionState>({
    isInitialized: false,
    isProcessing: false,
    worldState: null,
    messages: [],
    streamingContent: '',
    thinkingTraces: [],
    toolCalls: [],
    currentMetrics: null,
    lastValidation: null,
    currentPhase: 'idle',
    sessionStats: {
      totalTurns: 0,
      totalTokens: 0,
      averageTPS: 0,
      validationPassRate: 1.0,
      sessionStartTime: Date.now(),
    },
    error: null,
  });

  const validationCountRef = useRef({ passed: 0, total: 0 });

  // Initialize game
  const initializeGame = useCallback(async () => {
    try {
      // Initialize memory system
      await atomicMemory.initialize();

      // Create or load session
      const sessions = await atomicMemory.listSessions();
      if (sessions.length === 0) {
        await atomicMemory.createSession('Default Session', uuid());
      }

      // Initialize world
      const scenario = createDefaultScenario();
      const worldState = await realityEngine.initializeWorld(scenario);

      // Add welcome message
      const welcomeMessage: TerminalMessage = {
        id: uuid(),
        type: 'system',
        content: `═══════════════════════════════════════════════════════════════
    GROQ RPG SIMULATOR — REALITY ENGINE v0.1.0
═══════════════════════════════════════════════════════════════

Welcome to ${scenario.name}.

You stand in the ${worldState.locations[Object.keys(worldState.locations)[0]]?.name || 'unknown location'}.

The world awaits your actions. Type your commands below.
Remember: This is a simulation, not a story. The world does not
bend to your will — it responds to your choices.

═══════════════════════════════════════════════════════════════`,
        timestamp: Date.now(),
      };

      // Add initial situation
      const situation = realityEngine.getCurrentSituation();
      const situationMessage: TerminalMessage = {
        id: uuid(),
        type: 'narrative',
        content: `${situation.description}

You see: ${situation.nearbyItems.map(i => i.name).join(', ') || 'nothing of interest'}
Exits: ${situation.exits.map(e => e.direction).join(', ') || 'none visible'}

The air is ${situation.weather}. It is ${formatWorldTime(situation.time)}.`,
        timestamp: Date.now(),
      };

      setState(prev => ({
        ...prev,
        isInitialized: true,
        worldState,
        messages: [welcomeMessage, situationMessage],
        sessionStats: {
          ...prev.sessionStats,
          sessionStartTime: Date.now(),
        },
      }));
    } catch (error) {
      setState(prev => ({
        ...prev,
        error: `Failed to initialize: ${error}`,
      }));
    }
  }, []);

  // Process player input
  const processInput = useCallback(async (input: string) => {
    if (!state.isInitialized || state.isProcessing) return;

    // Add player message
    const playerMessage: TerminalMessage = {
      id: uuid(),
      type: 'player',
      content: input,
      timestamp: Date.now(),
    };

    setState(prev => ({
      ...prev,
      isProcessing: true,
      messages: [...prev.messages, playerMessage],
      streamingContent: '',
      thinkingTraces: [],
      toolCalls: [],
      currentMetrics: null,
      lastValidation: null,
      error: null,
    }));

    try {
      // Run adversarial loop
      const result = await adversarialEngine.runAdversarialLoop(input, {
        onPhaseChange: (phase) => {
          setState(prev => ({ ...prev, currentPhase: phase }));
        },
        onThinking: (trace) => {
          setState(prev => ({
            ...prev,
            thinkingTraces: [...prev.thinkingTraces.filter(t => t.id !== trace.id), trace],
          }));
        },
        onToolCall: (tc) => {
          setState(prev => ({
            ...prev,
            toolCalls: [...prev.toolCalls, tc],
          }));
        },
        onMetrics: (metrics) => {
          setState(prev => ({
            ...prev,
            currentMetrics: { ...prev.currentMetrics, ...metrics } as InferenceMetrics,
          }));
        },
        onContentStream: (delta, accumulated) => {
          setState(prev => ({ ...prev, streamingContent: accumulated }));
        },
        onValidation: (validation) => {
          setState(prev => ({ ...prev, lastValidation: validation }));
          validationCountRef.current.total++;
          if (validation.isValid) {
            validationCountRef.current.passed++;
          }
        },
      });

      // End turn
      await realityEngine.endTurn();

      // Update state with result
      const narrativeMessage: TerminalMessage = {
        id: uuid(),
        type: 'narrative',
        content: result.finalNarrative,
        timestamp: Date.now(),
      };

      // Add world events
      const eventMessages: TerminalMessage[] = result.generatorResult.events.map(e => ({
        id: uuid(),
        type: 'world-event' as const,
        content: `[${e.type.toUpperCase()}] ${e.description}`,
        timestamp: Date.now(),
      }));

      setState(prev => {
        const newTotalTokens = prev.sessionStats.totalTokens + result.totalMetrics.totalTokens;
        const elapsed = (Date.now() - prev.sessionStats.sessionStartTime) / 1000;
        const { passed, total } = validationCountRef.current;

        return {
          ...prev,
          isProcessing: false,
          worldState: realityEngine.getState(),
          messages: [...prev.messages, ...eventMessages, narrativeMessage],
          streamingContent: '',
          currentPhase: 'idle',
          currentMetrics: result.generatorResult.metrics,
          sessionStats: {
            ...prev.sessionStats,
            totalTurns: prev.sessionStats.totalTurns + 1,
            totalTokens: newTotalTokens,
            averageTPS: newTotalTokens / Math.max(elapsed, 1),
            validationPassRate: total > 0 ? passed / total : 1,
          },
        };
      });
    } catch (error) {
      const errorMessage: TerminalMessage = {
        id: uuid(),
        type: 'error',
        content: `Error: ${error instanceof Error ? error.message : 'Unknown error occurred'}`,
        timestamp: Date.now(),
      };

      setState(prev => ({
        ...prev,
        isProcessing: false,
        currentPhase: 'idle',
        messages: [...prev.messages, errorMessage],
        error: String(error),
      }));
    }
  }, [state.isInitialized, state.isProcessing]);

  // Initialize on mount
  useEffect(() => {
    if (!state.isInitialized) {
      initializeGame();
    }
  }, [state.isInitialized, initializeGame]);

  return {
    ...state,
    processInput,
    initializeGame,
  };
}

// Helper function
function formatWorldTime(time: { hour: number; day: number; month: number; year: number }): string {
  const hour = time.hour % 12 || 12;
  const period = time.hour >= 12 ? 'PM' : 'AM';
  return `${hour}:00 ${period}`;
}
