// Per-turn cost accumulator. The dispatcher's own model usage is tracked
// inline in interaction-agent, but spawn_agent and run_skill route through
// MCP tool callbacks where the dispatcher loses sight of the sub-agent's
// cost. This module is the side-channel: tools call `addTurnCost(turnId,
// costUsd)` after each spawn, and the dispatcher reads the total via
// `takeTurnCost(turnId)` at the end of the turn to assemble the
// cost-disclosure footer.
//
// Keyed by turnId rather than conversationId so concurrent turns from
// the same chat (rare but possible if coalescing fails) don't smear into
// each other's totals.

const accumulator = new Map<string, number>();

// Defensive cap on map size in case a turnId is ever leaked (handler
// crashes between addTurnCost and takeTurnCost). When we hit the cap we
// drop the oldest entries first — a slightly-undercounted disclosure
// footer is much better than an unbounded memory leak.
const MAX_TRACKED_TURNS = 100;

export function addTurnCost(turnId: string, costUsd: number): void {
  if (!Number.isFinite(costUsd) || costUsd <= 0) return;
  const prior = accumulator.get(turnId) ?? 0;
  accumulator.set(turnId, prior + costUsd);

  if (accumulator.size > MAX_TRACKED_TURNS) {
    // Drop the oldest insert to bound memory. Map iteration is in
    // insertion order, so .keys().next() gives the oldest key.
    const oldest = accumulator.keys().next().value;
    if (oldest !== undefined) accumulator.delete(oldest);
  }
}

export function takeTurnCost(turnId: string): number {
  const value = accumulator.get(turnId) ?? 0;
  accumulator.delete(turnId);
  return value;
}

const DEFAULT_DISCLOSURE_THRESHOLD_USD = 0.5;

// Footer shown to the user when a turn's cost crosses the threshold.
// Off by default below the threshold to avoid spamming chitchat replies
// with "$0.001" noise. Threshold tunable via COST_DISCLOSURE_THRESHOLD_USD.
export function maybeDisclosureFooter(totalCostUsd: number): string | null {
  const raw = process.env.COST_DISCLOSURE_THRESHOLD_USD;
  const threshold =
    raw && Number.isFinite(Number(raw)) ? Number(raw) : DEFAULT_DISCLOSURE_THRESHOLD_USD;
  if (threshold < 0) return null; // negative → disabled entirely
  if (totalCostUsd < threshold) return null;
  return `_(turn cost ~$${totalCostUsd.toFixed(2)})_`;
}
