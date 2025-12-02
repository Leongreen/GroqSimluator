"""
Reality Engine - Simulation > Narration

The neutral "physics engine" of the simulation. Unlike narrative-driven
AI Dungeon Masters, this system prioritizes:
- Object permanence
- Independent NPC agency
- Causal consistency

Philosophy: The world exists independently of the player.
"""

from __future__ import annotations

import random
import time
from dataclasses import dataclass, field
from uuid import uuid4

from ..models import (
    WorldState, WorldTime, Player, NPC, Location, Item,
    Relationship, WorldEvent, EventType, NPCGoal, Personality,
    LocationConnection,
)
from ..memory import AtomicMemory


@dataclass
class TimeAdvanceResult:
    """Result of advancing world time."""
    previous_time: WorldTime
    new_time: WorldTime
    triggered_events: list[str] = field(default_factory=list)
    npc_actions: list[str] = field(default_factory=list)


@dataclass
class WorldSituation:
    """Current situation in the world for AI context."""
    description: str
    location: Location | None
    nearby_npcs: list[NPC]
    nearby_items: list[Item]
    exits: list[LocationConnection]
    time: WorldTime
    weather: str
    threats: list[str]


class RealityEngine:
    """
    The core simulation engine.

    Manages world state, NPC agency, and time progression.
    """

    def __init__(self, memory: AtomicMemory | None = None):
        self.state = self._create_empty_world()
        self.memory = memory or AtomicMemory()

    def _create_empty_world(self) -> WorldState:
        """Create an empty world state."""
        return WorldState(
            id=str(uuid4()),
            name="The Realm of Shadows",
            current_turn=0,
            time=WorldTime(hour=8, day=1, month=1, year=1),
            weather="clear",
        )

    def initialize_world(self, scenario: WorldScenario) -> WorldState:
        """Initialize the world with a scenario."""
        self.state = self._create_empty_world()
        self.state.name = scenario.name

        # Add locations
        for loc in scenario.locations:
            self.state.locations[loc.id] = loc

        # Add items
        for item in scenario.items:
            self.state.items[item.id] = item

        # Add NPCs
        for npc in scenario.npcs:
            self.state.npcs[npc.id] = npc

        # Add relationships
        for rel in scenario.relationships:
            self.state.relationships[rel.id] = rel

        # Set player
        self.state.player = scenario.player

        # Log world creation
        event = WorldEvent(
            turn=0,
            event_type=EventType.SPAWN,
            description=f'The world "{scenario.name}" springs into existence.',
            validated=True,
            validator_notes="World initialization",
        )
        self.memory.log_event(event)

        # Save initial snapshot
        self.memory.save_snapshot(0, self.state)

        return self.state

    def get_state(self) -> WorldState:
        """Get the current world state."""
        return self.state

    def get_player(self) -> Player | None:
        """Get the player."""
        return self.state.player

    def get_npc(self, npc_id: str) -> NPC | None:
        """Get an NPC by ID."""
        return self.state.npcs.get(npc_id)

    def get_location(self, location_id: str) -> Location | None:
        """Get a location by ID."""
        return self.state.locations.get(location_id)

    def get_current_location(self) -> Location | None:
        """Get the player's current location."""
        if not self.state.player or not self.state.player.location_id:
            return None
        return self.state.locations.get(self.state.player.location_id)

    def get_entities_at_location(self, location_id: str) -> tuple[list[NPC], list[Item]]:
        """Get all entities at a location."""
        npcs = [
            npc for npc in self.state.npcs.values()
            if npc.location_id == location_id and npc.is_alive
        ]
        items = [
            item for item in self.state.items.values()
            if item.location_id == location_id
        ]
        return npcs, items

    # ========== TIME MANAGEMENT ==========

    def advance_time(self, hours: int = 1) -> TimeAdvanceResult:
        """Advance world time."""
        result = TimeAdvanceResult(
            previous_time=WorldTime(
                hour=self.state.time.hour,
                day=self.state.time.day,
                month=self.state.time.month,
                year=self.state.time.year,
            ),
            new_time=self.state.time,
        )

        self.state.time.hour += hours

        # Handle day rollover
        while self.state.time.hour >= 24:
            self.state.time.hour -= 24
            self.state.time.day += 1
            result.triggered_events.append(f"A new day dawns (Day {self.state.time.day}).")

            # Month rollover
            if self.state.time.day > 30:
                self.state.time.day = 1
                self.state.time.month += 1

                # Year rollover
                if self.state.time.month > 12:
                    self.state.time.month = 1
                    self.state.time.year += 1
                    result.triggered_events.append(f"A new year begins (Year {self.state.time.year}).")

        # Update weather occasionally
        if random.random() < 0.05:
            weathers = ["clear", "cloudy", "rainy", "stormy", "foggy", "windy"]
            self.state.weather = random.choice(weathers)

        # Process NPC schedules
        for npc in self.state.npcs.values():
            if npc.is_alive and self.state.time.hour in npc.schedule:
                new_activity = npc.schedule[self.state.time.hour]
                if new_activity != npc.current_activity:
                    result.npc_actions.append(
                        f"{npc.name} transitions to {new_activity}."
                    )
                    npc.current_activity = new_activity

        result.new_time = self.state.time
        return result

    def process_npc_agency(self) -> list[str]:
        """Process independent NPC actions."""
        results = []
        player_location = self.state.player.location_id if self.state.player else None

        for npc in self.state.npcs.values():
            if not npc.is_alive:
                continue

            is_near_player = npc.location_id == player_location

            # Process goals
            for goal in npc.goals:
                if not goal.is_complete and not is_near_player:
                    # 30% chance of progress when player isn't watching
                    if random.random() < 0.3:
                        goal.progress = min(1.0, goal.progress + 0.1)
                        if goal.progress >= 1.0:
                            goal.is_complete = True
                            results.append(f"{npc.name} achieved: {goal.description}")
                        else:
                            results.append(f"{npc.name} progresses toward: {goal.description}")

            # Update player tracking
            if is_near_player:
                npc.last_seen_player = time.time()
                npc.last_known_player_location = player_location

        return results

    def log_event(self, event: WorldEvent) -> WorldEvent:
        """Log an event to memory."""
        logged = self.memory.log_event(event)
        self.state.recent_events.append(logged)
        if len(self.state.recent_events) > 100:
            self.state.recent_events.pop(0)
        return logged

    def increment_turn(self) -> int:
        """Increment the turn counter."""
        self.state.current_turn += 1
        return self.state.current_turn

    def end_turn(self) -> tuple[int, TimeAdvanceResult, list[str]]:
        """End the current turn."""
        turn = self.increment_turn()
        time_result = self.advance_time(1)
        npc_results = self.process_npc_agency()

        # Save snapshot every 10 turns
        if turn % 10 == 0:
            self.memory.save_snapshot(turn, self.state)

        return turn, time_result, npc_results

    # ========== SITUATION QUERIES ==========

    def get_current_situation(self) -> WorldSituation:
        """Get the current situation for AI context."""
        player = self.state.player
        if not player:
            return WorldSituation(
                description="No player in world.",
                location=None,
                nearby_npcs=[],
                nearby_items=[],
                exits=[],
                time=self.state.time,
                weather=self.state.weather,
                threats=[],
            )

        location = self.get_current_location()
        npcs, items = self.get_entities_at_location(player.location_id) if player.location_id else ([], [])

        # Identify threats
        threats = []
        for npc in npcs:
            for rel in self.state.relationships.values():
                if rel.relationship_type == "hostile":
                    if (rel.source_id == npc.id and rel.target_id == player.id) or \
                       (rel.source_id == player.id and rel.target_id == npc.id):
                        threats.append(f"{npc.name} (hostile)")

        return WorldSituation(
            description=location.description if location else "Unknown location",
            location=location,
            nearby_npcs=npcs,
            nearby_items=items,
            exits=location.connections if location else [],
            time=self.state.time,
            weather=self.state.weather,
            threats=threats,
        )

    def build_generator_context(self) -> str:
        """Build context for the AI generator."""
        situation = self.get_current_situation()
        recent_events = self.memory.build_context_window(self.state.current_turn, 10)

        player_facts = ""
        if self.state.player:
            player_facts = self.memory.get_fact_summary([self.state.player.id])

        npc_facts = ""
        if situation.nearby_npcs:
            npc_ids = [n.id for n in situation.nearby_npcs]
            npc_facts = self.memory.get_fact_summary(npc_ids)

        return f"""
=== WORLD STATE (Turn {self.state.current_turn}) ===
Time: {self.state.time.format()} | Weather: {self.state.weather}
Location: {situation.location.name if situation.location else 'Unknown'}
Description: {situation.description}

=== PLAYER STATUS ===
Health: {self.state.player.health if self.state.player else 0}/{self.state.player.max_health if self.state.player else 0}
{player_facts or 'No player facts.'}

=== NEARBY ENTITIES ===
NPCs: {', '.join(f'{n.name} ({n.current_activity})' for n in situation.nearby_npcs) or 'None'}
Items: {', '.join(i.name for i in situation.nearby_items) or 'None'}
Exits: {', '.join(e.direction for e in situation.exits) or 'None'}
Threats: {', '.join(situation.threats) or 'None detected'}

=== NPC KNOWLEDGE ===
{npc_facts or 'No nearby NPCs.'}

=== RECENT HISTORY ===
{recent_events or 'No recent events.'}
""".strip()


@dataclass
class WorldScenario:
    """A scenario to initialize the world."""
    name: str
    player: Player
    locations: list[Location]
    npcs: list[NPC]
    items: list[Item]
    relationships: list[Relationship]


def create_default_scenario() -> WorldScenario:
    """Create the default starting scenario."""
    # Generate IDs
    player_location_id = str(uuid4())
    tavern_id = str(uuid4())
    market_id = str(uuid4())
    forest_id = str(uuid4())
    player_id = str(uuid4())
    bartender_id = str(uuid4())
    merchant_id = str(uuid4())
    stranger_id = str(uuid4())
    sword_id = str(uuid4())
    potion_id = str(uuid4())

    return WorldScenario(
        name="The Realm of Shadows",
        player=Player(
            id=player_id,
            name="Traveler",
            description="A weary traveler seeking fortune and adventure.",
            location_id=player_location_id,
            health=100,
            max_health=100,
            level=1,
            known_locations=[player_location_id],
            skills={"combat": 10, "stealth": 5, "persuasion": 8, "survival": 7},
        ),
        locations=[
            Location(
                id=player_location_id,
                name="Town Square",
                description="The central square of Ravenmoor. Cobblestones worn smooth by centuries. A dried-up fountain stands silent in the center. Dark buildings loom around the perimeter.",
                connections=[
                    LocationConnection(direction="north", target_id=tavern_id),
                    LocationConnection(direction="east", target_id=market_id),
                    LocationConnection(direction="west", target_id=forest_id),
                ],
                is_outdoor=True,
                light_level=0.7,
                danger_level=2,
            ),
            Location(
                id=tavern_id,
                name="The Rusted Nail Tavern",
                description="A dimly lit establishment. The smell of stale ale and woodsmoke hangs heavy. Patrons huddle at worn tables, speaking in hushed tones.",
                connections=[
                    LocationConnection(direction="south", target_id=player_location_id),
                ],
                is_outdoor=False,
                light_level=0.4,
                danger_level=1,
            ),
            Location(
                id=market_id,
                name="Abandoned Market",
                description="Empty stalls line the street, awnings tattered and faded. The wind whistles through broken crates.",
                connections=[
                    LocationConnection(direction="west", target_id=player_location_id),
                ],
                is_outdoor=True,
                light_level=0.8,
                danger_level=3,
            ),
            Location(
                id=forest_id,
                name="Edge of the Dark Forest",
                description="Ancient trees rise like twisted columns. Strange sounds echo from deeper within. Few who enter return unchanged.",
                connections=[
                    LocationConnection(direction="east", target_id=player_location_id),
                ],
                is_outdoor=True,
                light_level=0.2,
                danger_level=7,
            ),
        ],
        npcs=[
            NPC(
                id=bartender_id,
                name="Grigor",
                description="A grizzled bartender with a missing eye and scarred hands. Speaks little but sees everything.",
                location_id=tavern_id,
                health=80,
                max_health=80,
                level=3,
                goals=[
                    NPCGoal(description="Keep the tavern running", priority=1, progress=0.5),
                    NPCGoal(description="Protect his secret", priority=2, progress=0.0),
                ],
                fears=["fire", "the shadows that took his eye"],
                knowledge=[
                    "The merchant Vex deals in more than trinkets",
                    "Strangers have been disappearing from the forest road",
                    "The old well in the square was sealed for a reason",
                ],
                personality=Personality(aggression=0.2, curiosity=0.3, loyalty=0.7, greed=0.4, courage=0.6),
                current_activity="cleaning glasses",
                schedule={6: "waking", 7: "opening", 12: "serving lunch", 18: "dinner crowd", 22: "closing"},
            ),
            NPC(
                id=merchant_id,
                name="Vex",
                description="A thin man with quick eyes and quicker hands. His smile never reaches his eyes.",
                location_id=market_id,
                health=60,
                max_health=60,
                level=2,
                goals=[
                    NPCGoal(description="Acquire rare artifacts", priority=1, progress=0.3),
                    NPCGoal(description="Expand his network", priority=2, progress=0.2),
                ],
                fears=["the authorities", "losing his connections"],
                knowledge=[
                    "There is an entrance to tunnels beneath the market",
                    "The stranger at the edge of town seeks something valuable",
                    "Blood magic has been practiced in the forest",
                ],
                personality=Personality(aggression=0.3, curiosity=0.8, loyalty=0.1, greed=0.9, courage=0.4),
                current_activity="examining wares",
                schedule={8: "setting up", 12: "business", 18: "packing", 20: "meeting contacts"},
                inventory=[potion_id],
            ),
            NPC(
                id=stranger_id,
                name="The Hooded Stranger",
                description="A figure cloaked in shadow, face hidden. Watches the town from a distance, never speaking.",
                location_id=forest_id,
                health=150,
                max_health=150,
                level=8,
                goals=[
                    NPCGoal(description="Find the artifact hidden in Ravenmoor", priority=1, progress=0.1),
                    NPCGoal(description="Remain undetected", priority=2, progress=0.8),
                ],
                fears=["exposure", "failure"],
                knowledge=[
                    "An ancient power sleeps beneath this town",
                    "The sealed well is a gateway",
                    "The bartender knows more than he admits",
                ],
                personality=Personality(aggression=0.5, curiosity=0.4, loyalty=0.2, greed=0.3, courage=0.9),
                current_activity="watching the town",
                schedule={0: "investigating", 6: "retreating", 20: "approaching"},
                inventory=[sword_id],
            ),
        ],
        items=[
            Item(
                id=sword_id,
                name="Darksteel Blade",
                description="A sword forged from metal that drinks in light. Strange runes pulse along its edge.",
                weight=3.5,
                value=500,
                owner_id=stranger_id,
            ),
            Item(
                id=potion_id,
                name="Suspicious Vial",
                description="A glass vial containing viscous purple liquid. The label has been scratched off.",
                weight=0.2,
                value=30,
                is_consumable=True,
                owner_id=merchant_id,
            ),
        ],
        relationships=[
            Relationship(
                source_id=bartender_id,
                target_id=merchant_id,
                relationship_type="neutral",
                strength=-0.2,
                description="Grigor distrusts Vex but tolerates his presence.",
            ),
            Relationship(
                source_id=stranger_id,
                target_id=player_id,
                relationship_type="neutral",
                strength=0.0,
                description="The stranger has not yet formed an opinion of the traveler.",
            ),
        ],
    )
