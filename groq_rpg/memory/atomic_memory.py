"""
Atomic Memory System - Structure > Context

This module implements the "Unified Logging Protocol" that treats
narrative as structured data. Every fact, event, and state change
is stored as an immutable database entry.

Philosophy: A fact established on Turn 1 remains true on Turn 1000.
"""

from __future__ import annotations

import sqlite3
import json
import time
from dataclasses import dataclass, field, asdict
from pathlib import Path
from typing import Any
from uuid import uuid4

from ..models import WorldEvent, WorldState, EventType


@dataclass
class Fact:
    """A discrete fact about the world."""
    id: str = field(default_factory=lambda: str(uuid4()))
    subject_id: str = ""
    subject_type: str = ""  # player, npc, item, location, world
    predicate: str = ""  # e.g., "is_dead", "owns", "located_at"
    value: Any = None
    established_at: int = 0  # Turn when this became true
    superseded_at: int | None = None  # Turn when this stopped being true
    source_event_id: str = ""
    confidence: float = 1.0
    is_active: bool = True


class AtomicMemory:
    """
    SQLite-backed memory store for the simulation.

    Provides immutable event logging and fact tracking.
    """

    def __init__(self, db_path: str = "groq_rpg_memory.db"):
        self.db_path = Path(db_path)
        self.conn: sqlite3.Connection | None = None
        self._initialize_db()

    def _initialize_db(self) -> None:
        """Initialize the database schema."""
        self.conn = sqlite3.connect(str(self.db_path))
        self.conn.row_factory = sqlite3.Row

        cursor = self.conn.cursor()

        # Events table
        cursor.execute("""
            CREATE TABLE IF NOT EXISTS events (
                id TEXT PRIMARY KEY,
                turn INTEGER,
                timestamp REAL,
                event_type TEXT,
                description TEXT,
                location_id TEXT,
                actor_id TEXT,
                target_ids TEXT,
                state_before TEXT,
                state_after TEXT,
                validated INTEGER,
                validator_notes TEXT,
                is_public INTEGER,
                witness_ids TEXT
            )
        """)

        # Facts table
        cursor.execute("""
            CREATE TABLE IF NOT EXISTS facts (
                id TEXT PRIMARY KEY,
                subject_id TEXT,
                subject_type TEXT,
                predicate TEXT,
                value TEXT,
                established_at INTEGER,
                superseded_at INTEGER,
                source_event_id TEXT,
                confidence REAL,
                is_active INTEGER
            )
        """)

        # World snapshots table
        cursor.execute("""
            CREATE TABLE IF NOT EXISTS world_snapshots (
                id TEXT PRIMARY KEY,
                turn INTEGER,
                timestamp REAL,
                state TEXT,
                checksum TEXT
            )
        """)

        # Sessions table
        cursor.execute("""
            CREATE TABLE IF NOT EXISTS sessions (
                id TEXT PRIMARY KEY,
                name TEXT,
                created_at REAL,
                last_played_at REAL,
                current_turn INTEGER,
                world_id TEXT
            )
        """)

        # Create indexes
        cursor.execute("CREATE INDEX IF NOT EXISTS idx_events_turn ON events(turn)")
        cursor.execute("CREATE INDEX IF NOT EXISTS idx_events_type ON events(event_type)")
        cursor.execute("CREATE INDEX IF NOT EXISTS idx_events_actor ON events(actor_id)")
        cursor.execute("CREATE INDEX IF NOT EXISTS idx_facts_subject ON facts(subject_id)")
        cursor.execute("CREATE INDEX IF NOT EXISTS idx_facts_active ON facts(is_active)")

        self.conn.commit()

    def _ensure_conn(self) -> sqlite3.Connection:
        if self.conn is None:
            raise RuntimeError("Database not initialized")
        return self.conn

    # ========== EVENT LOGGING ==========

    def log_event(self, event: WorldEvent) -> WorldEvent:
        """Log an event to the database."""
        conn = self._ensure_conn()
        cursor = conn.cursor()

        cursor.execute("""
            INSERT INTO events (
                id, turn, timestamp, event_type, description, location_id,
                actor_id, target_ids, state_before, state_after,
                validated, validator_notes, is_public, witness_ids
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """, (
            event.id,
            event.turn,
            event.timestamp,
            event.event_type.value if isinstance(event.event_type, EventType) else event.event_type,
            event.description,
            event.location_id,
            event.actor_id,
            json.dumps(event.target_ids),
            json.dumps(event.state_before),
            json.dumps(event.state_after),
            1 if event.validated else 0,
            event.validator_notes,
            1 if event.is_public else 0,
            json.dumps(event.witness_ids),
        ))

        conn.commit()
        return event

    def get_event(self, event_id: str) -> WorldEvent | None:
        """Get an event by ID."""
        conn = self._ensure_conn()
        cursor = conn.cursor()

        cursor.execute("SELECT * FROM events WHERE id = ?", (event_id,))
        row = cursor.fetchone()

        if row is None:
            return None

        return self._row_to_event(row)

    def get_events_by_turn(self, turn: int) -> list[WorldEvent]:
        """Get all events for a specific turn."""
        conn = self._ensure_conn()
        cursor = conn.cursor()

        cursor.execute("SELECT * FROM events WHERE turn = ? ORDER BY timestamp", (turn,))
        return [self._row_to_event(row) for row in cursor.fetchall()]

    def get_recent_events(self, limit: int = 50) -> list[WorldEvent]:
        """Get the most recent events."""
        conn = self._ensure_conn()
        cursor = conn.cursor()

        cursor.execute("SELECT * FROM events ORDER BY timestamp DESC LIMIT ?", (limit,))
        return [self._row_to_event(row) for row in cursor.fetchall()][::-1]

    def get_events_by_actor(self, actor_id: str) -> list[WorldEvent]:
        """Get all events by a specific actor."""
        conn = self._ensure_conn()
        cursor = conn.cursor()

        cursor.execute("SELECT * FROM events WHERE actor_id = ? ORDER BY timestamp", (actor_id,))
        return [self._row_to_event(row) for row in cursor.fetchall()]

    def _row_to_event(self, row: sqlite3.Row) -> WorldEvent:
        """Convert a database row to a WorldEvent."""
        return WorldEvent(
            id=row["id"],
            turn=row["turn"],
            timestamp=row["timestamp"],
            event_type=EventType(row["event_type"]),
            description=row["description"],
            location_id=row["location_id"],
            actor_id=row["actor_id"],
            target_ids=json.loads(row["target_ids"]),
            state_before=json.loads(row["state_before"]),
            state_after=json.loads(row["state_after"]),
            validated=bool(row["validated"]),
            validator_notes=row["validator_notes"],
            is_public=bool(row["is_public"]),
            witness_ids=json.loads(row["witness_ids"]),
        )

    # ========== FACT MANAGEMENT ==========

    def establish_fact(
        self,
        subject_id: str,
        subject_type: str,
        predicate: str,
        value: Any,
        turn: int,
        source_event_id: str,
        confidence: float = 1.0,
    ) -> Fact:
        """Establish a new fact, superseding any existing fact with same subject+predicate."""
        conn = self._ensure_conn()
        cursor = conn.cursor()

        # Supersede existing active facts
        cursor.execute("""
            UPDATE facts
            SET is_active = 0, superseded_at = ?
            WHERE subject_id = ? AND predicate = ? AND is_active = 1
        """, (turn, subject_id, predicate))

        # Create new fact
        fact = Fact(
            id=str(uuid4()),
            subject_id=subject_id,
            subject_type=subject_type,
            predicate=predicate,
            value=value,
            established_at=turn,
            superseded_at=None,
            source_event_id=source_event_id,
            confidence=confidence,
            is_active=True,
        )

        cursor.execute("""
            INSERT INTO facts (
                id, subject_id, subject_type, predicate, value,
                established_at, superseded_at, source_event_id,
                confidence, is_active
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """, (
            fact.id,
            fact.subject_id,
            fact.subject_type,
            fact.predicate,
            json.dumps(fact.value),
            fact.established_at,
            fact.superseded_at,
            fact.source_event_id,
            fact.confidence,
            1 if fact.is_active else 0,
        ))

        conn.commit()
        return fact

    def get_active_facts(self, subject_id: str) -> list[Fact]:
        """Get all active facts for a subject."""
        conn = self._ensure_conn()
        cursor = conn.cursor()

        cursor.execute("""
            SELECT * FROM facts WHERE subject_id = ? AND is_active = 1
        """, (subject_id,))

        return [self._row_to_fact(row) for row in cursor.fetchall()]

    def get_all_active_facts(self) -> list[Fact]:
        """Get all active facts."""
        conn = self._ensure_conn()
        cursor = conn.cursor()

        cursor.execute("SELECT * FROM facts WHERE is_active = 1")
        return [self._row_to_fact(row) for row in cursor.fetchall()]

    def query_facts(self, predicate: str) -> list[Fact]:
        """Query facts by predicate."""
        conn = self._ensure_conn()
        cursor = conn.cursor()

        cursor.execute("""
            SELECT * FROM facts WHERE predicate = ? AND is_active = 1
        """, (predicate,))

        return [self._row_to_fact(row) for row in cursor.fetchall()]

    def _row_to_fact(self, row: sqlite3.Row) -> Fact:
        """Convert a database row to a Fact."""
        return Fact(
            id=row["id"],
            subject_id=row["subject_id"],
            subject_type=row["subject_type"],
            predicate=row["predicate"],
            value=json.loads(row["value"]),
            established_at=row["established_at"],
            superseded_at=row["superseded_at"],
            source_event_id=row["source_event_id"],
            confidence=row["confidence"],
            is_active=bool(row["is_active"]),
        )

    # ========== WORLD SNAPSHOTS ==========

    def save_snapshot(self, turn: int, state: WorldState) -> str:
        """Save a world state snapshot."""
        conn = self._ensure_conn()
        cursor = conn.cursor()

        snapshot_id = str(uuid4())
        state_json = json.dumps(asdict(state), default=str)
        checksum = str(hash(state_json))

        cursor.execute("""
            INSERT INTO world_snapshots (id, turn, timestamp, state, checksum)
            VALUES (?, ?, ?, ?, ?)
        """, (snapshot_id, turn, time.time(), state_json, checksum))

        conn.commit()
        return snapshot_id

    def get_latest_snapshot(self) -> tuple[int, str] | None:
        """Get the latest snapshot turn and state JSON."""
        conn = self._ensure_conn()
        cursor = conn.cursor()

        cursor.execute("SELECT turn, state FROM world_snapshots ORDER BY turn DESC LIMIT 1")
        row = cursor.fetchone()

        if row is None:
            return None

        return row["turn"], row["state"]

    # ========== QUERY HELPERS ==========

    def get_fact_summary(self, entity_ids: list[str]) -> str:
        """Get a summary of facts for context injection."""
        facts = []
        for entity_id in entity_ids:
            facts.extend(self.get_active_facts(entity_id))

        lines = [
            f"[{f.subject_type}:{f.subject_id[:8]}] {f.predicate} = {json.dumps(f.value)}"
            for f in facts
        ]
        return "\n".join(lines)

    def build_context_window(self, current_turn: int, window_size: int = 10) -> str:
        """Build a context window from recent events."""
        conn = self._ensure_conn()
        cursor = conn.cursor()

        min_turn = max(0, current_turn - window_size)
        cursor.execute("""
            SELECT * FROM events
            WHERE turn >= ? AND turn <= ?
            ORDER BY turn, timestamp
        """, (min_turn, current_turn))

        events = [self._row_to_event(row) for row in cursor.fetchall()]
        lines = [f"[Turn {e.turn}] {e.event_type.value}: {e.description}" for e in events]
        return "\n".join(lines)

    # ========== UTILITY ==========

    def clear(self) -> None:
        """Clear all data (for testing)."""
        conn = self._ensure_conn()
        cursor = conn.cursor()

        cursor.execute("DELETE FROM events")
        cursor.execute("DELETE FROM facts")
        cursor.execute("DELETE FROM world_snapshots")
        cursor.execute("DELETE FROM sessions")

        conn.commit()

    def get_stats(self) -> dict[str, int]:
        """Get database statistics."""
        conn = self._ensure_conn()
        cursor = conn.cursor()

        cursor.execute("SELECT COUNT(*) as count FROM events")
        event_count = cursor.fetchone()["count"]

        cursor.execute("SELECT COUNT(*) as count FROM facts")
        fact_count = cursor.fetchone()["count"]

        cursor.execute("SELECT COUNT(*) as count FROM facts WHERE is_active = 1")
        active_fact_count = cursor.fetchone()["count"]

        cursor.execute("SELECT COUNT(*) as count FROM world_snapshots")
        snapshot_count = cursor.fetchone()["count"]

        return {
            "event_count": event_count,
            "fact_count": fact_count,
            "active_fact_count": active_fact_count,
            "snapshot_count": snapshot_count,
        }

    def close(self) -> None:
        """Close the database connection."""
        if self.conn:
            self.conn.close()
            self.conn = None
