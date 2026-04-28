import { Bot } from "grammy";
import { api } from "../convex/_generated/api.js";
import { convex } from "./convex-client.js";
import { handleUserMessage } from "./interaction-agent.js";
import { broadcast } from "./broadcast.js";

// Telegram message limit is 4096 chars; leave headroom for safety.
const MAX_CHUNK = 3800;

function chunk(text: string, size = MAX_CHUNK): string[] {
  if (text.length <= size) return [text];
  const out: string[] = [];
  let buf = "";
  for (const line of text.split(/\n/)) {
    if ((buf + "\n" + line).length > size) {
      if (buf) out.push(buf);
      buf = line;
    } else {
      buf = buf ? buf + "\n" + line : line;
    }
  }
  if (buf) out.push(buf);
  return out;
}

function parseAllowlist(): Set<string> | null {
  const raw = process.env.TELEGRAM_ALLOWED_CHAT_IDS;
  if (!raw) return null;
  const ids = raw
    .split(/[,\s]+/)
    .map((s) => s.trim())
    .filter(Boolean);
  return ids.length ? new Set(ids) : null;
}

let botSingleton: Bot | null = null;

export function getTelegramBot(): Bot | null {
  if (botSingleton) return botSingleton;
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) return null;
  botSingleton = new Bot(token);
  return botSingleton;
}

export async function sendTelegramMessage(chatId: string, text: string): Promise<void> {
  const bot = getTelegramBot();
  if (!bot) {
    console.warn("[telegram] missing TELEGRAM_BOT_TOKEN — not sending");
    return;
  }
  for (const part of chunk(text)) {
    try {
      await bot.api.sendMessage(chatId, part);
      console.log(`[telegram] → sent ${part.length} chars to ${chatId}`);
    } catch (err) {
      console.error(`[telegram] send failed:`, err);
    }
  }
}

export function startTypingLoop(chatId: string): () => void {
  const bot = getTelegramBot();
  if (!bot) return () => {};
  const send = () => {
    bot.api.sendChatAction(chatId, "typing").catch(() => {});
  };
  send();
  // Telegram clears the typing indicator after ~5s, so refresh on that cadence.
  const timer = setInterval(send, 4500);
  return () => clearInterval(timer);
}

export async function startTelegramBot(): Promise<void> {
  const bot = getTelegramBot();
  if (!bot) {
    console.log("[telegram] TELEGRAM_BOT_TOKEN not set — skipping Telegram bot");
    return;
  }

  const allowlist = parseAllowlist();
  if (!allowlist) {
    console.warn(
      "[telegram] TELEGRAM_ALLOWED_CHAT_IDS not set — bot will respond to ANY chat. Set this to lock the bot to your own chat id(s).",
    );
  }

  bot.on("message:text", async (ctx) => {
    const chatId = String(ctx.chat.id);
    const content = ctx.message.text;
    const updateId = String(ctx.update.update_id);

    if (allowlist && !allowlist.has(chatId)) {
      console.log(`[telegram] ignored message from non-allowlisted chat ${chatId}`);
      return;
    }

    // Dedup against Telegram's update_id in case Telegram retries delivery.
    const { claimed } = await convex.mutation(api.telegramDedup.claim, {
      handle: updateId,
    });
    if (!claimed) {
      console.log(`[telegram] deduped update ${updateId}`);
      return;
    }

    const conversationId = `tg:${chatId}`;
    const turnTag = Math.random().toString(36).slice(2, 8);
    const preview = content.length > 100 ? content.slice(0, 100) + "…" : content;
    console.log(`[turn ${turnTag}] ← tg:${chatId}: ${JSON.stringify(preview)}`);
    const start = Date.now();

    broadcast("message_in", { conversationId, content, from_number: chatId, handle: updateId });

    const stopTyping = startTypingLoop(chatId);
    try {
      const reply = await handleUserMessage({
        conversationId,
        content,
        turnTag,
        onThinking: (t) => broadcast("thinking", { conversationId, t }),
      });
      if (reply) {
        const elapsed = ((Date.now() - start) / 1000).toFixed(1);
        const replyPreview = reply.length > 100 ? reply.slice(0, 100) + "…" : reply;
        console.log(
          `[turn ${turnTag}] → reply (${elapsed}s, ${reply.length} chars): ${JSON.stringify(replyPreview)}`,
        );
        await sendTelegramMessage(chatId, reply);
        await convex.mutation(api.messages.send, {
          conversationId,
          role: "assistant",
          content: reply,
        });
      } else {
        console.log(`[turn ${turnTag}] → (no reply)`);
      }
    } catch (err) {
      console.error(`[turn ${turnTag}] handler error`, err);
    } finally {
      stopTyping();
    }
  });

  bot.catch((err) => {
    console.error("[telegram] bot error:", err);
  });

  // Long polling — no public URL / tunnel required.
  bot.start({
    onStart: (info) =>
      console.log(`[telegram] bot @${info.username} started (long polling)`),
  }).catch((err) => {
    console.error("[telegram] failed to start polling:", err);
  });
}
