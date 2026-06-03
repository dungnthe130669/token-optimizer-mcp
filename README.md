     1|     1|# token-optimizer-mcp
     2|     2|
     3|     3|> **50-70% reduction in Claude Code token consumption** via 11 MCP tools covering every layer of the AI agent context pipeline.
     4|     4|
     5|     5|## Why
     6|     6|
     7|     7|Every Claude Code request re-sends your full conversation history, all tool schemas, repeated file reads, and injected skills — most of it unchanged. This MCP server intercepts those layers and compresses them before they reach the LLM.
     8|     8|
     9|     9|## Install
    10|    10|
    11|    11|```bash
    12|    12|npm install -g token-optimizer-mcp
    13|    13|```
    14|    14|
    15|    15|Or use directly without installing:
    16|    16|
    17|    17|```json
    18|    18|{
    19|    19|  "mcpServers": {
    20|    20|    "token-optimizer": {
    21|    21|      "command": "npx",
    22|    22|      "args": ["-y", "token-optimizer-mcp"],
    23|    23|      "env": {
    24|    24|        "TOKEN_OPTIMIZER_LLM_URL": "https://api.anthropic.com/v1/messages",
    25|    25|        "TOKEN_OPTIMIZER_LLM_KEY": "your-api-key"
    26|    26|      }
    27|    27|    }
    28|    28|  }
    29|    29|}
    30|    30|```
    31|    31|
    32|    32|Add to `~/.claude.json` (global) or `.claude/settings.json` (per-project).
    33|    33|
    34|    34|Then restart Claude Code.
    35|    35|
    36|## Environment Variables
    37|
    38|| Variable | Required | Default | Description |
    39||---|---|---|---|
    40|| `TOKEN_OPTIMIZER_LLM_URL` | No | Anthropic native | LLM endpoint (OpenAI-compat or Anthropic) |
    41|| `TOKEN_OPTIMIZER_LLM_KEY` | No | empty | API key |
    42|| `TOKEN_OPTIMIZER_CHEAP_MODEL` | No | `claude-haiku-4-5` | Model for compression tasks |
    43|
    44|> `estimate_tokens`, `filter_active_tools`, `suggest_max_tokens`, `pack_context`, `unpack_context`, `get_savings_report` work with **no LLM config** — pure local computation.
    45|> Only `compress_tool_output` and `compress_history` need an LLM.
    46|
    47|## Tools
    48|
    49|### Compression
    50|| Tool | What it does | Est. saving |
    51||---|---|---|
    52|| `compress_tool_output` | Summarize large tool results via cheap model before entering history | ~2000 tok/call |
    53|| `compress_history` | Sliding window: summarize old turns, keep recent 10 verbatim (O(n)→O(1)) | ~3000-8000 tok/session |
    54|| `deduplicate_context` | SHA1-detect repeated file reads, replace duplicates with pointers | 40-60% code sessions |
    55|
    56|### Filtering
    57|| Tool | What it does | Est. saving |
    58||---|---|---|
    59|| `search_relevant_skills` | RAG search skill docs, return top-K relevant only | ~1500 tok/turn |
    60|| `filter_active_tools` | Return minimal toolset for a task — reduce injected schema | ~3000-5000 tok/req |
    61|
    62|### Output + Cache
    63|| Tool | What it does | Est. saving |
    64||---|---|---|
    65|| `suggest_max_tokens` | Classify task type, recommend max_tokens cap (output costs 5x input) | ~500-800 tok/req |
    66|| `warm_cache` | Pre-warm Anthropic prompt cache before session | $3.75→$0.30 /1M |
    67|| `estimate_tokens` | Estimate token count + cost before sending | Awareness |
    68|
    69|### Multi-Agent
    70|| Tool | What it does | Est. saving |
    71||---|---|---|
    72|| `pack_context` | Compress structured context to base64 for agent handoff | ~5000-10000 tok/subagent |
    73|| `unpack_context` | Restore packed context at subagent start | — |
    74|
    75|### Analytics
    76|| Tool | What it does |
    77||---|---|
    78|| `get_savings_report` | Show cumulative savings by tool (last N days) |
    79|
    80|## Indexing Skills (for `search_relevant_skills`)
    81|
    82|Index your skill or doc directory once:
    83|
    84|```bash
    85|# Hermes Agent users
    86|npx token-optimizer-mcp index ~/.hermes/skills
    87|
    88|# Any markdown docs
    89|npx token-optimizer-mcp index ~/my-project/docs
    90|```
    91|
    92|Model (`all-MiniLM-L6-v2`, 22MB) downloads on first run, cached after. No API key needed.
    93|
    94|## CLI Commands
    95|
    96|```bash
    97|tok stats [--days=7]        # savings report with bar chart
    98|tok index [dir]             # index docs into RAG store
    99|tok search <query>          # semantic search
   100|tok dashboard               # web UI at http://localhost:4242
   101|```
   102|
   103|## Expected Impact
   104|
   105|| Layer | Tool | Est. Saving |
   106||---|---|---|
   107|| System prompt | `search_relevant_skills` | ~1500 tok/turn |
   108|| Tool schema | `filter_active_tools` | ~3000-5000 tok/req |
   109|| History | `compress_history` | ~3000-8000 tok/session |
   110|| Tool results | `compress_tool_output` | ~2000 tok/call |
   111|| Repeated reads | `deduplicate_context` | 40-60% code sessions |
   112|| Output | `suggest_max_tokens` | ~500-800 tok/req |
   113|| Cache | `warm_cache` | 92% cost reduction |
   114|| Subagent | `pack_context` | ~5000-10000 tok/agent |
   115|
   116|**Total: 50-70% reduction** in token spend for typical Claude Code sessions.
   117|
   118|## License
   119|
   120|MIT — Dung Nguyen
   121|