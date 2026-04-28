---
name: 17dots-context
description: Reference data about the 17dots design agency — team members and roles, current clients, active projects, RACI conventions, pricing model, delivery process, internal cadence. Loaded by other skills (proposal-writer, internal-comms, meeting-prep, standup-notes, etc.) when they need agency context. Use when the user says "розкажи про команду", "team roster", "хто за що відповідає", "agency context", "що ми робимо", or when another skill explicitly invokes 17dots-context to enrich its output.
---

# 17dots context

Reference layer for any skill that needs to know "what's 17dots" — team, clients, process, pricing model. Other skills call this via `Skill("17dots-context")` to enrich their output without duplicating the data.

## When to use

- "Розкажи про команду 17dots"
- "Хто з команди за що відповідає?"
- "Який процес у вас?"
- "Що ми зараз робимо?"
- "Список клієнтів"
- Whenever proposal-writer / meeting-prep / standup-notes / internal-comms calls this skill internally

## When NOT to use

- "Хто такий [specific person outside team]" → person-dossier (not yet implemented), not this
- "Що по проекту X?" → linear / project status query
- Marketing copy about the agency → that's `localize-marketing-copy` content

## Team roster

| Person | Role | Strengths | Default project bucket |
|---|---|---|---|
| **Robert** | Owner / dispatch | Strategy, design direction, client relationships, technical hands-on | All — sets direction |
| **Tetiana** | Design lead | Brand, visual systems, pixel-level polish, design crit | Brand, design systems, hero design |
| **Vlad** | Frontend / fullstack | React, Next.js, Tailwind, animation (Framer/GSAP), Convex | Web app development, motion-heavy landings |
| **Nastya** | Design / production | Production design, asset management, file hygiene | Asset-heavy projects, multi-deliverable handoffs |
| **Katya** | Design / brand | Brand identity, illustration, marketing collateral | Brand work, social assets |
| **Roman** | Shopify specialist | Liquid, theme dev, Shopify integrations | All Shopify work |

## Current clients (active engagements — verify with recall before relying)

- **Dealscribe** — ongoing
- **Romi** — ongoing
- **AI Prudence** — ongoing
- **Optimus Gang** — ongoing

Always verify against `recall("client status")` before referencing — list above may be stale.

## Service offering

- **Brand identity** (Katya / Tetiana lead) — discovery / concepts / refinement / handoff
- **Landing pages** (Tetiana design / Vlad dev) — typically 2-4 weeks fixed bid
- **Design systems** (Tetiana / Vlad) — audit / tokens / components / docs phases
- **Shopify themes & integrations** (Roman lead) — fixed bid for theme work, hourly for custom
- **Web apps & dashboards** (Vlad lead) — weekly retainer engagement
- **AI tooling** (Robert hands-on) — Claude integrations, custom agents, automation; experimental tier

## Process / cadence

- **Communication**: async by default, Discord for team chat, Telegram for owner ping, Linear for issue tracking
- **Standups**: async via Linear activity, no daily live sync
- **Reviews**: end-of-week digest internal, mid-project check-ins with client
- **Time tracking**: not strict — fixed-bid model dominant
- **Tools**: Figma (design), Linear (PM), Convex / Next.js (build), Notion (docs), Discord (chat), Gmail (client-facing)

## Pricing principles

- **Default**: fixed bid for clear-scope work
- **Retainer**: weekly for ongoing product work, when scope-shifts are expected
- **Phased**: brand and design system work — discovery / concepts / refinement / handoff billed per phase
- **Hourly**: only for custom Shopify dev, never for design

## RACI defaults (per project type)

- **Brand identity**: Tetiana R, Katya R, Robert A, Nastya C, client I
- **Landing page**: Tetiana R (design), Vlad R (dev), Robert A, Nastya C (production), client I/A on review
- **Shopify**: Roman R, Robert A, Tetiana C (design), client I/A
- **App / product**: Vlad R, Robert A, Tetiana C (design), client I/A
- **Design system**: Tetiana R, Vlad R, Robert A

## Tone with the team (internal)

- First names, casual peer
- Direct — name what's blocked, no euphemism
- UA default
- Wins celebrated specifically (name the person and the outcome)
- Mistakes owned, not blamed

## Tone with clients

- **Default**: professional but warm; first names once they offer; UA or EN per their default
- **Decision-makers**: address by name, not "the team", not "we" alone
- **Scope discipline**: never agree to expansion without timeline / price update — flag every "while you're at it" via the `scope-creep-detector` workflow

## Client-specific notes (recall-overlay)

This skill provides defaults. For specific clients, always overlay with `recall("client X relationship")` — Robert's persistent memory has tone, prior issues, decision-maker names, payment habits, etc. that override this skill.

## Edge cases

- **Team member listed here left or changed role**: this SKILL.md goes stale. The skill-creator workflow is authoritative; rerun this skill via skill-creator if the team changes.
- **Client name conflict** (two clients with similar names): always ask which one, don't guess.
- **New service line not listed**: refer to recall + ask user; don't fabricate pricing.

## Things this skill does NOT do

- Doesn't generate output for the user directly — it's a reference layer for other skills.
- Doesn't track real-time team availability — that's calendar / Linear.
- Doesn't include sensitive financials (margins, salaries, runway).
- Doesn't list churned clients — only active.
