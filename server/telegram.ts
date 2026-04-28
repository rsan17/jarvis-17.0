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
// Caps the input at 5 MB (Anthropic image limit) and tells the model to
// produce a thorough description + verbatim OCR of any text. The output
// becomes the dispatcher's only window into the image, so we ask for
// detail rather than a one-liner.
const IMAGE_BYTES_LIMIT = 5 * 1024 * 1024;
const VISION_PROMPT = `You are describing an image so a downstream agent can act on it without seeing it.

Be thorough:
- What is shown overall (UI screenshot, photo, diagram, document, chat, code, etc.).
- All visible text — extract verbatim, preserving line breaks, formatting, code, error messages, URLs.
- Layout cues that matter: which part is highlighted, where the cursor is, what's selected, what looks like an error vs. a normal element.
- Anything obviously wrong, unusual, or clickable.

Do NOT add interpretation the user didn't ask for. Just describe what's there. Output is plain text — no markdown headers, no preamble like "Here is a description". Lead with the type of image, then the contents.`;

async function describeImage(image: Buffer, mediaType: string): Promise<string> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    throw new ImageConfigError(
      "ANTHROPIC_API_KEY not set — image description disabled. Set it in .env to enable vision.",
    );
  }
  if (image.byteLength > IMAGE_BYTES_LIMIT) {
    throw new Error(
      `image too large: ${image.byteLength} bytes (limit ${IMAGE_BYTES_LIMIT})`,
    );
  }
  const model = process.env.BOOP_MODEL ?? "claude-sonnet-4-6";
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
      "content-type": "application/json",
    },
    body: JSON.stringify({
      model,
      max_tokens: 2048,
      messages: [
        {
          role: "user",
          content: [
            {
              type: "image",
              source: {
                type: "base64",
                media_type: mediaType,
                data: image.toString("base64"),
              },
            },
            { type: "text", text: VISION_PROMPT },
          ],
        },
      ],
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
