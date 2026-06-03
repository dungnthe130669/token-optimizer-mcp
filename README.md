     1|# token-optimizer-mcp
     2|
     3|> **50-70% reduction in Claude Code token consumption** via 11 MCP tools covering every layer of the AI agent context pipeline.
     4|
     5|## Why
     6|
     7|Every Claude Code request re-sends your full conversation history, all tool schemas, repeated file reads, and injected skills — most of it unchanged. This MCP server intercepts those layers and compresses them before they reach the LLM.
     8|
     9|## Install
    10|
    11|```bash
    12|npm install -g token-optimizer-mcp
    13|```
    14|
    15|Or use directly without installing:
    16|
    17|```json
    18|{
    19|  "mcpServers": {
    20|    "token-optimizer": {
    21|      "command": "npx",
    22|      "args": ["-y", "token-optimizer-mcp"],
    23|      "env": {
    24|        "TOKEN_OPTIMIZER_LLM_URL": "https://api.anthropic.com/v1/messages",
    25|        "TOKEN_OPTIMIZER_LLM_KEY": "your-api-key"
    26|      }
    27|    }
    28|  }
    29|}
    30|```
    31|
    32|Add to `~/.claude.json` (global) or `.claude/settings.json` (per-project).
    33|
    34|Then restart Claude Code.
    35|
## Environment Variables

| Variable | Required | Default | Description |
|---|---|---|---|
| `TOKEN_OPTIMIZER_LLM_URL` | No | Anthropic native | LLM endpoint (OpenAI-compat or Anthropic) |
| `TOKEN_OPTIMIZER_LLM_KEY` | No | empty | API key |
| `TOKEN_OPTIMIZER_CHEAP_MODEL` | No | `claude-haiku-4-5` | Model for compression tasks |

> `estimate_tokens`, `filter_active_tools`, `suggest_max_tokens`, `pack_context`, `unpack_context`, `get_savings_report` work with **no LLM config** — pure local computation.
> Only `compress_tool_output` and `compress_history` need an LLM.

## Tools

### Compression
| Tool | What it does | Est. saving |
|---|---|---|
| `compress_tool_output` | Summarize large tool results via cheap model before entering history | ~2000 tok/call |
| `compress_history` | Sliding window: summarize old turns, keep recent 10 verbatim (O(n)→O(1)) | ~3000-8000 tok/session |
| `deduplicate_context` | SHA1-detect repeated file reads, replace duplicates with pointers | 40-60% code sessions |

### Filtering
| Tool | What it does | Est. saving |
|---|---|---|
| `search_relevant_skills` | RAG search skill docs, return top-K relevant only | ~1500 tok/turn |
| `filter_active_tools` | Return minimal toolset for a task — reduce injected schema | ~3000-5000 tok/req |

### Output + Cache
| Tool | What it does | Est. saving |
|---|---|---|
| `suggest_max_tokens` | Classify task type, recommend max_tokens cap (output costs 5x input) | ~500-800 tok/req |
| `warm_cache` | Pre-warm Anthropic prompt cache before session | $3.75→$0.30 /1M |
| `estimate_tokens` | Estimate token count + cost before sending | Awareness |

### Multi-Agent
| Tool | What it does | Est. saving |
|---|---|---|
| `pack_context` | Compress structured context to base64 for agent handoff | ~5000-10000 tok/subagent |
| `unpack_context` | Restore packed context at subagent start | — |

### Analytics
| Tool | What it does |
|---|---|
| `get_savings_report` | Show cumulative savings by tool (last N days) |

## Indexing Skills (for `search_relevant_skills`)

Index your skill or doc directory once:

```bash
# Hermes Agent users
npx token-optimizer-mcp index ~/.hermes/skills

# Any markdown docs
npx token-optimizer-mcp index ~/my-project/docs
```

Model (`all-MiniLM-L6-v2`, 22MB) downloads on first run, cached after. No API key needed.

## CLI Commands

```bash
tok stats [--days=7]        # savings report with bar chart
tok index [dir]             # index docs into RAG store
tok search <query>          # semantic search
tok dashboard               # web UI at http://localhost:4242
```

## Expected Impact

| Layer | Tool | Est. Saving |
|---|---|---|
| System prompt | `search_relevant_skills` | ~1500 tok/turn |
| Tool schema | `filter_active_tools` | ~3000-5000 tok/req |
| History | `compress_history` | ~3000-8000 tok/session |
| Tool results | `compress_tool_output` | ~2000 tok/call |
| Repeated reads | `deduplicate_context` | 40-60% code sessions |
| Output | `suggest_max_tokens` | ~500-800 tok/req |
| Cache | `warm_cache` | 92% cost reduction |
| Subagent | `pack_context` | ~5000-10000 tok/agent |

**Total: 50-70% reduction** in token spend for typical Claude Code sessions.

## License

MIT — Dung Nguyen
