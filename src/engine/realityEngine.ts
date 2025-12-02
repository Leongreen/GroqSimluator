/**
 * Reality Engine - Simulation > Narration
 *
 * The neutral "physics engine" of the simulation. Unlike narrative-driven
 * AI Dungeon Masters, this system prioritizes:
 * - Object permanence
 * - Independent NPC agency
 * - Causal consistency
 *
 * Philosophy: The world exists independently of the player.
 */

import { v4 as uuid } from 'uuid';
import type {
  WorldState,
  Player,
  NPC,
  Location,
  Item,
  WorldEvent,
  EventType,
  WorldTime,
  Relationship,
} from '@/types';
import { atomicMemory } from '@/memory/atomicMemory';

// Default starting world configuration
const DEFAULT_WORLD_NAME = 'The Realm of Shadows';

// Time constants
const HOURS_PER_DAY = 24;
const DAYS_PER_MONTH = 30;
const MONTHS_PER_YEAR = 12;

export class RealityEngine {
  private state: WorldState;
  private isRunning: boolean = false;

  constructor() {
    this.state = this.createEmptyWorld();
  }

  // ========== WORLD CREATION ==========

  private createEmptyWorld(): WorldState {
    return {
      id: uuid(),
      name: DEFAULT_WORLD_NAME,
      currentTurn: 0,
      time: {
        hour: 8,  // Start at 8 AM
        day: 1,
        month: 1,
        year: 1,
      },
      weather: 'clear',
      globalEvents: [],
      player: null,
      npcs: {},
      locations: {},
      items: {},
      relationships: {},
      recentEvents: [],
    };
  }

  /**
   * Initialize a new game world with a starting scenario
   */
  async initializeWorld(scenario: WorldScenario): Promise<WorldState> {
    this.state = this.createEmptyWorld();
    this.state.name = scenario.name;

    // Create locations
    for (const loc of scenario.locations) {
      this.state.locations[loc.id] = loc;
    }

    // Create items
    for (const item of scenario.items) {
      this.state.items[item.id] = item;
    }

    // Create NPCs
    for (const npc of scenario.npcs) {
      this.state.npcs[npc.id] = npc;
    }

    // Create relationships
    for (const rel of scenario.relationships) {
      this.state.relationships[rel.id] = rel;
    }

    // Create player
    this.state.player = scenario.player;

    // Log world creation event
    await this.logEvent({
      turn: 0,
      type: EventType.SPAWN,
      description: `The world "${scenario.name}" springs into existence.`,
      locationId: null,
      actorId: null,
      targetIds: [],
      stateBefore: {},
      stateAfter: {},
      validated: true,
      validatorNotes: 'World initialization',
      isPublic: true,
      witnessIds: [],
    });

    // Save initial snapshot
    await atomicMemory.saveSnapshot(0, this.state);

    return this.state;
  }

  // ========== STATE ACCESS ==========

  getState(): WorldState {
    return this.state;
  }

  getPlayer(): Player | null {
    return this.state.player;
  }

  getNPC(id: string): NPC | undefined {
    return this.state.npcs[id];
  }

  getLocation(id: string): Location | undefined {
    return this.state.locations[id];
  }

  getItem(id: string): Item | undefined {
    return this.state.items[id];
  }

  getCurrentLocation(): Location | undefined {
    if (!this.state.player?.locationId) return undefined;
    return this.state.locations[this.state.player.locationId];
  }

  getEntitiesAtLocation(locationId: string): { npcs: NPC[]; items: Item[] } {
    const npcs = Object.values(this.state.npcs).filter(n => n.locationId === locationId && n.isAlive);
    const items = Object.values(this.state.items).filter(i => i.locationId === locationId);
    return { npcs, items };
  }

  // ========== TIME MANAGEMENT ==========

  advanceTime(hours: number = 1): WorldTimeAdvanceResult {
    const result: WorldTimeAdvanceResult = {
      previousTime: { ...this.state.time },
      newTime: { ...this.state.time },
      triggeredEvents: [],
      npcActions: [],
    };

    // Advance hours
    this.state.time.hour += hours;

    // Handle day rollover
    while (this.state.time.hour >= HOURS_PER_DAY) {
      this.state.time.hour -= HOURS_PER_DAY;
      this.state.time.day++;
      result.triggeredEvents.push(`A new day dawns (Day ${this.state.time.day}).`);

      // Check month rollover
      if (this.state.time.day > DAYS_PER_MONTH) {
        this.state.time.day = 1;
        this.state.time.month++;

        if (this.state.time.month > MONTHS_PER_YEAR) {
          this.state.time.month = 1;
          this.state.time.year++;
          result.triggeredEvents.push(`A new year begins (Year ${this.state.time.year}).`);
        }
      }
    }

    // Update weather based on time
    this.updateWeather();

    // Process NPC schedules
    for (const npc of Object.values(this.state.npcs)) {
      if (npc.isAlive) {
        const action = this.processNPCSchedule(npc, this.state.time.hour);
        if (action) {
          result.npcActions.push(action);
        }
      }
    }

    result.newTime = { ...this.state.time };
    return result;
  }

  private updateWeather(): void {
    // Simple weather system - changes occasionally
    const rand = Math.random();
    if (rand < 0.05) {
      const weathers = ['clear', 'cloudy', 'rainy', 'stormy', 'foggy', 'windy'];
      this.state.weather = weathers[Math.floor(Math.random() * weathers.length)];
    }
  }

  private processNPCSchedule(npc: NPC, hour: number): NPCAction | null {
    const scheduledActivity = npc.schedule[hour];
    if (scheduledActivity && scheduledActivity !== npc.currentActivity) {
      const previousActivity = npc.currentActivity;
      npc.currentActivity = scheduledActivity;
      return {
        npcId: npc.id,
        npcName: npc.name,
        action: `transitions from ${previousActivity} to ${scheduledActivity}`,
        hour,
      };
    }
    return null;
  }

  // ========== NPC AGENCY ==========

  /**
   * Process independent NPC actions when player is not present
   */
  async processNPCAgency(): Promise<NPCAgencyResult[]> {
    const results: NPCAgencyResult[] = [];
    const playerLocation = this.state.player?.locationId;

    for (const npc of Object.values(this.state.npcs)) {
      if (!npc.isAlive) continue;

      // NPCs in different locations act independently
      const isNearPlayer = npc.locationId === playerLocation;

      // Process goals
      for (const goal of npc.goals) {
        if (!goal.isComplete) {
          const action = this.evaluateGoalProgress(npc, goal, isNearPlayer);
          if (action) {
            results.push(action);
          }
        }
      }

      // NPCs remember when they last saw the player
      if (isNearPlayer) {
        npc.lastSeenPlayer = Date.now();
        npc.lastKnownPlayerLocation = playerLocation;
      }
    }

    return results;
  }

  private evaluateGoalProgress(npc: NPC, goal: NPCGoal, isNearPlayer: boolean): NPCAgencyResult | null {
    // If not near player, NPC works toward goals autonomously
    if (!isNearPlayer && Math.random() < 0.3) {
      // 30% chance of progress per tick
      goal.progress = Math.min(1, goal.progress + 0.1);

      if (goal.progress >= 1) {
        goal.isComplete = true;
        return {
          npcId: npc.id,
          npcName: npc.name,
          type: 'goal_complete',
          description: `${npc.name} has achieved their goal: ${goal.description}`,
          isVisible: false,
        };
      }

      return {
        npcId: npc.id,
        npcName: npc.name,
        type: 'goal_progress',
        description: `${npc.name} makes progress toward: ${goal.description}`,
        isVisible: false,
      };
    }
    return null;
  }

  // ========== EVENT LOGGING ==========

  async logEvent(event: Omit<WorldEvent, 'id' | 'timestamp'>): Promise<WorldEvent> {
    const fullEvent = await atomicMemory.logEvent(event);

    // Keep recent events in state (limited buffer)
    this.state.recentEvents.push(fullEvent);
    if (this.state.recentEvents.length > 100) {
      this.state.recentEvents.shift();
    }

    return fullEvent;
  }

  // ========== STATE MUTATIONS ==========

  applyStateChange(change: WorldStateChange): void {
    switch (change.type) {
      case 'player_move':
        if (this.state.player) {
          this.state.player.locationId = change.locationId;
          if (!this.state.player.knownLocations.includes(change.locationId)) {
            this.state.player.knownLocations.push(change.locationId);
          }
        }
        break;

      case 'player_health':
        if (this.state.player) {
          this.state.player.health = Math.max(0, Math.min(
            this.state.player.maxHealth,
            this.state.player.health + change.delta
          ));
          if (this.state.player.health <= 0) {
            this.state.player.isAlive = false;
          }
        }
        break;

      case 'npc_health':
        const npc = this.state.npcs[change.npcId];
        if (npc) {
          npc.health = Math.max(0, Math.min(npc.maxHealth, npc.health + change.delta));
          if (npc.health <= 0) {
            npc.isAlive = false;
          }
        }
        break;

      case 'npc_move':
        const movingNpc = this.state.npcs[change.npcId];
        if (movingNpc) {
          movingNpc.locationId = change.locationId;
        }
        break;

      case 'item_transfer':
        const item = this.state.items[change.itemId];
        if (item) {
          item.ownerId = change.newOwnerId;
          item.locationId = change.newLocationId ?? null;
        }
        break;

      case 'add_knowledge':
        const knowledgeNpc = this.state.npcs[change.npcId];
        if (knowledgeNpc && !knowledgeNpc.knowledge.includes(change.knowledge)) {
          knowledgeNpc.knowledge.push(change.knowledge);
        }
        break;

      case 'relationship_change':
        const rel = this.state.relationships[change.relationshipId];
        if (rel) {
          rel.strength = Math.max(-1, Math.min(1, rel.strength + change.delta));
          if (change.newType) {
            rel.type = change.newType;
          }
        }
        break;
    }
  }

  // ========== TURN MANAGEMENT ==========

  incrementTurn(): number {
    this.state.currentTurn++;
    return this.state.currentTurn;
  }

  async endTurn(): Promise<TurnEndResult> {
    const turn = this.incrementTurn();

    // Advance time by 1 hour per turn (configurable)
    const timeResult = this.advanceTime(1);

    // Process NPC agency
    const npcResults = await this.processNPCAgency();

    // Save snapshot every 10 turns
    if (turn % 10 === 0) {
      await atomicMemory.saveSnapshot(turn, this.state);
    }

    return {
      turn,
      timeResult,
      npcResults,
    };
  }

  // ========== WORLD QUERIES ==========

  /**
   * Get a description of the current situation for the AI
   */
  getCurrentSituation(): WorldSituation {
    const player = this.state.player;
    if (!player) {
      return {
        description: 'No player in world.',
        location: null,
        nearbyNPCs: [],
        nearbyItems: [],
        exits: [],
        time: this.state.time,
        weather: this.state.weather,
        threats: [],
      };
    }

    const location = this.getCurrentLocation();
    const { npcs, items } = location ? this.getEntitiesAtLocation(location.id) : { npcs: [], items: [] };

    // Identify threats based on relationships
    const threats: string[] = [];
    for (const npc of npcs) {
      const relationship = Object.values(this.state.relationships).find(
        r => (r.sourceId === npc.id && r.targetId === player.id) ||
             (r.sourceId === player.id && r.targetId === npc.id)
      );
      if (relationship?.type === 'hostile') {
        threats.push(`${npc.name} (hostile)`);
      }
    }

    return {
      description: location?.description ?? 'Unknown location',
      location,
      nearbyNPCs: npcs,
      nearbyItems: items,
      exits: location?.connections ?? [],
      time: this.state.time,
      weather: this.state.weather,
      threats,
    };
  }

  /**
   * Build context for the AI generator
   */
  async buildGeneratorContext(): Promise<string> {
    const situation = this.getCurrentSituation();
    const recentEvents = await atomicMemory.buildContextWindow(this.state.currentTurn, 10);

    const playerFacts = this.state.player
      ? await atomicMemory.getFactSummary([this.state.player.id])
      : 'No player facts.';

    const npcIds = situation.nearbyNPCs.map(n => n.id);
    const npcFacts = npcIds.length > 0
      ? await atomicMemory.getFactSummary(npcIds)
      : 'No nearby NPCs.';

    return `
=== WORLD STATE (Turn ${this.state.currentTurn}) ===
Time: ${this.formatTime()} | Weather: ${this.state.weather}
Location: ${situation.location?.name ?? 'Unknown'}
Description: ${situation.description}

=== PLAYER STATUS ===
Health: ${this.state.player?.health ?? 0}/${this.state.player?.maxHealth ?? 0}
${playerFacts}

=== NEARBY ENTITIES ===
NPCs: ${situation.nearbyNPCs.map(n => `${n.name} (${n.currentActivity})`).join(', ') || 'None'}
Items: ${situation.nearbyItems.map(i => i.name).join(', ') || 'None'}
Exits: ${situation.exits.map(e => `${e.direction}`).join(', ') || 'None'}
Threats: ${situation.threats.join(', ') || 'None detected'}

=== NPC KNOWLEDGE ===
${npcFacts}

=== RECENT HISTORY ===
${recentEvents || 'No recent events.'}
`.trim();
  }

  formatTime(): string {
    const { hour, day, month, year } = this.state.time;
    const period = hour >= 12 ? 'PM' : 'AM';
    const displayHour = hour % 12 || 12;
    return `${displayHour}:00 ${period}, Day ${day}, Month ${month}, Year ${year}`;
  }
}

// ========== TYPES ==========

export interface WorldScenario {
  name: string;
  player: Player;
  locations: Location[];
  npcs: NPC[];
  items: Item[];
  relationships: Relationship[];
}

export interface WorldTimeAdvanceResult {
  previousTime: WorldTime;
  newTime: WorldTime;
  triggeredEvents: string[];
  npcActions: NPCAction[];
}

export interface NPCAction {
  npcId: string;
  npcName: string;
  action: string;
  hour: number;
}

export interface NPCAgencyResult {
  npcId: string;
  npcName: string;
  type: 'goal_progress' | 'goal_complete' | 'autonomous_action';
  description: string;
  isVisible: boolean;
}

export interface NPCGoal {
  id: string;
  description: string;
  priority: number;
  progress: number;
  isComplete: boolean;
}

export type WorldStateChange =
  | { type: 'player_move'; locationId: string }
  | { type: 'player_health'; delta: number }
  | { type: 'npc_health'; npcId: string; delta: number }
  | { type: 'npc_move'; npcId: string; locationId: string }
  | { type: 'item_transfer'; itemId: string; newOwnerId: string | null; newLocationId?: string }
  | { type: 'add_knowledge'; npcId: string; knowledge: string }
  | { type: 'relationship_change'; relationshipId: string; delta: number; newType?: Relationship['type'] };

export interface TurnEndResult {
  turn: number;
  timeResult: WorldTimeAdvanceResult;
  npcResults: NPCAgencyResult[];
}

export interface WorldSituation {
  description: string;
  location: Location | null;
  nearbyNPCs: NPC[];
  nearbyItems: Item[];
  exits: Location['connections'];
  time: WorldTime;
  weather: string;
  threats: string[];
}

// Singleton instance
export const realityEngine = new RealityEngine();
