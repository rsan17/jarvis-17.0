import { action, mutation, query } from "./_generated/server";
import { v } from "convex/values";
import { api } from "./_generated/api.js";
import type { Id } from "./_generated/dataModel.js";

const tokenShapeV = v.union(
  v.literal("short"),
  v.literal("medium"),
  v.literal("long"),
);

const skillStatusV = v.union(
  v.literal("running"),
  v.literal("completed"),
  v.literal("failed"),
);

// Upsert by name. The indexer is the source of truth — it diffs by fileHash
// to skip work when nothing changed.
export const upsert = mutation({
  args: {
    name: v.string(),
    description: v.string(),
    body: v.string(),
    allowedTools: v.optional(v.string()),
    tokenShape: tokenShapeV,
    sourceFile: v.string(),
    fileHash: v.string(),
    embedding: v.optional(v.array(v.float64())),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("skills")
      .withIndex("by_name", (q) => q.eq("name", args.name))
      .unique();
    const now = Date.now();
    if (existing) {
      await ctx.db.patch(existing._id, { ...args, indexedAt: now });
      return existing._id;
    }
    return await ctx.db.insert("skills", { ...args, indexedAt: now });
  },
});

// Remove a skill that no longer has a matching SKILL.md on disk.
export const remove = mutation({
  args: { name: v.string() },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("skills")
      .withIndex("by_name", (q) => q.eq("name", args.name))
      .unique();
    if (existing) await ctx.db.delete(existing._id);
  },
});

// Lightweight metadata for the indexer's reconciliation pass — pulls all
// known skills' name + sourceFile + fileHash without dragging the body
// through the function-result limit.
export const listMeta = query({
  args: {},
  handler: async (ctx) => {
    const all = await ctx.db.query("skills").collect();
    return all.map((s) => ({
      name: s.name,
      sourceFile: s.sourceFile,
      fileHash: s.fileHash,
    }));
  },
});

export const byName = query({
  args: { name: v.string() },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("skills")
      .withIndex("by_name", (q) => q.eq("name", args.name))
      .unique();
  },
});

// Lightweight directory listing for the dispatcher — name+description+shape
// only. Body is NOT included; that lives behind run_skill.
export const directory = query({
  args: {},
  handler: async (ctx) => {
    const all = await ctx.db.query("skills").collect();
    return all.map((s) => ({
      name: s.name,
      description: s.description,
      tokenShape: s.tokenShape,
    }));
  },
});

export const getByIds = query({
  args: { ids: v.array(v.id("skills")) },
  handler: async (ctx, args) => {
    const out = [];
    for (const id of args.ids) {
      const r = await ctx.db.get(id);
      if (r) out.push(r);
    }
    return out;
  },
});

// Vector search → returns top-k {name, description, score}. Falls through
// to the substring fallback in find_skills when embeddings aren't available.
export const vectorSearch = action({
  args: { embedding: v.array(v.float64()), limit: v.optional(v.number()) },
  handler: async (
    ctx,
    args,
  ): Promise<
    Array<{ name: string; description: string; tokenShape: string; score: number }>
  > => {
    const results = await ctx.vectorSearch("skills", "by_embedding", {
      vector: args.embedding,
      limit: args.limit ?? 5,
    });
    const records = await ctx.runQuery(api.skills.getByIds, {
      ids: results.map((r) => r._id) as Id<"skills">[],
    });
    const byId = new Map(records.map((r: any) => [r._id, r]));
    return results
      .map((r) => {
        const rec: any = byId.get(r._id);
        if (!rec) return null;
        return {
          name: rec.name,
          description: rec.description,
          tokenShape: rec.tokenShape,
          score: r._score,
        };
      })
      .filter((x): x is { name: string; description: string; tokenShape: string; score: number } => x !== null);
  },
});

// --- skillRuns: append-only invocation log -----------------------------

export const startRun = mutation({
  args: {
    runId: v.string(),
    skillName: v.string(),
    agentId: v.optional(v.string()),
    conversationId: v.optional(v.string()),
    taskInput: v.string(),
  },
  handler: async (ctx, args) => {
    return await ctx.db.insert("skillRuns", {
      ...args,
      status: "running",
      startedAt: Date.now(),
    });
  },
});

export const finishRun = mutation({
  args: {
    runId: v.string(),
    status: skillStatusV,
    result: v.optional(v.string()),
    errorMsg: v.optional(v.string()),
    durationMs: v.optional(v.number()),
    costUsd: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("skillRuns")
      .withIndex("by_run_id", (q) => q.eq("runId", args.runId))
      .unique();
    if (!existing) return;
    await ctx.db.patch(existing._id, {
      status: args.status,
      result: args.result,
      errorMsg: args.errorMsg,
      durationMs: args.durationMs,
      costUsd: args.costUsd,
      completedAt: Date.now(),
    });
  },
});

// Aggregated usage report — one row per skill name.
// Use this from the dashboard, the future model router (high-cost skills
// → bigger model), and pruning decisions.
export const usageReport = query({
  args: {},
  handler: async (ctx) => {
    const runs = await ctx.db.query("skillRuns").collect();
    const buckets = new Map<
      string,
      {
        skillName: string;
        runs: number;
        completed: number;
        failed: number;
        totalDurationMs: number;
        totalCostUsd: number;
        lastUsedAt: number;
      }
    >();
    for (const r of runs) {
      let b = buckets.get(r.skillName);
      if (!b) {
        b = {
          skillName: r.skillName,
          runs: 0,
          completed: 0,
          failed: 0,
          totalDurationMs: 0,
          totalCostUsd: 0,
          lastUsedAt: 0,
        };
        buckets.set(r.skillName, b);
      }
      b.runs += 1;
      if (r.status === "completed") b.completed += 1;
      if (r.status === "failed") b.failed += 1;
      b.totalDurationMs += r.durationMs ?? 0;
      b.totalCostUsd += r.costUsd ?? 0;
      const ts = r.completedAt ?? r.startedAt;
      if (ts > b.lastUsedAt) b.lastUsedAt = ts;
    }
    return Array.from(buckets.values()).sort((a, b) => b.runs - a.runs);
  },
});
