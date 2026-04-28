---
name: daily-brief
description: Generate the user's morning briefing — today's calendar, important inbox highlights, Linear deltas, and any flagged energy/focus notes — in one tight Telegram message. Use when the user says "ранковий бриф", "morning brief", "що сьогодні", "what's on today", "доброго ранку", "доброе утро", "сводка", "briefing", "що в мене сьогодні", "розклад на сьогодні", or any opening turn before 11am that asks about the day ahead. Read-only — never sends or creates anything.
---

# Daily brief

Replace "open Gmail, open Calendar, open Linear, scroll, repeat" with one Telegram message that surfaces only what matters in the next 24h.

## When to use

- "Доброго ранку" / "Good morning" (treat as implicit request when the user opens the day)
- "Ранковий бриф" / "Morning brief"
- "Що сьогодні?" / "What's on today?"
- "Сводка" / "Briefing"
- "Розклад на сьогодні?"
- "Що в мене зараз важливого?" — early in the day

## When NOT to use

- "Що було вчора?" → that's `weekly-review` territory
- "Що я маю сьогодні зробити?" if the user clearly means a task list, not a brief — use `linear-issue-drafter` review instead
- During the day for ad-hoc "що там на 3 годину?" — that's a calendar lookup, not a brief

## Inputs

- None required. Optional: explicit horizon ("today only" vs "next 24h" vs "today + tomorrow morning"). Default = today, server-local time.

## Procedure

1. Spawn-fetch from `googlecalendar`: today's events with `summary`, `start`, `end`, `attendees`, `description` truncated to 300 chars. Skip declined events. Skip "Busy" placeholders.
2. Spawn-fetch from `gmail`: unread threads from the last 12h. Filter to: starred, threads with attachments from known clients, threads in Action label (if set), or threads where the latest message is from a person not a list. Cap at 8.
3. Spawn-fetch from `linear`: issues with status changes in the last 24h where the user is assignee, creator, or mentioned. Cap at 5.
4. Call `recall("morning routine")` — there may be persistent notes (e.g. "remind me about hydration", "client X follow-up always at 9am").
5. Compose the brief in Telegram-friendly markdown (see Output format).
6. Return. Do NOT send / archive / mark-read anything — read-only.

## Output format

One Telegram message, ~400-600 chars. Use bold for section headers, • for bullets. No tables.

```
**🌅 Сьогодні** — <weekday>, <date>

**Calendar (<N>):**
• 09:30 [client name] — <30-word context>
• 14:00 Internal sync — <30-word context>

**Inbox (<N> threads to look at):**
• [Sender] — <subject, 50 chars>
• [Sender] — <subject>

**Linear (<N> changes):**
• <issue id> moved → <status> by <person>
• <issue id> mention from <person>: "<first 60 chars>"

**↪** <one-line nudge from recall, if any. Skip the line if nothing.>
```

## Tone

- Match Robert's energy. If it's a heavy day (>4 meetings) end with a short "тримайся" / "you got this". If it's a quiet day, end with a focus suggestion ("good day to ship X — no meetings until 2pm").
- Bilingual: section headers in Ukrainian by default. Switch to English if the prior turn was in English.
- Never apologize for finding less than expected ("only 1 meeting" is fine — that's a feature, not a failure).

## Edge cases

- Calendar empty: lead with "Чистий день — only inbox + Linear below" and proceed.
- Inbox empty: skip the section entirely. Don't write "no new emails".
- Linear empty: skip the section.
- All three empty: short reply — "Все тихо. Що сьогодні робиш?" / "All quiet. What are you working on today?"

## Things this skill does NOT do

- Doesn't reply to / draft / archive emails — that's `inbox-triage` or `email-reply-drafter`.
- Doesn't create issues — that's `linear-issue-drafter`.
- Doesn't move events — manual.
- Doesn't proactively run on a schedule — that's an `automation` (set up separately).
