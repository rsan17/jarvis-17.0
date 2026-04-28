---
name: standup-notes
description: Generate async standup-style notes for the 17dots team — yesterday/today/blockers per teammate — by aggregating Linear issue activity and GitHub commits/PRs from the last 24h. Use when the user says "standup", "стендап", "що команда робила", "team update", "що по команді", "team status", "what did the team ship", "що зробила команда вчора", "weekly team digest", "ранковий стендап". Read-only.
---

# Standup notes

Robert's team (Tetiana, Vlad, Nastya, Katya, Roman) is async — no daily live standup. This skill generates the equivalent: a per-person "yesterday / today / blockers" view from system-of-record signals (Linear + GitHub), so Robert can scan in 30 seconds.

## When to use

- "Standup" / "Стендап"
- "Що команда робила вчора?"
- "Team update"
- "Що по команді?"
- "What did the team ship?"
- Friday "weekly team digest"
- Monday "що почали тиждень з?"

## When NOT to use

- "Стендап для конкретного проекту X" → that's a per-project status, more like `project-status` (not yet implemented). This skill is team-wide.
- "Що я робив вчора?" → personal recap, simpler — just spawn a personal Linear/GitHub query.
- "Сплануй спрінт" → that's `sprint-planner`.

## Inputs

- Optional: window (default last 24h on weekdays, last 72h on Mondays to cover the weekend).
- Optional: include-only-team-X (filter to subset of people).
- Optional: depth (`brief` = bullets only, `full` = include 1-line per issue/PR).

## The team

Per memory + 17dots-context skill:
- **Robert** — owner / dispatch
- **Tetiana** — design lead
- **Vlad** — frontend / fullstack
- **Nastya** — design / production
- **Katya** — design / brand
- **Roman** — Shopify / specialty work

When attributing activity, match Linear assignee names + GitHub usernames against this list. Use `recall("team handles")` for current GitHub aliases if drift is suspected.

## Procedure

1. Fetch from `linear`: issues with status changes in window, assigned-to or moved-by any team member. Capture: issue id, title (truncated to 50 chars), prior→new status, assignee, project, last-comment date.
2. Fetch from `github`: commits and PRs (open/merged/closed) in window, authored by team handles. Capture: repo, PR title, action (opened/merged/closed), reviewer ack if any.
3. For each teammate, bucket activity:
   - **Yesterday (done)**: issues moved to `Done` or PRs merged
   - **Today / In flight**: issues currently `In Progress` assigned to them, or open PRs
   - **Blocked**: issues with `Blocked` status or PRs with stale `Changes requested` review
4. Skip teammates with zero activity in window — don't pad.
5. Compose the standup. Format below.

## Output format

```
**📋 Standup** — <date>

**Tetiana**
✅ Done: <count> issues, <count> PRs
   • [PROJ-123] Landing v2 — moved to Done
   • PR #45 in 17dots/dealscribe-app: hero animation
🚀 In flight: <count>
   • [PROJ-130] Mobile responsive pass
🚧 Blocked: <count>
   • [PROJ-128] Waiting on copy from client

**Vlad**
✅ Done: ...
🚀 In flight: ...
🚧 Blocked: <none → omit line>

...

**🌟 Highlights:**
• Tetiana shipped landing v2 — biggest win this round
• 3 PRs need Robert's review (mark below)
```

Trim aggressively for `brief` mode:
```
**📋 Standup** — <date>

• **Tetiana**: 2 done, 1 in flight, 0 blocked
• **Vlad**: 1 done, 2 in flight, 1 blocked (waiting on copy)
• **Nastya**: idle
• **Katya**: 1 in flight
• **Roman**: idle

**Watch:** Vlad's blocker — copy from client X.
```

## Edge cases

- **Whole team idle in window**: short reply — "Тиха ніч — нічого нового з вчора. Тільки це нормально?"
- **One person dominates activity (>60% of all changes)**: flag in highlights — "Tetiana shipped a lot — others light. Is that intentional?"
- **PR opened by external contributor**: include but tag with `(external)`, don't bucket under any team member.
- **Linear deleted issue still shows changes**: skip silently, don't try to reconstruct.

## Things this skill does NOT do

- Doesn't write the standup MESSAGE to Discord — read-only summary. If Robert wants to broadcast, that's a separate `team-broadcast` skill.
- Doesn't track time spent — Robert doesn't time-track.
- Doesn't auto-schedule per cadence — that's an automation, set up separately.
- Doesn't compare productivity between teammates — never. This is a "what's happening" view, not a performance-review tool.
