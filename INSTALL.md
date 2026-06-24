# Installation Guide

> This guide is designed to be followed by humans **or** AI agents.
> Each step includes exact commands and expected outputs for automated verification.

## Prerequisites

| Requirement | Why | Check |
|-------------|-----|-------|
| [OpenCode](https://opencode.ai) with plugin support | Host application | `opencode --version` |
| Node.js 22.5+ | Built-in `node:sqlite` | `node --version` |
| ~300 MB free disk | Embedding model (one-time download) | — |

Node < 22.5? Install the fallback SQLite binding:

```bash
npm install better-sqlite3
```

## Installation

Pick **one** method. Add the corresponding entry to `~/.config/opencode/opencode.json` under the `"plugin"` array.

### A. GitHub (recommended — latest features)

```jsonc
{
  "plugin": ["opencode-mem@github:ZelinZhou-THU/opencode-mem-mimo"]
}
```

### B. npm (stable releases)

```jsonc
{
  "plugin": ["opencode-mem"]
}
```

### C. Local development

```jsonc
{
  "plugin": ["opencode-mem@file:/absolute/path/to/opencode-mem"]
}
```

## What Happens on First Run (all automatic)

When you restart OpenCode after adding the plugin, the following happens without user intervention:

1. **Config generated** — `~/.config/opencode/opencode-mem.jsonc` created from template (if missing)
2. **Subagents installed** — `dream.md` and `distill.md` written to `~/.config/opencode/{agents,commands}/`
3. **AGENTS.md created** — project-root `AGENTS.md` written for memory priming (skipped if a user-authored one already exists)
4. **Embedding model downloaded** — `Xenova/nomic-embed-text-v1` (~250 MB, one-time)
5. **Web server started** — memory UI at `http://127.0.0.1:4747`

Step 4 may take 30–60 s on first launch. The plugin is usable immediately after.

## Verification Checklist

Run these checks after first launch. **All five must pass.**

### 1. Plugin web server is listening

```powershell
# Windows (PowerShell)
netstat -ano | Select-String "4747"
```

```bash
# macOS / Linux
lsof -i :4747
```

**Expected:** a line containing `LISTENING` (Windows) or a process bound to port 4747 (Unix).

### 2. API responds

```bash
curl -s http://127.0.0.1:4747/api/stats
```

**Expected:** `{"success":true,"data":{"total":N,"byScope":{...},"byType":{...}}}`

### 3. AGENTS.md exists in project root

```bash
head -1 AGENTS.md
```

**Expected:** `<!-- opencode-mem-agents-md-v1 -->`

If missing: check `"priming": {"agentsMd": true}` in `~/.config/opencode/opencode-mem.jsonc`.

### 4. dream / distill agents installed

```bash
ls ~/.config/opencode/agents/dream.md ~/.config/opencode/agents/distill.md \
   ~/.config/opencode/commands/dream.md ~/.config/opencode/commands/distill.md
```

**Expected:** all four paths exist.

### 5. Memory tool registered

In an OpenCode session, ask the agent:

> What tools do you have available?

**Expected:** the response includes a `memory` tool with modes `add`, `search`, `profile`, `list`, `forget`.

## Troubleshooting

### Port 4747 not listening

1. Check OpenCode log for plugin errors:
   ```bash
   # Log location: ~/.local/share/opencode/log/
   grep "service=plugin" ~/.local/share/opencode/log/*.log | grep ERROR
   ```
2. Verify `opencode.json` is valid JSON/JSONC (no trailing commas, no `undefined`).
3. Ensure no other process occupies port 4747.

### "no SQLite binding available"

Node 22.5+ provides `node:sqlite` natively. If unavailable:

```bash
npm install better-sqlite3
```

Or upgrade Node: `nvm install 22.5`.

### Embedding model download stuck / failed

The default model downloads from HuggingFace Hub. If behind a firewall, switch to API-based embeddings in `~/.config/opencode/opencode-mem.jsonc`:

```jsonc
{
  "embeddingApiUrl": "https://api.openai.com/v1",
  "embeddingApiKey": "sk-...",
  "embeddingModel": "text-embedding-3-small"
}
```

### AGENTS.md not created

1. Open `~/.config/opencode/opencode-mem.jsonc`.
2. Ensure `"priming": {"agentsMd": true}` is present (or remove the key to use the default `true`).
3. Restart OpenCode.
4. If an `AGENTS.md` already exists without the marker `<!-- opencode-mem-agents-md-v1 -->`, it is treated as user-authored and **never** overwritten.

## Key Configuration

The full config lives at `~/.config/opencode/opencode-mem.jsonc`. See the [README](README.md) for all options. Key settings:

| Setting | Default | Effect |
|---------|---------|--------|
| `systemPromptInjection.enabled` | `true` | Inject relevant memories into system prompt |
| `systemPromptInjection.minSimilarity` | `0.45` | Similarity threshold for injection |
| `systemPromptInjection.usageHint` | `true` | Always-on "use memory proactively" hint |
| `priming.agentsMd` | `true` | Auto-create AGENTS.md in project root |
| `webServerPort` | `4747` | Web UI port |
| `embeddingModel` | `Xenova/nomic-embed-text-v1` | Local embedding model (no API key needed) |
