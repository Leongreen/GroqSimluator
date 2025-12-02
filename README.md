# Groq RPG Simulator

A reality-first RPG simulation engine powered by Groq's LPU inference. This project implements a unique approach to AI-driven role-playing games that prioritizes simulation over narration.

## Design Philosophy

### 1. Reality Engine (Simulation > Narration)
Unlike standard AI Dungeon Masters, this system acts as a neutral physics engine. It prioritizes object permanence, independent NPC agency, and causal consistency over dramatic narrative arcs.

### 2. Glass Box (Transparency > Magic)
The interface exposes the internal thinking trace, tool usage, validator logic, and real-time compute metrics. A raw window into the powerful compute driving the simulation.

### 3. Atomic Memory (Structure > Context)
Narrative is treated as structured data, not just text. Events are captured as discrete, immutable database entries (SQLite), ensuring facts remain consistent across gameplay.

### 4. Adversarial Integrity (Truth > Creativity)
A Generator proposes reality, but it must pass inspection by a Critic (Consistency Engine) before the user sees it. This "Trust but Verify" loop eliminates hallucination.

### 5. Visceral Performance (Tangibility > Abstraction)
Real-time token counters, live TPS metrics, and sequential text rendering make the inference process tangible and physical.

## Architecture

```
groq_rpg/
├── engine/          # Reality Engine & Adversarial Architecture
│   ├── reality_engine.py      # World state, NPC agency, time system
│   └── adversarial_engine.py  # Generator/Critic validation loop
├── memory/          # Atomic Memory system (SQLite)
│   └── atomic_memory.py       # Immutable event and fact storage
├── services/        # Groq API integration
│   └── groq_service.py        # Streaming, tool use, metrics
├── ui/              # Textual terminal UI
│   └── app.py                 # Glass Box interface
├── models.py        # Data models and types
└── main.py          # Entry point
```

## Getting Started

```bash
# Install dependencies
pip install -e .

# Or install directly
pip install groq textual rich pydantic python-dotenv

# Configure your Groq API key
cp .env.example .env
# Edit .env and add your API key from https://console.groq.com/keys

# Run the simulator
python -m groq_rpg.main
```

## Configuration

Create a `.env` file in the project root with your Groq API key:

```
GROQ_API_KEY=your_groq_api_key_here
```

Get your API key from [Groq Console](https://console.groq.com/keys).

## Key Features

- **Independent NPC Agency**: NPCs have goals, fears, and schedules. They act autonomously when the player isn't watching.
- **Persistent World State**: Every action is logged as a structured event in SQLite.
- **Adversarial Validation**: All AI-generated content is validated for consistency before being shown.
- **Real-time Metrics**: Live TPS, token counts, and latency measurements.
- **Visible Thinking**: Watch the AI's reasoning process in real-time.
- **Terminal UI**: Beautiful terminal interface built with Textual.

## Technology Stack

- **UI**: Textual + Rich (terminal UI framework)
- **AI**: Groq SDK (LLaMA 3.3 70B)
- **Storage**: SQLite (atomic memory)
- **Language**: Python 3.10+

## Screenshots

The simulator runs in your terminal with a split-panel interface:
- Main panel: Game narrative and events
- Side panels: Real-time metrics, thinking trace, tool calls, validation status

## License

MIT
