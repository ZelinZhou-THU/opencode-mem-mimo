# opencode-mem-mimo

[![GitHub stars](https://img.shields.io/github/stars/ZelinZhou-THU/opencode-mem-mimo.svg)](https://github.com/ZelinZhou-THU/opencode-mem-mimo/stargazers)
[![license](https://img.shields.io/github/license/ZelinZhou-THU/opencode-mem-mimo.svg)](LICENSE)
[![based on](https://img.shields.io/badge/based%20on-opencode--mem-blue.svg)](https://github.com/tickernelz/opencode-mem)
[![inspiration](https://img.shields.io/badge/inspiration-MiMo--Code-purple.svg)](https://github.com/XiaomiMiMo/MiMo-Code)

A persistent memory system for AI coding agents. Long-term context retention across sessions, local-first SQLite storage, hybrid vector + full-text search, knowledge-consolidation subagents, and integration with `opencode`'s experimental compaction / system-prompt hooks.

> **What this fork adds over `tickernelz/opencode-mem`** (MiMo-Code-inspired):
>
> 1. **FTS5 hybrid search** — vector + BM25 fused scores, `trigram` tokenizer for CJK support
> 2. **Markdown dual storage** — `<project>/.opencode/MEMORY.md` and `~/.opencode-mem/global/MEMORY.md` reconciled on every search
> 3. **Compaction memory injection** — `experimental.session.compacting` hook preserves prior knowledge across compression
> 4. **Budgeted system-prompt injection** — `experimental.chat.system.transform` hook with token-budgeted, section-aware truncation
> 5. **`dream` and `distill` subagents** — auto-installed knowledge-consolidation and workflow-distillation agents that query `opencode.db` directly via `bash` + `sqlite3`
>
> See `DEV_REPORT_CN.md` for the full design and review log (5 rounds, 62 issues fixed, 34/34 tests pass).

## Core Features

- **Local SQLite + vector index.** SQLite is the source of truth, usearch-first in-memory index with automatic exact-scan fallback. No external service required.
- **Hybrid search (vector + FTS5).** Vector similarity and BM25 keyword scores are fused. FTS5 uses the `trigram` tokenizer, so CJK content is searchable out of the box.
- **Markdown dual storage.** `<project>/.opencode/MEMORY.md` and `~/.opencode-mem/global/MEMORY.md` are reconciled into the memory store on every search (size+mtime fingerprint, 30 s throttle). Edits to MEMORY.md become immediately searchable.
- **Compaction injection.** The `experimental.session.compacting` hook injects relevant memories into the LLM's compaction prompt so the compressed summary preserves prior knowledge.
- **System-prompt injection.** The `experimental.chat.system.transform` hook injects a token-budgeted memory block into the system prompt on each turn.
- **`dream` and `distill` subagents.** Two subagent definitions (Chinese playbooks, installed globally on first load) that consolidate memories into MEMORY.md and discover repeated workflows.
- **Web UI.** Browse, add, delete, search, pin, and export memories at `http://127.0.0.1:4747`.
- **Multi-provider AI.** Reuse any provider already authenticated in opencode; no separate API key required.

## Visual Overview

**Project Memory Timeline:**

![Project Memory Timeline](.github/screenshot-project-memory.png)

**User Profile Viewer:**

![User Profile Viewer](.github/screenshot-user-profile.png)

## Getting Started

Add to your OpenCode configuration at `~/.config/opencode/opencode.json`:

```jsonc
{
  "plugin": ["opencode-mem"]
}
```

On first load the plugin auto-installs `dream` and `distill` agents/commands into `~/.config/opencode/{agents,commands}/`. The plugin downloads automatically on next startup.

## Usage Examples

```typescript
memory({ mode: "add", content: "Project uses microservices architecture" });
memory({ mode: "search", query: "architecture decisions" });
memory({ mode: "search", query: "architecture decisions", scope: "all-projects" });
memory({ mode: "profile" });
memory({ mode: "list", limit: 10 });
memory({ mode: "forget", memoryId: "mem_…" });
```

The web interface is available at `http://127.0.0.1:4747` for visual memory browsing and management.

For project knowledge consolidation, use the `/dream` and `/distill` slash commands (installed globally on first plugin load).

## Configuration Essentials

Configure at `~/.config/opencode/opencode-mem.jsonc`:

```jsonc
{
  "storagePath": "~/.opencode-mem/data",
  "userEmailOverride": "user@example.com",
  "userNameOverride": "John Doe",
  "embeddingModel": "Xenova/nomic-embed-text-v1",
  "memory": { "defaultScope": "project" },
  "webServerEnabled": true,
  "webServerPort": 4747,

  "autoCaptureEnabled": true,
  "autoCaptureLanguage": "auto",

  "opencodeProvider": "anthropic",
  "opencodeModel": "claude-haiku-4-5-20251001",

  "showAutoCaptureToasts": true,
  "showUserProfileToasts": true,
  "showErrorToasts": true,

  "userProfileAnalysisInterval": 10,
  "maxMemories": 10,

  "vectorBackend": "exact-scan",

  "compaction": {
    "enabled": true,
    "memoryLimit": 10,
    "contextLimit": 2000
  },
  "systemPromptInjection": {
    "enabled": true,
    "tokenBudget": 1500,
    "maxResults": 5,
    "minSimilarity": 0.3
  },
  "markdown": {
    "enabled": true,
    "syncOnSearch": true,
    "autoWrite": false
  },
  "chatMessage": {
    "enabled": true,
    "maxMemories": 3,
    "excludeCurrentSession": true,
    "maxAgeDays": undefined,
    "injectOn": "first"
  }
}
```

### Memory Scope

- `scope: "project"`: query only the current project. This is the default.
- `scope: "all-projects"`: query `search` / `list` across all project shards.
- `memory.defaultScope` sets the default query scope when no explicit scope is provided.

### Hybrid Search (FTS5)

Searches always run vector + FTS5 in parallel. Scores are fused as:

```
final = max(vectorScore, vectorScore * 0.6 + ftsScore_normalized * 0.4)
```

The `max()` guard ensures the fused score never degrades below the raw vector similarity when FTS is a weak signal. The `trigram` tokenizer handles CJK, English, and mixed content equally well.

### Markdown Dual Storage

Two files are reconciled into the memory store:

| Path | Scope | Use case |
| --- | --- | --- |
| `<project>/.opencode/MEMORY.md` | project | durable project knowledge, rules, decisions, patterns — git-trackable |
| `~/.opencode-mem/global/MEMORY.md` | user (global) | cross-project preferences, habits, style rules |

Reconciliation runs on every search (30 s throttle), uses size+mtime fingerprinting, and is idempotent. Modified files are re-indexed; deleted files are pruned.

### Compaction & System-Prompt Injection

Both hooks depend on `experimental.*` opencode APIs and degrade silently if unavailable.

- `experimental.session.compacting` — injects the top-N most recent memories into the compaction prompt (capped at `compaction.contextLimit` chars).
- `experimental.chat.system.transform` — injects a token-budgeted `[Relevant Project Memory]` block into the system prompt. Filtered by `systemPromptInjection.minSimilarity` (default `0.3`, suitable for fused scores).

### `dream` and `distill` Subagents

On first load, the plugin installs four files to `~/.config/opencode/`:

- `agents/dream.md`, `agents/distill.md` — subagent definitions (Chinese playbooks, hidden from the agent list)
- `commands/dream.md`, `commands/distill.md` — slash-command entrypoints

Use `/dream` to consolidate project memories into `<project>/.opencode/MEMORY.md`. Use `/distill` to discover repeated workflows and package them as skills under `.opencode/skills/`.

The agents use `bash` + `sqlite3` to query `~/.local/share/opencode/opencode.db` (raw conversation trajectory) — this scales naturally because each agent decides what to query on demand. All `bash` commands require explicit user approval.

### Auto-Capture AI Provider

**Recommended:** Use any provider that is already authenticated in opencode (no separate API key needed in this plugin):

```jsonc
"opencodeProvider": "anthropic",
"opencodeModel": "claude-haiku-4-5-20251001",
```

The plugin issues structured-output requests to opencode's session API instead of calling provider endpoints directly, so opencode owns the auth, token refresh, and provider routing. Whatever you configured in opencode just works — Claude Pro/Max via OAuth, GitHub Copilot (personal & business), OpenAI / Anthropic API keys, custom providers, etc.

Supported providers: any provider listed by `opencode providers list` (e.g. `anthropic`, `openai`, `github-copilot`, ...).

**Fallback:** Manual API configuration (if not using opencodeProvider):

```jsonc
"memoryProvider": "openai-chat",
"memoryModel": "gpt-4o-mini",
"memoryApiUrl": "https://api.openai.com/v1",
"memoryApiKey": "sk-..."
```

**API Key Formats:**

```jsonc
"memoryApiKey": "sk-..."
"memoryApiKey": "file://~/.config/opencode/api-key.txt"
"memoryApiKey": "env://OPENAI_API_KEY"
```

## Public Subpath Exports

In addition to the main plugin entry, `opencode-mem` exposes one stable subpath that other opencode plugins can import directly. This avoids having to reverse-engineer container-tag conventions when writing third-party tools that read or write into the same memory store.

### `opencode-mem/tags`

Canonical container-tag helpers. The same functions opencode-mem itself uses to scope auto-captured memories.

```ts
import { getProjectTagInfo, getUserTagInfo, getTags } from "opencode-mem/tags";

// Canonical project tag derived from cwd (git remote URL if present, else
// the project root path). Format: `opencode_project_<sha16>`.
const projectTag = getProjectTagInfo(process.cwd()).tag;

// Canonical user tag derived from `git config user.email`.
// Format: `opencode_user_<sha16>`.
const userTag = getUserTagInfo().tag;

// Both at once.
const { user, project } = getTags(process.cwd());
```

Tags produced by these helpers match what auto-capture writes, so third-party plugins that call `POST /api/memories` will land in the same shards the rest of the system already understands. Hand-rolled tags whose substring isn't `_project_` or `_user_` end up in shadow shards that `/api/stats` and `/api/memories` silently filter out — using these helpers avoids that pitfall.

## Development & Contribution

```bash
bun install --ignore-scripts   # usearch fails to compile on Windows; safe to skip
bun run build                  # tsc + copy web/templates to dist
bun run typecheck              # tsc --noEmit
bun run format
```

### Source Layout

```
src/
  index.ts                          plugin entry; all hooks
  config.ts                         OpenCodeMemConfig + DEFAULTS + buildConfig
  plugin.ts                         plugin registration
  services/
    client.ts                       LocalMemoryClient (search/add/delete/list)
    embedding.ts                    local (Xenova) + remote (OpenAI-compatible) embed
    context.ts                      formatContextForPrompt / formatSystemPromptMemory
    budgeted-read.ts                section-aware token-budgeted file reads
    agent-installer.ts              auto-install dream/distill agents/commands
    markdown-memory.ts              MEMORY.md read/write/reconcile
    web-server.ts                   Express on http://127.0.0.1:4747
    auto-capture.ts                 session.idle → LLM summarization
    user-memory-learning.ts         per-user preference inference
    deduplication-service.ts        near-duplicate suppression
    cleanup-service.ts              retention + shard rotation
    api-handlers.ts                 HTTP API for the web UI
    privacy.ts                      redaction of secrets before persistence
    secret-resolver.ts              `env://`, `file://`, plain string keys
    language-detector.ts            auto-capture output language
    migration-service.ts            schema migrations
    tags.ts                         canonical container-tag helpers
    jsonc.ts                        stripJsoncComments
    logger.ts                       plugin logger
    ai/                             LLM providers (Anthropic, OpenAI, Gemini, opencode)
    sqlite/
      connection-manager.ts         WAL-mode connection pool
      shard-manager.ts              shard rotation (50k vectors/shard)
      vector-search.ts              vector+tag-weighted scoring
      fts-search.ts                 FTS5 init, BM25 search, triggers
      fts-query.ts                  CJK-safe query builder
      sqlite-bootstrap.ts           better-sqlite3 / node:sqlite / bun:sqlite
    vector-backends/                usearch + exact-scan + factory
    user-profile/                   preference/pattern/workflow inference
    user-prompt/                    rolling user-prompt buffer
templates/
  agents/dream.md                   dream subagent (Chinese)
  agents/distill.md                 distill subagent (Chinese)
  commands/dream.md                 /dream command
  commands/distill.md               /distill command
```

This project is actively seeking contributions. Whether you are fixing bugs, adding features, improving documentation, or expanding embedding model support, your contributions are critical. The codebase is well-structured and ready for enhancement. If you hit a blocker or have improvement ideas, submit a pull request — we review and merge contributions quickly.

## License & Links

MIT License — see `LICENSE` file.

- **Repository**: https://github.com/tickernelz/opencode-mem
- **Issues**: https://github.com/tickernelz/opencode-mem/issues
- **OpenCode Platform**: https://opencode.ai

Inspired by [opencode-supermemory](https://github.com/supermemoryai/opencode-supermemory). Subagent and FTS5 designs influenced by [XiaomiMiMo/MiMo-Code](https://github.com/XiaomiMiMo/MiMo-Code).
