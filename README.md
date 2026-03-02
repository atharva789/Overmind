# Overmind

Multiplayer AI coding agent for your terminal. A host opens a session in their project; teammates join from anywhere and submit prompts; an AI agent executes the changes live in the host's directory.

```
┌─────────────────────────────────────────────────────────────┐
│                        Architecture                          │
│                                                              │
│  Teammate A ──┐                                              │
│  Teammate B ──┼──► WebSocket Party ──► Story Agent          │
│  Teammate C ──┘         │              (clusters prompts)    │
│                         │                                    │
│                         ▼                                    │
│                   Scope Extractor                            │
│                   (Gemini: which files?)                     │
│                         │                                    │
│              ┌──────────┴──────────┐                        │
│              ▼                     ▼                         │
│        Local Agent          Modal Orchestrator               │
│        (OVERMIND_LOCAL=1)   (remote sandbox)                 │
│              │                     │                         │
│              └──────────┬──────────┘                        │
│                         ▼                                    │
│                  Host's Project Files                        │
└─────────────────────────────────────────────────────────────┘
```

## Setup

Requires Node.js 20+.

```bash
npm install -g github:atharva789/Overmind
```

Or clone and install locally:
```bash
git clone git@github.com:atharva789/Overmind.git
cd Overmind && npm install && npm link
```

Set your API key:
```bash
export GEMINI_API_KEY="your-key"
```

## Host a Session

Navigate to your project and start:
```bash
overmind host --port 4444
```

This prints a 4-letter party code (e.g. `ABCD`). Share it with teammates.

**To expose over the internet via ngrok:**
```bash
ngrok tcp 4444
# Share the ngrok host, port, and party code
```

## Join a Session

```bash
# Over the internet (ngrok)
overmind join ABCD --server 4.tcp.ngrok.io --port 14680 -u "YourName"

# Local network
overmind join ABCD --server 192.168.1.50 --port 4444 -u "YourName"
```

## Execution Modes

| Mode | Config | Description |
|------|--------|-------------|
| Local | `OVERMIND_LOCAL=1` | Runs Gemini agent directly on host machine |
| Remote | `OVERMIND_ORCHESTRATOR_URL=...` | Executes in a Modal cloud sandbox |

For local mode, add to `.env`:
```
OVERMIND_LOCAL=1
GEMINI_API_KEY=your-key
```
