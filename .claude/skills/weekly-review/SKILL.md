---
name: weekly-review
description: Sunday-style weekly review for Robert — wins, misses, slip patterns across projects, energy/focus flags, and a top-3 for next week. Aggregates Linear / GitHub / calendar / inbox over the past 7 days. Use when the user says "weekly review", "тижневий ревʼю", "підсумки тижня", "підбий тиждень", "weekly retro", "neighbor's review", "Sunday review", "пере думаю тиждень". Read-only.
---

# Weekly review

Higher-leverage than a daily journal. Run it Sunday evening or Monday morning to set the next week's top-3.

## When to use

- "Weekly review"
- "Тижневий ревʼю"
- "Підсумки тижня"
- "Підбий тиждень"
- "Sunday review"
- Sunday afternoon → end-of-day on its own (treat as implicit if Robert opens chat with reflection-flavored phrasing)

## When NOT to use

- Daily recap → too short a window for this skill
- "Що команда зробила?" → that's `standup-notes` (per-person, narrower)
- Project-specific retrospective → that's a different skill (project-retro, not yet implemented)

## Inputs

- Optional: explicit window (default = last 7 days, Sunday-ending). Override: "last 14 days" / "this month so far".
- Optional: focus area ("just business", "just personal").

## Procedure

1. Aggregate from systems-of-record over the window:
   - **`linear`**: issues moved to Done by Robert, by his team. Issues that slipped (still in flight after last week's plan). Issues blocked.
   - **`github`**: PRs merged, PRs opened, repos touched.
   - **`googlecalendar`**: meeting count, mtg-heavy days, gaps, recurring drains.
   - **`gmail`**: high-signal threads — proposals sent / closed, client conversations of substance. (Skip newsletters, transactional.)
2. `recall("last week's plan", "last week's intentions")` — was there a top-3 set last review? Did Robert hit it?
3. `recall("energy", "focus", "burnout")` — any persistent flags about workload?
4. Look for **patterns**, not just data:
   - Days >5 meetings + low Linear progress → meeting overload
   - Linear issues opened but none closed → started-many-finished-few
   - Same issue blocked all week → systemic blocker, not just this week
   - Threads with one client dominating > 30% of inbox → relationship attention needed
5. Compose review with: wins, misses, patterns, energy reading, top-3 for next week.

## Output format

```
**🗓 Weekly review** — week of <Mon date> to <Sun date>

**🌟 Wins**
• <bullet — specific outcome>
• <bullet>
• <bullet>

**🚧 Misses & slips**
• <bullet — what didn't happen + why if known>
• <bullet>

**🔍 Patterns**
• <pattern observation>
• <pattern>

**⚡ Energy reading**
<one-paragraph qualitative read based on calendar density + completion rate + memory flags>

**🎯 Next week's top 3**
1. <suggested priority based on slip/gap analysis>
2. <suggested priority>
3. <suggested priority — leave room for one personal/recovery item if last week was heavy>

---
_Reply to commit / edit the top-3 → `recall` will pick it up next review_
```

## Pattern catalog (heuristics)

- **Started-many-finished-few**: opened/closed ratio > 2:1 → flag
- **Meeting overload**: >25 meetings in week or any day with >6 → flag
- **Single-client gravity**: one client > 35% of inbox or Linear → flag
- **Blocker persistence**: same Linear blocker label across 3+ days → flag with the blocker text
- **Quiet week**: <10 issues moved + <5 meetings → not necessarily bad, but reflect on whether it was intentional rest or stalled momentum
- **PR streaks** (3+ days with merges) → momentum, celebrate

## Edge cases

- **First weekly review** (no prior plan to compare against): skip the "did we hit last week" framing; lay groundwork for next week.
- **Robert was OOO part of week**: shorten window to active days; flag the OOO context.
- **Heavy week with hard misses** (lost client, missed launch): tone shifts to forward-looking — what did we learn, what's the next step. Don't dwell.
- **No data signals at all** (totally quiet week): "Нічого не сталось — це теж відповідь. Що думаєш?" Open question rather than fabricated review.

## Things this skill does NOT do

- Doesn't auto-schedule / post to anywhere — read-only output.
- Doesn't grade Robert / score productivity — patterns are observations, not judgments.
- Doesn't recommend specific time-blocking — that's `focus-block-scheduler`.
- Doesn't compare to other weeks numerically (no charts) — qualitative > quantitative for owner-level reflection.
