---
name: linear-issue-drafter
description: Turn a voice note or freeform text into a properly-structured Linear issue (title, acceptance criteria, project guess, assignee guess, labels) and stage it via save_draft for one-tap approval. Use when the user says "створи тікет", "запиши в Linear", "create issue", "make a ticket", "Linear ticket", "новий тікет", "запиши таску", "todo для X", "add to Linear", "Linear issue", or sends a voice note describing something to track. Voice-friendly — works with rough transcripts.
---

# Linear issue drafter

Voice → ticket is the killer Telegram pattern for an agency owner. This skill turns "[Voice note]: треба зробити нову лендінгу для Romi до п'ятниці, проектний — Romi, відповідальний Влад, мінімум адаптив + dark mode" into a full Linear issue with title, AC, project, assignee, labels, due date, ready for one-tap approval.

## When to use

- "Створи тікет про X" / "Create issue for X"
- "Запиши в Linear: ..." / "Add to Linear: ..."
- "Новий тікет" / "New ticket"
- "Запиши таску" / "Track this"
- "Todo для [project]"
- A voice note that describes work to be done (see Voice intake below)

## When NOT to use

- "Покажи всі мої тікети" → spawn_agent for read-only listing
- "Зміни статус тікета X на done" → spawn_agent (single-write, doesn't need this skill's drafting)
- "Що в спрінті?" → that's `sprint-planner`
- "Скільки тікетів не закрито?" → simple Linear query, no drafting

## Inputs

- **Required**: a description of what needs to be done (text or voice transcript). Free-form is fine — the skill parses.
- **Optional**: explicit project name, assignee name, labels, due date, priority, parent issue.
- **Implicit context** (pull via recall + 17dots-context): client list, team list, project mappings, label conventions.

## Voice intake

When the input came from a voice note (look for `[Voice note]:` prefix), be extra forgiving:
- Filler words ("ну", "значить", "ось") → strip
- Project/person names may be misheard → normalize against known list (Romi → "Romi", Mukachevo → leave verbatim, "Влад" → "Vlad"). Confirm in the draft if low-confidence.
- Robert often gives priority by tone ("терміново", "горить") — capture as `priority: urgent`.
- Dates: "до п'ятниці" / "by Friday" → resolve against current date. "На наступному тижні" → set due date to next Friday.

## Procedure

1. Parse the input. Extract candidate fields:
   - **Title** — one short imperative line, ≤80 chars, in the language of the input. Don't try to be cute. "Зробити лендинг для Romi" beats "Land the Romi landing page".
   - **Acceptance Criteria** — 2-4 bullets describing "done" looks like. If user didn't say, infer minimum sensible AC from project type (landing page → desktop + responsive + dark mode; bug → reproduces no longer + test).
   - **Project** — match to known Linear projects via `recall` + 17dots-context. If no clear match, leave blank and flag.
   - **Assignee** — match to team. If "self" / "я" → Robert. If unclear, leave blank.
   - **Labels** — pick from known label set per project type: `bug`, `feature`, `design`, `client-facing`, `internal`. Multi-allowed.
   - **Priority** — `urgent` / `high` / `medium` / `low`. Default `medium`.
   - **Due date** — parsed from input or AC ("by Friday"). Optional.
2. Call `recall` for the named project to pull project description, current cycle, default assignee, default labels — fills any gaps.
3. Spawn-fetch from `linear` to validate: project exists, assignee is a team member, labels exist on the project. If any reference is wrong, normalize or flag.
4. Build the draft payload:
   ```json
   {
     "kind": "linear-issue",
     "summary": "<one-line summary of the issue>",
     "issue": {
       "title": "...",
       "description": "<markdown — context paragraph + AC bullets>",
       "projectId": "...",
       "assigneeId": "...",
       "labelIds": ["..."],
       "priority": "medium",
       "dueDate": "2026-05-02"
     },
     "confidence": {
       "project": "high",
       "assignee": "low — please confirm Vlad",
       "labels": "high"
     }
   }
   ```
5. `save_draft` with the payload.
6. Return a Telegram-formatted preview (Output format).

## Output format

```
**📋 Linear draft**

**<Title>**

**Project:** <Name> ✅
**Assignee:** <Name> ⚠️ <flag if low confidence>
**Labels:** <list>
**Priority:** <level>
**Due:** <date or —>

**Description:**
<2-3 sentences of context>

**Acceptance criteria:**
• <bullet>
• <bullet>

Reply "send" to create, or correct fields ("assignee Tetiana", "priority urgent", "label bug").
```

## Multi-issue from one voice note

If the voice note clearly describes multiple separate items ("treба зробити X, потім Y, і ще Z"), draft them as **separate** issues in **one** save_draft of `kind: "linear-issue-batch"`. Don't merge unrelated work into one ticket.

## Edge cases

- Input is too short to make sense ("create issue") with no body: ask one clarifying question — "Про що тікет?" Don't draft a placeholder.
- Project guess wrong on first pass: in confirmation reply path, the user often types just "Romi" — interpret as project override and re-draft, don't ask again.
- User says "without AC" / "no checklist": skip the AC section, keep description.
- User dictates a multi-paragraph spec: keep it as the description verbatim, but still extract a clean title from the first sentence/intent.

## Things this skill does NOT do

- Doesn't actually create the issue — only `save_draft`. The draft-decisions MCP committing it lives in the dispatcher's `send_draft` tool.
- Doesn't update existing issues — single-write workflow not worth a skill.
- Doesn't change status / move issues between cycles.
- Doesn't read other people's issues for context-stuffing — only what the user explicitly references.
