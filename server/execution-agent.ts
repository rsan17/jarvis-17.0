import { query } from "@anthropic-ai/claude-agent-sdk";
import { api } from "../convex/_generated/api.js";
import { convex } from "./convex-client.js";
import { broadcast } from "./broadcast.js";
import { buildMcpServersForIntegrations, listIntegrations } from "./integrations/registry.js";
import { createDraftStagingMcp } from "./draft-tools.js";

const running = new Map<string, AbortController>();

function randomId(prefix: string): string {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

const EXECUTION_SYSTEM = `You are a focused background worker for the user.

Your job:
1. Perform the task you were given, end to end.
2. Use your integrations to look things up, draft, or take action.
3. Return a concise, well-structured answer — not a data dump.

Style:
- Optimize for iMessage delivery: short sentences, bullets over paragraphs, no tables.
- Prefer markdown with **bold** keywords and • bullets.
- Under 500 words unless explicitly asked for more.
- If you can't complete something, say why in one sentence.

Safety:
- Anything that sends a message, creates an event, or takes an external action: call save_draft with a JSON payload instead of the real send/create tool. Return the summary so the interaction agent can show it to the user.
- Only the interaction agent's send_draft tool commits. You never commit.`;

export interface SpawnOptions {
  task: string;
  integrations: string[];
  conversationId?: string;
  name?: string;
}

export interface SpawnResult {
  agentId: string;
  result: string;
  status: "completed" | "failed" | "cancelled";
}

export async function spawnExecutionAgent(opts: SpawnOptions): Promise<SpawnResult> {
  const agentId = randomId("agent");
  const name = opts.name ?? (opts.integrations.join("+") || "general");
  const abort = new AbortController();
  running.set(agentId, abort);

  await convex.mutation(api.agents.create, {
    agentId,
    conversationId: opts.conversationId,
    name,
    task: opts.task,
    mcpServers: opts.integrations,
  });
  broadcast("agent_spawned", { agentId, name, task: opts.task });

  await convex.mutation(api.agents.update, { agentId, status: "running" });

  const integrationServers = await buildMcpServersForIntegrations(
    opts.integrations,
    opts.conversationId,
  );
  const draftServer = opts.conversationId
    ? createDraftStagingMcp(opts.conversationId)
    : undefined;
  const mcpServers = {
    ...integrationServers,
    ...(draftServer ? { "boop-drafts": draftServer } : {}),
  };
  const allowedTools = Object.keys(mcpServers).flatMap((n) => [`mcp__${n}__*`]);

  let buffer = "";
  let inputTokens = 0;
  let outputTokens = 0;
  let status: "completed" | "failed" | "cancelled" = "completed";
  let errorMsg: string | undefined;

  try {
    for await (const msg of query({
      prompt: opts.task,
      options: {
        systemPrompt: EXECUTION_SYSTEM,
        model: process.env.BOOP_MODEL ?? "claude-sonnet-4-6",
        mcpServers,
        allowedTools,
        permissionMode: "bypassPermissions",
        abortController: abort,
      },
    })) {
      if (msg.type === "assistant") {
        for (const block of msg.message.content) {
          if (block.type === "text") {
            buffer += block.text;
            await convex.mutation(api.agents.addLog, {
              agentId,
              logType: "text",
              content: block.text,
            });
          } else if (block.type === "tool_use") {
            await convex.mutation(api.agents.addLog, {
              agentId,
              logType: "tool_use",
              toolName: block.name,
              content: JSON.stringify(block.input).slice(0, 2000),
            });
            broadcast("agent_tool", { agentId, toolName: block.name });
          }
        }
        const u = msg.message.usage;
        if (u) {
          inputTokens = u.input_tokens ?? inputTokens;
          outputTokens = u.output_tokens ?? outputTokens;
        }
      } else if (msg.type === "user") {
        for (const block of msg.message.content) {
          if (block.type === "tool_result") {
            const text = Array.isArray(block.content)
              ? block.content.map((c: any) => (c.type === "text" ? c.text : "")).join("")
              : String(block.content ?? "");
            await convex.mutation(api.agents.addLog, {
              agentId,
              logType: "tool_result",
              content: text.slice(0, 2000),
            });
          }
        }
      }
    }
  } catch (err) {
    status = abort.signal.aborted ? "cancelled" : "failed";
    errorMsg = String(err);
    await convex.mutation(api.agents.addLog, {
      agentId,
      logType: "error",
      content: errorMsg,
    });
  } finally {
    running.delete(agentId);
  }

  await convex.mutation(api.agents.update, {
    agentId,
    status,
    result: buffer,
    error: errorMsg,
    inputTokens,
    outputTokens,
  });
  broadcast("agent_done", { agentId, status, result: buffer.slice(0, 200) });

  return { agentId, result: buffer || errorMsg || "(no output)", status };
}

export function cancelAgent(agentId: string): boolean {
  const abort = running.get(agentId);
  if (!abort) return false;
  abort.abort();
  return true;
}

export function runningAgentIds(): string[] {
  return [...running.keys()];
}

export async function retryAgent(agentId: string): Promise<SpawnResult | null> {
  const existing = await convex.query(api.agents.get, { agentId });
  if (!existing) return null;
  return await spawnExecutionAgent({
    task: existing.task,
    integrations: existing.mcpServers,
    conversationId: existing.conversationId,
    name: existing.name,
  });
}

export function availableIntegrations(): string[] {
  return listIntegrations().map((i) => i.name);
}
