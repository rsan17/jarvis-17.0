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

// --- voice transcription via OpenAI Whisper -----------------------------
async function downloadVoiceFile(fileId: string): Promise<Buffer> {
  const bot = getTelegramBot();
  if (!bot) throw new Error("telegram bot not initialized");
  const file = await bot.api.getFile(fileId);
  const token = process.env.TELEGRAM_BOT_TOKEN!;
  const url = `https://api.telegram.org/file/bot${token}/${file.file_path}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`voice download failed: ${res.status}`);
  return Buffer.from(await res.arrayBuffer());
}

// Distinguish "voice is not configured" from "tried and failed" so the
// user-facing error in the voice handler can say something useful.
class VoiceConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "VoiceConfigError";
  }
}

async function transcribeVoice(audio: Buffer): Promise<string> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new VoiceConfigError(
      "OPENAI_API_KEY not set — voice transcription disabled. Set it in .env to enable.",
    );
  }
  // Use the global Web FormData + Blob (Node 20+). The npm `form-data`
  // package and Node's native `fetch` don't agree on streaming — the
  // boundary header gets lost, OpenAI returns 400 "Could not parse
  // multipart form". Native FormData composes the multipart body itself
  // and native fetch sets Content-Type with the right boundary.
  const form = new FormData();
  form.append("file", new Blob([new Uint8Array(audio)], { type: "audio/ogg" }), "voice.ogg");
  form.append("model", "whisper-1");

  const res = await fetch("https://api.openai.com/v1/audio/transcriptions", {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}` },
    body: form,
  });
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`whisper failed: ${res.status} — ${err}`);
  }
  const json = (await res.json()) as { text: string };
  return json.text.trim();
}

// Both text and voice updates funnel through this. Centralizing the
// allowlist/dedup/typing/agent path keeps the two grammy handlers thin and
// avoids drift between transports.
async function handleIncoming(opts: {
  chatId: string;
  content: string;
  updateId: string;
  allowlist: Set<string> | null;
}): Promise<void> {
  const { chatId, content, updateId, allowlist } = opts;

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
  if (!process.env.OPENAI_API_KEY) {
    console.warn(
      "[telegram] OPENAI_API_KEY not set — voice notes will be rejected with a config error. Set it in .env to enable Whisper transcription.",
    );
  }

  bot.on("message:text", async (ctx) => {
    await handleIncoming({
      chatId: String(ctx.chat.id),
      content: ctx.message.text,
      updateId: String(ctx.update.update_id),
      allowlist,
    });
  });

  bot.on("message:voice", async (ctx) => {
    const chatId = String(ctx.chat.id);
    const updateId = String(ctx.update.update_id);

    // Allowlist gate first — don't spend Whisper credits on strangers.
    // The same check repeats inside handleIncoming for the reply path.
    if (allowlist && !allowlist.has(chatId)) {
      console.log(`[telegram] ignored voice from non-allowlisted chat ${chatId}`);
      return;
    }

    const fileId = ctx.message.voice.file_id;
    console.log(`[telegram] voice note chatId=${chatId} file_id=${fileId}`);
    const stopTyping = startTypingLoop(chatId);
    let transcript: string;
    try {
      const audio = await downloadVoiceFile(fileId);
      transcript = await transcribeVoice(audio);
      console.log(`[telegram] transcript: ${JSON.stringify(transcript.slice(0, 200))}`);
    } catch (err) {
      console.error("[telegram] voice transcription failed:", err);
      stopTyping();
      const userMessage =
        err instanceof VoiceConfigError
          ? "Voice notes aren't set up on this bot — `OPENAI_API_KEY` is missing in the server's .env. Send text instead, or ping the operator to enable Whisper."
          : "Sorry — I couldn't transcribe that voice note. Try again or send text?";
      await sendTelegramMessage(chatId, userMessage);
      return;
    } finally {
      stopTyping();
    }

    await handleIncoming({
      chatId,
      content: `[Voice note]: ${transcript}`,
      updateId,
      allowlist,
    });
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
