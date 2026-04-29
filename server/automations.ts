import { Cron } from "croner";
import { api } from "../convex/_generated/api.js";
import { convex } from "./convex-client.js";
import { spawnExecutionAgent } from "./execution-agent.js";
import { sendImessage } from "./sendblue.js";
import { sendTelegramMessage } from "./telegram.js";
import { broadcast } from "./broadcast.js";

function randomId(prefix: string): string {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

export function nextRunFor(schedule: string): number | null {
  try {
    const c = new Cron(schedule, { paused: true });
    const next = c.nextRun();
    return next ? next.getTime() : null;
  } catch {
    return null;
  }
}

export function validateSchedule(schedule: string): { valid: boolean; error?: string } {
  try {
    new Cron(schedule, { paused: true }).nextRun();
    return { valid: true };
  } catch (err) {
    return { valid: false, error: String(err) };
  }
}

// Estimate how many times a cron schedule will fire in the next 24h.
// Used by `create_automation` to flag suspiciously frequent schedules
// before they run away with the spend.
//
// Walks `nextRun(after)` forward until the cutoff. Capped at 1500 to
// avoid spinning forever on a misparsed expression — 1440 is the max
// possible (every minute), so 1500 is a safe ceiling.
export function runsInNext24h(schedule: string): number | null {
  try {
    const c = new Cron(schedule, { paused: true });
    const cutoff = Date.now() + 24 * 60 * 60 * 1000;
    let cursor = new Date();
    let count = 0;
    while (count < 1500) {
      const next = c.nextRun(cursor);
      if (!next) break;
      if (next.getTime() >= cutoff) break;
      count += 1;
      cursor = next;
    }
    return count;
  } catch {
    return null;
  }
}

async function runAutomation(a: {
  automationId: string;
  name: string;
  task: string;
  integrations: string[];
  schedule: string;
  conversationId?: string;
  notifyConversationId?: string;
}): Promise<void> {
  const runId = randomId("run");
  await convex.mutation(api.automations.createRun, {
    runId,
    automationId: a.automationId,
  });
  broadcast("automation_started", { automationId: a.automationId, runId, name: a.name });

  try {
    const res = await spawnExecutionAgent({
      task: `AUTOMATION "${a.name}": ${a.task}`,
      integrations: a.integrations,
      conversationId: a.conversationId,
      name: `auto:${a.name}`,
    });
    await convex.mutation(api.automations.updateRun, {
      runId,
      status: res.status === "completed" ? "completed" : "failed",
      result: res.result,
      agentId: res.agentId,
    });

    if (a.notifyConversationId && res.result) {
      const preamble = `[${a.name}]\n\n`;
      if (a.notifyConversationId.startsWith("sms:")) {
        const number = a.notifyConversationId.slice(4);
        await sendImessage(number, preamble + res.result);
      } else if (a.notifyConversationId.startsWith("tg:")) {
        const chatId = a.notifyConversationId.slice(3);
        await sendTelegramMessage(chatId, preamble + res.result);
      }
      await convex.mutation(api.messages.send, {
        conversationId: a.notifyConversationId,
        role: "assistant",
        content: `[${a.name}]\n\n${res.result}`,
      });
    }

    broadcast("automation_completed", { automationId: a.automationId, runId });
  } catch (err) {
    await convex.mutation(api.automations.updateRun, {
      runId,
      status: "failed",
      error: String(err),
    });
    broadcast("automation_failed", { automationId: a.automationId, runId, error: String(err) });
  }

  const next = nextRunFor(a.schedule);
  await convex.mutation(api.automations.markRan, {
    automationId: a.automationId,
    lastRunAt: Date.now(),
    nextRunAt: next ?? undefined,
  });
}

export async function tickAutomations(): Promise<void> {
  const all = await convex.query(api.automations.list, { enabledOnly: true });
  const now = Date.now();
  const due = all.filter((a) => a.nextRunAt !== undefined && a.nextRunAt <= now);
  for (const a of due) {
    // fire-and-forget so one slow automation doesn't block others
    runAutomation({
      automationId: a.automationId,
      name: a.name,
      task: a.task,
      integrations: a.integrations,
      schedule: a.schedule,
      conversationId: a.conversationId,
      notifyConversationId: a.notifyConversationId,
    }).catch((err) => console.error("[automations] run error", err));
  }
}

export function startAutomationLoop(intervalMs = 30_000): () => void {
  const timer = setInterval(() => {
    tickAutomations().catch((err) => console.error("[automations] tick error", err));
  }, intervalMs);
  return () => clearInterval(timer);
}
