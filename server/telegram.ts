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

// --- generic Telegram file download -------------------------------------
async function downloadTelegramFile(fileId: string): Promise<Buffer> {
  const bot = getTelegramBot();
  if (!bot) throw new Error("telegram bot not initialized");
  const file = await bot.api.getFile(fileId);
  const token = process.env.TELEGRAM_BOT_TOKEN!;
  const url = `https://api.telegram.org/file/bot${token}/${file.file_path}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`telegram file download failed: ${res.status}`);
  return Buffer.from(await res.arrayBuffer());
}

// Distinguish "media handler is not configured" from "tried and failed"
// so the user-facing message in each handler can say something useful.
class VoiceConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "VoiceConfigError";
  }
}
class ImageConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ImageConfigError";
  }
}

// --- voice transcription via OpenAI Whisper -----------------------------
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

// --- image description via Claude vision (Anthropic Messages API) -------
// Caps each image at 5 MB (Anthropic per-image limit) and asks the model
// for a thorough description + verbatim OCR. The output becomes the
// dispatcher's only window into the image(s), so we ask for detail
// rather than a one-liner.
//
// Multi-image (Telegram albums) goes through this same call with all
// images packed into a single content array. Per the Anthropic docs,
// "Multiple images can be included in a single request, which Claude
// will analyze jointly when formulating its response. This can be
// helpful for comparing or contrasting images."
const IMAGE_BYTES_LIMIT = 5 * 1024 * 1024;
const VISION_PROMPT_SINGLE = `You are describing an image so a downstream agent can act on it without seeing it.

Be thorough:
- What is shown overall (UI screenshot, photo, diagram, document, chat, code, etc.).
- All visible text — extract verbatim, preserving line breaks, formatting, code, error messages, URLs.
- Layout cues that matter: which part is highlighted, where the cursor is, what's selected, what looks like an error vs. a normal element.
- Anything obviously wrong, unusual, or clickable.

Do NOT add interpretation the user didn't ask for. Just describe what's there. Output is plain text — no markdown headers, no preamble like "Here is a description". Lead with the type of image, then the contents.`;

const VISION_PROMPT_ALBUM = `You are describing an album of images so a downstream agent can act on them without seeing them.

For each image, in order:
1. Lead with "Image N:" (1-indexed).
2. Describe what is shown (UI screenshot, photo, diagram, document, chat, code, etc.).
3. Extract all visible text verbatim — preserve line breaks, formatting, code, errors, URLs.
4. Note layout cues (highlighted areas, cursor position, selected items, errors).

Then add a short final paragraph titled "Across the album:" calling out any obvious relationships — same content from different angles, before/after, sequence of steps, or completely unrelated. Skip the final paragraph if the images are clearly independent.

Do NOT add interpretation the user didn't ask for. Output is plain text — no markdown headers beyond the per-image prefix and the final "Across the album:" line.`;

interface ImagePart {
  buffer: Buffer;
  mediaType: string;
}

async function describeImages(images: ImagePart[]): Promise<string> {
  if (images.length === 0) throw new Error("describeImages called with no images");
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    throw new ImageConfigError(
      "ANTHROPIC_API_KEY not set — image description disabled. Set it in .env to enable vision.",
    );
  }
  for (const img of images) {
    if (img.buffer.byteLength > IMAGE_BYTES_LIMIT) {
      throw new Error(
        `image too large: ${img.buffer.byteLength} bytes (limit ${IMAGE_BYTES_LIMIT})`,
      );
    }
  }

  // Vision is a one-shot describe call — it doesn't need the per-turn
  // model router. Pin a vision-capable model directly. Don't read
  // BOOP_MODEL: that env can hold the sentinel "auto" (router mode),
  // which is not a real Anthropic model id and yields a 404.
  // VISION_MODEL_OVERRIDE is the explicit escape hatch if you ever want
  // to force opus or a future vision-capable model just for descriptions.
  const model = process.env.VISION_MODEL_OVERRIDE ?? "claude-sonnet-4-6";
  const isAlbum = images.length > 1;
  // 2KB output per image, capped — albums need more room than single shots
  // but we don't want unbounded long descriptions.
  const maxTokens = Math.min(2048 + (images.length - 1) * 1024, 8192);

  const content: Array<unknown> = images.map((img) => ({
    type: "image",
    source: {
      type: "base64",
      media_type: img.mediaType,
      data: img.buffer.toString("base64"),
    },
  }));
  content.push({
    type: "text",
    text: isAlbum ? VISION_PROMPT_ALBUM : VISION_PROMPT_SINGLE,
  });

  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
      "content-type": "application/json",
    },
    body: JSON.stringify({
      model,
      max_tokens: maxTokens,
      messages: [{ role: "user", content }],
    }),
  });
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`vision describe failed: ${res.status} — ${err}`);
  }
  const json = (await res.json()) as {
    content: Array<{ type: string; text?: string }>;
  };
  const text = json.content
    .filter((b) => b.type === "text" && b.text)
    .map((b) => b.text)
    .join("\n")
    .trim();
  if (!text) throw new Error("vision describe returned no text");
  return text;
}

// Convenience for the existing single-image callsites — keeps them readable.
async function describeImage(image: Buffer, mediaType: string): Promise<string> {
  return describeImages([{ buffer: image, mediaType }]);
}

// --- text-file content extraction ---------------------------------------
// 100 KB cap so we don't blow out the dispatcher context. A single source
// file is rarely larger; if it is, the head + tail give enough of a
// fingerprint for the user to clarify what they want done.
const TEXT_BYTES_LIMIT = 100 * 1024;
const READABLE_TEXT_MIMES = /^(text\/|application\/(json|xml|javascript|x-yaml|x-toml))/i;

function isReadableText(mimeType: string | undefined, fileName: string | undefined): boolean {
  if (mimeType && READABLE_TEXT_MIMES.test(mimeType)) return true;
  // Telegram sometimes labels source files as application/octet-stream.
  // Trust the extension as a fallback.
  if (fileName) {
    return /\.(txt|md|json|ya?ml|toml|csv|tsv|js|mjs|cjs|ts|tsx|jsx|py|rb|go|rs|java|kt|c|cc|cpp|h|hpp|cs|php|sh|bash|zsh|fish|sql|html|htm|css|scss|sass|less|xml|svg|env|conf|ini|log|gitignore|dockerfile|makefile)$/i.test(
      fileName,
    );
  }
  return false;
}

// --- album coalescing for Telegram media groups -------------------------
// Telegram sends each photo in an album as an independent update with a
// shared `media_group_id`. Naively each one fires the photo handler →
// independent vision call → independent dispatcher turn → N replies for
// N photos. Awful UX, N× cost.
//
// We buffer per `media_group_id`, reset a 1.5s timer on each arrival,
// and flush as a single multi-image describe + single dispatcher turn.
// Hard-flush at 10 (Telegram's max album size) so we don't wait the
// full debounce when the album is clearly complete.
//
// In-memory only — if the bot restarts mid-album we lose the buffer.
// Acceptable: the user retries by re-sending. Not worth a Convex
// round-trip for a 1.5s window.
const ALBUM_DEBOUNCE_MS = 1500;
const ALBUM_HARD_FLUSH_AT = 10;
const MAX_TRACKED_GROUPS = 50; // safety cap against memory leaks if a
// flush ever silently fails to delete the buffer entry.

interface AlbumBufferEntry {
  // Highest-res file_id from each photo in arrival order.
  fileIds: string[];
  // First non-empty caption seen (Telegram puts caption on one of the
  // album items, usually the first).
  caption: string;
  // First update_id seen — used as the dedup key for the eventual
  // dispatcher turn, since the whole album is one logical event.
  firstUpdateId: string;
  chatId: string;
  flushTimer: NodeJS.Timeout;
}

const albumBuffers = new Map<string, AlbumBufferEntry>();

async function flushAlbum(groupId: string): Promise<void> {
  const entry = albumBuffers.get(groupId);
  if (!entry) return;
  albumBuffers.delete(groupId);
  clearTimeout(entry.flushTimer);

  const { chatId, fileIds, caption, firstUpdateId } = entry;
  console.log(
    `[telegram] album flush chatId=${chatId} group=${groupId} count=${fileIds.length}` +
      (caption ? ` caption=${JSON.stringify(caption.slice(0, 80))}` : ""),
  );

  const stopTyping = startTypingLoop(chatId);
  let description: string;
  try {
    const buffers = await Promise.all(fileIds.map(downloadTelegramFile));
    description = await describeImages(
      buffers.map((b) => ({ buffer: b, mediaType: "image/jpeg" })),
    );
    console.log(`[telegram] album described (${description.length} chars)`);
  } catch (err) {
    console.error("[telegram] album description failed:", err);
    stopTyping();
    const userMessage =
      err instanceof ImageConfigError
        ? "Image understanding isn't set up — `ANTHROPIC_API_KEY` is missing in the server's .env. Send the album as text descriptions, or ping the operator."
        : `Sorry — I couldn't process that ${fileIds.length}-photo album. Try again or describe it in text?`;
    await sendTelegramMessage(chatId, userMessage);
    return;
  } finally {
    stopTyping();
  }

  const content = caption
    ? `[Album of ${fileIds.length} images]:\n${description}\n\nUser caption: ${caption}`
    : `[Album of ${fileIds.length} images]:\n${description}`;

  await handleIncoming({
    chatId,
    content,
    updateId: firstUpdateId,
    // Allowlist already checked when we added to the buffer; re-parse
    // here so handleIncoming's own gate sees the same set rather than
    // assuming. parseAllowlist is just env-read — cheap.
    allowlist: parseAllowlist(),
  });
}

function readTextWithTruncation(buffer: Buffer): string {
  if (buffer.byteLength <= TEXT_BYTES_LIMIT) return buffer.toString("utf-8");
  // Show head + tail so the model sees both ends. Mid-truncation is more
  // useful than just head-truncation when the tail contains a summary,
  // signature, conclusion, etc.
  const half = Math.floor(TEXT_BYTES_LIMIT / 2);
  const head = buffer.subarray(0, half).toString("utf-8");
  const tail = buffer.subarray(buffer.byteLength - half).toString("utf-8");
  return `${head}\n\n[…truncated ${buffer.byteLength - TEXT_BYTES_LIMIT} bytes…]\n\n${tail}`;
}

// --- text-message coalescing per chat ----------------------------------
// Same pattern as album coalescing, but keyed by chatId and triggered
// by closely-spaced text messages from the same chat. When the user
// fires off "ось ідея" + "у Linear" + "термін завтра" as three separate
// messages within a couple seconds, we want the dispatcher to see ONE
// merged turn with all three lines, not three independent turns each
// running its own model call and emitting its own reply.
//
// Tradeoff: a single text message also gets a small delay before it
// reaches the dispatcher (the debounce window). Acceptable because the
// typing indicator fires immediately, and processing dwarfs 1.5s.
const TEXT_DEBOUNCE_MS = Number(process.env.TEXT_DEBOUNCE_MS ?? 1500);
const TEXT_HARD_FLUSH_AT = 5; // never buffer more than 5 messages — past
// that we're better off processing what we have than waiting longer.
const TEXT_MAX_WAIT_MS = 5000; // absolute ceiling on how long we'll
// hold a buffer regardless of new arrivals.

interface TextBufferEntry {
  chatId: string;
  // Each entry is one user message in arrival order.
  texts: string[];
  // First update_id seen — dedup key for the merged dispatcher turn.
  firstUpdateId: string;
  // When the buffer was first opened (for TEXT_MAX_WAIT_MS ceiling).
  openedAt: number;
  flushTimer: NodeJS.Timeout;
}

const textBuffers = new Map<string, TextBufferEntry>();

// Disable coalescing entirely with TEXT_DEBOUNCE_MS=0. Useful for
// debugging "did the bot see my message?" — every message hits the
// dispatcher immediately when this is set.
function textCoalescingEnabled(): boolean {
  return TEXT_DEBOUNCE_MS > 0;
}

async function flushTextBuffer(chatId: string): Promise<void> {
  const entry = textBuffers.get(chatId);
  if (!entry) return;
  textBuffers.delete(chatId);
  clearTimeout(entry.flushTimer);

  const { texts, firstUpdateId } = entry;
  if (texts.length === 0) return;

  // Single message → pass through unchanged. Multiple → join with blank
  // lines so the dispatcher sees them as paragraphs of one message.
  // No "[Coalesced N messages]:" prefix — the dispatcher doesn't need to
  // know they arrived as separate Telegram updates; it just needs the
  // combined intent.
  const content =
    texts.length === 1 ? texts[0] : texts.join("\n\n");

  if (texts.length > 1) {
    console.log(
      `[telegram] coalesced ${texts.length} text messages for chat ${chatId}`,
    );
  }

  await handleIncoming({
    chatId,
    content,
    updateId: firstUpdateId,
    allowlist: parseAllowlist(),
  });
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

  // Slow-turn warning. The typing indicator pulses every ~5s, but a long
  // research turn (skill with multiple web searches, opus reasoning, etc.)
  // can take 30-90s — long enough that the user wonders if the bot died.
  // Send one explicit "still working" message at ~60s. Single shot; we
  // don't want a chatty bot, just one signal that things are alive.
  const slowTurnTimer = setTimeout(() => {
    sendTelegramMessage(
      chatId,
      "⏳ Still working on this — give it another minute.",
    ).catch((err) =>
      console.warn(`[turn ${turnTag}] slow-turn notice failed:`, err),
    );
    console.log(`[turn ${turnTag}] slow-turn notice sent at 60s`);
  }, 60_000);

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
    clearTimeout(slowTurnTimer);
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
    const chatId = String(ctx.chat.id);
    const updateId = String(ctx.update.update_id);
    const text = ctx.message.text;

    // Allowlist gate before any buffering — strangers can't fill memory.
    if (allowlist && !allowlist.has(chatId)) {
      console.log(`[telegram] ignored text from non-allowlisted chat ${chatId}`);
      return;
    }

    // Coalescing disabled (TEXT_DEBOUNCE_MS=0) → pass straight through.
    if (!textCoalescingEnabled()) {
      await handleIncoming({ chatId, content: text, updateId, allowlist });
      return;
    }

    // Append to per-chat buffer. New arrivals reset the timer so a burst
    // ("ось ідея" → "у Linear" → "термін завтра") flushes once.
    let entry = textBuffers.get(chatId);
    if (!entry) {
      entry = {
        chatId,
        texts: [],
        firstUpdateId: updateId,
        openedAt: Date.now(),
        flushTimer: setTimeout(() => {}, 0),
      };
      clearTimeout(entry.flushTimer);
      textBuffers.set(chatId, entry);
    }
    entry.texts.push(text);
    clearTimeout(entry.flushTimer);

    // Hard flush at the message-count cap or after the absolute max wait,
    // whichever comes first. Otherwise schedule a debounce flush.
    const elapsed = Date.now() - entry.openedAt;
    if (
      entry.texts.length >= TEXT_HARD_FLUSH_AT ||
      elapsed >= TEXT_MAX_WAIT_MS
    ) {
      await flushTextBuffer(chatId);
    } else {
      const remainingMaxWait = TEXT_MAX_WAIT_MS - elapsed;
      entry.flushTimer = setTimeout(
        () => void flushTextBuffer(chatId),
        Math.min(TEXT_DEBOUNCE_MS, remainingMaxWait),
      );
    }
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
      const audio = await downloadTelegramFile(fileId);
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

  bot.on("message:photo", async (ctx) => {
    const chatId = String(ctx.chat.id);
    const updateId = String(ctx.update.update_id);

    if (allowlist && !allowlist.has(chatId)) {
      console.log(`[telegram] ignored photo from non-allowlisted chat ${chatId}`);
      return;
    }

    // Telegram sends an array of progressively-larger sizes of the same
    // photo. The last one is the highest resolution.
    const sizes = ctx.message.photo;
    const largest = sizes[sizes.length - 1];
    const fileId = largest.file_id;
    const caption = ctx.message.caption?.trim() ?? "";
    const groupId = ctx.message.media_group_id;

    // Album member → buffer and (re)schedule flush.
    if (groupId) {
      console.log(
        `[telegram] photo chatId=${chatId} group=${groupId} file_id=${fileId} ${largest.width}x${largest.height}` +
          (caption ? ` caption=${JSON.stringify(caption.slice(0, 80))}` : ""),
      );

      let entry = albumBuffers.get(groupId);
      if (!entry) {
        // Safety: don't let a stuck flush balloon memory.
        if (albumBuffers.size >= MAX_TRACKED_GROUPS) {
          console.warn(
            `[telegram] album buffer at cap (${MAX_TRACKED_GROUPS}); falling back to single-photo handling for group ${groupId}`,
          );
        } else {
          entry = {
            chatId,
            fileIds: [],
            caption: "",
            firstUpdateId: updateId,
            // Placeholder; set immediately below.
            flushTimer: setTimeout(() => {}, 0),
          };
          clearTimeout(entry.flushTimer);
          albumBuffers.set(groupId, entry);
        }
      }
      if (entry) {
        entry.fileIds.push(fileId);
        // First non-empty caption wins (Telegram puts caption on
        // exactly one item, usually the first).
        if (!entry.caption && caption) entry.caption = caption;
        clearTimeout(entry.flushTimer);
        if (entry.fileIds.length >= ALBUM_HARD_FLUSH_AT) {
          // Telegram's max — we know there's nothing more coming.
          await flushAlbum(groupId);
        } else {
          entry.flushTimer = setTimeout(
            () => void flushAlbum(groupId),
            ALBUM_DEBOUNCE_MS,
          );
        }
        return;
      }
      // Fallthrough on cap-overflow: handle as single below. Rare path,
      // logged above for visibility.
    }

    // Single-photo path (no media_group_id, or buffer-cap fallback).
    console.log(
      `[telegram] photo chatId=${chatId} file_id=${fileId} ${largest.width}x${largest.height}` +
        (caption ? ` caption=${JSON.stringify(caption.slice(0, 80))}` : ""),
    );

    const stopTyping = startTypingLoop(chatId);
    let description: string;
    try {
      const image = await downloadTelegramFile(fileId);
      // Telegram-served photos are jpeg.
      description = await describeImage(image, "image/jpeg");
      console.log(`[telegram] image described (${description.length} chars)`);
    } catch (err) {
      console.error("[telegram] photo description failed:", err);
      stopTyping();
      const userMessage =
        err instanceof ImageConfigError
          ? "Image understanding isn't set up — `ANTHROPIC_API_KEY` is missing in the server's .env. Send text describing what's in the image, or ping the operator."
          : "Sorry — I couldn't process that image. Try again or describe it in text?";
      await sendTelegramMessage(chatId, userMessage);
      return;
    } finally {
      stopTyping();
    }

    const content = caption
      ? `[Image]:\n${description}\n\nUser caption: ${caption}`
      : `[Image]:\n${description}`;

    await handleIncoming({ chatId, content, updateId, allowlist });
  });

  bot.on("message:document", async (ctx) => {
    const chatId = String(ctx.chat.id);
    const updateId = String(ctx.update.update_id);

    if (allowlist && !allowlist.has(chatId)) {
      console.log(`[telegram] ignored document from non-allowlisted chat ${chatId}`);
      return;
    }

    const doc = ctx.message.document;
    const fileId = doc.file_id;
    const fileName = doc.file_name ?? "document";
    const mimeType = doc.mime_type ?? "application/octet-stream";
    const fileSize = doc.file_size ?? 0;
    const caption = ctx.message.caption?.trim() ?? "";
    console.log(
      `[telegram] document chatId=${chatId} name=${fileName} mime=${mimeType} size=${fileSize}`,
    );

    const stopTyping = startTypingLoop(chatId);
    let content: string;
    try {
      // 1. Image-as-document → vision pipeline.
      if (mimeType.startsWith("image/")) {
        const image = await downloadTelegramFile(fileId);
        const description = await describeImage(image, mimeType);
        content = `[Image: ${fileName}]:\n${description}`;
      }
      // 2. Readable text/code/config → inline (truncated if huge).
      else if (isReadableText(mimeType, fileName)) {
        const buffer = await downloadTelegramFile(fileId);
        const body = readTextWithTruncation(buffer);
        content = `[File: ${fileName}] (${mimeType}, ${fileSize} bytes):\n\`\`\`\n${body}\n\`\`\``;
      }
      // 3. PDF — we don't extract yet; tell the user.
      else if (mimeType === "application/pdf") {
        stopTyping();
        await sendTelegramMessage(
          chatId,
          `I see ${fileName} but I can't read PDFs yet. Send a screenshot of the page(s) you care about, or paste the text.`,
        );
        return;
      }
      // 4. Anything else.
      else {
        stopTyping();
        await sendTelegramMessage(
          chatId,
          `I see ${fileName} (${mimeType}) but I can't read this format yet. Send a screenshot or copy-paste the relevant bits as text.`,
        );
        return;
      }
    } catch (err) {
      console.error("[telegram] document handling failed:", err);
      stopTyping();
      const userMessage =
        err instanceof ImageConfigError
          ? "Image understanding isn't set up — `ANTHROPIC_API_KEY` is missing in the server's .env."
          : `Sorry — I couldn't read ${fileName}. Try again or paste the contents as text?`;
      await sendTelegramMessage(chatId, userMessage);
      return;
    } finally {
      stopTyping();
    }

    if (caption) content += `\n\nUser caption: ${caption}`;

    await handleIncoming({ chatId, content, updateId, allowlist });
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
