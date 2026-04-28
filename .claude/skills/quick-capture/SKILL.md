---
name: quick-capture
description: Catch-all "remember this" — auto-tag a fragment (idea / task / fact / person / quote) and route it to the right place: durable memory for facts, Linear for tasks, draft-staged Notion entry for ideas. Use when the user says "запам'ятай", "запиши", "remember this", "note this", "ідея", "saved this thought", "throw this in inbox", "throw it somewhere", or sends a stand-alone fragment with no clear ask. Voice-friendly.
---

# Quick capture

The killer Telegram pattern for an owner: dump a thought via voice or text, let Jarvis decide the right home. Most goes to durable memory; tasks become Linear drafts; longer ideas get staged for Notion.

## When to use

- "Запам'ятай: [text]"
- "Записати: [text]"
- "Remember this: [text]"
- "Throw this somewhere: [text]"
- "Ідея на потім: [text]"
- "На пам'ять: [text]"
- A standalone voice/text fragment that ISN'T a question, ISN'T directed at the bot, and ISN'T part of an ongoing thread

## When NOT to use

- "Створи тікет про X" → `linear-issue-drafter` (explicit task creation)
- "Запиши що ми домовились що X" → durable memory direct, no quick-capture overhead
- A question disguised as capture ("чи варто X?") → answer the question, don't capture
- Multi-paragraph spec → that's a project doc, not a quick capture

## Auto-classify into one of:

| Tag | Content shape | Destination |
|---|---|---|
| **fact** | Statement of how things are: "Romi платить 30-го", "Vlad live in Kyiv now", "Kyrillic-only headers don't work in Stripe checkout" | `write_memory(tier=long, segment=knowledge or context)` |
| **person-note** | Something about a specific person: "Tetiana prefers Wednesday review calls", "Roman зацікавлений в Shopify Plus tier" | `write_memory(segment=relationship, includes person name)` |
| **preference** | Robert's own pref: "I want to keep Friday afternoons free", "не люблю коли клієнт пише в неділю" | `write_memory(segment=preference)` |
| **task** | Something Robert intends to do: "потрібно подзвонити провайдеру", "fix the responsive bug on landing", "send invoice to AI Prudence" | Draft a Linear issue via `linear-issue-drafter` workflow |
| **idea** | Longer thought worth developing: marketing angle, business idea, blog post seed, design concept | Draft a Notion entry — `save_draft` of `kind: notion-inbox` |
| **quote** | Something someone else said worth remembering: client wisdom, podcast snippet | `write_memory(segment=knowledge, metadata: source=quote)` |
| **ambiguous** | Can't tell — short fragment, no signal | Route to `write_memory(tier=short, segment=context)` and flag for next consolidation |

## Procedure

1. Read the fragment. Detect language (UA/EN) — preserve verbatim.
2. Classify per the table above. Heuristics:
   - Imperative or future tense ("треба", "must", "need to", "let's do") → likely **task**
   - Person name + behavioral observation → **person-note**
   - Long-form (>200 chars) with creative framing → **idea**
   - "I prefer / I don't like / завжди / ніколи" → **preference**
   - Quote marks or attribution ("як казав X") → **quote**
   - Cold statement of fact → **fact**
3. Apply the destination action:
   - **Memory tags**: call `write_memory` with the appropriate tier/segment/importance. Importance: 0.7 default for facts, 0.8 for prefs, 0.6 for ambiguous.
   - **Task**: don't fully draft a Linear issue, but DO call `linear-issue-drafter` with the fragment as input — it'll handle the rest.
   - **Idea**: stage `save_draft({kind: "notion-inbox", payload: {title: <first 60 chars>, content: <fragment>, suggestedTags: [...]}})`. (Notion MCP not yet wired — this draft will queue until it lands.)
   - **Quote**: same as fact, but include source metadata.
4. Acknowledge in Telegram (Output format).

## Output format

Keep it tight — capture should feel low-friction:

```
✅ Captured as <tag> — <destination>

<one-line restatement back to confirm understanding>
```

Examples:

```
✅ Captured as fact — long memory

"Romi платить 30-го числа місяця, не раніше"
```

```
✅ Captured as task — Linear draft pending

"Fix responsive landing for Romi" — see draft above for confirmation.
```

```
✅ Captured as idea — Notion inbox queue

"Idea: turn proposal-followup analytics into client dashboard"
Draft staged. Reply "send" to push to Notion when MCP is wired, or "edit tags X,Y" to retag.
```

## Voice intake

Voice notes are the primary input mode for this skill. Be forgiving:
- Fillers (ну, значить, ось, like, you know) → strip
- Multiple thoughts in one note → split into multiple captures, each classified separately. Tell user how many you split into.
- Unclear pronoun ("він казав" — who?) → flag with a question rather than guessing.

## Edge cases

- **Same content was captured before** (memory contradiction or duplicate): flag, don't duplicate. "Looks like you saved a similar fact 3 days ago — update it instead?"
- **Cross-classified content** (e.g. "I want Vlad to fix the responsive bug" — task + person + preference): pick the dominant action, mention the others in the ack.
- **Sensitive content** (financials, legal, health): still capture, but tag with `metadata.sensitive=true` so memory consolidation handles carefully.
- **Empty / monosyllabic input** ("так", "ага", "yes"): don't capture, ask "що зберігаємо?"

## Things this skill does NOT do

- Doesn't search existing memory for the user — only writes. Search is via `recall()`.
- Doesn't auto-publish to anywhere — Notion entries stage via draft, Linear via the issue drafter (also draft).
- Doesn't deduplicate aggressively — flags possible duplicates but lets the user override (skipping is more annoying than duplicates).
- Doesn't classify into custom user-defined tags — taxonomy is fixed above. To add tags, edit this SKILL.md.
