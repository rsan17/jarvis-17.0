---
name: client-thread-summarizer
description: Compress a long Gmail thread into "decisions made / open questions / next ask / scope creep flags" so Robert doesn't reread 30 messages. Use when the user says "що в цьому треді", "summarize this thread", "переказ переписки", "TLDR thread", "що ми з X домовились", "що обговорювали з [client]", "розкажи в двох словах про переписку", "what's the summary of this email chain". Read-only.
---

# Client thread summarizer

Long client threads are recurring tax. This skill turns a 30-message thread into 4 sections: what was decided, what's open, what's the next ask, and any scope-creep red flags Robert should pre-empt before sending the next reply.

## When to use

- "Що в цьому треді?"
- "Summarize this thread"
- "Переказ переписки"
- "TLDR thread"
- "Що ми з X домовились?"
- "Що обговорювали з [client]?"
- User pastes a thread URL or quotes a long thread fragment asking for a summary

## When NOT to use

- "Напиши відповідь" / "Draft a reply" → `email-reply-drafter`
- "Знайди все що X писав про Y" → grep-style query, simpler spawn_agent
- Thread under 5 messages — overkill, just read it
- Standalone sender summary across many threads → that's `person-dossier` (not yet implemented)

## Inputs

- **Required**: thread identifier (Gmail thread ID, URL, or "the latest thread from X" / "the [subject] thread")
- **Optional**: depth (`tldr` = 4 bullets only, `full` = with quoted-key-passages)
- **Optional**: focus ("only what's open" / "only decisions")

## Procedure

1. Resolve via `gmail`: pull all messages in the thread, parse: sender, date, body (HTML stripped). Cap at last 50 messages if huge.
2. Parse for structured signals:
   - **Decisions** — past-tense agreement language: "agreed", "let's go with", "погодилися", "домовились", "ok by me", "approved"
   - **Open questions** — explicit "?" sentences in latest 5 messages, OR statements followed by "let me know" / "thoughts?" / "?"
   - **Next ask** — the most recent message's primary CTA from the other side. What does the user need to do next?
   - **Scope creep flags** — phrases that expand original agreement: "while you're at it", "and could you also", "small addition", "невеликий додатковий запит", "на додаток", "додатково"
   - **Pricing/timeline mentions** — extract any numbers, dates, currency
3. `recall("client X relationship")` for tone calibration on the summary.
4. Compose the summary. Be ruthless — every bullet earns its place.

## Output format

```
**📜 Thread summary** — <subject>
<N> messages, <date range>, <main participants>

**✅ Decisions made:**
• <decision> _(date, who agreed)_
• <decision>

**❓ Still open:**
• <question> — last raised by <name> on <date>
• <question>

**👉 Next ask:** <one sentence — what the OTHER side needs from Robert / what Robert needs to do>

**⚠️ Watch-outs:**
• Scope: <flag if found, e.g. "client added 'and a mobile version' in msg 12 — not in original scope">
• Timeline: <flag if found, e.g. "deadline shifted from May 15 → May 8 with no scope reduction">
• Tone: <flag if found, e.g. "tense after revision request">
```

Skip the "Watch-outs" section if nothing flagged. Don't fabricate concerns.

For `tldr` mode:
```
✅ Decided: <comma-separated, brief>
❓ Open: <comma-separated>
👉 Next: <one line>
⚠️ <only if flagged>
```

## Decision detection rules

A "decision" requires explicit confirmation from at least one party:
- Robert proposed → Client said "ok / yes / agreed / let's do it / погоджуюсь" → DECIDED
- Client proposed → Robert said the same → DECIDED
- One side stated and the other DIDN'T explicitly disagree → NOT decided (open / implicit)

Implicit agreement is risky — flag it as "appears agreed but not explicitly confirmed".

## Edge cases

- **Thread is a meeting recap email with no replies**: summary is the recap itself, decisions are listed in the email. Easy mode.
- **Thread has multiple sub-conversations** (people split the topic): summarize each sub-thread separately under named sub-headers.
- **Auto-replies / out-of-office in the thread**: ignore, don't include in participant list.
- **Forwarded thread (Robert is summarizing for himself before sending elsewhere)**: focus the summary on what someone NEW would need to know. Add brief "TL;DR for forwarding" at top.
- **Thread is in EN but recap is asked in UA**: summarize in UA, keep quoted excerpts in source language.

## Things this skill does NOT do

- Doesn't draft a reply — pair with `email-reply-drafter` for that.
- Doesn't archive or label — pair with `inbox-triage`.
- Doesn't pull attachments — only message bodies.
- Doesn't rate the client / assess relationship health — too subjective for an automated summary.
