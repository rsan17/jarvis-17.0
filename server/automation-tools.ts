import { tool, createSdkMcpServer } from "@anthropic-ai/claude-agent-sdk";
import { z } from "zod";
import { api } from "../convex/_generated/api.js";
import { convex } from "./convex-client.js";
import { availableIntegrations } from "./execution-agent.js";
import { nextRunFor, runsInNext24h, validateSchedule } from "./automations.js";

function randomId(prefix: string): string {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

// Frequency above which we ask the dispatcher to confirm with the user
// before creating the automation. Hourly = 24 fires/24h is fine without
// asking; tighter than that and we want explicit consent. The threshold
// is configurable so the operator can loosen/tighten without code changes.
const CRON_FREQUENT_THRESHOLD = Number(
  process.env.CRON_WARN_RUNS_PER_DAY ?? 24,
);
// Rough cost estimate per automation run — research-shaped tasks are
// $0.05–0.30, simple reminders much less. $0.10 is a midpoint we surface
// as guidance, not a guarantee. Documented in the warning text so the
// user knows it's an estimate.
const COST_PER_RUN_USD = 0.1;

export function createAutomationMcp(conversationId: string) {
  const integrationHint = availableIntegrations().join(", ") || "(none configured)";

  return createSdkMcpServer({
    name: "boop-automations",
    version: "0.1.0",
    tools: [
      tool(
        "create_automation",
        `Schedule a recurring task. The agent will run the task on the schedule and reply with the result.

Cron expressions (5 fields: min hour day-of-month month day-of-week). Examples:
  "0 8 * * *"      — every day at 8am
  "*/15 * * * *"   — every 15 minutes
  "0 9 * * 1-5"    — weekdays at 9am
  "0 18 * * 0"     — Sundays at 6pm

Use this for anything the user says "every [time]" or "remind me" about.
Integrations available: ${integrationHint}`,
        {
          name: z.string().describe("Short label, e.g. 'morning email digest'."),
          schedule: z.string().describe("Cron expression (5 fields)."),
          task: z
            .string()
            .describe("Specific task for the sub-agent — what to look up, draft, or summarize."),
          integrations: z
            .array(z.string())
            .optional()
            .default([])
            .describe(
              "Integration names the sub-agent needs for this task. Pass [] for reminder-only automations that don't need external tools.",
            ),
          notify: z
            .boolean()
            .optional()
            .default(true)
            .describe("If true, send the result to this conversation when it runs."),
          force: z
            .boolean()
            .optional()
            .default(false)
            .describe(
              "Bypass the frequency-and-cost sanity check. Set this only after the user has explicitly confirmed they want a schedule that fires more than once per hour.",
            ),
        },
        async (args) => {
          const validation = validateSchedule(args.schedule);
          if (!validation.valid) {
            return {
              content: [
                {
                  type: "text" as const,
                  text: `Invalid cron expression: ${validation.error}`,
                },
              ],
            };
          }

          // Cron sanity check — bail with a structured warning if the
          // schedule fires more often than the threshold. The dispatcher
          // is expected to relay this to the user verbatim and re-call
          // with force=true after confirmation, or with a less frequent
          // cron expression. Without this, a single mistaken
          // `* * * * *` cron quietly burns ~$144/day.
          if (!args.force) {
            const runs = runsInNext24h(args.schedule);
            if (runs !== null && runs > CRON_FREQUENT_THRESHOLD) {
              const estCostPerDay = runs * COST_PER_RUN_USD;
              return {
                content: [
                  {
                    type: "text" as const,
                    text:
                      `⚠ Frequency check: schedule "${args.schedule}" will fire ` +
                      `~${runs} times per day (~$${estCostPerDay.toFixed(2)}/day at ` +
                      `~$${COST_PER_RUN_USD.toFixed(2)} per run, rough estimate). ` +
                      `That's tighter than the safe threshold of ${CRON_FREQUENT_THRESHOLD} runs/day. ` +
                      `\n\nAsk the user to confirm before scheduling. If they want it anyway, ` +
                      `re-call create_automation with force=true. Otherwise, suggest a less ` +
                      `frequent cron — e.g. "0 * * * *" (24/day) or "0 8 * * *" (1/day).`,
                  },
                ],
              };
            }
          }

          const automationId = randomId("auto");
          const nextRunAt = nextRunFor(args.schedule) ?? undefined;
          await convex.mutation(api.automations.create, {
            automationId,
            name: args.name,
            task: args.task,
            integrations: args.integrations,
            schedule: args.schedule,
            conversationId,
            notifyConversationId: args.notify ? conversationId : undefined,
            nextRunAt,
          });
          const nextStr = nextRunAt ? new Date(nextRunAt).toLocaleString() : "unknown";
          return {
            content: [
              {
                type: "text" as const,
                text: `Created automation ${automationId} "${args.name}" — next run: ${nextStr}.`,
              },
            ],
          };
        },
      ),

      tool(
        "list_automations",
        "List all automations for this conversation.",
        { enabledOnly: z.boolean().optional().default(false) },
        async (args) => {
          const all = await convex.query(api.automations.list, {
            enabledOnly: args.enabledOnly,
          });
          const mine = all.filter((a) => a.conversationId === conversationId);
          if (mine.length === 0) {
            return { content: [{ type: "text" as const, text: "No automations." }] };
          }
          const lines = mine.map(
            (a) =>
              `• [${a.automationId}] ${a.enabled ? "●" : "○"} "${a.name}" — ${a.schedule} — ${a.task}`,
          );
          return { content: [{ type: "text" as const, text: lines.join("\n") }] };
        },
      ),

      tool(
        "toggle_automation",
        "Enable or disable an automation by id.",
        { automationId: z.string(), enabled: z.boolean() },
        async (args) => {
          const id = await convex.mutation(api.automations.setEnabled, args);
          return {
            content: [
              {
                type: "text" as const,
                text: id ? `Set ${args.automationId} enabled=${args.enabled}.` : `Not found.`,
              },
            ],
          };
        },
      ),

      tool(
        "delete_automation",
        "Permanently remove an automation.",
        { automationId: z.string() },
        async (args) => {
          const id = await convex.mutation(api.automations.remove, args);
          return {
            content: [
              {
                type: "text" as const,
                text: id ? `Deleted ${args.automationId}.` : `Not found.`,
              },
            ],
          };
        },
      ),
    ],
  });
}
