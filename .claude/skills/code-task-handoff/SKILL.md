---
name: code-task-handoff
description: Convert a code-change request from Telegram into a structured GitHub issue ready for the operator's host Claude Code session to execute. Use when the user describes a code edit, refactor, bug fix, copy change in a website, PR-style work, or any modification that touches files in a repo — and they mention or imply a specific GitHub repository. Examples ("правки в lge-website", "fix bug у Jarvis", "змінити hero копі на сайті", "refactor в репо X", "закоммітити це", "відкрий PR що", "make this change to the website"). NOT for Linear team-tracking tickets — use linear-issue-drafter for those. NOT for read-only GitHub queries (PR status, issue comments, branch lists). Always stages via save_draft so the user reviews before the issue is opened.
---

# Code task handoff

The operator (Robert) has direct Claude Code subscription access on his laptop where coding is effectively flat-rate. Every code edit through Jarvis costs paid API time on opus/sonnet — strict net loss vs. doing it in his host session. This skill is the bridge: when Robert says "fix this in repo X" via Telegram, instead of spawning a github-write sub-agent (expensive, $3-5/edit), we draft a GitHub issue with a tight spec. He picks it up in his next host Claude session and ships it for free.

## When to use

- "Fix bug у [repo]" / "Виправ ось це в [repo]"
- "Зміни hero / copy / footer на сайті [name]" / "edit the hero on [site]"
- "Refactor [thing] in [repo]"
- "Add [feature] to [repo]"
- "Open a PR for [change] in [repo]"
- "Закоммітити це у [repo]"
- "I want to change X in [repo]"
- A voice note describing a code change to a known repo
- A screenshot of a UI bug / typo with "fix this" + repo context

## When NOT to use

- **Linear team-tracking tickets** ("створи тікет про X", "запиши в Linear") → `linear-issue-drafter`. The line is: GitHub issue = the operator's own coding session will pick it up; Linear ticket = team-tracked work, possibly assigned to someone else.
- **Read-only GitHub** ("статус PR #5", "що в коментах issue #12", "які гілки в repo X") → `spawn_agent` with the github integration directly. Read-only is cheap and doesn't need this skill's drafting.
- **Issue management without code** (close issue, add label, assign) → `spawn_agent` with github, single-write.
- **Quick one-line tweaks** the operator clearly wants to remember without opening an issue ("memo this for next session", "remember to fix X eventually") → `quick-capture` skill writes to memory.
- **Fresh new project / repo doesn't exist yet** ("start a new repo for Y") → `spawn_agent` with github (repo creation is one-shot, doesn't need a draft layer).

## Inputs

- **Required**: a description of the code change + a repo identifier (name, URL, or implicit via recall of recent work).
- **Optional**: target branch, screenshots referencing the bug, file/component hints, urgency.
- **Implicit context** (pull via recall): which repos the operator works on, conventions per repo (commit style, branch naming, file structure if memorized), recent active branches.

## Voice / image intake

Same forgiving normalization as `linear-issue-drafter`:
- `[Voice note]: ...` prefix → strip filler, normalize repo names against recalled list ("елджейка" → `lge-website`, "джарвіс" → `jarvis-17.0`).
- `[Image]: ...` prefix or `[Album of N images]:` — extract any visible text/code/error/UI strings from the description and weave them into the issue body verbatim. Screenshots of bugs become "reproduction steps" or "expected vs. actual" sections.
- Multi-image albums — each image referenced in the issue body so the host session knows which screen each text snippet came from.

## Procedure

1. **Identify the repo.** Try in order:
   - explicit mention (`lge-website`, `rsan17/jarvis-17.0`, etc.)
   - implicit via recall ("the website" + recall reveals operator's website is `lge-website`)
   - last-mentioned repo in this conversation (recall short-tier memories tagged `recently-worked-repo`)
   - if still unclear: ask one clarifying question — "Це у якому репо?" Don't draft a placeholder.

2. **Pull conventions.** `recall` for any memorized facts about that repo: tech stack, branch naming convention, commit style, deploy target. Fold them into the issue's "Hints" section if useful — saves the host session time.

3. **Parse the change.** Extract:
   - **Title** — one short imperative line, ≤80 chars, in the language of the input. "Fix hero copy on lge-website Process section" beats "Hero copy fix needed".
   - **Why** — 1-2 sentence rationale. If the user didn't give one, leave blank or use "Operator request via Telegram on YYYY-MM-DD".
   - **What** — clear description of the change. Quote any specific copy / code / values verbatim.
   - **Acceptance criteria** — 2-4 bullets describing "done" looks like. For copy changes: "section X reads exactly Y". For bug fixes: "bug no longer reproduces with steps Z" + "test added if applicable". For features: minimum viable behavior.
   - **Files likely involved** — best-effort guess from recall + repo conventions. Tag uncertainty: "likely `app/page.tsx` or `components/Hero.tsx`". OK to leave blank if no hint.
   - **References** — original Telegram chat link (`tg:<chatId>` reference), screenshot transcript snippets if any.

4. **Build the draft payload:**
   ```json
   {
     "kind": "github-issue",
     "summary": "<one-line summary of the issue>",
     "issue": {
       "owner": "rsan17",
       "repo": "lge-website",
       "title": "Fix hero copy on lge-website Process section",
       "body": "<markdown body — Why / What / AC / Files / Reference>",
       "labels": ["copy", "telegram-handoff"]
     },
     "confidence": {
       "repo": "high",
       "files": "low — host session will need to grep"
     }
   }
   ```

5. **`save_draft`** with the payload.

6. **Return a Telegram-formatted preview** (Output format below).

## Output format

```
**🔧 GitHub issue draft → for next coding session**

**<Title>**
Repo: `<owner>/<repo>` ✅
Labels: <list>

**Why**
<1-2 sentences>

**What**
<the change, with verbatim quotes for copy / values>

**Acceptance criteria**
• <bullet>
• <bullet>

**Files likely involved**
• <hint>  (or "host session will grep")

Reply "send" to open the issue, or correct fields ("repo jarvis-17.0", "label bug", "no AC needed").
```

## Body template (markdown that lands in the GitHub issue)

```markdown
## Why
<rationale, or "Operator request via Telegram, YYYY-MM-DD HH:MM">

## What
<clear description; verbatim copy/code/values in fenced blocks>

## Acceptance criteria
- [ ] <bullet>
- [ ] <bullet>

## Files likely involved
- <hint>

## Reference
- Source: Telegram chat (`tg:<chatId>`)
- Transcripts / screenshots: <quoted relevant excerpts if any>
- Date: <ISO date>

---
_Drafted by Jarvis via the `code-task-handoff` skill. The operator (Robert) will execute this in his host Claude Code session — the repo's CLAUDE.md and house conventions apply._
```

## Multi-task batch from one message

If the user describes multiple separate code changes in one Telegram message ("fix hero, also change footer color, and add a contact button"), draft them as **separate** issues in **one** `save_draft` of `kind: "github-issue-batch"`. Don't merge unrelated changes into one issue — tighter PRs are easier to ship and review.

## Edge cases

- **Repo unknown after recall** → ask once, don't draft.
- **User says "don't open the issue, just remember it"** → don't use this skill; switch to `quick-capture` writing the change to memory.
- **User says "send straight to PR" / "do it now"** → reply once: "Quick reminder — coding through me costs API time. I can draft the issue and you ship it in your next coding session for free, OR I can spawn the github-edit sub-agent now (~\$3-5 likely). Which?". Default to the issue draft if user's intent is ambiguous.
- **Issue would be huge** (multi-day refactor) → flag in the draft preview: "This looks like multi-PR work; consider splitting into smaller AC bullets first."
- **Operator wants the issue assigned to themselves on creation** → set `assignees: ["rsan17"]` in the payload.

## Things this skill does NOT do

- Doesn't open the issue itself — only `save_draft`. Commit goes through the dispatcher's `send_draft`.
- Doesn't write or push code, ever. That's the whole point — that work is reserved for the host Claude Code session.
- Doesn't read repo file contents to plan the change. The host session will do that with full repo context (much cheaper).
- Doesn't run any GitHub Actions or CI.
- Doesn't update existing issues — single-write workflow is `spawn_agent` territory.
