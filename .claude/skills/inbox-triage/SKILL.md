---
name: inbox-triage
description: Classify recent unread Gmail threads into Action / FYI / Newsletter / Spam, summarize each Action thread, and draft a batch operation (archive newsletters + label the rest) for the user to approve via save_draft. Use when the user says "перебери пошту", "почисти інбокс", "triage my inbox", "sort gmail", "розбери пошту", "пошта", "розчисть інбокс", "що в пошті важливого", "inbox zero", or asks to sort/clean/process emails. Mutating actions (archive, label, mark-read) ALWAYS go through draft approval — never executed directly.
---

# Inbox triage

Cut Robert's morning gmail-tax to one decision point: approve a draft of label/archive operations, then he's done.

## When to use

- "Перебери пошту" / "Triage my inbox"
- "Почисти інбокс" / "Clean my inbox"
- "Що в пошті важливого?"
- "Розбери пошту"
- "Sort gmail"
- "Розчисть інбокс"

## When NOT to use

- "Прочитай мені останній лист від X" — direct read, no triage. Use spawn_agent.
- "Напиши відповідь на цей тред" — that's `email-reply-drafter`.
- "Що нового в інбоксі?" — that's the inbox section of `daily-brief`.

## Inputs

- Optional: time window (default last 24h, max 7d).
- Optional: max threads to process (default 50).
- Optional: focus filter ("тільки клієнти" / "клієнти only" → restrict to known client domains from 17dots-context).

## Classification taxonomy

Every thread lands in exactly one bucket:

| Bucket | What goes here | Default action |
|---|---|---|
| **Action** | Direct ask, decision needed, deadline, pending reply, contract/legal, payment | Label `Action`, leave unread |
| **FYI** | CC'd updates, status reports, calendar invites already in cal | Label `FYI`, mark read |
| **Newsletter** | Substacks, marketing, product updates from tools, digests | Archive, label `Newsletter` (filter rule for next time) |
| **Spam** | Cold outreach, unsolicited proposals, obvious phishing | Archive, label `Spam-review` (Robert checks weekly to confirm) |

Heuristics for classification:
- Sender is a known client (per `17dots-context`) → Action by default
- Sender is a teammate → Action if direct, FYI if CC
- List-Unsubscribe header present → Newsletter
- Subject contains "[stat]", "weekly digest", "your [tool] report" → Newsletter
- Bulk-mail marker (>10 recipients in To/CC) AND not from teammate → Newsletter or Spam
- "Re:" thread the user previously replied to → Action only if last message is from external

## Procedure

1. Spawn-fetch from `gmail`: unread threads in the time window, capped. Pull `from`, `subject`, `snippet` (first 200 chars), `to`, `cc`, `List-Unsubscribe` header, `labels`.
2. Call `recall("client list", "team list")` to refine sender classification. Use `17dots-context` skill data if it surfaces in recall.
3. Classify each thread. For Action threads, write a one-line summary (≤80 chars) including urgency tag: `[urgent]` / `[today]` / `[this week]` / `[no rush]`.
4. Build the draft payload:
   ```json
   {
     "kind": "gmail-batch",
     "summary": "<N> action, <M> FYI, <K> newsletter, <L> spam",
     "operations": [
       {"threadId": "...", "action": "label", "labels": ["Action"]},
       {"threadId": "...", "action": "archive+label", "labels": ["Newsletter"]},
       ...
     ],
     "actionPreview": [
       {"threadId": "...", "from": "...", "subject": "...", "summary": "...", "urgency": "today"},
       ...
     ]
   }
   ```
5. `save_draft` with this payload.
6. Return a Telegram-formatted summary (see Output format) so Robert can decide.

## Output format

```
**📬 Triage** — <total> threads scanned

**Action (<N>) — needs you:**
• [urgent] <Sender> — <subject>: <summary>
• [today] <Sender> — <subject>: <summary>
• [this week] <Sender> — <subject>: <summary>
...

**FYI (<M>):** <comma-separated senders, max 6, then "+ K more">
**Newsletter (<K>):** archived
**Spam-review (<L>):** archived

Draft pending — reply "send" to apply, or list specific threadIds to override.
```

## Edge cases

- Only Action threads, nothing else to archive: skip the draft entirely, just return the Action list.
- Empty inbox: "📭 Інбокс чистий — нема що робити. Yay."
- A single very-large thread (50+ messages): summarize the LATEST message only, mark `[long thread — open in Gmail for full context]`.
- Thread classified Action but it's actually waiting on the user's prior reply (i.e. "I sent it, ball in their court"): downgrade to FYI with note.
- Conflict between sender heuristic and content heuristic: prefer **content**. A teammate sending a digest is still a digest.

## Things this skill does NOT do

- Doesn't draft replies — that's `email-reply-drafter`.
- Doesn't unsubscribe newsletters — that's `unsubscribe-sweep`.
- Doesn't search the body of emails for facts — that's WebFetch over a saved URL or a manual ask.
- Doesn't auto-apply rules — every batch goes through `save_draft` approval. No exceptions.
