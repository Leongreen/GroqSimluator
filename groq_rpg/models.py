"""
Data models for the Groq RPG Simulator.

These models define the atoms of reality - the immutable structures
that represent the simulated world.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from enum import Enum
from typing import Any
from uuid import uuid4
import time


class EventType(str, Enum):
    """Types of events that can occur in the world."""
    ACTION = "action"
    DIALOGUE = "dialogue"
    OBSERVATION = "observation"
    STATE_CHANGE = "state_change"
    TIME_PASSAGE = "time_passage"
    COMBAT = "combat"
    DEATH = "death"
    SPAWN = "spawn"
    ITEM_TRANSFER = "item_transfer"
    LOCATION_CHANGE = "location_change"
    WORLD_TICK = "world_tick"


@dataclass
class WorldTime:
    """Represents time in the game world."""
    hour: int = 8  # 0-23
    day: int = 1
    month: int = 1
    year: int = 1

    def format(self) -> str:
        period = "PM" if self.hour >= 12 else "AM"
        display_hour = self.hour % 12 or 12
        return f"{display_hour}:00 {period}, Day {self.day}, Month {self.month}, Year {self.year}"


@dataclass
class NPCGoal:
    """A goal that an NPC is pursuing."""
    id: str = field(default_factory=lambda: str(uuid4()))
    description: str = ""
    priority: int = 1
    progress: float = 0.0
    is_complete: bool = False


@dataclass
class Personality:
    """NPC personality traits."""
    aggression: float = 0.5
    curiosity: float = 0.5
    loyalty: float = 0.5
    greed: float = 0.5
    courage: float = 0.5


@dataclass
class Entity:
    """Base class for all entities in the world."""
    id: str = field(default_factory=lambda: str(uuid4()))
    name: str = ""
    description: str = ""
    location_id: str | None = None
    properties: dict[str, Any] = field(default_factory=dict)
    created_at: float = field(default_factory=time.time)
    is_alive: bool = True


@dataclass
class Item(Entity):
    """An item that can exist in the world."""
    weight: float = 0.0
    value: int = 0
    is_consumable: bool = False
    owner_id: str | None = None


@dataclass
class NPC(Entity):
    """A non-player character with independent agency."""
    health: int = 100
    max_health: int = 100
    level: int = 1

    # Agency attributes
    goals: list[NPCGoal] = field(default_factory=list)
    fears: list[str] = field(default_factory=list)
    knowledge: list[str] = field(default_factory=list)
    personality: Personality = field(default_factory=Personality)

    # Behavioral state
    current_activity: str = "idle"
    schedule: dict[int, str] = field(default_factory=dict)
    inventory: list[str] = field(default_factory=list)

    # Memory
    memory_ids: list[str] = field(default_factory=list)
    last_seen_player: float | None = None
    last_known_player_location: str | None = None


@dataclass
class Player(Entity):
    """The player character."""
    health: int = 100
    max_health: int = 100
    level: int = 1
    experience: int = 0
    inventory: list[str] = field(default_factory=list)
    known_locations: list[str] = field(default_factory=list)
    active_quests: list[str] = field(default_factory=list)
    skills: dict[str, int] = field(default_factory=dict)


@dataclass
class LocationConnection:
    """A connection between locations."""
    direction: str
    target_id: str
    is_locked: bool = False
    required_item: str | None = None


@dataclass
class Location:
    """A place in the world."""
    id: str = field(default_factory=lambda: str(uuid4()))
    name: str = ""
    description: str = ""
    properties: dict[str, Any] = field(default_factory=dict)
    connections: list[LocationConnection] = field(default_factory=list)
    is_outdoor: bool = True
    light_level: float = 1.0
    danger_level: int = 0


@dataclass
class Relationship:
    """A relationship between two entities."""
    id: str = field(default_factory=lambda: str(uuid4()))
    source_id: str = ""
    target_id: str = ""
    relationship_type: str = "neutral"  # hostile, friendly, neutral, fearful
    strength: float = 0.0  # -1.0 to 1.0
    description: str = ""
    established_at: float = field(default_factory=time.time)


@dataclass
class WorldEvent:
    """An immutable record of something that happened."""
    id: str = field(default_factory=lambda: str(uuid4()))
    turn: int = 0
    timestamp: float = field(default_factory=time.time)
    event_type: EventType = EventType.ACTION
    description: str = ""
    location_id: str | None = None

    actor_id: str | None = None
    target_ids: list[str] = field(default_factory=list)

    state_before: dict[str, Any] = field(default_factory=dict)
    state_after: dict[str, Any] = field(default_factory=dict)

    validated: bool = False
    validator_notes: str = ""

    is_public: bool = True
    witness_ids: list[str] = field(default_factory=list)


@dataclass
class WorldState:
    """The complete state of the simulated world."""
    id: str = field(default_factory=lambda: str(uuid4()))
    name: str = "The World"
    current_turn: int = 0
    time: WorldTime = field(default_factory=WorldTime)
    weather: str = "clear"
    global_events: list[str] = field(default_factory=list)

    player: Player | None = None
    npcs: dict[str, NPC] = field(default_factory=dict)
    locations: dict[str, Location] = field(default_factory=dict)
    items: dict[str, Item] = field(default_factory=dict)
    relationships: dict[str, Relationship] = field(default_factory=dict)

    recent_events: list[WorldEvent] = field(default_factory=list)


@dataclass
class TokenUsage:
    """Token usage statistics."""
    prompt_tokens: int = 0
    completion_tokens: int = 0
    total_tokens: int = 0


@dataclass
class InferenceMetrics:
    """Metrics for a single inference call."""
    start_time: float = 0.0
    end_time: float | None = None
    first_token_time: float | None = None
    usage: TokenUsage | None = None
    tokens_generated: int = 0
    chunks_received: int = 0
    tokens_per_second: float = 0.0
    time_to_first_token: float | None = None
    total_latency: float | None = None
    model: str = ""


@dataclass
class ValidationResult:
    """Result of the critic's validation."""
    is_valid: bool = True
    errors: list[str] = field(default_factory=list)
    warnings: list[str] = field(default_factory=list)
    facts_checked: int = 0
    contradictions_found: int = 0


@dataclass
class ThinkingTrace:
    """A trace of AI thinking for transparency."""
    id: str = field(default_factory=lambda: str(uuid4()))
    timestamp: float = field(default_factory=time.time)
    phase: str = "generator"  # generator, critic, resolution
    content: str = ""
    is_complete: bool = False
