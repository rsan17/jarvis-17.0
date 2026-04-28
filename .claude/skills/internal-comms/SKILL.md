---
name: internal-comms
description: Draft internal team communications for 17dots — Discord broadcast, weekly digest, status update, project kickoff message, OOO announcement, change-of-plans note. Stage via save_draft, never auto-post. Use when the user says "напиши команді", "team announcement", "broadcast в Discord", "повідомлення в чат", "напиши про X команді", "Friday digest", "status для команди", "kickoff message", "OOO announcement". Always goes through save_draft.
---

# Internal comms

Anything Robert sends to his team that's longer than a quick reply — kickoffs, weekly digests, OOOs, change announcements. Drafted in the team's tone (casual peer, direct, low-ceremony), staged for approval.

## When to use

- "Напиши команді про X"
- "Broadcast в Discord"
- "Friday digest"
- "Kickoff message for [project]"
- "OOO message — Robert поза наступного тижня"
- "Change of plans on X — повідомити команду"
- "Status update для всіх"

## When NOT to use

- DM to one specific teammate → write directly, no template needed
- External client comms → `email-reply-drafter` or `proposal-writer`
- Urgent ping ("Tetiana потрібна на дзвінок зараз") — too short for this skill, just send

## Inputs

- **Required**: topic / what to communicate.
- **Optional**: audience (all-team default, or specific subset), channel (Discord general by default), tone override ("more formal" / "more urgent" / "more celebratory"), language (UA default for internal team).

## Comm types — pick the right template

| Type | When | Length | Tone |
|---|---|---|---|
| **Kickoff** | New project starting | 4-6 sentences | Energizing, sets ownership |
| **Weekly digest** | End-of-week | 5-8 bullets | Recap, low-fluff |
| **Status update** | Mid-project check-in | 3-5 sentences | Direct, name what's blocked |
| **OOO** | Robert away | 2-3 sentences | Brief, who covers what |
| **Change announcement** | Plan / scope / timeline shift | 3-5 sentences | Acknowledge impact, explain why |
| **Win celebration** | Project shipped, milestone hit | 1-3 sentences | Warm, name names |
| **FYI** | Heads-up about external development | 2-4 sentences | Neutral |

## Procedure

1. Identify type from inputs.
2. `recall("team comms tone", "team handles")` for context.
3. Pull supporting data if relevant:
   - Kickoff → recall the project brief, list project team
   - Weekly digest → call standup-notes skill internally for the week's team activity
   - Status update → query Linear for project state
4. Draft per template. Tone rules:
   - **First names**, never "Шановні колеги"
   - **Direct, low-fluff** — name the thing, don't ramp up
   - **Bilingual default = UA** for team (Robert's team is Ukrainian-speaking); auto-switch to EN if context is EN-language project
   - **Never blame-y** — "I shifted timeline" not "the team didn't deliver"
   - **Tag people who need to act**: `@Tetiana, can you take this?` — but only when there's a real ask
5. Build the draft:
   ```json
   {
     "kind": "discord-broadcast",
     "summary": "<type> — <topic>",
     "channel": "general" | "<other>",
     "audience": "all" | "<subset>",
     "language": "uk" | "en",
     "body": "..."
   }
   ```
6. `save_draft`.
7. Return Telegram preview.

## Output format

```
**💬 Team comm draft** — <type> · <channel>

---
<draft body verbatim>
---

Reply "send" to broadcast to <channel>, "ред [instruction]" to revise, or "skip".
```

## Templates by type

**Kickoff:**
```
Нагадаю — стартуємо <project> для <client>. <Lead person> веде, <other roles>. Брифінг тут: <link>. Старт <date>, перший check-in <next-Friday>. Питання — пишіть.
```

**Weekly digest** (bullet list):
```
**🗓 <Week ending date>**

✅ Закрили: <projects/items>
🚀 В роботі: <items>
⏳ Чекає на клієнта: <items>
🎯 Наступний тиждень: <focus>

<one-line celebration if there's a clear win>
```

**OOO:**
```
Я поза з <date> до <date>. <Person X> на терміновому. Стандартні питання — в чат, відповім по поверненні. <Optional: contact channel for emergency>
```

**Change announcement:**
```
Heads-up: <change>, ефект — <impact>. Причина: <reason, brief>. Що міняється для вас: <bullet, if any>. Питання — кидайте.
```

## Edge cases

- **Negative news** (project lost, layoff, missed deadline): keep it short, factual, no over-explaining. Robert reviews carefully before sending.
- **Sensitive content** (one teammate underperforming, client conflict): don't broadcast. Suggest a 1:1 instead. Flag in the draft summary.
- **Multiple team chats** (general, design-only, dev-only): default to general unless content is role-specific.
- **EN-speaking client included in audience by mistake**: don't auto-translate; ask Robert which language he meant.

## Things this skill does NOT do

- Doesn't auto-broadcast — `save_draft` only.
- Doesn't translate already-sent messages — that's `ua-en-translate`.
- Doesn't decide who to tag for follow-up actions — that's the user's call (suggest, but defer).
- Doesn't post to Telegram (that's where Robert IS) — channel = Discord (or specified).
