---
name: proposal-writer
description: Draft a structured 17dots client proposal — scope, pricing, timeline, team, deliverables — based on a client brief or discovery notes. Output is a ready-to-send proposal text, staged via save_draft for review. Use when the user says "напиши пропозал", "draft a proposal", "оффер для X", "write proposal for client X", "складемо пропозал", "пітч для нового клієнта", "preparation для discovery call". Always goes through save_draft.
---

# Proposal writer

Turn discovery notes / client brief into a proposal that matches 17dots' tone and pricing model. Stage for Robert's review, don't auto-send.

## When to use

- "Напиши пропозал для X"
- "Draft a proposal"
- "Оффер для [client]"
- "Складемо пропозал"
- "Пітч для [client]"
- After a discovery call: "Robert just had a call with X, write up the proposal"

## When NOT to use

- "Повтори пропозал який ми робили для Y" → spawn_agent to retrieve, no drafting
- "Перепиши секцію scope" → narrow edit, just spawn_agent on existing doc
- Cold pitch with no discovery → ask user what scope first; don't fabricate

## Inputs

- **Required**: client name + brief / discovery notes
- **Optional**: project type (landing / brand / shopify / app / design system), timeline, budget hint, team preference, language (UA / EN — default = client's primary)

## Procedure

1. Parse the brief — extract: client name, project type, scope hints, timeline mentions, budget hints, stakeholders.
2. `recall("17dots pricing", "team rates")` for current pricing model.
3. `recall("client X")` if returning client — pull prior project context.
4. Use the agency context from `17dots-context` skill (call `Skill("17dots-context")` if you need team / RACI / process details).
5. Compose proposal sections:
   - **Project overview** (3-5 sentences) — what we understand they need
   - **Scope** — bulleted deliverables, organized by phase
   - **Out of scope** — what's explicitly excluded (anti-creep)
   - **Timeline** — phase dates, dependencies, review checkpoints
   - **Team** — who from 17dots is on this (Tetiana / Vlad / Nastya / Katya / Roman) per project type
   - **Pricing** — fixed bid OR phased OR retainer per pricing model
   - **Process** — how we work, async cadence, review style
   - **Next steps** — what client needs to confirm to start
6. Build the draft:
   ```json
   {
     "kind": "proposal",
     "summary": "<client> — <project type> — $<amount>",
     "client": "...",
     "language": "uk" | "en",
     "sections": { "overview": "...", "scope": "...", "..." }
   }
   ```
7. `save_draft`.
8. Return Telegram preview — sectioned, with section toggles.

## Output format

```
**📄 Proposal draft** — <client> · <project type> · $<amount> · <timeline>

**1. Overview** (<word count>)
<first 2 sentences>...

**2. Scope** — <N> deliverables
• <top 3 bullets>
...

**3. Timeline:** <total weeks>, phases: <phase 1>, <phase 2>, ...

**4. Team:** <names>

**5. Pricing:** $<amount> <model: fixed/phased/retainer>

[full draft staged — reply "show overview", "show scope", etc. to inspect, "send" to email, "ред [section] [instruction]" to revise]
```

## Pricing model defaults

- **Landing page**: fixed bid, $X per page (recall current rate)
- **Brand identity**: fixed bid, phased — discovery / concepts / refinement / handoff
- **Shopify**: fixed bid for theme work, hourly for custom dev
- **Design system**: fixed bid, phased — audit / tokens / components / docs
- **App / product**: weekly retainer, no fixed bid (too much unknown)

If brief is too vague to price → return scope+timeline draft with "Pricing TBD pending scope confirmation" and ask Robert.

## Edge cases

- **Brief mentions competitor we lost to before**: leave the proposal alone but flag in summary so Robert decides whether to pursue.
- **Client is in industry 17dots avoids**: stop and ask — don't draft for industries Robert has previously declined.
- **Stakeholder ambiguity** (multiple decision-makers, no clear primary): draft TO the named contact but include "Cc: [other names]" in the staging metadata.
- **UA client asking for proposal in EN**: confirm — sometimes they want to share with international stakeholders, sometimes it's a default. Translate the version they want.

## Things this skill does NOT do

- Doesn't actually email — `save_draft` only.
- Doesn't sign / contract — separate legal flow.
- Doesn't create the project in Linear — that's manual after kickoff.
- Doesn't fabricate discovery notes — if brief is too thin, ask.
