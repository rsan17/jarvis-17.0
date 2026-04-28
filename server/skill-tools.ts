import { tool, createSdkMcpServer } from "@anthropic-ai/claude-agent-sdk";
import { z } from "zod";
import { api } from "../convex/_generated/api.js";
import { convex } from "./convex-client.js";
import { embed } from "./embeddings.js";
import { availableIntegrations, spawnExecutionAgent } from "./execution-agent.js";

function randomId(prefix: string): string {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

// Substring-match fallback for when no embedding provider is configured.
// Cheap, dumb, ranks by # of query tokens that hit name+description.
async function substringSearch(
  query: string,
  k: number,
): Promise<Array<{ name: string; description: string; tokenShape: string; score: number }>> {
  const directory = await convex.query(api.skills.directory, {});
  const tokens = query
    .toLowerCase()
    .split(/[^a-zЀ-ӿ0-9]+/i)
    .filter((t) => t.length >= 3);
  const scored = directory.map((s) => {
    const haystack = `${s.name} ${s.description}`.toLowerCase();
    let score = 0;
    for (const t of tokens) if (haystack.includes(t)) score += 1;
    return { ...s, score };
  });
  scored.sort((a, b) => b.score - a.score);
  return scored.filter((s) => s.score > 0).slice(0, k);
}

export function createSkillMcp(conversationId: string | undefined) {
  return createSdkMcpServer({
    name: "boop-skills",
    version: "0.1.0",
    tools: [
      tool(
        "find_skills",
        `Search the skill registry for skills relevant to a user request. Returns up to k matches with name, description, and shape. ALWAYS call this BEFORE deciding between run_skill and spawn_agent — a matching skill is almost always better than a freeform spawn. The query should be a short paraphrase of what the user wants ("draft morning brief", "translate this thread to English", "linear ticket from voice note").`,
        {
          query: z.string().describe("Short paraphrase of the user's intent."),
          k: z
            .number()
            .int()
            .min(1)
            .max(10)
            .optional()
            .describe("How many results (default 5)."),
        },
        async (args) => {
          const k = args.k ?? 5;
          let results: Array<{
            name: string;
            description: string;
            tokenShape: string;
            score: number;
          }> = [];
          try {
            const v = await embed(args.query);
            if (v) {
              results = await convex.action(api.skills.vectorSearch, {
                embedding: v,
                limit: k,
              });
            }
          } catch (err) {
            console.warn("[skills] vectorSearch failed, falling back to substring:", err);
          }
          if (results.length === 0) {
            results = await substringSearch(args.query, k);
          }
          if (results.length === 0) {
            return {
              content: [
                {
                  type: "text" as const,
                  text: "No skills matched. Use spawn_agent for this task.",
                },
              ],
            };
          }
          const lines = results.map(
            (r, i) =>
              `${i + 1}. **${r.name}** (${r.tokenShape}, score=${r.score.toFixed(2)}) — ${r.description}`,
          );
          return {
            content: [
              {
                type: "text" as const,
                text: `Top ${results.length} skills:\n\n${lines.join("\n")}\n\nIf one fits, call run_skill with that name. Otherwise spawn_agent.`,
              },
            ],
          };
        },
      ),
      tool(
        "run_skill",
        `Invoke a named skill from the registry. The skill's SKILL.md is loaded into a fresh execution sub-agent which then carries out the task following the skill's playbook. Pass a short, specific task description — the skill body provides the procedure, you provide the inputs.`,
        {
          name: z
            .string()
            .describe(
              "Exact skill name as returned by find_skills (e.g. 'daily-brief', 'inbox-triage').",
            ),
          task: z
            .string()
            .describe(
              "What you want the skill to do this turn — concrete inputs/parameters, not the raw user message.",
            ),
        },
        async (args) => {
          const skill = await convex.query(api.skills.byName, { name: args.name });
          if (!skill) {
            return {
              content: [
                {
                  type: "text" as const,
                  text: `Skill "${args.name}" not found in registry. Call find_skills first to discover available skills.`,
                },
              ],
            };
          }
          const runId = randomId("skillrun");
          await convex.mutation(api.skills.startRun, {
            runId,
            skillName: args.name,
            conversationId,
            taskInput: args.task,
          });
          const start = Date.now();
          const wrappedTask = `Use the "${args.name}" skill to handle this task. First call the Skill tool with name="${args.name}" to load the playbook, then follow it.\n\nTask: ${args.task}`;
          let status: "completed" | "failed" = "completed";
          let result = "";
          let errorMsg: string | undefined;
          try {
            // Skills frequently call into integrations the dispatcher can't
            // pre-declare (a single playbook may touch gmail + calendar +
            // linear in one run). Pass ALL available integrations so the
            // sub-agent can compose freely. Per-skill scoping moves to a
            // future `integrations:` SKILL.md frontmatter field.
            const res = await spawnExecutionAgent({
              task: wrappedTask,
              integrations: availableIntegrations(),
              conversationId,
              name: `skill:${args.name}`,
            });
            result = res.result;
            if (res.status !== "completed") {
              status = "failed";
              errorMsg = `sub-agent status: ${res.status}`;
            }
          } catch (err) {
            status = "failed";
            errorMsg = err instanceof Error ? err.message : String(err);
            result = `Skill execution failed: ${errorMsg}`;
          }
          await convex.mutation(api.skills.finishRun, {
            runId,
            status,
            result,
            errorMsg,
            durationMs: Date.now() - start,
          });
          return {
            content: [{ type: "text" as const, text: result }],
          };
        },
      ),
    ],
  });
}
