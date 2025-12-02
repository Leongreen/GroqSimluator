"""
Groq Service - The inference backbone.

Handles all communication with Groq's LPU-powered API.
Implements streaming, tool use, and metrics tracking.
"""

from __future__ import annotations

import os
import json
import time
from typing import AsyncIterator, Callable, Any
from dataclasses import dataclass, field

from groq import Groq
from dotenv import load_dotenv

from ..models import InferenceMetrics, TokenUsage

# Load environment variables
load_dotenv()

# Available models
MODELS = {
    "FAST": "llama-3.3-70b-versatile",
    "REASONING": "deepseek-r1-distill-llama-70b",
    "SMALL": "llama-3.1-8b-instant",
}

# Tool definitions for the RPG simulator
SIMULATOR_TOOLS = [
    {
        "type": "function",
        "function": {
            "name": "log_world_event",
            "description": "Record an event that occurred in the world. Every action, dialogue, or state change MUST be logged.",
            "parameters": {
                "type": "object",
                "properties": {
                    "event_type": {
                        "type": "string",
                        "enum": ["action", "dialogue", "observation", "state_change", "combat", "death", "item_transfer", "location_change"],
                        "description": "The type of event",
                    },
                    "description": {
                        "type": "string",
                        "description": "A detailed description of what happened",
                    },
                    "actor_id": {
                        "type": "string",
                        "description": "The ID of the entity that initiated this event (or 'player')",
                    },
                    "target_ids": {
                        "type": "array",
                        "items": {"type": "string"},
                        "description": "IDs of entities affected by this event",
                    },
                    "state_changes": {
                        "type": "object",
                        "description": "Key-value pairs of state changes",
                    },
                    "is_public": {
                        "type": "boolean",
                        "description": "Whether this event is observable by nearby entities",
                    },
                },
                "required": ["event_type", "description", "actor_id"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "update_npc_state",
            "description": "Update an NPC's internal state, goals, or knowledge",
            "parameters": {
                "type": "object",
                "properties": {
                    "npc_id": {
                        "type": "string",
                        "description": "The ID of the NPC to update",
                    },
                    "current_activity": {
                        "type": "string",
                        "description": "What the NPC is currently doing",
                    },
                    "new_knowledge": {
                        "type": "array",
                        "items": {"type": "string"},
                        "description": "New facts the NPC has learned",
                    },
                    "emotional_state": {
                        "type": "string",
                        "description": "The NPC's current emotional state",
                    },
                },
                "required": ["npc_id"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "draft_response",
            "description": "Draft the narrative response to show the player.",
            "parameters": {
                "type": "object",
                "properties": {
                    "narrative": {
                        "type": "string",
                        "description": "The narrative text describing what the player perceives",
                    },
                    "threat_level": {
                        "type": "string",
                        "enum": ["safe", "cautious", "dangerous", "critical"],
                        "description": "The current threat level",
                    },
                },
                "required": ["narrative"],
            },
        },
    },
]

CRITIC_TOOLS = [
    {
        "type": "function",
        "function": {
            "name": "validation_result",
            "description": "Report the validation result for the proposed reality",
            "parameters": {
                "type": "object",
                "properties": {
                    "is_valid": {
                        "type": "boolean",
                        "description": "Whether the proposed reality is consistent",
                    },
                    "errors": {
                        "type": "array",
                        "items": {"type": "string"},
                        "description": "Critical inconsistencies that must be fixed",
                    },
                    "warnings": {
                        "type": "array",
                        "items": {"type": "string"},
                        "description": "Minor issues or concerns",
                    },
                    "facts_checked": {
                        "type": "number",
                        "description": "Number of facts verified against memory",
                    },
                },
                "required": ["is_valid", "errors", "warnings", "facts_checked"],
            },
        },
    },
]


@dataclass
class ToolCall:
    """An accumulated tool call from streaming."""
    id: str
    name: str
    arguments: str


@dataclass
class StreamResult:
    """Result of a streaming completion."""
    content: str = ""
    reasoning: str = ""
    tool_calls: list[ToolCall] = field(default_factory=list)
    usage: TokenUsage | None = None
    metrics: InferenceMetrics = field(default_factory=InferenceMetrics)


def safe_json_parse(text: str) -> dict | None:
    """Safely parse JSON that might be wrapped in markdown."""
    try:
        return json.loads(text)
    except json.JSONDecodeError:
        # Try extracting from markdown code block
        import re
        match = re.search(r'```(?:json)?\s*([\s\S]*?)```', text)
        if match:
            try:
                return json.loads(match.group(1).strip())
            except json.JSONDecodeError:
                return None
        return None


class GroqService:
    """Service for interacting with the Groq API."""

    def __init__(self, api_key: str | None = None):
        self.api_key = api_key or os.getenv("GROQ_API_KEY", "")
        if not self.api_key:
            raise ValueError("GROQ_API_KEY not set. Please set the environment variable or pass api_key.")
        self.client = Groq(api_key=self.api_key)

    def stream_completion(
        self,
        messages: list[dict],
        model: str = MODELS["FAST"],
        tools: list[dict] | None = None,
        max_tokens: int = 4096,
        on_content: Callable[[str, str], None] | None = None,
        on_reasoning: Callable[[str, str], None] | None = None,
        on_tool_call: Callable[[ToolCall], None] | None = None,
        on_metrics: Callable[[InferenceMetrics], None] | None = None,
    ) -> StreamResult:
        """Stream a chat completion with full metrics tracking."""
        start_time = time.time()
        first_token_time: float | None = None

        metrics = InferenceMetrics(
            start_time=start_time,
            model=model,
        )

        content = ""
        reasoning = ""
        accumulated_tool_calls: dict[int, ToolCall] = {}
        final_usage: TokenUsage | None = None

        # Build request params
        request_params: dict[str, Any] = {
            "model": model,
            "messages": messages,
            "stream": True,
            "max_tokens": max_tokens,
        }

        if tools:
            request_params["tools"] = tools

        try:
            stream = self.client.chat.completions.create(**request_params)

            for chunk in stream:
                metrics.chunks_received += 1

                # Track first token time
                if first_token_time is None and chunk.choices and chunk.choices[0].delta.content:
                    first_token_time = time.time()
                    metrics.first_token_time = first_token_time
                    metrics.time_to_first_token = first_token_time - start_time

                # Extract usage from chunk
                if hasattr(chunk, 'usage') and chunk.usage:
                    final_usage = TokenUsage(
                        prompt_tokens=chunk.usage.prompt_tokens,
                        completion_tokens=chunk.usage.completion_tokens,
                        total_tokens=chunk.usage.total_tokens,
                    )

                # Also check x_groq for usage
                if hasattr(chunk, 'x_groq') and chunk.x_groq and hasattr(chunk.x_groq, 'usage'):
                    usage = chunk.x_groq.usage
                    final_usage = TokenUsage(
                        prompt_tokens=usage.prompt_tokens,
                        completion_tokens=usage.completion_tokens,
                        total_tokens=usage.total_tokens,
                    )

                # Handle content delta
                if chunk.choices and chunk.choices[0].delta.content:
                    delta = chunk.choices[0].delta.content
                    content += delta
                    metrics.tokens_generated += 1
                    if on_content:
                        on_content(delta, content)

                # Handle reasoning delta (for DeepSeek R1 style)
                if chunk.choices and hasattr(chunk.choices[0].delta, 'reasoning'):
                    delta = chunk.choices[0].delta.reasoning
                    if delta:
                        reasoning += delta
                        if on_reasoning:
                            on_reasoning(delta, reasoning)

                # Handle tool calls (accumulate by index)
                if chunk.choices and chunk.choices[0].delta.tool_calls:
                    for tc in chunk.choices[0].delta.tool_calls:
                        idx = tc.index
                        if idx not in accumulated_tool_calls:
                            accumulated_tool_calls[idx] = ToolCall(
                                id=tc.id or f"tool_{idx}",
                                name=tc.function.name if tc.function else "",
                                arguments="",
                            )
                        if tc.function and tc.function.name:
                            accumulated_tool_calls[idx].name = tc.function.name
                        if tc.function and tc.function.arguments:
                            accumulated_tool_calls[idx].arguments += tc.function.arguments

                # Update metrics
                elapsed = time.time() - start_time
                metrics.tokens_per_second = metrics.tokens_generated / max(elapsed, 0.001)
                if on_metrics:
                    on_metrics(metrics)

            # Finalize metrics
            end_time = time.time()
            metrics.end_time = end_time
            metrics.total_latency = end_time - start_time
            metrics.usage = final_usage

            if final_usage:
                metrics.tokens_generated = final_usage.completion_tokens
                elapsed = end_time - start_time
                metrics.tokens_per_second = final_usage.completion_tokens / max(elapsed, 0.001)

            # Convert tool calls to list
            tool_calls_list = list(accumulated_tool_calls.values())
            for tc in tool_calls_list:
                if on_tool_call:
                    on_tool_call(tc)

            return StreamResult(
                content=content,
                reasoning=reasoning,
                tool_calls=tool_calls_list,
                usage=final_usage,
                metrics=metrics,
            )

        except Exception as e:
            metrics.end_time = time.time()
            metrics.total_latency = metrics.end_time - start_time
            raise e

    def stream_with_retry(
        self,
        messages: list[dict],
        model: str = MODELS["FAST"],
        tools: list[dict] | None = None,
        max_retries: int = 3,
        **kwargs,
    ) -> StreamResult:
        """Stream with exponential backoff retry."""
        last_error: Exception | None = None

        for attempt in range(max_retries):
            try:
                return self.stream_completion(messages, model, tools, **kwargs)
            except Exception as e:
                last_error = e
                # Don't retry validation errors
                if hasattr(e, 'code') and e.code in ('tool_use_failed', 'json_validate_failed'):
                    raise
                # Exponential backoff
                if attempt < max_retries - 1:
                    time.sleep(2 ** attempt)

        raise last_error or Exception("Unknown error in stream_with_retry")
