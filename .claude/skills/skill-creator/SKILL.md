---
name: skill-creator
description: Author a new SKILL.md for the Jarvis registry, or improve an existing one. Use when the user says "напиши скіл", "create a skill", "make a skill that does X", "add a new skill", "improve the X skill", "новий скіл", or asks how to teach Jarvis a new procedure. Outputs a complete SKILL.md draft (frontmatter + two-tier body) and the exact git commands to add it.
---

# Skill creator

Turn a half-formed idea ("I wish Jarvis would ___ for me") into a working `.claude/skills/<name>/SKILL.md` that the registry will pick up automatically.

## When to use

- "Напиши скіл який X"
- "Create a skill for Y"
- "Add a new playbook"
- "Improve the description of skill Z" (re-author existing)
- "Why isn't Jarvis using the X skill?" (likely description-tuning issue)

## Inputs to gather first (ask if missing)

1. **Trigger phrase(s)** — what would the user say in chat? Both Ukrainian and English. The dispatcher matches against `description` via embedding + substring; bad triggers = silent miss.
2. **Inputs the skill needs** — e.g. "a Linear project name", "an email thread URL", "raw voice note text". Skip if the skill is parameterless.
3. **External effects** — does it send / create / modify anything? If yes, the skill MUST end through `save_draft` so the user approves via Telegram. Read-only skills (briefs, summaries, translations) skip this.
4. **Integrations needed** — gmail / linear / googlecalendar / discord / github. The skill body should name them so the execution agent loads them.

## Output shape — every SKILL.md follows this

```
---
name: <kebab-case, must match folder name>
description: <one paragraph. Lead with what it does. Pack trigger phrases UA+EN: "Use when the user says X, Y, Ukrainian-trigger, English-trigger, ...">
---

# <Title Case Name>

<one-line restatement of purpose>

## When to use
- Bullet of trigger phrases (UA + EN)
- Edge cases that should also trigger this

## When NOT to use
- Other skills that look similar but cover different ground
- Cases where freeform spawn_agent is better

## Inputs
- What the skill needs from the user (one bullet each)
- Defaults when input is missing

## Procedure
Numbered steps, each step a sentence. Reference integrations by their name
(gmail, linear, googlecalendar). For external effects, end with `save_draft`.

## Output format
What the user actually sees back. Telegram-friendly: <600 chars,
short bullets, no tables.
```

## Rules that make skills actually work

1. **Description is the routing surface.** It's the only thing in the dispatcher's `<available_skills>` budget — the body is loaded only after `run_skill` is called. Pack trigger phrases tightly. Bad: "Helps with email." Good: "Use when the user says triage my inbox, перебери пошту, почисти інбокс, sort gmail, прибери пошту, або просить ранкову вибірку важливих листів."

2. **Bilingual triggers** — Robert types UA and EN interchangeably. Always include both. Don't write transliterations (use real Cyrillic).

3. **Two-tier loading inside SKILL.md.** Top section = quick reference (~300 tokens). Sub-headings below = "READ ONLY IF..." material. Keeps active context cheap.

4. **`save_draft` for any external mutation.** Email send, calendar create, Linear issue create, Discord post — ALWAYS go through draft. Never call the integration's "send/create" tool directly from a skill.

5. **One skill, one purpose.** If you're tempted to add "...also does Y", that's a second skill. The dispatcher picks ONE; combined skills get matched ambiguously and lose to focused skills.

6. **Body stays under 400 lines.** Skills over 500 lines hit Anthropic's recommended size budget. If yours is bigger, split or move material to `references/` (loaded on demand via `Read`).

## How to install a new skill

The skill-creator does NOT write to disk directly — it produces the file content and the install commands. The user (or future tooling) commits the file:

```bash
mkdir -p .claude/skills/<name>
cat > .claude/skills/<name>/SKILL.md << 'EOF'
<your content here>
EOF
git add .claude/skills/<name>/SKILL.md
git commit -m "feat(skills): add <name>"
git push
```

On next merge to main + droplet pull, the indexer reindexes within ~200ms. If the watcher is already running on a dev box, the skill becomes available the moment the file lands.

## Self-improvement loop (Jarvis-specific)

When Robert asks for a new skill via Telegram:
1. Use `recall()` to check if a similar skill already exists; if so, suggest editing rather than creating.
2. Gather the inputs above through 1-2 follow-up questions if needed (don't ask 5 questions; pick the highest-leverage ones).
3. Draft the SKILL.md following the output shape.
4. Reply with the file content + install commands as a single Telegram message.
5. (Future) `save_draft({kind: "new-skill", payload: {name, content}})` so the user can approve and the bot can commit + open a PR autonomously.

## Output format for the chat

Reply with two clearly-marked sections:

**1. SKILL.md content** — fenced markdown block with the complete file.

**2. Install command** — one bash block the user can paste.

Keep prose around the blocks minimal. Robert wants to read code, not commentary.
