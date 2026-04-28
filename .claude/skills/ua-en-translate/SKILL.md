---
name: ua-en-translate
description: Translate text between Ukrainian and English while preserving register (formal client / casual team / marketing / technical). Use when the user says "переклади", "translate", "як це англійською", "як це українською", "EN version", "UA version", "переведи", "перекладеш", or pastes text and asks for the other language. Auto-detects source/target. Read-only.
---

# UA ↔ EN translate

Robert's daily bilingual workflow needs more than literal translation — it needs register preservation. A casual team Slack stays casual; a client proposal stays formal. AI tells get scrubbed in both directions.

## When to use

- "Переклади це на EN/UA"
- "Як це англійською/українською?"
- "Translate"
- "EN version please"
- "UA version please"
- "Переведи цей пасаж"
- User pastes text and asks "так?" / "ok?" — interpret as translation review
- User pastes a sentence with no other context, in one language, while previously chatting in the other → likely wants translation

## When NOT to use

- "Напиши X на EN" / "Write X in EN" — that's drafting, not translation. Use the relevant skill (email-reply-drafter, internal-comms, proposal-writer).
- "Переклади і відправ" → translate is fine, but the send goes through `save_draft` via the relevant communication skill.
- Multi-language passages that need linguistic analysis, not translation → ask for clarification.

## Inputs

- **Required**: source text.
- **Optional**: target language explicit ("на EN" / "to UA"). If not specified, infer from source: UA → EN, EN → UA.
- **Optional**: register override ("more formal", "casual", "marketing-y", "technical").

## Auto-detected register

Default register heuristic:

| Source signals | Target register |
|---|---|
| "Шановний/Шановна", "Доброго дня", formal company titles | Formal: "Dear", "Mr./Ms.", measured tone |
| First names, "Привіт", emoji, casual contractions | Casual: "Hey", "Quick note", contractions OK |
| Bullet lists with caps, headers, marketing copy phrases | Marketing: punchy, short sentences, sensory verbs |
| Code blocks, API names, technical jargon | Technical: keep terms verbatim, translate only prose |
| Legal/contract language, "повноваження", "юрисдикція" | Legal: precise, no creative substitutions |

If the input mixes registers, match the dominant one and flag the mix in the response.

## Procedure

1. Detect source language (single dominant) and target.
2. Detect register from heuristics above.
3. Translate. Rules:
   - **Preserve named entities**: company names, product names, person names — never localize "Romi" or "Mukachevo" or "Convex".
   - **Idioms**: replace with target-language equivalent of similar register, not literal. "Тримаймось!" → "Hang in there!" (casual), not "Let us hold on!"
   - **No AI tells**: no "delve", "tapestry", "robust", "leverage", "profound" unless the original has equivalent emphasis. Match neutral with neutral.
   - **Punctuation conventions**: UA → EN drop the laquo «», use straight quotes "". UA dashes (тире) become em-dashes; UA → EN comma rules apply.
   - **Honorifics**: UA "Ви" with capital → EN second-person formal context (no equivalent capital, but maintain formal vocabulary).
   - **Currencies / dates / numbers**: keep format from source unless it makes the target awkward (UA → EN: "10:00" stays, "10.000" becomes "10,000").
4. If a phrase is ambiguous or culturally untranslatable, give the primary translation and note the alternative in a brief footnote.

## Output format

For short input (<200 chars):

```
<translation, no preamble>

_<register> • <source>→<target>_
```

For longer input:

```
**EN translation** _(formal client tone)_

<full translation>

---
_Notes:_
• "X" — lit. "Y", but "X" reads more naturally
• Sentence 3: ambiguous in UA, translated to most likely intent
```

Skip notes section if there are none. Don't pad.

## Edge cases

- **Mixed UA + EN input**: translate ONLY the parts in source language; leave EN-in-UA-text or UA-in-EN-text verbatim. Flag at top.
- **Surzhyk / dialect**: translate to standard EN, don't try to find an English dialect equivalent. Note the dialect in the source if it changes meaning.
- **User's own message they just sent in chat needs translation back**: yes, that's fine. Translate verbatim.
- **Asks for "literal translation"**: skip the register-matching, just give word-for-word with bracket notes for context.
- **Asks for re-translation of a previous answer**: translate from the prior turn's text, don't ask "translate what?"

## Things this skill does NOT do

- Doesn't translate code or comments inside code blocks (preserve verbatim).
- Doesn't write originals — only translates user-supplied text.
- Doesn't critique the original ("the source has a typo") unless it changes the translation meaning.
- Doesn't translate to/from third languages (RU, PL, etc.) — UA↔EN only.
