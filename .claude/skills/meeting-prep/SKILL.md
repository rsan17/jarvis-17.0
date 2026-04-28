---
name: meeting-prep
description: Surface the context Robert needs walking into a meeting — attendees, last touchpoint, related Linear issues, Notion notes, prior thread highlights — so he doesn't open the call cold. Use when the user says "підготуй до мітингу", "meeting prep", "prep for the call with X", "хто такий [name]", "що ми обговорювали з [client]", "next call with X", "що обговорювати з", or asks for context before a calendar event. Read-only.
---

# Meeting prep

Compress everything Robert touched in connection with a person/client/project into a one-screen brief so he can walk into the call already loaded.

## When to use

- "Підготуй до мітингу з X" / "Meeting prep for X"
- "Що ми обговорювали з [client]?"
- "Хто такий [name]?" — when context-of-purpose is meeting-related
- "Next call with X" / "Наступний дзвінок з"
- Any time the next event in calendar is <24h away and Robert mentions the attendee

## When NOT to use

- "Покажи мій календар" — that's a calendar query, not prep
- "Доброго ранку" / general morning brief — that's `daily-brief`
- Post-meeting recap — that would be a follow-up summary skill, not this

## Inputs

- **Identifier of the meeting**: event title, time slot, OR an attendee name. If user says "next call" → use the next event in calendar. If multiple match (e.g. several meetings with Romi) → ask which one.
- Optional: depth ("light" = top 5 facts, "deep" = full thread excerpts).

## Procedure

1. Resolve the meeting via `googlecalendar`: title, time, attendees (emails + names), description, agenda. If the meeting is recurring, pull the most recent past instance for prior-context.
2. Fetch participant context:
   - For each external attendee → search `gmail` for the last 3 threads with that address. Pull subject + 200 chars of latest message + date.
   - For each attendee in 17dots team → check `linear` for issues currently mentioning them or assigned to them in projects matching the meeting context.
3. If meeting title or description references a specific project/client → `recall(project_name)` for any persistent context the user has saved.
4. If meeting is a follow-up (subject contains "follow-up", "review", "kickoff", "sync"), pull last week's `linear` activity in the matching project: completed issues, blocked issues, in-progress count.
5. Compose the brief.

## Output format

```
**🎯 <Meeting title>** — <time> (<duration> with <N> people)

**Attendees:** <Name 1> (<role/company>), <Name 2>, ...

**Context:**
<2-3 sentences on the relationship — what's happening, last touchpoint date, who's pushing>

**Last threads (<email>):**
• <date> — <subject>: <one-line summary>
• <date> — <subject>: <one-line summary>

**Linear status (<project>):**
• <N> issues open, <M> closed this week
• Blocked: <issue id> — <reason>
• In flight: <issue id> assigned to <person>

**Likely topics:**
• <bullet inferred from threads + Linear deltas>
• <bullet>

**Watch-outs:**
• <e.g. "scope creep on Linear issue X — they may push back on timeline">
```

## Edge cases

- Internal meeting (only 17dots team, no client) → skip the email thread section, focus on Linear status + persistent context.
- Cold call / first meeting (no prior threads, no Linear history) → say so explicitly: "First touchpoint with X — no prior history. They're [role] at [company]." Pull whatever recall returns about how the meeting was booked.
- Meeting is in <30 minutes → keep it tight (≤300 chars), Robert doesn't have time to read.
- More than 8 attendees → don't do per-person threads; switch to "company-wide" framing.

## Things this skill does NOT do

- Doesn't write the agenda — just surfaces context.
- Doesn't reschedule / decline — manual.
- Doesn't draft post-meeting follow-up — that's a separate skill.
- Doesn't pull from Notion (no Notion MCP wired yet); when it lands, this skill will absorb it.
