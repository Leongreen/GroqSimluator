"""
Groq RPG Simulator - Textual Terminal UI

The Glass Box Interface: A high-fidelity terminal aesthetic
that makes compute tangible.
"""

from __future__ import annotations

import time
from threading import Thread
from queue import Queue

from textual.app import App, ComposeResult
from textual.containers import Container, Horizontal, Vertical, ScrollableContainer
from textual.widgets import Header, Footer, Static, Input, RichLog, Label
from textual.binding import Binding
from textual.reactive import reactive
from rich.text import Text
from rich.panel import Panel
from rich.table import Table
from rich.console import Group

from ..services import GroqService, MODELS
from ..engine import RealityEngine, AdversarialEngine, create_default_scenario
from ..memory import AtomicMemory
from ..models import InferenceMetrics, ValidationResult, ThinkingTrace


class MetricsPanel(Static):
    """Real-time metrics display panel."""

    turn = reactive(0)
    tps = reactive(0.0)
    tokens = reactive(0)
    latency = reactive(0.0)
    phase = reactive("idle")
    total_tokens = reactive(0)

    def compose(self) -> ComposeResult:
        yield Static(id="metrics-content")

    def watch_turn(self) -> None:
        self._update_display()

    def watch_tps(self) -> None:
        self._update_display()

    def watch_tokens(self) -> None:
        self._update_display()

    def watch_phase(self) -> None:
        self._update_display()

    def _update_display(self) -> None:
        table = Table(show_header=False, box=None, padding=(0, 1))
        table.add_column("Label", style="dim")
        table.add_column("Value", style="bold green")

        table.add_row("TURN", str(self.turn))
        table.add_row("TPS", f"{self.tps:.1f}")
        table.add_row("TOKENS", str(self.tokens))
        table.add_row("LATENCY", f"{self.latency:.0f}ms")
        table.add_row("SESSION", str(self.total_tokens))

        phase_style = {
            "idle": "white",
            "generator": "green",
            "critic": "yellow",
            "resolution": "magenta",
        }.get(self.phase, "white")

        content = self.query_one("#metrics-content", Static)
        content.update(Panel(
            Group(
                Text(f"[{self.phase.upper()}]", style=phase_style),
                table,
            ),
            title="[bold cyan]METRICS[/]",
            border_style="cyan",
        ))


class ThinkingPanel(Static):
    """Thinking trace display panel."""

    def compose(self) -> ComposeResult:
        yield ScrollableContainer(
            RichLog(id="thinking-log", highlight=True, markup=True),
            id="thinking-scroll",
        )

    def add_trace(self, trace: ThinkingTrace) -> None:
        log = self.query_one("#thinking-log", RichLog)
        phase_color = {
            "generator": "green",
            "critic": "yellow",
            "resolution": "magenta",
        }.get(trace.phase, "white")

        log.write(f"[{phase_color}][{trace.phase.upper()}][/] {trace.content[:200]}...")

    def clear(self) -> None:
        log = self.query_one("#thinking-log", RichLog)
        log.clear()


class ValidationPanel(Static):
    """Validation result display panel."""

    def compose(self) -> ComposeResult:
        yield Static(id="validation-content")

    def update_validation(self, result: ValidationResult | None) -> None:
        content = self.query_one("#validation-content", Static)

        if result is None:
            content.update(Panel(
                "[dim]Awaiting validation...[/]",
                title="[bold blue]VALIDATOR[/]",
                border_style="blue",
            ))
            return

        status = "[bold green]✓ VALID[/]" if result.is_valid else "[bold red]✗ INVALID[/]"
        details = f"Facts checked: {result.facts_checked}"

        errors_text = ""
        if result.errors:
            errors_text = "\n[red]Errors:[/]\n" + "\n".join(f"  • {e}" for e in result.errors[:3])

        warnings_text = ""
        if result.warnings:
            warnings_text = "\n[yellow]Warnings:[/]\n" + "\n".join(f"  • {w}" for w in result.warnings[:3])

        content.update(Panel(
            f"{status}\n{details}{errors_text}{warnings_text}",
            title="[bold blue]VALIDATOR[/]",
            border_style="green" if result.is_valid else "red",
        ))


class ToolCallsPanel(Static):
    """Tool calls display panel."""

    def compose(self) -> ComposeResult:
        yield ScrollableContainer(
            RichLog(id="tools-log", highlight=True, markup=True),
            id="tools-scroll",
        )

    def add_tool_call(self, name: str, args: str) -> None:
        log = self.query_one("#tools-log", RichLog)
        color = {
            "log_world_event": "magenta",
            "update_npc_state": "yellow",
            "draft_response": "green",
            "validation_result": "blue",
        }.get(name, "white")

        log.write(f"[{color}]{name}[/]: {args[:100]}...")

    def clear(self) -> None:
        log = self.query_one("#tools-log", RichLog)
        log.clear()


class WorldInfoPanel(Static):
    """World information display panel."""

    time_str = reactive("8:00 AM, Day 1")
    weather = reactive("clear")
    location = reactive("Unknown")

    def compose(self) -> ComposeResult:
        yield Static(id="world-content")

    def watch_time_str(self) -> None:
        self._update_display()

    def watch_weather(self) -> None:
        self._update_display()

    def watch_location(self) -> None:
        self._update_display()

    def _update_display(self) -> None:
        weather_emoji = {
            "clear": "☀️",
            "cloudy": "☁️",
            "rainy": "🌧️",
            "stormy": "⛈️",
            "foggy": "🌫️",
            "windy": "💨",
        }.get(self.weather, "🌤️")

        content = self.query_one("#world-content", Static)
        content.update(Panel(
            f"[cyan]Time:[/] {self.time_str}\n"
            f"[cyan]Weather:[/] {weather_emoji} {self.weather}\n"
            f"[cyan]Location:[/] {self.location}",
            title="[bold yellow]WORLD[/]",
            border_style="yellow",
        ))


class GroqRPGApp(App):
    """The main Groq RPG Simulator application."""

    CSS = """
    Screen {
        layout: grid;
        grid-size: 3 3;
        grid-columns: 1fr 1fr 25;
        grid-rows: 3 1fr 3;
    }

    #header {
        column-span: 3;
        background: $surface;
        color: $text;
        text-align: center;
        text-style: bold;
        padding: 1;
    }

    #main-output {
        column-span: 2;
        row-span: 1;
        border: solid green;
    }

    #side-panel {
        row-span: 1;
        layout: vertical;
    }

    #input-area {
        column-span: 2;
        dock: bottom;
    }

    #input-box {
        width: 100%;
    }

    MetricsPanel {
        height: auto;
        min-height: 10;
    }

    ThinkingPanel {
        height: 1fr;
        border: solid magenta;
    }

    #thinking-scroll {
        height: 100%;
    }

    ValidationPanel {
        height: auto;
        min-height: 6;
    }

    ToolCallsPanel {
        height: 1fr;
        border: solid blue;
    }

    #tools-scroll {
        height: 100%;
    }

    WorldInfoPanel {
        height: auto;
        min-height: 6;
    }

    RichLog {
        background: $surface;
        scrollbar-size: 1 1;
    }
    """

    BINDINGS = [
        Binding("ctrl+c", "quit", "Quit"),
        Binding("ctrl+l", "clear", "Clear"),
    ]

    def __init__(self):
        super().__init__()
        self.groq_service: GroqService | None = None
        self.reality_engine: RealityEngine | None = None
        self.adversarial_engine: AdversarialEngine | None = None
        self.memory: AtomicMemory | None = None
        self.is_processing = False
        self.total_tokens = 0
        self.message_queue: Queue = Queue()

    def compose(self) -> ComposeResult:
        yield Static(
            "[bold green]GROQ RPG SIMULATOR[/] — [dim]Reality Engine v0.1.0[/]",
            id="header",
        )

        yield ScrollableContainer(
            RichLog(id="game-log", highlight=True, markup=True),
            id="main-output",
        )

        yield Vertical(
            MetricsPanel(id="metrics"),
            WorldInfoPanel(id="world-info"),
            ThinkingPanel(id="thinking"),
            ValidationPanel(id="validation"),
            ToolCallsPanel(id="tools"),
            id="side-panel",
        )

        yield Container(
            Input(placeholder="What do you do?", id="input-box"),
            id="input-area",
        )

    def on_mount(self) -> None:
        """Initialize the game on mount."""
        self.initialize_game()

    def initialize_game(self) -> None:
        """Initialize all game systems."""
        try:
            # Initialize services
            self.memory = AtomicMemory()
            self.groq_service = GroqService()
            self.reality_engine = RealityEngine(self.memory)
            self.adversarial_engine = AdversarialEngine(
                self.groq_service,
                self.reality_engine,
                self.memory,
            )

            # Initialize world
            scenario = create_default_scenario()
            self.reality_engine.initialize_world(scenario)

            # Update UI
            self._update_world_info()

            # Show welcome message
            log = self.query_one("#game-log", RichLog)
            log.write(Panel(
                "[bold green]GROQ RPG SIMULATOR[/] — Reality Engine v0.1.0\n\n"
                f"Welcome to [cyan]{scenario.name}[/].\n\n"
                "The world awaits your actions. This is a simulation, not a story.\n"
                "The world does not bend to your will — it responds to your choices.\n\n"
                "[dim]Type your actions below and press Enter.[/]",
                title="[bold]SYSTEM[/]",
                border_style="green",
            ))

            # Show initial situation
            situation = self.reality_engine.get_current_situation()
            log.write(Panel(
                f"{situation.description}\n\n"
                f"[cyan]Exits:[/] {', '.join(e.direction for e in situation.exits) or 'None visible'}\n"
                f"[cyan]Weather:[/] {situation.weather}",
                title=f"[bold]{situation.location.name if situation.location else 'Unknown'}[/]",
                border_style="blue",
            ))

        except Exception as e:
            log = self.query_one("#game-log", RichLog)
            log.write(f"[bold red]ERROR:[/] Failed to initialize: {e}")

    def _update_world_info(self) -> None:
        """Update the world info panel."""
        if not self.reality_engine:
            return

        state = self.reality_engine.get_state()
        world_info = self.query_one("#world-info", WorldInfoPanel)
        world_info.time_str = state.time.format()
        world_info.weather = state.weather

        location = self.reality_engine.get_current_location()
        world_info.location = location.name if location else "Unknown"

        metrics = self.query_one("#metrics", MetricsPanel)
        metrics.turn = state.current_turn
        metrics.total_tokens = self.total_tokens

    async def on_input_submitted(self, event: Input.Submitted) -> None:
        """Handle player input."""
        if self.is_processing or not event.value.strip():
            return

        player_input = event.value.strip()
        event.input.value = ""

        # Show player input
        log = self.query_one("#game-log", RichLog)
        log.write(f"\n[bold green]>[/] {player_input}\n")

        # Process in background thread
        self.is_processing = True
        self.query_one("#input-box", Input).disabled = True

        # Clear panels
        self.query_one("#thinking", ThinkingPanel).clear()
        self.query_one("#tools", ToolCallsPanel).clear()
        self.query_one("#validation", ValidationPanel).update_validation(None)

        # Run processing in thread
        thread = Thread(target=self._process_input_thread, args=(player_input,))
        thread.start()

        # Start polling for updates
        self.set_interval(0.1, self._poll_updates, name="poll_updates")

    def _process_input_thread(self, player_input: str) -> None:
        """Process player input in background thread."""
        try:
            metrics_panel = self.query_one("#metrics", MetricsPanel)
            thinking_panel = self.query_one("#thinking", ThinkingPanel)
            tools_panel = self.query_one("#tools", ToolCallsPanel)
            validation_panel = self.query_one("#validation", ValidationPanel)

            def on_phase_change(phase: str) -> None:
                self.call_from_thread(lambda: setattr(metrics_panel, "phase", phase))

            def on_content(delta: str, accumulated: str) -> None:
                self.message_queue.put(("content", accumulated))

            def on_thinking(trace: ThinkingTrace) -> None:
                self.call_from_thread(lambda: thinking_panel.add_trace(trace))

            def on_tool_call(tc) -> None:
                self.call_from_thread(lambda: tools_panel.add_tool_call(tc.name, tc.arguments[:50]))

            def on_metrics(m: InferenceMetrics) -> None:
                self.call_from_thread(lambda: self._update_metrics(m))

            def on_validation(v: ValidationResult) -> None:
                self.call_from_thread(lambda: validation_panel.update_validation(v))

            # Run adversarial loop
            result = self.adversarial_engine.run_adversarial_loop(
                player_input,
                on_phase_change=on_phase_change,
                on_content=on_content,
                on_thinking=on_thinking,
                on_tool_call=on_tool_call,
                on_metrics=on_metrics,
                on_validation=on_validation,
            )

            # End turn
            self.reality_engine.end_turn()

            # Update totals
            self.total_tokens += result.total_tokens

            # Queue final result
            self.message_queue.put(("result", result))

        except Exception as e:
            self.message_queue.put(("error", str(e)))

    def _update_metrics(self, m: InferenceMetrics) -> None:
        """Update metrics panel."""
        metrics = self.query_one("#metrics", MetricsPanel)
        metrics.tps = m.tokens_per_second
        metrics.tokens = m.tokens_generated
        metrics.latency = (m.total_latency or 0) * 1000

    def _poll_updates(self) -> None:
        """Poll for updates from background thread."""
        while not self.message_queue.empty():
            msg_type, data = self.message_queue.get()

            if msg_type == "content":
                # Streaming content (could show live, but we'll wait for result)
                pass

            elif msg_type == "result":
                self._show_result(data)
                self._finish_processing()

            elif msg_type == "error":
                log = self.query_one("#game-log", RichLog)
                log.write(f"[bold red]ERROR:[/] {data}")
                self._finish_processing()

    def _show_result(self, result) -> None:
        """Show the final result."""
        log = self.query_one("#game-log", RichLog)

        # Show events
        for event in result.generator_result.events:
            log.write(f"[dim magenta][{event.event_type.value.upper()}][/] {event.description}")

        # Show narrative
        log.write(Panel(
            result.final_narrative,
            title="[bold]WORLD[/]",
            border_style="blue",
        ))

        # Update world info
        self._update_world_info()

    def _finish_processing(self) -> None:
        """Finish processing and re-enable input."""
        self.is_processing = False
        self.query_one("#input-box", Input).disabled = False
        self.query_one("#input-box", Input).focus()

        metrics = self.query_one("#metrics", MetricsPanel)
        metrics.phase = "idle"

        # Stop polling
        try:
            self.remove_timer("poll_updates")
        except Exception:
            pass

    def action_clear(self) -> None:
        """Clear the game log."""
        log = self.query_one("#game-log", RichLog)
        log.clear()

    def action_quit(self) -> None:
        """Quit the application."""
        if self.memory:
            self.memory.close()
        self.exit()
