/**
 * World State Types - The atoms of reality
 *
 * These types define the immutable facts about the simulated world.
 * Every entity, location, and event is a discrete data structure.
 */

export type EntityId = string;
export type LocationId = string;
export type ItemId = string;
export type EventId = string;

export enum EventType {
  ACTION = 'action',
  DIALOGUE = 'dialogue',
  OBSERVATION = 'observation',
  STATE_CHANGE = 'state_change',
  TIME_PASSAGE = 'time_passage',
  COMBAT = 'combat',
  DEATH = 'death',
  SPAWN = 'spawn',
  ITEM_TRANSFER = 'item_transfer',
  LOCATION_CHANGE = 'location_change',
  WORLD_TICK = 'world_tick',
}

export interface Entity {
  id: EntityId;
  name: string;
  description: string;
  locationId: LocationId | null;
  properties: Record<string, unknown>;
  createdAt: number;
  isAlive: boolean;
}

export interface Item extends Entity {
  weight: number;
  value: number;
  isConsumable: boolean;
  ownerId: EntityId | null;
}

export interface Relationship {
  id: string;
  sourceId: EntityId;
  targetId: EntityId;
  type: 'hostile' | 'friendly' | 'neutral' | 'fearful' | 'romantic';
  strength: number; // -1.0 to 1.0
  description: string;
  establishedAt: number;
}

export interface NPCGoal {
  id: string;
  description: string;
  priority: number;
  progress: number;
  isComplete: boolean;
}

export interface NPC extends Entity {
  health: number;
  maxHealth: number;
  level: number;

  // Agency - What makes NPCs independent actors
  goals: NPCGoal[];
  fears: string[];
  knowledge: string[]; // Facts the NPC knows
  personality: {
    aggression: number;
    curiosity: number;
    loyalty: number;
    greed: number;
    courage: number;
  };

  // Behavioral state
  currentActivity: string;
  schedule: Record<number, string>; // hour -> activity
  inventory: ItemId[];

  // Memory
  memoryIds: EventId[];
  lastSeenPlayer: number | null;
  lastKnownPlayerLocation: LocationId | null;
}

export interface Player extends Entity {
  health: number;
  maxHealth: number;
  level: number;
  experience: number;
  inventory: ItemId[];
  knownLocations: LocationId[];
  activeQuests: string[];
  skills: Record<string, number>;
}

export interface LocationConnection {
  direction: string;
  targetId: LocationId;
  isLocked: boolean;
  requiredItem?: ItemId;
}

export interface Location {
  id: LocationId;
  name: string;
  description: string;
  properties: Record<string, unknown>;
  connections: LocationConnection[];
  isOutdoor: boolean;
  lightLevel: number;
  dangerLevel: number;
}

export interface WorldEvent {
  id: EventId;
  turn: number;
  timestamp: number;
  type: EventType;
  description: string;
  locationId: LocationId | null;

  // Participants
  actorId: EntityId | null;
  targetIds: EntityId[];

  // State tracking
  stateBefore: Record<string, unknown>;
  stateAfter: Record<string, unknown>;

  // Validation
  validated: boolean;
  validatorNotes: string;

  // Visibility
  isPublic: boolean;
  witnessIds: EntityId[];
}

export interface WorldTime {
  hour: number;    // 0-23
  day: number;     // 1+
  month: number;   // 1-12
  year: number;    // 1+
}

export interface WorldState {
  id: string;
  name: string;
  currentTurn: number;
  time: WorldTime;
  weather: string;
  globalEvents: string[];

  // Entity registries
  player: Player | null;
  npcs: Record<EntityId, NPC>;
  locations: Record<LocationId, Location>;
  items: Record<ItemId, Item>;
  relationships: Record<string, Relationship>;

  // Recent events for quick access
  recentEvents: WorldEvent[];
}

// Utility type for creating new world states
export type WorldStatePatch = Partial<Omit<WorldState, 'id'>>;
