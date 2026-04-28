# Project notes for Claude Code

## This is a Telegram fork of Boop ("Jarvis")

This repo is a customized fork of [raroque/boop-agent](https://github.com/raroque/boop-agent). Upstream is actively maintained; we pull changes in via the **`/upgrade-boop`** skill.

**Key delta from upstream:**
- Primary transport is **Telegram** (long polling via `grammy`), not iMessage/Sendblue.
- Agent identity in system prompts is **"Jarvis"**, not "Boop".
- Sendblue files (`server/sendblue.ts`, `scripts/sendblue-*.mjs`, `convex/sendblueDedup.ts`) are kept dormant for upstream-merge compatibility — do **not** delete them.
- New files added by this fork:
  - `server/telegram.ts` — long-polling bot, sender, typing loop, allowlist, dedup.
  - `convex/telegramDedup.ts` + `telegramDedup` table in `convex/schema.ts`.

**Conversation ID prefixes (both must stay supported in any code touching conversations):**
- `sms:<phone>` — iMessage via Sendblue (legacy, dormant).
- `tg:<chat_id>` — Telegram. **Default for this fork.**

## When running `/upgrade-boop` (upstream merges)

Resolve conflicts in favor of **Telegram-first behavior**:

1. **System prompts** (`server/interaction-agent.ts` `INTERACTION_SYSTEM`, `server/execution-agent.ts` `EXECUTION_SYSTEM`):
   - Agent identity: keep `"Jarvis"`, not `"Boop"`.
   - Transport references: keep `"Telegram"`, not `"iMessage"`.
   - Reply length hint in dispatcher: keep `~600 chars` (Telegram is roomier than SMS).
   - In execution agent: keep "Optimize for Telegram delivery" line.

2. **Conversation routing** (`server/interaction-agent.ts` `send_ack`, `server/automations.ts` notify path):
   - Both files have `if (...startsWith("sms:")) ... else if (...startsWith("tg:"))` blocks.
   - Always preserve the `tg:` branch. If upstream rewrites this logic, port Telegram routing forward.

3. **`scripts/dev.mjs`**:
   - Preserve the `telegramConfigured` / `sendblueConfigured` ngrok-skip logic.
   - Preserve the Telegram banner branch in the "no public tunnel" path.
   - **Windows fix:** `shell: process.platform === "win32"` must remain in every `spawn()` call (without this, `npx`/`vite`/`convex` fail with `ENOENT` on Windows because they're `.cmd` shims). Affects the `run()` helper and the `autoRegisterWebhook` spawn.

4. **`.env.example`**:
   - Keep the Telegram section at the top.
   - Sendblue section stays commented-out / marked legacy.

5. **`README.md`**:
   - Keep the Telegram quickstart block immediately under the title.

6. **`package.json`**:
   - Keep `grammy` in dependencies.
   - Keep the modified `description` mentioning Telegram + Jarvis.

7. **`convex/schema.ts`**:
   - Keep the `telegramDedup` table. It coexists with `sendblueDedup`.

8. **`server/convex-client.ts`**:
   - Keep the `CONVEX_URL ?? VITE_CONVEX_URL` fallback. Newer Convex CLI versions write only `VITE_CONVEX_URL` into `.env.local`; reverting this breaks server boot on a fresh setup.

After resolving, run `npm run typecheck` and `npm run dev` to validate.

<!-- convex-ai-start -->
This project uses [Convex](https://convex.dev) as its backend.

When working on Convex code, **always read `convex/_generated/ai/guidelines.md` first** for important guidelines on how to correctly use Convex APIs and patterns. The file contains rules that override what you may have learned about Convex from training data.

Convex agent skills for common tasks can be installed by running `npx convex ai-files install`.
<!-- convex-ai-end -->
