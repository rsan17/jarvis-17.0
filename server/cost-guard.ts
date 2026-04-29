// Daily cost circuit breaker. Both the dispatcher (interaction-agent)
// and every execution-agent spawn call into this before invoking the
// Claude SDK. If we've spent more than DAILY_COST_USD_CAP in the last
// 24h, we refuse the turn and tell the caller to surface a polite
// message to the user.
//
// The cap is a *soft* guard — it stops new model calls but doesn't
// kill in-flight ones. That's intentional: we'd rather over-spend by
// the cost of one in-flight turn than abort mid-tool-call and leave
// the user staring at a blank typing indicator.
//
// External hard caps (Anthropic Console workspace spend limit,
// OpenAI org spend limit) remain the canonical safety net for
// runaway-key scenarios. This module is the *internal* tripwire for
// runaway-bot scenarios (bad cron, sub-agent loop, stuck retry).

import { api } from "../convex/_generated/api.js";
import { convex } from "./convex-client.js";

const DEFAULT_CAP_USD = 5;

export interface CostGuardCheck {
  ok: boolean;
  spent: number;
  cap: number;
  reason?: string;
}

function readCapUsd(): number {
  const raw = process.env.DAILY_COST_USD_CAP;
  if (!raw) return DEFAULT_CAP_USD;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    console.warn(
      `[cost-guard] DAILY_COST_USD_CAP=${JSON.stringify(raw)} is not a positive number; falling back to ${DEFAULT_CAP_USD}`,
    );
    return DEFAULT_CAP_USD;
  }
  return parsed;
}

export async function checkDailyCap(): Promise<CostGuardCheck> {
  const cap = readCapUsd();
  let spent = 0;
  try {
    spent = await convex.query(api.usageRecords.spentLast24h, {});
  } catch (err) {
    // Convex is the source of truth for spend. If we can't reach it,
    // fail OPEN — refusing every turn because Convex hiccupped is a
    // worse failure mode than over-spending by a tiny margin. The
    // external Anthropic/OpenAI hard caps still backstop real abuse.
    console.warn("[cost-guard] failed to read spend from Convex, allowing turn:", err);
    return { ok: true, spent: 0, cap };
  }
  if (spent >= cap) {
    return {
      ok: false,
      spent,
      cap,
      reason: `daily cost cap reached: $${spent.toFixed(2)} / $${cap.toFixed(2)}`,
    };
  }
  return { ok: true, spent, cap };
}

// Concise message we send to the user when the cap trips. Localized
// neither to UA nor EN — the operator (the bot's only user today) is
// bilingual and the reset window is short.
export function capExceededMessage(check: CostGuardCheck): string {
  return (
    `🛑 Daily budget cap reached: $${check.spent.toFixed(2)} of $${check.cap.toFixed(2)} spent in the last 24h. ` +
    `Bot is paused until enough rolls off (rolling window). ` +
    `Raise the cap by setting DAILY_COST_USD_CAP in .env, or wait it out.`
  );
}
