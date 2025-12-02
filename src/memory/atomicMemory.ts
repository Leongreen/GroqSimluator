/**
 * Atomic Memory System - Structure > Context
 *
 * This module implements the "Unified Logging Protocol" that treats
 * narrative as structured data. Every fact, event, and state change
 * is stored as an immutable database entry.
 *
 * Philosophy: A fact established on Turn 1 remains true on Turn 1000.
 */

import { openDB, DBSchema, IDBPDatabase } from 'idb';
import type { WorldEvent, WorldState, NPC, Item, Location, EventType } from '@/types';
import { v4 as uuid } from 'uuid';

// Database schema
interface SimulatorDB extends DBSchema {
  events: {
    key: string;
    value: WorldEvent;
    indexes: {
      'by-turn': number;
      'by-type': string;
      'by-actor': string;
      'by-location': string;
      'by-timestamp': number;
    };
  };
  facts: {
    key: string;
    value: Fact;
    indexes: {
      'by-subject': string;
      'by-type': string;
      'by-turn': number;
      'is-active': number; // 1 = active, 0 = superseded
    };
  };
  worldSnapshots: {
    key: string;
    value: WorldSnapshot;
    indexes: {
      'by-turn': number;
    };
  };
  sessions: {
    key: string;
    value: GameSession;
  };
}

// A discrete fact about the world
export interface Fact {
  id: string;
  subjectId: string;        // Entity this fact is about
  subjectType: 'player' | 'npc' | 'item' | 'location' | 'world';
  predicate: string;        // What kind of fact (e.g., "is_dead", "owns", "located_at")
  value: unknown;           // The fact value
  establishedAt: number;    // Turn when this became true
  supersededAt: number | null;  // Turn when this stopped being true (null = still active)
  sourceEventId: string;    // The event that established this fact
  confidence: number;       // 0-1 confidence level
  isActive: boolean;        // Quick filter for current facts
}

// A snapshot of world state at a specific turn
export interface WorldSnapshot {
  id: string;
  turn: number;
  timestamp: number;
  state: WorldState;
  checksum: string;         // For integrity verification
}

// A game session record
export interface GameSession {
  id: string;
  name: string;
  createdAt: number;
  lastPlayedAt: number;
  currentTurn: number;
  worldId: string;
}

const DB_NAME = 'groq-rpg-simulator';
const DB_VERSION = 1;

class AtomicMemoryStore {
  private db: IDBPDatabase<SimulatorDB> | null = null;
  private sessionId: string | null = null;

  async initialize(): Promise<void> {
    this.db = await openDB<SimulatorDB>(DB_NAME, DB_VERSION, {
      upgrade(db) {
        // Events store
        const eventStore = db.createObjectStore('events', { keyPath: 'id' });
        eventStore.createIndex('by-turn', 'turn');
        eventStore.createIndex('by-type', 'type');
        eventStore.createIndex('by-actor', 'actorId');
        eventStore.createIndex('by-location', 'locationId');
        eventStore.createIndex('by-timestamp', 'timestamp');

        // Facts store
        const factStore = db.createObjectStore('facts', { keyPath: 'id' });
        factStore.createIndex('by-subject', 'subjectId');
        factStore.createIndex('by-type', 'predicate');
        factStore.createIndex('by-turn', 'establishedAt');
        factStore.createIndex('is-active', 'isActive');

        // World snapshots
        const snapshotStore = db.createObjectStore('worldSnapshots', { keyPath: 'id' });
        snapshotStore.createIndex('by-turn', 'turn');

        // Sessions
        db.createObjectStore('sessions', { keyPath: 'id' });
      },
    });
  }

  private ensureDb(): IDBPDatabase<SimulatorDB> {
    if (!this.db) {
      throw new Error('AtomicMemory not initialized. Call initialize() first.');
    }
    return this.db;
  }

  // ========== SESSION MANAGEMENT ==========

  async createSession(name: string, worldId: string): Promise<GameSession> {
    const db = this.ensureDb();
    const session: GameSession = {
      id: uuid(),
      name,
      createdAt: Date.now(),
      lastPlayedAt: Date.now(),
      currentTurn: 0,
      worldId,
    };
    await db.put('sessions', session);
    this.sessionId = session.id;
    return session;
  }

  async loadSession(sessionId: string): Promise<GameSession | undefined> {
    const db = this.ensureDb();
    const session = await db.get('sessions', sessionId);
    if (session) {
      this.sessionId = session.id;
    }
    return session;
  }

  async listSessions(): Promise<GameSession[]> {
    const db = this.ensureDb();
    return db.getAll('sessions');
  }

  // ========== EVENT LOGGING ==========

  async logEvent(event: Omit<WorldEvent, 'id' | 'timestamp'>): Promise<WorldEvent> {
    const db = this.ensureDb();
    const fullEvent: WorldEvent = {
      ...event,
      id: uuid(),
      timestamp: Date.now(),
    };
    await db.put('events', fullEvent);
    return fullEvent;
  }

  async getEvent(eventId: string): Promise<WorldEvent | undefined> {
    const db = this.ensureDb();
    return db.get('events', eventId);
  }

  async getEventsByTurn(turn: number): Promise<WorldEvent[]> {
    const db = this.ensureDb();
    return db.getAllFromIndex('events', 'by-turn', turn);
  }

  async getEventsByType(type: EventType): Promise<WorldEvent[]> {
    const db = this.ensureDb();
    return db.getAllFromIndex('events', 'by-type', type);
  }

  async getEventsByActor(actorId: string): Promise<WorldEvent[]> {
    const db = this.ensureDb();
    return db.getAllFromIndex('events', 'by-actor', actorId);
  }

  async getEventsByLocation(locationId: string): Promise<WorldEvent[]> {
    const db = this.ensureDb();
    return db.getAllFromIndex('events', 'by-location', locationId);
  }

  async getRecentEvents(limit: number = 50): Promise<WorldEvent[]> {
    const db = this.ensureDb();
    const allEvents = await db.getAllFromIndex('events', 'by-timestamp');
    return allEvents.slice(-limit).reverse();
  }

  async getEventRange(fromTurn: number, toTurn: number): Promise<WorldEvent[]> {
    const db = this.ensureDb();
    const events: WorldEvent[] = [];
    const tx = db.transaction('events', 'readonly');
    const index = tx.store.index('by-turn');
    const range = IDBKeyRange.bound(fromTurn, toTurn);

    for await (const cursor of index.iterate(range)) {
      events.push(cursor.value);
    }
    return events;
  }

  // ========== FACT MANAGEMENT ==========

  async establishFact(
    subjectId: string,
    subjectType: Fact['subjectType'],
    predicate: string,
    value: unknown,
    turn: number,
    sourceEventId: string,
    confidence: number = 1.0
  ): Promise<Fact> {
    const db = this.ensureDb();

    // Supersede any existing active facts with same subject+predicate
    const existingFacts = await this.getActiveFacts(subjectId);
    for (const existing of existingFacts) {
      if (existing.predicate === predicate && existing.isActive) {
        existing.supersededAt = turn;
        existing.isActive = false;
        await db.put('facts', existing);
      }
    }

    // Create new fact
    const fact: Fact = {
      id: uuid(),
      subjectId,
      subjectType,
      predicate,
      value,
      establishedAt: turn,
      supersededAt: null,
      sourceEventId,
      confidence,
      isActive: true,
    };
    await db.put('facts', fact);
    return fact;
  }

  async getActiveFacts(subjectId: string): Promise<Fact[]> {
    const db = this.ensureDb();
    const allFacts = await db.getAllFromIndex('facts', 'by-subject', subjectId);
    return allFacts.filter(f => f.isActive);
  }

  async getFactHistory(subjectId: string, predicate: string): Promise<Fact[]> {
    const db = this.ensureDb();
    const allFacts = await db.getAllFromIndex('facts', 'by-subject', subjectId);
    return allFacts.filter(f => f.predicate === predicate).sort((a, b) => a.establishedAt - b.establishedAt);
  }

  async getAllActiveFacts(): Promise<Fact[]> {
    const db = this.ensureDb();
    // IndexedDB doesn't support boolean indexes well, so we filter
    const allFacts = await db.getAll('facts');
    return allFacts.filter(f => f.isActive);
  }

  async queryFacts(predicate: string): Promise<Fact[]> {
    const db = this.ensureDb();
    const facts = await db.getAllFromIndex('facts', 'by-type', predicate);
    return facts.filter(f => f.isActive);
  }

  // ========== WORLD SNAPSHOTS ==========

  async saveSnapshot(turn: number, state: WorldState): Promise<WorldSnapshot> {
    const db = this.ensureDb();
    const snapshot: WorldSnapshot = {
      id: uuid(),
      turn,
      timestamp: Date.now(),
      state,
      checksum: this.generateChecksum(state),
    };
    await db.put('worldSnapshots', snapshot);
    return snapshot;
  }

  async getSnapshot(turn: number): Promise<WorldSnapshot | undefined> {
    const db = this.ensureDb();
    const snapshots = await db.getAllFromIndex('worldSnapshots', 'by-turn', turn);
    return snapshots[0];
  }

  async getLatestSnapshot(): Promise<WorldSnapshot | undefined> {
    const db = this.ensureDb();
    const allSnapshots = await db.getAllFromIndex('worldSnapshots', 'by-turn');
    return allSnapshots[allSnapshots.length - 1];
  }

  // ========== QUERY HELPERS ==========

  /**
   * Get a summary of facts for context injection
   */
  async getFactSummary(entityIds: string[]): Promise<string> {
    const facts: Fact[] = [];
    for (const id of entityIds) {
      const entityFacts = await this.getActiveFacts(id);
      facts.push(...entityFacts);
    }

    return facts.map(f => `[${f.subjectType}:${f.subjectId}] ${f.predicate} = ${JSON.stringify(f.value)}`).join('\n');
  }

  /**
   * Build a context window from recent events
   */
  async buildContextWindow(currentTurn: number, windowSize: number = 10): Promise<string> {
    const events = await this.getEventRange(Math.max(0, currentTurn - windowSize), currentTurn);
    return events.map(e => `[Turn ${e.turn}] ${e.type}: ${e.description}`).join('\n');
  }

  /**
   * Get all facts and events related to a specific entity
   */
  async getEntityHistory(entityId: string): Promise<{ facts: Fact[]; events: WorldEvent[] }> {
    const [facts, actorEvents] = await Promise.all([
      this.getActiveFacts(entityId),
      this.getEventsByActor(entityId),
    ]);
    return { facts, events: actorEvents };
  }

  // ========== UTILITY ==========

  private generateChecksum(state: WorldState): string {
    // Simple checksum for integrity verification
    const str = JSON.stringify(state);
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
      const char = str.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash;
    }
    return hash.toString(16);
  }

  async clear(): Promise<void> {
    const db = this.ensureDb();
    await Promise.all([
      db.clear('events'),
      db.clear('facts'),
      db.clear('worldSnapshots'),
    ]);
  }

  async getStats(): Promise<{
    eventCount: number;
    factCount: number;
    activeFactCount: number;
    snapshotCount: number;
  }> {
    const db = this.ensureDb();
    const [events, facts, snapshots] = await Promise.all([
      db.count('events'),
      db.getAll('facts'),
      db.count('worldSnapshots'),
    ]);
    return {
      eventCount: events,
      factCount: facts.length,
      activeFactCount: facts.filter(f => f.isActive).length,
      snapshotCount: snapshots,
    };
  }
}

// Singleton instance
export const atomicMemory = new AtomicMemoryStore();
