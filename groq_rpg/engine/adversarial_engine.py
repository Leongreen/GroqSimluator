"""
Adversarial Architecture - Truth > Creativity

This module implements the "Trust but Verify" loop that anchors
the simulation in reality. A Generator proposes, a Critic inspects.

Philosophy: A single AI is prone to dreaming. We employ adversarial
validation to eliminate hallucination.
"""

from __future__ import annotations

import time
from dataclasses import dataclass, field
from typing import Callable, Any
from uuid import uuid4

from ..models import (
    WorldEvent, EventType, ValidationResult, ThinkingTrace, InferenceMetrics,
)
from ..services.groq_service import (
    GroqService, SIMULATOR_TOOLS, CRITIC_TOOLS, MODELS, ToolCall, safe_json_parse,
)
from ..memory import AtomicMemory, Fact
from .reality_engine import RealityEngine


# System prompts
GENERATOR_SYSTEM_PROMPT = """You are the REALITY ENGINE for a dark fantasy RPG simulation.

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

You are a physics engine, not a storyteller. Simulate, don't narrate."""

CRITIC_SYSTEM_PROMPT = """You are the CONSISTENCY ENGINE - a rigorous fact-checker for an RPG simulation.

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

You must call validation_result with your findings. Be thorough but fair."""


@dataclass
class NPCUpdate:
    """An update to an NPC's state."""
    npc_id: str
    current_activity: str | None = None
    new_knowledge: list[str] = field(default_factory=list)
    emotional_state: str | None = None


@dataclass
class GeneratorResult:
    """Result from the generator phase."""
    narrative: str = ""
    events: list[WorldEvent] = field(default_factory=list)
    npc_updates: list[NPCUpdate] = field(default_factory=list)
    metrics: InferenceMetrics = field(default_factory=InferenceMetrics)
    thinking: list[ThinkingTrace] = field(default_factory=list)
    tool_calls: list[ToolCall] = field(default_factory=list)


@dataclass
class CriticResult:
    """Result from the critic phase."""
    validation: ValidationResult = field(default_factory=ValidationResult)
    metrics: InferenceMetrics = field(default_factory=InferenceMetrics)
    thinking: list[ThinkingTrace] = field(default_factory=list)


@dataclass
class AdversarialResult:
    """Final result from the adversarial loop."""
    final_narrative: str
    was_modified: bool
    generator_result: GeneratorResult
    critic_result: CriticResult
    resolution_attempts: int
    total_tokens: int
    total_time: float
    average_tps: float


class AdversarialEngine:
    """
    The adversarial validation engine.

    Implements the Generator/Critic loop for hallucination prevention.
    """

    MAX_RESOLUTION_ATTEMPTS = 3

    def __init__(
        self,
        groq_service: GroqService,
        reality_engine: RealityEngine,
        memory: AtomicMemory,
    ):
        self.groq = groq_service
        self.reality = reality_engine
        self.memory = memory

    def run_generator(
        self,
        player_input: str,
        world_context: str,
        on_content: Callable[[str, str], None] | None = None,
        on_thinking: Callable[[ThinkingTrace], None] | None = None,
        on_tool_call: Callable[[ToolCall], None] | None = None,
        on_metrics: Callable[[InferenceMetrics], None] | None = None,
    ) -> GeneratorResult:
        """Run the generator phase."""
        result = GeneratorResult()

        messages = [
            {"role": "system", "content": GENERATOR_SYSTEM_PROMPT},
            {"role": "user", "content": f"=== CURRENT WORLD STATE ===\n{world_context}\n\n=== PLAYER INPUT ===\n{player_input}"},
        ]

        def handle_reasoning(delta: str, accumulated: str) -> None:
            trace = ThinkingTrace(
                phase="generator",
                content=accumulated,
                is_complete=False,
            )
            result.thinking.append(trace)
            if on_thinking:
                on_thinking(trace)

        stream_result = self.groq.stream_completion(
            messages=messages,
            model=MODELS["FAST"],
            tools=SIMULATOR_TOOLS,
            on_content=on_content,
            on_reasoning=handle_reasoning,
            on_tool_call=on_tool_call,
            on_metrics=on_metrics,
        )

        result.metrics = stream_result.metrics
        result.tool_calls = stream_result.tool_calls

        # Process tool calls
        for tc in stream_result.tool_calls:
            args = safe_json_parse(tc.arguments)
            if not args:
                continue

            if tc.name == "log_world_event":
                event = WorldEvent(
                    turn=self.reality.state.current_turn,
                    event_type=EventType(args.get("event_type", "action")),
                    description=args.get("description", ""),
                    location_id=self.reality.state.player.location_id if self.reality.state.player else None,
                    actor_id=args.get("actor_id"),
                    target_ids=args.get("target_ids", []),
                    state_after=args.get("state_changes", {}),
                    is_public=args.get("is_public", True),
                )
                result.events.append(event)

            elif tc.name == "update_npc_state":
                update = NPCUpdate(
                    npc_id=args.get("npc_id", ""),
                    current_activity=args.get("current_activity"),
                    new_knowledge=args.get("new_knowledge", []),
                    emotional_state=args.get("emotional_state"),
                )
                result.npc_updates.append(update)

            elif tc.name == "draft_response":
                result.narrative = args.get("narrative", "")

        # Fallback to content if no draft_response
        if not result.narrative and stream_result.content:
            result.narrative = stream_result.content

        return result

    def run_critic(
        self,
        generator_result: GeneratorResult,
        world_context: str,
        relevant_facts: list[Fact],
        on_thinking: Callable[[ThinkingTrace], None] | None = None,
        on_metrics: Callable[[InferenceMetrics], None] | None = None,
    ) -> CriticResult:
        """Run the critic phase."""
        result = CriticResult()

        # Build proposal for critic
        events_text = "\n".join(
            f"- [{e.event_type.value}] {e.description}"
            for e in generator_result.events
        ) or "No events logged"

        updates_text = "\n".join(
            f"- NPC {u.npc_id}: {u.current_activity or 'no change'}"
            for u in generator_result.npc_updates
        ) or "No NPC updates"

        facts_text = "\n".join(
            f"- [{f.subject_type}:{f.subject_id[:8]}] {f.predicate} = {f.value}"
            for f in relevant_facts
        ) or "No established facts"

        proposal = f"""
=== PROPOSED NARRATIVE ===
{generator_result.narrative}

=== PROPOSED EVENTS ===
{events_text}

=== PROPOSED NPC UPDATES ===
{updates_text}

=== ESTABLISHED FACTS TO CHECK AGAINST ===
{facts_text}
"""

        messages = [
            {"role": "system", "content": CRITIC_SYSTEM_PROMPT},
            {"role": "user", "content": f"=== CURRENT WORLD STATE ===\n{world_context}\n\n=== PROPOSAL TO VERIFY ===\n{proposal}"},
        ]

        def handle_reasoning(delta: str, accumulated: str) -> None:
            trace = ThinkingTrace(
                phase="critic",
                content=accumulated,
                is_complete=False,
            )
            result.thinking.append(trace)
            if on_thinking:
                on_thinking(trace)

        stream_result = self.groq.stream_completion(
            messages=messages,
            model=MODELS["SMALL"],  # Faster model for critic
            tools=CRITIC_TOOLS,
            on_reasoning=handle_reasoning,
            on_metrics=on_metrics,
        )

        result.metrics = stream_result.metrics

        # Extract validation result
        for tc in stream_result.tool_calls:
            if tc.name == "validation_result":
                args = safe_json_parse(tc.arguments)
                if args:
                    result.validation = ValidationResult(
                        is_valid=args.get("is_valid", True),
                        errors=args.get("errors", []),
                        warnings=args.get("warnings", []),
                        facts_checked=args.get("facts_checked", 0),
                        contradictions_found=len(args.get("contradictions", [])),
                    )

        return result

    def run_adversarial_loop(
        self,
        player_input: str,
        on_phase_change: Callable[[str], None] | None = None,
        on_content: Callable[[str, str], None] | None = None,
        on_thinking: Callable[[ThinkingTrace], None] | None = None,
        on_tool_call: Callable[[ToolCall], None] | None = None,
        on_metrics: Callable[[InferenceMetrics], None] | None = None,
        on_validation: Callable[[ValidationResult], None] | None = None,
    ) -> AdversarialResult:
        """Run the full adversarial loop."""
        world_context = self.reality.build_generator_context()
        all_facts = self.memory.get_all_active_facts()

        attempts = 0
        generator_result: GeneratorResult | None = None
        critic_result: CriticResult | None = None
        total_tokens = 0
        start_time = time.time()

        while attempts < self.MAX_RESOLUTION_ATTEMPTS:
            attempts += 1

            # === GENERATOR PHASE ===
            if on_phase_change:
                on_phase_change("generator")

            # Add feedback if this is a retry
            input_with_feedback = player_input
            if attempts > 1 and critic_result:
                errors = ", ".join(critic_result.validation.errors)
                input_with_feedback = f"{player_input}\n\n[SYSTEM: Previous attempt was rejected. Errors: {errors}. Please fix and try again.]"

            generator_result = self.run_generator(
                input_with_feedback,
                world_context,
                on_content=on_content,
                on_thinking=on_thinking,
                on_tool_call=on_tool_call,
                on_metrics=on_metrics,
            )

            if generator_result.metrics.usage:
                total_tokens += generator_result.metrics.usage.total_tokens

            # === CRITIC PHASE ===
            if on_phase_change:
                on_phase_change("critic")

            critic_result = self.run_critic(
                generator_result,
                world_context,
                all_facts,
                on_thinking=on_thinking,
                on_metrics=on_metrics,
            )

            if critic_result.metrics.usage:
                total_tokens += critic_result.metrics.usage.total_tokens

            if on_validation:
                on_validation(critic_result.validation)

            # If valid, we're done
            if critic_result.validation.is_valid:
                break

            # If max attempts reached, proceed with warnings
            if attempts >= self.MAX_RESOLUTION_ATTEMPTS:
                break

            # Otherwise, loop with resolution phase
            if on_phase_change:
                on_phase_change("resolution")

        end_time = time.time()
        total_time = end_time - start_time

        # Apply validated changes to world
        if generator_result:
            for event in generator_result.events:
                event.validated = critic_result.validation.is_valid if critic_result else False
                event.validator_notes = "; ".join(critic_result.validation.warnings) if critic_result else ""
                self.memory.log_event(event)

            for update in generator_result.npc_updates:
                npc = self.reality.get_npc(update.npc_id)
                if npc:
                    if update.current_activity:
                        npc.current_activity = update.current_activity
                    for knowledge in update.new_knowledge:
                        if knowledge not in npc.knowledge:
                            npc.knowledge.append(knowledge)

        return AdversarialResult(
            final_narrative=generator_result.narrative if generator_result else "The world remains silent.",
            was_modified=attempts > 1,
            generator_result=generator_result or GeneratorResult(),
            critic_result=critic_result or CriticResult(),
            resolution_attempts=attempts,
            total_tokens=total_tokens,
            total_time=total_time,
            average_tps=total_tokens / max(total_time, 0.001),
        )
