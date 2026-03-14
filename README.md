# pi-compact

Smart context compaction for Pi. Topic-aware summarization that preserves code context and drops chatter.

## Install

```bash
pi install npm:@artale/pi-compact
```

## Strategies

### balanced (default)
Keep code + key decisions. Summarize long discussions.

### code-first
Preserve all code blocks, file paths, errors, tool calls. Summarize prose to 1-2 sentences each. Drop social chatter.

### aggressive
Keep only actions and outcomes. Drop everything else. Target <20% of original length.

## Commands

```
/compact status              — show compaction stats and current strategy
/compact strategy <name>     — switch strategy (code-first|aggressive|balanced)
/compact now                 — force compaction immediately
/compact dry                 — preview what compaction prompt would be used
```

## Tools

- `compact_status` — show current strategy and stats
- `compact_strategy` — switch strategy programmatically

## How it works

Hooks into Pi's compaction system via `pre_compaction` event. When Pi triggers compaction (auto or manual), pi-compact injects strategy-specific prompts that tell the summarization model what to preserve and what to drop.

- **code-first**: preserves code blocks, file paths, errors, stack traces, tool I/O. Summarizes discussions.
- **aggressive**: keeps only tool calls, code, and final decisions. Drops everything else.
- **balanced**: preserves code + decisions with reasoning. Summarizes discussions to key points.

Tracks compaction count and reduction ratio per session.

## Zero dependencies

Uses only Pi's built-in extension API. No external packages.

## License

MIT
