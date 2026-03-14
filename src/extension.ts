/**
 * pi-compact — Smart context compaction for Pi
 *
 * Topic-aware summarization that preserves code context and drops chatter.
 * Configurable strategies. Zero external deps.
 *
 * Strategies:
 *   code-first  — preserve code blocks, file paths, errors. Summarize prose.
 *   aggressive  — keep only tool calls, code, and decisions. Drop everything else.
 *   balanced    — default. Keep code + key decisions. Summarize long discussions.
 *
 * Commands:
 *   /compact status           — show context usage and strategy
 *   /compact strategy <name>  — switch strategy
 *   /compact now              — force compaction immediately
 *   /compact dry              — preview what would be compacted
 *
 * Hooks:
 *   pre_compaction — rewrites the compaction prompt based on active strategy
 */

import type { ExtensionAPI } from '@anthropic-ai/claude-code'

type Strategy = 'code-first' | 'aggressive' | 'balanced'

interface CompactState {
  strategy: Strategy
  compactions: number
  lastCompactedAt: number | null
  tokensBeforeLast: number
  tokensAfterLast: number
}

const STRATEGY_PROMPTS: Record<Strategy, string> = {
  'code-first': `Summarize the conversation for context continuity. Rules:
- PRESERVE ALL: code blocks, file paths, error messages, stack traces, tool call inputs/outputs, git commands, test results
- PRESERVE: key architectural decisions and their reasoning
- SUMMARIZE BRIEFLY: discussions, questions, explanations — reduce to 1-2 sentences each
- DROP: greetings, acknowledgments, "sure", "got it", thinking-out-loud that led nowhere
- FORMAT: use bullet points, not paragraphs. Group by topic.
- START with "## Context Summary" header`,

  'aggressive': `Compress this conversation to minimum viable context. Rules:
- KEEP ONLY: tool calls and their results, code written/edited, file paths touched, errors encountered, final decisions made
- DROP EVERYTHING ELSE: discussions, alternatives considered, explanations, questions, social chatter
- FORMAT: numbered list of actions taken and outcomes. No prose.
- TARGET: reduce to <20% of original length
- START with "## Actions & Outcomes"`,

  'balanced': `Summarize the conversation preserving key context. Rules:
- PRESERVE: code blocks, file paths, errors, tool calls, decisions with reasoning
- SUMMARIZE: discussions to key points (1-2 sentences per topic)
- DROP: redundant exchanges, social chatter, repeated information
- PRESERVE: any TODO items, blockers, or next steps mentioned
- FORMAT: organized sections with headers. Bullet points over paragraphs.
- START with "## Session Summary"`,
}

const state: CompactState = {
  strategy: 'balanced',
  compactions: 0,
  lastCompactedAt: null,
  tokensBeforeLast: 0,
  tokensAfterLast: 0,
}

function analyzeMessages(messages: any[]): { codeBlocks: number; toolCalls: number; userMessages: number; assistantMessages: number; totalChars: number } {
  let codeBlocks = 0
  let toolCalls = 0
  let userMessages = 0
  let assistantMessages = 0
  let totalChars = 0

  for (const msg of messages) {
    if (msg.role === 'user') userMessages++
    if (msg.role === 'assistant') assistantMessages++

    const content = typeof msg.content === 'string' ? msg.content : JSON.stringify(msg.content || '')
    totalChars += content.length

    const codeMatches = content.match(/```/g)
    if (codeMatches) codeBlocks += Math.floor(codeMatches.length / 2)

    if (msg.role === 'assistant' && content.includes('tool_use')) toolCalls++
  }

  return { codeBlocks, toolCalls, userMessages, assistantMessages, totalChars }
}

function formatStatus(): string {
  const lines = [
    `## Compaction Status`,
    ``,
    `**Strategy:** ${state.strategy}`,
    `**Compactions this session:** ${state.compactions}`,
  ]

  if (state.lastCompactedAt) {
    const ago = Math.round((Date.now() - state.lastCompactedAt) / 60000)
    lines.push(`**Last compaction:** ${ago}m ago`)
    if (state.tokensBeforeLast && state.tokensAfterLast) {
      const ratio = Math.round((1 - state.tokensAfterLast / state.tokensBeforeLast) * 100)
      lines.push(`**Last reduction:** ${ratio}% (${state.tokensBeforeLast} → ${state.tokensAfterLast} tokens)`)
    }
  }

  lines.push(``, `**Available strategies:**`)
  lines.push(`- \`code-first\` — preserve all code, summarize prose`)
  lines.push(`- \`aggressive\` — keep only actions and outcomes`)
  lines.push(`- \`balanced\` — default, keep code + key decisions`)

  return lines.join('\n')
}

export default function init(pi: ExtensionAPI) {
  // Hook into compaction to inject our strategy prompt
  pi.on('pre_compaction', (event: any) => {
    if (event.prompt) {
      event.prompt = STRATEGY_PROMPTS[state.strategy]
    }
    return event
  })

  // Track compaction events
  pi.on('post_compaction', (event: any) => {
    state.compactions++
    state.lastCompactedAt = Date.now()
    if (event.tokensBefore) state.tokensBeforeLast = event.tokensBefore
    if (event.tokensAfter) state.tokensAfterLast = event.tokensAfter
  })

  // Command
  pi.addCommand({
    name: 'compact',
    description: 'Smart context compaction — manage strategies and trigger compaction',
    handler: async (args) => {
      const parts = args.trim().split(/\s+/)
      const sub = parts[0]?.toLowerCase()

      if (!sub || sub === 'status') {
        pi.sendMessage({ content: formatStatus(), display: true }, { triggerTurn: false })
        return
      }

      if (sub === 'strategy') {
        const name = parts[1]?.toLowerCase() as Strategy
        if (!name || !STRATEGY_PROMPTS[name]) {
          pi.sendMessage({
            content: `Usage: /compact strategy <code-first|aggressive|balanced>`,
            display: true,
          }, { triggerTurn: false })
          return
        }
        state.strategy = name
        pi.sendMessage({
          content: `Compaction strategy set to **${name}**.`,
          display: true,
        }, { triggerTurn: false })
        return
      }

      if (sub === 'now') {
        pi.sendMessage({
          content: `Triggering compaction with **${state.strategy}** strategy...`,
          display: true,
        }, { triggerTurn: true })
        return
      }

      if (sub === 'dry') {
        pi.sendMessage({
          content: `**Dry run** — current strategy: **${state.strategy}**\n\nCompaction prompt that would be used:\n\n\`\`\`\n${STRATEGY_PROMPTS[state.strategy]}\n\`\`\``,
          display: true,
        }, { triggerTurn: false })
        return
      }

      pi.sendMessage({
        content: '**Usage:**\n- `/compact status` — show context usage and strategy\n- `/compact strategy <name>` — switch strategy\n- `/compact now` — force compaction\n- `/compact dry` — preview compaction prompt',
        display: true,
      }, { triggerTurn: false })
    },
  })

  // Tool for agent use
  pi.addTool({
    name: 'compact_status',
    description: 'Show current compaction strategy, compaction count, and last reduction ratio.',
    parameters: { type: 'object', properties: {} },
    handler: async () => formatStatus(),
  })

  pi.addTool({
    name: 'compact_strategy',
    description: 'Switch compaction strategy. Options: code-first (preserve code, summarize prose), aggressive (keep only actions/outcomes), balanced (default).',
    parameters: {
      type: 'object',
      properties: {
        strategy: { type: 'string', enum: ['code-first', 'aggressive', 'balanced'], description: 'Compaction strategy' },
      },
      required: ['strategy'],
    },
    handler: async (params: { strategy: Strategy }) => {
      if (!STRATEGY_PROMPTS[params.strategy]) return `Invalid strategy. Use: code-first, aggressive, balanced.`
      state.strategy = params.strategy
      return `Compaction strategy set to **${params.strategy}**.`
    },
  })
}
