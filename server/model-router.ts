// Picks a Claude model per turn based on the message + (optionally) the
// skill being invoked. Three sources of override, in priority order:
//   1. `BOOP_MODEL` env set to a real model id (legacy pin)
//   2. Inline override in the user message ("use opus", "через haiku")
//   3. Persistent memory preference ("always use opus for code reviews")
// If none match, scoring heuristics decide between haiku / sonnet / opus.
//
// The heuristic is intentionally simple and easy to read — once we have
// enough usageRecords data, we'll replace it with cost-aware routing
// based on observed turn shapes.

import { api } from "../convex/_generated/api.js";
import { convex } from "./convex-client.js";

export type Tier = "haiku" | "sonnet" | "opus";

export const MODELS: Record<Tier, string> = {
  haiku: "claude-haiku-4-5",
  sonnet: "claude-sonnet-4-6",
  opus: "claude-opus-4-7",
};

export interface RouterInput {
  content: string;
  conversationId?: string;
  // Set when called from execution-agent and we know the skill being run.
  // Long-shape skills (large bodies / multi-step procedures) get a model
  // bump regardless of content length.
  skillShape?: "short" | "medium" | "long";
}

export interface RouterDecision {
  model: string;
  tier: Tier;
  reason: string;
}

// Inline overrides — must be a clear directive, not a passing mention.
// "use opus" wins over "I find opus interesting".
const INLINE_OPUS = /\b(use|with|на|через|за допомогою|використ\w*)\s+opus\b/i;
const INLINE_SONNET = /\b(use|with|на|через|за допомогою|використ\w*)\s+sonnet\b/i;
const INLINE_HAIKU = /\b(use|with|на|через|за допомогою|використ\w*)\s+haiku\b/i;

// Difficulty signals
const TECH_KEYWORDS =
  /\b(function|async|error|bug|schema|deploy|migrate|migration|regex|stack[\s-]?trace|crash|race[\s-]?condition|memoiz|architecture|архітектура|типчек|деплой|конфлікт|refactor|TypeScript)\b/i;
const RESEARCH_KEYWORDS =
  /\b(compare|порівня\w*|find|search|шук\w*|дослідж\w*|investigate|deep[\s-]?dive|analyze|analy[sz]e|audit|вивчи|порівняння|surveil)\b/i;
const MULTISTEP =
  /\b(step\s+\d|first[\s,]|second[\s,]|finally|спочатку|потім|після|then[\s,]|next,)\b/i;

// Chit-chat — if the message is one of these alone (or starts that way),
// pull score down hard.
const CHITCHAT_HEAD =
  /^(hi|hello|hey|привіт|здоров|ок|ok|thanks|дякую|спасибі|cool|круто|yeah|yep|ага|так|nope|ні|good\s?night|на\s?добраніч|good\s?morning|добрий\s?ранок|доброго\s?ранку)\b/i;

function detectInlineOverride(content: string): Tier | null {
  if (INLINE_OPUS.test(content)) return "opus";
  if (INLINE_HAIKU.test(content)) return "haiku";
  if (INLINE_SONNET.test(content)) return "sonnet";
  return null;
}

export function scoreContent(content: string): number {
  let score = 0;
  const trimmed = content.trim();
  const len = trimmed.length;

  if (len < 30) score -= 1;
  else if (len < 100) score += 0;
  else if (len < 300) score += 1;
  else if (len < 800) score += 2;
  else score += 3;

  if (CHITCHAT_HEAD.test(trimmed)) score -= 3;
  if (TECH_KEYWORDS.test(trimmed)) score += 2;
  if (RESEARCH_KEYWORDS.test(trimmed)) score += 2;
  if (MULTISTEP.test(trimmed)) score += 1;

  return score;
}

// Memory-driven persistent preference. Looks for an active "preference"
// memory record whose content matches a known preference pattern. Cheap
// to call — same Convex query as recall(), capped at 50 records.
async function detectMemoryOverride(
  conversationId?: string,
): Promise<RouterDecision | null> {
  if (!conversationId) return null;
  try {
    const records = await convex.query(api.memoryRecords.list, {
      lifecycle: "active",
      segment: "preference",
      limit: 50,
    });
    for (const r of records) {
      const t = r.content.toLowerCase();
      if (/(prefer|always|тільки|завжди)[^.]{0,40}\bopus\b/.test(t)) {
        return { model: MODELS.opus, tier: "opus", reason: "memory preference" };
      }
      if (/(prefer|always|тільки|завжди)[^.]{0,40}\bhaiku\b/.test(t)) {
        return { model: MODELS.haiku, tier: "haiku", reason: "memory preference" };
      }
    }
  } catch {
    // Memory query failure shouldn't gate the turn — fall through.
  }
  return null;
}

export async function selectModel(opts: RouterInput): Promise<RouterDecision> {
  // 1. Legacy env pin — set BOOP_MODEL to a model id to force it.
  // Set BOOP_MODEL=auto (or unset) to let the router decide.
  const envModel = process.env.BOOP_MODEL;
  if (envModel && envModel !== "auto") {
    return { model: envModel, tier: "sonnet", reason: "BOOP_MODEL pin" };
  }

  // 2. Inline override in current message
  const inline = detectInlineOverride(opts.content);
  if (inline) {
    return { model: MODELS[inline], tier: inline, reason: `inline ${inline}` };
  }

  // 3. Memory-driven preference
  const memOverride = await detectMemoryOverride(opts.conversationId);
  if (memOverride) return memOverride;

  // 4. Long-shape skill bump
  if (opts.skillShape === "long") {
    return { model: MODELS.opus, tier: "opus", reason: "long skill shape" };
  }
  if (opts.skillShape === "medium") {
    // Stay sonnet for medium — sufficient for most procedural skills.
    return { model: MODELS.sonnet, tier: "sonnet", reason: "medium skill shape" };
  }

  // 5. Heuristic scoring
  const score = scoreContent(opts.content);
  if (score >= 5) return { model: MODELS.opus, tier: "opus", reason: `score=${score}` };
  if (score >= 1) return { model: MODELS.sonnet, tier: "sonnet", reason: `score=${score}` };
  return { model: MODELS.haiku, tier: "haiku", reason: `score=${score}` };
}
