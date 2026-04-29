import { mutation, query } from "./_generated/server";
import { v } from "convex/values";

const sourceV = v.union(
  v.literal("dispatcher"),
  v.literal("execution"),
  v.literal("extract"),
  v.literal("consolidation-proposer"),
  v.literal("consolidation-adversary"),
  v.literal("consolidation-judge"),
);

export const record = mutation({
  args: {
    source: sourceV,
    conversationId: v.optional(v.string()),
    turnId: v.optional(v.string()),
    agentId: v.optional(v.string()),
    runId: v.optional(v.string()),
    model: v.string(),
    inputTokens: v.number(),
    outputTokens: v.number(),
    cacheReadTokens: v.number(),
    cacheCreationTokens: v.number(),
    costUsd: v.number(),
    durationMs: v.number(),
  },
  handler: async (ctx, args) => {
    return await ctx.db.insert("usageRecords", { ...args, createdAt: Date.now() });
  },
});

export const byConversation = query({
  args: { conversationId: v.string(), limit: v.optional(v.number()) },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("usageRecords")
      .withIndex("by_conversation", (q) => q.eq("conversationId", args.conversationId))
      .order("desc")
      .take(args.limit ?? 200);
  },
});

export const recent = query({
  args: { limit: v.optional(v.number()) },
  handler: async (ctx, args) => {
    return await ctx.db.query("usageRecords").order("desc").take(args.limit ?? 100);
  },
});

// Sum of costUsd over the last 24 hours. Used by the dispatcher and
// execution agent as a circuit breaker before each Claude call —
// if it exceeds DAILY_COST_USD_CAP, we refuse the turn instead of
// letting a runaway automation or sub-agent loop spend silently.
//
// Implementation note: there is no `createdAt` index on usageRecords,
// so we scan the most-recent 5_000 rows (Convex .collect() ceiling is
// 16_384). At ~3 calls/turn and < 500 turns/day in the worst case this
// is comfortable. If we ever cross that volume, add a `by_createdAt`
// index and switch to a range query.
export const spentLast24h = query({
  args: {},
  handler: async (ctx) => {
    const cutoff = Date.now() - 24 * 60 * 60 * 1000;
    const rows = await ctx.db.query("usageRecords").order("desc").take(5000);
    let total = 0;
    for (const r of rows) {
      if (r.createdAt < cutoff) break; // rows are already in desc order
      total += r.costUsd;
    }
    return total;
  },
});

export const summary = query({
  args: { conversationId: v.optional(v.string()), limit: v.optional(v.number()) },
  handler: async (ctx, args) => {
    // Cap the scan. Convex's hard .collect() ceiling is 16,384 docs; this
    // keeps the summary query from silently breaking once the append-only
    // log grows past that. Conversation-scoped queries use the index.
    const limit = args.limit ?? 5000;
    const rows = args.conversationId
      ? await ctx.db
          .query("usageRecords")
          .withIndex("by_conversation", (q) => q.eq("conversationId", args.conversationId!))
          .order("desc")
          .take(limit)
      : await ctx.db.query("usageRecords").order("desc").take(limit);
    const bySource: Record<
      string,
      { costUsd: number; inputTokens: number; outputTokens: number; cacheReadTokens: number; cacheCreationTokens: number; count: number }
    > = {};
    let totalCost = 0;
    for (const r of rows) {
      totalCost += r.costUsd;
      const bucket = (bySource[r.source] ??= {
        costUsd: 0,
        inputTokens: 0,
        outputTokens: 0,
        cacheReadTokens: 0,
        cacheCreationTokens: 0,
        count: 0,
      });
      bucket.costUsd += r.costUsd;
      bucket.inputTokens += r.inputTokens;
      bucket.outputTokens += r.outputTokens;
      bucket.cacheReadTokens += r.cacheReadTokens;
      bucket.cacheCreationTokens += r.cacheCreationTokens;
      bucket.count += 1;
    }
    return { totalCost, bySource, rowCount: rows.length };
  },
});
