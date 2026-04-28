---
name: email-reply-drafter
description: Draft a reply to a specific gmail thread, matching Robert's tone and the language of the thread (UA/EN auto-detected). Stages the draft via save_draft so Robert approves before sending. Use when the user says "напиши відповідь", "draft a reply", "відповідай на цей лист", "replyна", "відпиши X", "draft response to thread", or forwards/quotes a thread asking for a response. Always goes through save_draft — never sends directly.
---

# Email reply drafter

Bilingual, tone-matched email drafts that don't smell of AI. Always staged for approval, never auto-sent.

## When to use

- "Напиши відповідь на цей тред"
- "Відпиши Х"
- "Draft a reply to the thread from Y"
- "Reply на цей лист: [тема]"
- "Як відповісти на це?"
- User pastes/quotes a thread fragment and asks for a response
- User forwards a Gmail thread URL with no other context (treat as implicit "draft a reply")

## When NOT to use

- "Просто відправ X" / "Just send X" → user wrote the body, just stage send. No drafting needed.
- "Згенеруй холодний лист" / "Cold email to X" → no prior thread; that's `cold-email-drafter` (not yet implemented).
- "Що в цьому листі?" / "Summarize this thread" → that's `client-thread-summarizer`, not reply.
- "Triage my inbox" → `inbox-triage`.

## Inputs

- **Required**: the thread to reply to. Either a Gmail thread ID, a URL, a quoted excerpt, or "the last thread from X".
- **Optional**: instruction on what the reply should say ("agree to the timeline but push back on price"), tone override ("more formal", "warmer"), language override ("EN even though thread is UA").

## Procedure

1. Resolve the thread via `gmail` — pull last 3 messages, sender names, dates, subject.
2. **Detect language**: dominant language of the latest 2 messages. Default to that for the reply unless user overrode. Mixed UA/EN is fine — match the threading style.
3. **Detect tone**: warm/casual vs formal/business. Heuristics:
   - Sender uses first name + casual sign-off → casual
   - Sender uses "Шановний" / "Dear" / company suffix → formal
   - Long-running thread with established rapport → match the prior message's tone
4. `recall("communication style with X")` — there may be persistent notes on how Robert talks to this person.
5. Draft the reply:
   - Open with the right register (no "Доброго дня!" if the thread has been first-name for 8 messages).
   - Address each open question / ask in the latest message. Don't dodge.
   - Match Robert's voice: short sentences, no "delve" / "tapestry" AI smell, no over-apologizing, no "I hope this finds you well" if the thread is hot.
   - Sign-off matches the thread's pattern (`—Robert` or just `Robert` or no sign-off if quick).
6. Build the draft payload:
   ```json
   {
     "kind": "gmail-reply",
     "summary": "<one-line intent>",
     "threadId": "...",
     "to": "...",
     "subject": "Re: ...",
     "body": "<draft>",
     "language": "uk" | "en" | "mixed",
     "tone": "casual" | "formal"
   }
   ```
7. `save_draft`.
8. Return the draft preview to Telegram for approval (Output format).

## Output format

```
**✉️ Draft reply** to <Sender> — <subject>

**Тон:** <casual / formal>  •  **Мова:** <UA / EN>

---
<draft body, verbatim, no quoting>
---

Reply "send" to send, "ред [інструкція]" to revise (e.g. "ред — більш формально", "ред — додай deadline"), or "skip".
```

## Tone calibration

Robert's voice in this fork:
- **Direct, low-fluff** — get to the ask in the first 2 sentences.
- **Warm with clients, blunt with team** — different defaults per audience.
- **No corporate-speak** — never "Per our discussion", "I wanted to circle back", "kindly find attached".
- **Bilingual fluency** — UA replies use natural register, not translated-from-EN syntax.
- **Avoids AI tells** — no "delve", "tapestry", "robust", "leverage", "synergize", em-dash overuse, or hedging chains. Use the `avoid-ai-tells` style cues internally even though we're not calling that skill.

## Edge cases

- **Thread has multiple open asks** (e.g. price negotiation + scope question + scheduling): address all three explicitly. Don't reply to "easy ones" and ignore hard ones.
- **Thread is hostile / scope-creepy**: stay calm, restate scope from the original agreement, propose a clear path forward. Never escalate. Flag this to Robert in the draft summary so he reads carefully before sending.
- **User asks reply in different language than thread**: do the override but flag in summary that the recipient may not understand ("recipient's last message was UA, you asked for EN — confirm?").
- **Thread is internal team chat that drifted to email**: write a short, peer-tone reply. Less ceremony.

## Things this skill does NOT do

- Doesn't send — `save_draft` only.
- Doesn't archive after replying — separate flow.
- Doesn't write subject lines for new threads — only Re:.
- Doesn't include attachments — manual.
