import { Router } from "express";
import FormData from "form-data";
import { handleUserMessage } from "./interaction-agent.js";

const getTelegramApi = () =>
  `https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}`;

async function downloadTelegramFile(fileId: string): Promise<Buffer> {
  const api = getTelegramApi();
  const infoRes = await fetch(`${api}/getFile?file_id=${encodeURIComponent(fileId)}`);
  if (!infoRes.ok) throw new Error(`getFile failed: ${infoRes.status}`);
  const infoJson = (await infoRes.json()) as { ok: boolean; result: { file_path: string } };
  if (!infoJson.ok) throw new Error("Telegram getFile returned ok=false");
  const filePath = infoJson.result.file_path;

  const token = process.env.TELEGRAM_BOT_TOKEN!;
  const fileUrl = `https://api.telegram.org/file/bot${token}/${filePath}`;
  const fileRes = await fetch(fileUrl);
  if (!fileRes.ok) throw new Error(`File download failed: ${fileRes.status}`);
  return Buffer.from(await fileRes.arrayBuffer());
}

async function transcribeVoice(audioBuffer: Buffer): Promise<string> {
  const form = new FormData();
  form.append("file", audioBuffer, {
    filename: "voice.ogg",
    contentType: "audio/ogg",
  });
  form.append("model", "whisper-1");

  const response = await fetch("https://api.openai.com/v1/audio/transcriptions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
      ...form.getHeaders(),
    },
    body: form as unknown as BodyInit,
  });
  if (!response.ok) {
    const err = await response.text();
    throw new Error(`Whisper transcription failed: ${response.status} — ${err}`);
  }
  const result = (await response.json()) as { text: string };
  return result.text.trim();
}

async function sendTelegramMessage(chatId: string, text: string): Promise<void> {
  const api = getTelegramApi();
  await fetch(`${api}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chat_id: chatId, text }),
  });
}

export function createTelegramRouter(): Router {
  const router = Router();

  /**
   * POST /telegram/webhook
   * Receives all updates from Telegram. Always responds 200 immediately to
   * prevent Telegram from retrying, then processes the message asynchronously.
   */
  router.post("/webhook", (req, res) => {
    res.json({ ok: true }); // ack immediately

    void (async () => {
      const update = req.body as TelegramUpdate;
      const message = update.message ?? update.edited_message;
      if (!message) return;

      const chatId = String(message.chat.id);
      const conversationId = `telegram:${chatId}`;

      let content: string | null = null;

      if (message.text) {
        content = message.text;
      } else if (message.voice) {
        const { file_id: fileId } = message.voice;
        console.log(`[telegram] voice note chatId=${chatId} file_id=${fileId}`);
        try {
          const audioBuffer = await downloadTelegramFile(fileId);
          const transcript = await transcribeVoice(audioBuffer);
          console.log(`[telegram] transcript: ${transcript}`);
          content = `[Voice note]: ${transcript}`;
        } catch (err) {
          console.error("[telegram] transcription error:", err);
          await sendTelegramMessage(chatId, "Sorry — I couldn't transcribe that voice note. Try again?");
          return;
        }
      }

      if (!content) return; // unsupported message type (photo, sticker, etc.)

      try {
        const reply = await handleUserMessage({ conversationId, content });
        await sendTelegramMessage(chatId, reply);
      } catch (err) {
        console.error("[telegram] agent error:", err);
        await sendTelegramMessage(chatId, "Sorry — something went wrong. Try again in a moment.");
      }
    })();
  });

  return router;
}

// ---- Minimal Telegram type stubs ----
interface TelegramUpdate {
  update_id: number;
  message?: TelegramMessage;
  edited_message?: TelegramMessage;
}

interface TelegramMessage {
  message_id: number;
  chat: { id: number; type: string };
  from?: { id: number; username?: string };
  text?: string;
  voice?: {
    file_id: string;
    file_unique_id: string;
    duration: number;
    mime_type?: string;
    file_size?: number;
  };
}
