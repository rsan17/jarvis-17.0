---
name: proposal-followup
description: Find proposals Robert sent that haven't gotten a reply in 5+ days, draft contextual nudge messages per client, and stage them via save_draft. Use when the user says "пропозали без відповіді", "proposal followups", "хто не відповів на пропозал", "follow up proposals", "перевір пропозали", "stale proposals", "хвостики по пропозалах", "які пропозали зависли". Direct cashflow lever.
---

# Proposal followup

Find the silent ones. Draft warm, non-pushy nudges. Stage them for approval. Recover deals that just need a bump.

## When to use

- "Пропозали без відповіді" / "Stale proposals"
- "Хто не відповів на пропозал?"
- "Follow up proposals"
- "Перевір пропозали"
- "Хвостики по пропозалах"
- Weekly Friday-afternoon "що з продажами?"

## When NOT to use

- "Напиши пропозал для X" → that's `proposal-writer`
- "Скільки пропозалів я надіслав цього місяця?" → simple gmail search, not this
- "Як підняти ціну в пропозалі для X?" → `pricing-defender` (not yet implemented)

## Inputs

- Optional: time window (default: proposals sent 5–30 days ago without reply). Outside that window we don't follow up — too fresh = annoying, too stale = re-pitch needed.
- Optional: specific client to focus on.

## Procedure

1. Search `gmail` for sent threads in the time window where:
   - Subject contains "proposal" / "пропозал" / "квот" / "estimate" / "scope" / "kickoff" / "engagement" / "deal" / "оффер"
   - OR: the user labeled a thread as `Proposal-sent` (if such a label exists)
   - AND: the latest message in the thread is from Robert (no reply since)
2. Filter out threads where:
   - The recipient already declined politely earlier in the thread → leave alone
   - Robert already followed up in the last 5 days → don't double-tap
   - The proposal was for a project that's already started elsewhere (recall may flag)
3. For each remaining thread, gather context:
   - Client name + company (parse from email signature / domain)
   - Date proposal was sent
   - Total value if mentioned in the email
   - Decision deadline if mentioned
   - Any prior touch attempts in the last 30 days
4. `recall("client X relationship")` for tone calibration.
5. Draft per-thread followup. Tone rules:
   - Default: warm, low-pressure, brief (≤80 words)
   - Open with one-sentence reference to the proposal context
   - Don't apologize for following up; don't over-explain
   - End with a single concrete ask: "Have a chance to look this over?" / "Are we good to start week of X?" / "Anything I can clarify?"
   - Match the language of the original proposal email
6. Build the batch draft:
   ```json
   {
     "kind": "gmail-batch-replies",
     "summary": "Follow up on <N> stale proposals",
     "drafts": [
       {"threadId": "...", "to": "...", "subject": "...", "body": "...", "client": "...", "daysAgo": 7},
       ...
     ]
   }
   ```
7. `save_draft`.
8. Return Telegram preview (Output format).

## Output format

```
**📊 Stale proposals** — <N> outstanding

**1. <Client>** — <days> days, $<value if known>
   <subject>
   _Draft:_ "<first 50 chars of draft>..."

**2. <Client>** — <days> days
   <subject>
   _Draft:_ "<first 50 chars>..."

...

Reply "send" to send all, or list numbers to send subset ("send 1,3,4"), or "ред 2 [instruction]" to revise one.
```

## Tone variants by days-since-sent

- **5–7 days**: light touch. "Following up — still interested?"
- **8–14 days**: add a small value-add. "While you decide, here's a quick thought on X (saw it in your last project)."
- **15–21 days**: ask if circumstances changed. "Has anything shifted on your side? Happy to adjust scope or revisit timing."
- **22–30 days**: closing question. "Closing my proposal queue for the month — should I keep yours open or assume not this round?"

Never call out the days-since explicitly to the recipient. The lifecycle informs tone, not content.

## Edge cases

- **Client replied "thinking about it" earlier and didn't return**: lighter touch — refer back to their last note. "You mentioned thinking it over — anything I can clarify in the meantime?"
- **Client requested specific changes that we sent revised proposal for**: this isn't a stale proposal, it's a closed loop. Skip.
- **Multi-stakeholder thread (CC'd legal/finance)**: address only the decision-maker by name; CC stays as-is.
- **Client domain matches a competitor or known-bad lead**: skip and flag in summary ("skipped X — competitor reach-out, not pursuing").

## Things this skill does NOT do

- Doesn't auto-close cold proposals after 30 days — manual decision.
- Doesn't change proposal pricing or scope — `pricing-defender` territory.
- Doesn't call/Slack/text — email only.
- Doesn't track CRM state (no CRM integration); state lives in Gmail labels + Robert's memory.
