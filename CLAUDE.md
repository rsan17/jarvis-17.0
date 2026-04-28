# Project notes for Claude Code

## This is a Telegram fork of Boop ("Jarvis")

This repo is a customized fork of [raroque/boop-agent](https://github.com/raroque/boop-agent). Upstream is actively maintained; we pull changes in via the **`/upgrade-boop`** skill.

**Key delta from upstream:**
- Primary transport is **Telegram** (long polling via `grammy`), not iMessage/Sendblue.
- Agent identity in system prompts is **"Jarvis"**, not "Boop".
- Sendblue files (`server/sendblue.ts`, `scripts/sendblue-*.mjs`, `convex/sendblueDedup.ts`) are kept **dormant for upstream-merge compatibility** — do **not** delete them.
- Telegram-specific files: `server/telegram.ts` (long-polling bot, allowlist, dedup, voice transcription via Whisper), `convex/telegramDedup.ts`, `telegramDedup` table in `convex/schema.ts`.

## ⛔ Hard rules — do not break these without an explicit user request

These are invariants that have been violated in past PRs and silently regressed core behavior. If a change touches any of these, call them out in the PR description and check with the user first.

1. **Telegram transport = grammy long polling.** Do not replace `server/telegram.ts` with an Express webhook approach. The droplet has no public URL, so a webhook bot is silently dead. `bot.start()` (long polling) is the only working path.

2. **Allowlist via `TELEGRAM_ALLOWED_CHAT_IDS` is mandatory.** Without it the bot answers anyone. Any rewrite of `server/telegram.ts` must keep the allowlist gate at the top of every message handler (text, voice, future media types).

3. **Conversation ID prefix is `tg:<chat_id>`.** Not `telegram:`. Changing the prefix detaches the user's history in Convex. Both `sms:` and `tg:` branches must coexist in `server/interaction-agent.ts` (`send_ack`) and `server/automations.ts` (notify path).

4. **Telegram update_id dedup via `convex/telegramDedup.ts`.** Telegram retries delivery on 5xx; without dedup the user sees double replies. Keep `api.telegramDedup.claim` as the first thing after the allowlist check.

5. **Sendblue files are DORMANT, not deleted.** `server/sendblue.ts`, `convex/sendblueDedup.ts`, `scripts/sendblue-{sync,webhook}.mjs`, the `sendblueDedup` table in `convex/schema.ts`, and the `sms:` branch in `interaction-agent.ts` all stay. Deleting them creates delete-vs-modify conflicts on every upstream merge and was the root cause of the [#1 regression](https://github.com/rsan17/jarvis-17.0/pull/1).

6. **`grammy` stays in `dependencies`** alongside `form-data` (Whisper) and `dotenv`. Do not "clean up" by removing it.

7. **Production runs `npm start`, not `npm run dev`.** `scripts/dev.mjs` spawns vite + `convex dev` + `tsx watch` — the watcher children silently exit with code 1 in headless environments and tear the whole script down. The DigitalOcean droplet uses `pm2 start npm --name jarvis -- start`.

8. **Do not regenerate package-lock.json from scratch unnecessarily.** Touching it pulls in unrelated transitive bumps and bloats the diff. Only touch when adding/removing direct dependencies.

## When running `/upgrade-boop` (upstream merges)

Resolve conflicts in favor of **Telegram-first behavior**:

1. **System prompts** (`server/interaction-agent.ts` `INTERACTION_SYSTEM`, `server/execution-agent.ts` `EXECUTION_SYSTEM`):
   - Agent identity: keep `"Jarvis"`, not `"Boop"`.
   - Transport references: keep `"Telegram"`, not `"iMessage"`.
   - Reply length hint in dispatcher: keep `~600 chars` (Telegram is roomier than SMS).
   - In execution agent: keep "Optimize for Telegram delivery" line.
   - Keep the "Tool calling discipline (HARD constraint)" block — it prevents an SDK transport crash from multiple `tool_use` blocks in one assistant message.

2. **Conversation routing** (`server/interaction-agent.ts` `send_ack`, `server/automations.ts` notify path):
   - Both files have `if (...startsWith("sms:")) ... else if (...startsWith("tg:"))` blocks.
   - Always preserve the `tg:` branch. If upstream rewrites this logic, port Telegram routing forward.

3. **`scripts/dev.mjs`**:
   - Preserve the `telegramConfigured` / `sendblueConfigured` ngrok-skip logic.
   - Preserve the Telegram banner branch in the "no public tunnel" path.
   - **Windows fix:** `shell: process.platform === "win32"` must remain in every `spawn()` call (without this, `npx`/`vite`/`convex` fail with `ENOENT` on Windows because they're `.cmd` shims). Affects the `run()` helper and the `autoRegisterWebhook` spawn.

4. **`.env.example`**:
   - Keep the Telegram section at the top with `TELEGRAM_ALLOWED_CHAT_IDS`.
   - Keep `OPENAI_API_KEY` (Whisper) section.
   - Sendblue section stays commented-out / marked legacy at the bottom.

5. **`README.md`**:
   - Keep the Telegram quickstart block immediately under the title.

6. **`package.json`**:
   - Keep `grammy` and `form-data` in dependencies.
   - Keep `sendblue:sync` / `sendblue:webhook` scripts (dormant but invocable).
   - Keep the modified `description` mentioning Telegram + Jarvis.

7. **`convex/schema.ts`**:
   - Keep the `telegramDedup` table. It coexists with `sendblueDedup`.

8. **`server/convex-client.ts`**:
   - Keep the `CONVEX_URL ?? VITE_CONVEX_URL` fallback. Newer Convex CLI versions write only `VITE_CONVEX_URL` into `.env.local`; reverting this breaks server boot on a fresh setup.

After resolving, run `npm run typecheck` and `npm start` (NOT `npm run dev` in headless contexts) to validate.

## Production deployment

DigitalOcean Droplet at `142.93.132.222`, user `jarvis`. Code at `/home/jarvis/jarvis/`, run via `pm2` as `jarvis` (`npm start`). Convex deployment `dev:original-jellyfish-81`. Required env vars in `.env`: `ANTHROPIC_API_KEY`, `TELEGRAM_BOT_TOKEN`, `TELEGRAM_ALLOWED_CHAT_IDS`, `OPENAI_API_KEY`, `CONVEX_DEPLOYMENT`, `VITE_CONVEX_URL`.

After merging code changes: SSH in, `git pull`, `pm2 restart jarvis --update-env`. Do **not** run `pm2 start npm -- run dev` — see Hard Rule #7.

## Planned work (not yet implemented)

- **Model router**: dispatch easy turns (greetings, recall) to a small Haiku model and complex turns (multi-step research, code generation) to Sonnet/Opus. Likely lives next to the `query()` call in `server/interaction-agent.ts` with a heuristic + budget check before model selection.
- **Skill / sub-agent registry**: lightweight registry of named skills the dispatcher can compose, so `spawn_agent` becomes `spawn_skill(name, args)` for known recipes (e.g. "summarize-inbox", "create-meeting").

If you're asked to work on either, treat them as additive — they should not regress any of the Hard Rules above.

<!-- convex-ai-start -->
This project uses [Convex](https://convex.dev) as its backend.

When working on Convex code, **always read `convex/_generated/ai/guidelines.md` first** for important guidelines on how to correctly use Convex APIs and patterns. The file contains rules that override what you may have learned about Convex from training data.

Convex agent skills for common tasks can be installed by running `npx convex ai-files install`.
<!-- convex-ai-end -->
