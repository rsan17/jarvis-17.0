---
name: decision-log
description: Capture an architecture / agency / process decision as a structured ADR (context, decision, consequences, alternatives) and stage it via save_draft for storage in Notion. Use when the user says "запиши рішення", "ADR for X", "architecture decision", "log decision", "чому ми вирішили X", "запиши чому ми...", "document this choice", "decision record", "зафіксуй рішення", "ADR про X". Voice-friendly — works with rough dictation. Read-only / additive — never overwrites prior ADRs.
---

# Decision log

Architecture Decision Records for Jarvis, 17dots delivery, and side projects. Robert keeps making the same call ("чому ми обрали Convex замість Postgres", "чому Telegram через long polling", "чому фікс-прайс а не T&M для Romi") and re-litigating it every few months. This skill captures the decision **once**, with context + alternatives + consequences, so future Robert (or future Jarvis) can `recall` instead of redebating.

Storage: Notion ADR database (one page per decision). Numbering is sequential — `ADR-NNN` — pulled from the highest existing record.

## When to use

- "Запиши рішення про X" / "Log a decision about X"
- "ADR: ми обрали Y бо Z" / "ADR for choosing Y over Z"
- "Зафіксуй чому ми вирішили..." / "Document why we decided..."
- "Architecture decision record для X"
- "Decision log entry: ..."
- After a longer chat where Robert reasoned through a tradeoff and said "ну ок, поїхали з варіантом А" — proactively suggest logging it (don't auto-create).

## When NOT to use

- "Створи тікет" → `linear-issue-drafter` (decisions ≠ work items)
- "Покажи всі ADR" → read-only Notion query, no skill needed
- "Що ми вирішили щодо X?" → `recall` first, then read the matching ADR — don't re-create
- A casual preference ("давай використовувати dark mode у дизайні") without tradeoffs — too lightweight for an ADR; use `quick-capture` instead
- Code edits that need explanation → put rationale in commit message + PR description, not ADR

## Inputs

- **Required**: the decision itself (one line) + minimal context (what triggered the question).
- **Optional**: alternatives considered, consequences (positive / negative), related ADRs, status override, scope tag.
- **Implicit**: today's date, ADR sequence number, author (Robert), default status `Accepted`.

## ADR structure (Nygard-style, trimmed)

Every record has these fields:

1. **Number** — `ADR-NNN`, sequential, no gaps. Query Notion for max existing number first.
2. **Title** — short imperative, ≤80 chars. "Use Convex instead of Postgres for Jarvis backend" not "Database choice".
3. **Status** — `Proposed` / `Accepted` / `Deprecated` / `Superseded by ADR-XXX`. Default `Accepted` (Robert rarely logs proposals he hasn't acted on).
4. **Date** — today.
5. **Scope tag** — one of `jarvis`, `17dots-process`, `client:<name>`, `personal-tooling`. Helps filtering.
6. **Context** — 2-4 sentences. What forces are at play? What problem are we solving?
7. **Decision** — 1-2 sentences, declarative. "We will X." Not "We considered X and Y, and chose X" — that goes in alternatives.
8. **Consequences** — bullets. Positive AND negative. If you can't name a downside, you haven't thought hard enough.
9. **Alternatives considered** — bullets, each with one-line "why not". Skip if user didn't mention any.
10. **Related** — links to other ADRs this supersedes / extends / depends on. Optional.

## Voice intake

Robert often dictates ADRs walking. Be forgiving:

- Filler ("ну ось", "значить", "коротше") → strip.
- "Чому ми не пішли з X" / "we didn't go with X" → that's an alternative.
- "Бо інакше Y" / "because otherwise Y" → that's a consequence (negative of the alternative).
- "Поки що" / "for now" / "тимчасово" → status `Proposed`, not `Accepted`. Flag explicitly.
- Tradeoff signal words ("але", "хоча", "with the downside that") → split into Decision vs Consequences.

If voice transcript is ambiguous, ask **one** clarifying question (e.g. "це Accepted чи Proposed?"), don't ask three.

## Procedure

1. Parse input. Identify which fields are explicit, which need inference.
2. `recall("ADR latest number", "decision log")` to find the next sequence number. If recall returns nothing, query the Notion ADR DB directly via notion MCP search.
3. If user mentioned related work ("supersedes the old Sendblue setup"), search Notion for the matching prior ADR and link it.
4. Build the ADR body in markdown (the Notion page content):
   ```markdown
   # ADR-042: <Title>

   - **Status:** Accepted
   - **Date:** 2026-05-03
   - **Scope:** jarvis

   ## Context
   <2-4 sentences>

   ## Decision
   <1-2 sentences, declarative>

   ## Consequences
   - ✅ <positive>
   - ⚠️ <negative / tradeoff>

   ## Alternatives considered
   - **<alternative>** — <one-line why-not>

   ## Related
   - Supersedes ADR-019
   ```
5. Build the draft payload:
   ```json
   {
     "kind": "adr",
     "summary": "ADR-042: <title>",
     "adr": {
       "number": 42,
       "title": "...",
       "status": "Accepted",
       "date": "2026-05-03",
       "scope": "jarvis",
       "body_markdown": "<full markdown above>",
       "notion_database_id": "<from env / 17dots-context>",
       "related": ["ADR-019"]
     },
     "confidence": {
       "scope": "high",
       "alternatives": "low — Robert mentioned 1, may be more"
     }
   }
   ```
6. `save_draft` with the payload.
7. Reply with the Telegram preview (Output format).

## Output format

```
**📐 ADR draft — ADR-042**

**<Title>**

**Status:** Accepted • **Scope:** jarvis • **Date:** 2026-05-03

**Context:** <1-2 sentence summary>

**Decision:** <1 sentence>

**Consequences:**
✅ <pos>
⚠️ <neg>

**Alternatives:** <list or — none captured>

Reply "send" to publish to Notion, or correct fields ("status proposed", "scope client:Romi", "+ alternative: build it ourselves — too slow").
```

## Edge cases

- **No alternatives mentioned**: don't fabricate. Leave the section out and flag low confidence.
- **Decision contradicts an existing ADR**: search Notion before drafting; if found, set `status: Superseded by ADR-NNN` on the old one (as part of the same draft) and reference it in `Related` of the new one.
- **Scope unclear**: ask once. If still unclear after one round, default to `jarvis` (most common for Robert's solo decisions) or `17dots-process` (if any team member is mentioned).
- **User says "відміни ADR-019"**: that's a status change, not a new ADR. Stage as `kind: "adr-status-update"` instead.
- **Multiple decisions in one voice note** ("ми обрали Convex, і ще вирішили що skill registry через MCP"): draft them as **separate** ADRs in one `kind: "adr-batch"` save_draft. Each gets its own number.

## Things this skill does NOT do

- Doesn't write to Notion directly — only `save_draft`. The dispatcher's `send_draft` commits.
- Doesn't edit existing ADRs (use `adr-status-update` draft kind for status flips; full content edits should be a manual Notion fix).
- Doesn't auto-detect that a chat conversation contains a decision — Robert must invoke. (Future: passive listener that suggests "це варто зафіксувати як ADR" after long architectural threads.)
- Doesn't number ADRs across scopes separately — single global sequence.
