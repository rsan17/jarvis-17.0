---
name: concept-explainer
description: Explain any concept at a depth-tunable level (ELI5 / ELI-engineer / ELI-designer / standard / deep) — programming patterns, design principles, business frameworks, technical specs, ML/AI ideas. Use when the user says "поясни X", "explain X", "що таке Y", "як працює Z", "ELI5", "поясни як інженеру", "поясни простіше", "deep dive into X", "як це насправді працює". Read-only.
---

# Concept explainer

On-demand learning via Telegram. Robert often hits "what does this thing actually mean" mid-flow — this skill answers without going on a 2000-word tour.

## When to use

- "Що таке X?" / "What is X?"
- "Поясни X"
- "Як працює Y?"
- "ELI5 [concept]"
- "Поясни як інженеру [concept]"
- "Deep dive into X"
- "Простішими словами"

## When NOT to use

- "Що ти можеш?" / "What can you do?" → bot capabilities, not concept
- "Хто такий [person]?" → person-dossier (not yet implemented)
- "Що ця помилка означає?" → debugging help, requires the error context — better as direct spawn_agent
- "Як зробити X?" → that's a how-to / skill recommendation, not a concept

## Inputs

- **Required**: the concept (one term or short phrase).
- **Optional**: depth level. Defaults inferred from phrasing:
  - "ELI5" → 5-year-old level, real-world metaphor
  - "Поясни як інженеру / engineer" → assume technical literacy, skip basics, name the trade-offs
  - "Поясни як дизайнеру / designer" → frame in design / visual / user-facing terms
  - "Deep dive" → 400-800 words, multiple layers
  - default → standard, ~250 words, bullet structure, one analogy

## Depth levels — what each looks like

### ELI5 (~120 words)
- One concrete metaphor (preferably physical / familiar object)
- 2-3 short sentences extending the metaphor
- One sentence on "and that's why it matters"
- No jargon, no bullets, no code

### Standard (~250 words)
- One-sentence definition
- 2-3 bullets covering the core idea
- One analogy (technical or physical, briefer than ELI5)
- One short example or scenario
- Optional: 1-line on common misconception

### ELI-engineer (~300-400 words)
- Definition with technical vocabulary
- The mechanism / how it actually works (3-5 bullets)
- Trade-offs vs alternatives
- Code/spec snippet if applicable (≤15 lines)
- Common pitfalls

### ELI-designer (~250-350 words)
- Definition framed in visual / UX / brand terms
- The user-facing implication
- Relevant examples (real apps / products / patterns)
- A visual analogy if it fits

### Deep dive (~500-800 words)
- All of standard PLUS
- Historical/ origin context (1-2 sentences)
- Variants / dialects / sub-flavors
- Where it fails / edge cases
- 1-2 references (verified URLs only — never fabricate)

## Procedure

1. Identify depth level from phrasing or input.
2. Identify whether the concept is one we'd benefit from spawning a research sub-agent for (i.e. it's something niche / current / disputed). Use heuristics:
   - Concept released in the last year → spawn for fresh sources (avoid stale training data)
   - Concept is well-established (a programming pattern, a known design principle) → answer from training, no spawn
   - Unsure → spawn just to fetch authoritative URL for the references section
3. If spawned: pass through `spawn_agent` with `task: "verify and cite sources for [concept] explanation at [depth] level"` and `integrations: []` (just WebSearch). Use the result as ground truth.
4. Compose the explanation per depth level template.

## Output format

Match depth level. Telegram-friendly always:
- ≤600 chars for standard / ELI5
- ≤900 chars for engineer / designer
- For deep dive: split into a multi-message response, each ≤900 chars, with section markers

```
**X** _(<depth-level>)_

<explanation per template>

<optional: misconception / pitfall / source>
```

## Tone

- Match Robert's style: warm, witty, unpretentious. No "Great question!".
- UA default. EN if the input was clearly EN.
- Don't condescend at ELI5 level — write FOR a smart 5-year-old, not at one.
- At engineer level, assume Robert knows the surrounding stack (TS, React, Convex, Linear, Composio, Claude SDK) — don't re-explain those.

## Edge cases

- **Concept doesn't exist** (made-up term, typo): say so directly, suggest the closest known concept. Don't invent.
- **Concept has multiple meanings** (e.g. "agent" in CS vs ML vs Anthropic-specific): list 2-3 senses, ask which Robert means.
- **Concept is fast-moving** (current AI/ML topic): note the snapshot date, recommend `deep-research` skill if Robert needs current state.
- **Robert pushes back on the explanation** ("так не зрозуміло"): drop one level deeper (engineer → standard, standard → ELI5) and try a different angle. Don't just paraphrase the same words.

## Things this skill does NOT do

- Doesn't critique the concept's value — explains, doesn't judge.
- Doesn't write tutorials / step-by-step how-tos — that's tutorial-style content, separate skill.
- Doesn't fact-check Robert's understanding — only explains the concept itself.
- Doesn't generate examples in code Robert hasn't asked for (engineer-level may include a snippet only if the concept is best shown that way).
