import { mutation, query } from "./_generated/server";
import { v } from "convex/values";

const bandV = v.union(
  v.literal("cheap"),
  v.literal("normal"),
  v.literal("expensive"),
  v.literal("extra-expensive"),
);

const statusV = v.union(
  v.literal("awaiting"),
  v.literal("confirmed"),
  v.literal("cancelled"),
);

// TTL on awaiting pendingTurns. After this, the row is treated as if
// it never existed — `findActive` returns null and the next user turn
// proceeds normally. We don't actively delete; old rows stay for
// post-hoc inspection of how many confirms the user blew through.
const PENDING_TTL_MS = 10 * 60 * 1000;

export const create = mutation({
  args: {
    conversationId: v.string(),
    content: v.string(),
    band: bandV,
    estimatorReason: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    return await ctx.db.insert("pendingTurns", {
      ...args,
      status: "awaiting",
      createdAt: Date.now(),
    });
  },
});

// Returns the most recent awaiting pendingTurn for this conversation,
// IFF it's still within TTL. Older awaiting rows are ignored (and will
// be flipped to "cancelled" by `markCancelled` next time the user
// sends anything in this conversation).
export const findActive = query({
  args: { conversationId: v.string() },
  handler: async (ctx, args) => {
    const cutoff = Date.now() - PENDING_TTL_MS;
    const rows = await ctx.db
      .query("pendingTurns")
      .withIndex("by_conversation_status", (q) =>
        q.eq("conversationId", args.conversationId).eq("status", "awaiting"),
      )
      .order("desc")
      .take(1);
    const row = rows[0];
    if (!row) return null;
    if (row.createdAt < cutoff) return null;
    return row;
  },
});

export const markConfirmed = mutation({
  args: { id: v.id("pendingTurns") },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.id, {
      status: "confirmed",
      decidedAt: Date.now(),
    });
  },
});

export const markCancelled = mutation({
  args: { id: v.id("pendingTurns") },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.id, {
      status: "cancelled",
      decidedAt: Date.now(),
    });
  },
});

// Cancel ALL active awaiting rows for a conversation. Used when the
// user sends a fresh non-confirm message that supersedes a stale
// confirm prompt. Idempotent.
export const cancelAllAwaiting = mutation({
  args: { conversationId: v.string() },
  handler: async (ctx, args) => {
    const rows = await ctx.db
      .query("pendingTurns")
      .withIndex("by_conversation_status", (q) =>
        q.eq("conversationId", args.conversationId).eq("status", "awaiting"),
      )
      .collect();
    const now = Date.now();
    for (const r of rows) {
      await ctx.db.patch(r._id, { status: "cancelled", decidedAt: now });
    }
    return rows.length;
  },
});

// Diagnostic: list recent rows for a conversation regardless of status.
// Lets the dashboard / debug surface see what was confirmed vs cancelled
// over the last hour.
export const recentByConversation = query({
  args: { conversationId: v.string(), limit: v.optional(v.number()) },
  handler: async (ctx, args) => {
    const rows = await ctx.db
      .query("pendingTurns")
      .withIndex("by_conversation", (q) => q.eq("conversationId", args.conversationId))
      .order("desc")
      .take(args.limit ?? 20);
    return rows;
  },
});
