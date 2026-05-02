// Pre-execution cost-band estimator. Sister to the post-execution
// disclosure footer in turn-cost.ts: that one tells the user AFTER the
// money was spent; this one warns the user BEFORE.
//
// The estimator returns a coarse band, not a number. Real cost depends
// on which sub-agents fire, how many web searches happen, how big the
// retrieved context is — none of which we know up front. So we report
// a band the user can decide on:
//
//   cheap          (<$0.05) — chit-chat, recall, quick lookups
//   normal         ($0.05–$0.20) — typical skill turn
//   expensive      ($0.20–$0.80) — deep research, multi-search
//   extra-expensive (>$0.80) — multi-spawn, multi-integration, code work
//
// The dispatcher uses this to decide whether to gate the turn behind
// a confirm prompt (see #24). Bands `expensive` and `extra-expensive`
// are gated by default; tunable via CONFIRM_EXPENSIVE_BANDS env.
//
// Heuristics reuse the model-router's keyword scoring so that a turn
// the router would send to opus is also a turn we'd flag as expensive.
// They diverge slightly: the router asks "how smart does this need to
// be"; the estimator asks "how much fan-out / web work is this likely
// to do". Research keywords matter to both; multi-integration phrases
// matter mostly to the estimator.

import { scoreContent } from "./model-router.js";

export type CostBand = "cheap" | "normal" | "expensive" | "extra-expensive";

export interface EstimatorInput {
  content: string;
  // Optional: a hint that this turn is going to invoke a specific
  // skill. Long-shape skills push the band up by one tier. Caller
  // (dispatcher) doesn't know this yet today, so it's optional.
  skillShape?: "short" | "medium" | "long";
}

// Multi-integration / fan-out signals — phrases that imply the bot
// will spawn multiple sub-agents back-to-back, OR that the request
// touches multiple integrations sequentially. Each match bumps cost.
const MULTI_INTEGRATION =
  /\b(gmail|inbox|пошт\w*|email|calendar|календар|linear|github|notion|drive)\b.*\b(gmail|inbox|пошт\w*|email|calendar|календар|linear|github|notion|drive)\b/i;

// "Deep dive" / "investigate" / "thorough" → research that fans out.
const DEEP_RESEARCH =
  /\b(deep[\s-]?dive|investigate|thoroughly|exhaustive\w*|глибок\w*\s+аналіз|деталь\w*\s+аналіз|comprehensive\s+(?:research|analysis)|all the|повний\s+(?:розбір|огляд))\b/i;

// "Compare across" / "everything you know about" — fan-out signals.
const FAN_OUT =
  /\b(compare\s+(?:across|between)|all\s+(?:emails|threads|tickets|issues|projects|клієнтів|клієнтам|листів)|every\s+(?:thread|email|client))\b/i;

// Code-work signals. These currently bounce off Hard Rule #12 (bot
// shouldn't edit code via GitHub) but they still *could* trigger a
// research-style sub-agent for "how would I do X" — which is paid time.
const CODE_HEAVY =
  /\b(refactor|migration|rewrite|переписати|архітектур\w*|implement\s+(?:from\s+scratch|the\s+full)|design\s+(?:system|the\s+whole)|перенести\s+(?:на|з))\b/i;

export function estimateTurnCostBand(opts: EstimatorInput): {
  band: CostBand;
  reason: string;
} {
  const trimmed = opts.content.trim();
  const score = scoreContent(trimmed);

  // Start with a base band derived from the router's score.
  // Router thresholds: <1 = haiku, 1-4 = sonnet, ≥5 = opus.
  let band: CostBand;
  if (score < 1) band = "cheap";
  else if (score < 5) band = "normal";
  else band = "expensive";

  const reasons: string[] = [`score=${score}`];

  // Long-shape skill bumps band up one tier (cheap → normal, etc.).
  if (opts.skillShape === "long") {
    band = bumpUp(band);
    reasons.push("long skill");
  }

  // Fan-out / multi-integration signals bump up one tier.
  if (MULTI_INTEGRATION.test(trimmed)) {
    band = bumpUp(band);
    reasons.push("multi-integration");
  }

  // Deep research keyword: also bump up.
  if (DEEP_RESEARCH.test(trimmed)) {
    band = bumpUp(band);
    reasons.push("deep-research");
  }

  // Fan-out keyword: bump up.
  if (FAN_OUT.test(trimmed)) {
    band = bumpUp(band);
    reasons.push("fan-out");
  }

  // Code-heavy keyword: bump up.
  if (CODE_HEAVY.test(trimmed)) {
    band = bumpUp(band);
    reasons.push("code-heavy");
  }

  return { band, reason: reasons.join(", ") };
}

function bumpUp(band: CostBand): CostBand {
  if (band === "cheap") return "normal";
  if (band === "normal") return "expensive";
  return "extra-expensive";
}

// Default bands that trigger a confirm prompt. Override via env:
//   CONFIRM_EXPENSIVE_BANDS=expensive,extra-expensive  (default)
//   CONFIRM_EXPENSIVE_BANDS=extra-expensive            (only the worst)
//   CONFIRM_EXPENSIVE_BANDS=                           (disable confirms entirely)
export function bandsRequiringConfirm(): Set<CostBand> {
  const raw = process.env.CONFIRM_EXPENSIVE_BANDS;
  if (raw === undefined) return new Set(["expensive", "extra-expensive"]);
  if (raw.trim() === "") return new Set();
  const parts = raw
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
  const valid = new Set<CostBand>();
  for (const p of parts) {
    if (p === "cheap" || p === "normal" || p === "expensive" || p === "extra-expensive") {
      valid.add(p);
    }
  }
  return valid;
}

// User-facing band → cost-range copy. Conservative ranges so we don't
// promise a too-narrow budget and have to explain a $0.50 turn that
// "should have been ~$0.20".
export function bandRangeUsd(band: CostBand): string {
  switch (band) {
    case "cheap":
      return "<$0.05";
    case "normal":
      return "$0.05–$0.20";
    case "expensive":
      return "$0.20–$0.80";
    case "extra-expensive":
      return "$0.80+";
  }
}

// Confirm-words the user can reply with to greenlight a pending turn.
// Anything else cancels. Generous match list (UA + EN + filler) so
// the user doesn't have to type a specific magic word — natural
// "yes" / "так" / "поїхали" all work.
const CONFIRM_WORDS = new Set([
  "yes",
  "y",
  "yep",
  "yeah",
  "ok",
  "okay",
  "sure",
  "go",
  "go ahead",
  "proceed",
  "confirm",
  "confirmed",
  "так",
  "ок",
  "окей",
  "ага",
  "давай",
  "поїхали",
  "погнали",
  "вперед",
  "погнали",
  "продовжуй",
  "продовжити",
]);

export function isConfirmReply(content: string): boolean {
  const normalized = content.trim().toLowerCase().replace(/[!.,?\s]+$/g, "");
  return CONFIRM_WORDS.has(normalized);
}
