---
version: 1
name: Kindred
status: proposal (2026-09-23), not yet accepted by the operator
colors:
  paper: "#ffffff"
  ink: "#141414"
  quiet: "#5f5f5a"
  rule: "#d9d9d2"
  down: "#ecece6"
  placeholder: "#737370"
  group:
    g1: "#f6c744"
    g2: "#86d6a8"
    g3: "#9cc6f2"
    g4: "#c4aef0"
    g5: "#f5a38e"
    g6: "#f2a9c9"
  brand:
    lens: "{colors.group.g1}"
    primary-action: "{colors.ink}"
    on-primary: "{colors.paper}"
typography:
  display:
    family: "Newsreader"
    weights: [500, 600, 700]
    fallback: "Georgia, 'Times New Roman', serif"
  ui:
    family: "Libre Franklin"
    weights: [400, 500, 600, 700, 800]
    fallback: "'Helvetica Neue', Arial, sans-serif"
  scale:
    prompt: "clamp(32px, 8.4vw, 46px) / 1.08, display 600"
    prompt-small: "clamp(24px, 6vw, 30px) / 1.1, display 600"
    headline: "clamp(26px, 6.6vw, 34px) / 1.12, display 600"
    wordmark: "clamp(44px, 12vw, 60px) / 1, display 700"
    answer-input: "22px, ui 600"
    tile-answer: "18px / 1.2, ui 700"
    body: "17px / 1.45, ui 400"
    small: "15px, ui 500"
    tile-name: "13px, ui 500"
spacing:
  unit: 4px
  column-max: 600px
  gutter: 20px
  tile-gap: 8px
  group-gap: 4px
shape:
  tile-radius: 10px
  group-radius: 14px
  button-radius: 999px
  sheet-radius: 18px
  border: 2px
elevation: none (flat; only the sheet backdrop dims the page)
motion:
  ease: "cubic-bezier(.2, .8, .2, 1)"
  flip: 520ms, 130ms stagger
  gather: 600ms transform, group color at +380ms over 320ms
  land: 360ms scale settle
  text-in: 420ms opacity + 6px rise
---

# Kindred design spec

Rationale, concepts, critique, and lineage: `README.md`. Reference build:
`prototypes/kindred.html` (static, simulated room). This spec covers the whole
player-facing surface: home, name, join, lobby, question, waiting, reveal, override,
end, room sheet, connection and judge-delay states. Not covered: marketing site, OG
image redraw, audio design.

**Built (2026-09-23, branch `phaedrus/kindred-pairs`).** The real app now implements this
spec with the round 5 scoring (`MECHANICS.md`): exact pairs score, crowds of three or more
score nothing, nothing is seeded, the pair with the most points wins, and a top tie gets one
extra question. Deltas from the text below: group color marks only scoring pairs, crowds
gather in `down` gray, a pairs standings list follows each reveal, and the override picker
and "We meant the same thing" do not exist (any override is gameable once points count).
The implementation mapping section is historical; `USER_STORIES.md` and the code are the
source of truth. The OG image and apple icon were redrawn from `brand/kindred-social.svg`
and `brand/kindred-mark.svg`.

## Overview

A party game for 2 to 12 friends on phones. Everyone answers the same question in secret;
the reveal shows who said the same thing. The design serves one job: make the "you said
that too?" moment happen often and read instantly. One rule, one screen per moment, color
only for matches.

## Colors

- `paper` page and tile ground. `ink` all text, borders of your own tile, primary buttons.
- `quiet` secondary text only (6.4:1 on paper, 5.4:1 on `down`).
- `rule` empty or loner tile borders (non-text, decorative boundary).
- `group.g1..g6` mean exactly one thing: these answers matched. Assign in order of first
  appearance at reveal (largest group gets g1). A group keeps its color for the rest of
  the round; a group created by agreement takes the next free color, and a player who
  joins an existing group by agreement takes that group's color. Never use group colors
  for decoration, status, or brand except `lens` in the mark, which is g1 by design (the
  mark is a match).
- Contrast (computed): ink on each group color 9.2 to 11.6:1; ink on paper 18.4:1;
  placeholder 4.8:1. Disabled button text 2.9:1 is exempt as a disabled control.
- Light only. `color-scheme: light`, `theme-color: #ffffff`. A dark theme is out of scope;
  if added later, group colors stay identical and paper/ink swap.

## Typography

- Newsreader (Production Type, SIL OFL, Google Fonts; self-host through
  `@fontsource-variable/newsreader`). Prompts, headlines, wordmark only.
- Libre Franklin (Impallari Type, SIL OFL; `@fontsource-variable/libre-franklin`).
  Everything else: inputs, tiles, buttons, lists.
- If fonts fail, the fallbacks keep metrics close enough; layout must not depend on exact
  widths (tiles wrap text, headlines use `text-wrap: balance`).
- No all-caps labels, no eyebrows above headings, no middle-dot meta strings.

## Layout

- One centered column, max 600px, 20px gutters. Phones first; desktop is the same column.
- Top bar, 60px: mark + wordmark left, question progress dots center (rounds only; the
  wordmark text hides under 440px during rounds), "Room" button right (inside a room only).
- Primary action sits at the bottom of the screen on phones (`margin-top: auto` in a
  full-height flex column); on 700px and wider it follows content with 28px spacing.
  Do not make it `position: sticky` over a background: it produced a visible seam at
  fractional device pixel ratios in the prototype.
- Tiles: two per row on phones, three from 560px. Loners are centered, not left-packed.

## Elevation and shape

Flat. No shadows, no gradients, no glass. Depth comes from fill (face-down tiles are
`down`) and from motion. Only the room sheet sits above the page, with a 38% ink backdrop.

## Components

### Button
- Primary: ink fill, paper text, 54px tall, full width. Hover: #333. Disabled: `down` fill,
  #8a8a84 text. Focus: 3px ink outline, 3px offset.
- Secondary: paper fill, 2px ink border.
- Text button: underlined ink text, 44px min height. Used for low-stakes side paths
  ("Copy invite link", "We meant the same thing", "End game for everyone").

### Answer tile
One unit, many states. Answer text 18px/700 over the player's name 13px.
- `pending`: dashed `rule` border, italic "Thinking" in `quiet`.
- `down` (answered, hidden): `down` fill, no border, name only. The server never sends the
  text in this state.
- `mine`: your tile, 2px ink border, shows your own text while you wait.
- `revealed loner`: paper fill, `rule` border.
- `grouped`: transparent inside the group color; your tile gets a 2px inset ink ring.
- Long answers wrap (`overflow-wrap: anywhere`); max 64 characters (existing
  `ANSWER_MAX_CHARS`).

### Group
A rounded 14px bar in its group color containing its member tiles. Formed only at reveal.

### Progress dots
Six dots: done filled ink, current 12px filled g1, future outlined. `role="img"`,
label "Question 2 of 6".

### Room code
Four 60 by 68px outlined letter tiles, 32px/800. Accessible name spells the letters.

### Room sheet
Bottom sheet on phones, centered dialog from 700px. Contains: room code title, copy invite
link, people with host label and match count, leave room, and for the host "End game for
everyone" with a second-tap confirmation. Native `<dialog>` with focus trapped and Escape
to close.

### Override picker
Sheet titled "Whose answer means the same?", one row per other player's answer. Offered
to any player whose answer matched no one ("We meant the same thing"). The chosen player
sees "Ana says her glue and your tape are the same thing." with Agree and Not really.
On agree, the proposer joins the chosen player's group (or the two form a new group) and
scores recompute for everyone in that group. The chosen player's consent stands for their
group. One player alone can never create a match; the judge's own groups are never split.

## Journey and states

| Screen | States | Exit |
| --- | --- | --- |
| Home | demo plays once (sofa, couch gather; chair stays) | Start a game, Join a game |
| Name | empty (button disabled), filled | Create room |
| Join | code incomplete, complete; invalid code error | Join |
| Lobby | 1 person (Start disabled, "Waiting for one more person."), 2+ (Start enabled), guest ("You're in. Waiting for Sam to start.") | Start game |
| Question | empty, typing, others answered line | Send |
| Waiting | your tile shown, others pending or down, "Waiting for Jo and Theo." | automatic |
| Checking | all down, "Everyone's in." with spinner | automatic |
| Slow judge | after 8s: "Still checking answers. This is taking longer than usual." Host: Check again | automatic or retry |
| Reveal | matched, alone, nobody matched, everyone matched, two or more groups, guest view | Next question or See results (host) |
| Override | picker open, waiting for agreement, agreed, declined | back to reveal |
| End | kindred pair, you-most-like line, share grid, match list | Share results, Play again (host) |
| Connection | top banner "Reconnecting. Your answer is safe." only while disconnected | automatic |

Joining mid-round: the new player lands on the waiting board as a spectator line
("You're in for the next question.") and plays from the next question.

## Motion

| Moment | Trigger | Spec | Purpose | Reduced motion |
| --- | --- | --- | --- | --- |
| Flip | last answer lands and judge returns | each non-you tile rotates X 0 to 90 to 0 over 520ms, text swaps at 260ms, 130ms stagger | the reveal | text appears, no rotation |
| Gather | 650ms after last flip | FLIP transform from flat grid position to group position, 600ms; group color fades in at +380ms over 320ms; tiles settle scale .94 to 1.02 to 1, 360ms | shows sameness as physical togetherness | tiles jump to groups, 160ms crossfade |
| Headline in | after gather | 420ms opacity and 6px rise | the verdict | opacity only |
| Person arrives | lobby join | 380ms rise | presence | opacity only |
| Sheet | open | 300ms rise | spatial origin | opacity only |

No ambient motion. Nothing moves unless a person or the game did something.

## Copy

Voice: plain, warm, specific. Say what happened, with names. Sentence case. No dashes in
player copy.

- Rule (lobby): "Everyone answers the same question in secret. Say the same thing as
  someone to score."
- Answer hint: "A word or a few. Nobody sees it until everyone answers."
- Waiting: "Waiting for Jo and Theo." / "Everyone's in."
- Reveal headlines, in precedence order:
  1. no groups: "Every answer was different."
  2. everyone in one group, 3+ players: "Everyone said the same thing."
  3. otherwise your group if you are in one, else the largest: "You, Sam and Priya said
     the same thing."
- Reveal subline: "+2 for you." or "No one matched you this time." then, if other groups
  exist, "Jo and Theo matched too."
- Override: "We meant the same thing" (button), "Waiting for Theo to agree.",
  "Theo agreed." Declined: "Theo sees it differently."
- End: "Sam and Priya are kindred." / "The same answer 3 of 6 times." / "You thought most
  like Jo: 2 of 6." / no matches at all: "Nobody matched this game."
- Errors say what to do: "That code isn't open. Check it with your host." Never apologize.
- Actions keep one name: Start game, Send, Next question, See results, Share results,
  Play again. The toast after share says "Results copied".

## Accessibility

- AA contrast for all text (computed above). Focus visible on every control.
- Hit targets 44px minimum; primary buttons 54px.
- Keyboard: Enter sends an answer; Escape closes sheets; focus moves to the prompt heading
  on each new question and to the headline after a reveal.
- `aria-live="polite"` announces arrivals, answers in, and the reveal headline plus
  subline as one sentence. Tiles are plain text in reading order, groups first.
- Color is never the only signal: grouped tiles are also adjacent inside one bar, and the
  headline names who matched.
- Reduced motion replaces every movement with a short crossfade (table above).

## Do and don't

- Do keep one mode. A second rule set (Meld) needs evidence from real pairs first.
- Do keep the reveal ungated: no "see who thought it" step.
- Do keep chrome in the Room sheet. The round screen shows only prompt, tiles, verdict,
  one action.
- Don't use group colors for anything except matches.
- Don't reintroduce category chips, seat numbers, or presence labels on the main screen.
  House answers stay deleted.
- Don't add prompts without writing their expected 40% answer first (README section 7).

## Implementation mapping

Rules and server (`convex/`):
- `rules.ts`: keep `normalizeAnswer`, `validateAnswer`, `clusterAnswers`,
  `applyMutualOverrides`, `hiveMindRoundScores`. Delete `soulmatePairs`,
  `soulmateRoundScores`, `SOULMATE_*`, `TWO_PLAYER_HOUSE_ANSWER_COUNT`,
  `HIVE_MIND_TWO_PLAYER_ROUNDS`, `twoPlayerSessionRecord`. Add a pure `pairTally(clusters[])`.
- `game.ts`: `start` loses `mode`; one round count (6). Delete `revealNames`; a round goes
  answering, adjudicating, revealed with names in one projection. Generalize
  `claimSharedMemory` from two-player rooms to any two players in a revealed round.
  `view` returns the kindred pair and your top pair on completion.
- `jev.ts`: drop the soulmate branch in scoring.
- `schema.ts`: drop `games.mode`, `pairs`, `sessionRecord`; add stored pair tallies or
  derive them in `view`.
- `prompts.ts`: drop `category`, `houseAnswers`; replace the deck under the gravity-well
  rule. Keep ids stable per prompt for retained adjudications.
- `product_event_contract.ts` and `product_event_validators.ts`: remove `game_mode`; bump the
  contract version; `round_count` range becomes 6.

Client (`app/`):
- `page.tsx`: Home, Name, Join as three states of one route.
- `room-view.tsx`: split into Lobby, Round (question, board), End, RoomSheet. The board
  owns the flip and gather animation (FLIP over measured rects, as in the prototype).
- `reveal-copy.ts`: replace with the headline and subline rules above.
- `globals.css`: rewrite from these tokens; delete ambient lights, glass, orbit, footer.
- `layout.tsx`: swap Fraunces and Manrope for Newsreader and Libre Franklin;
  `colorScheme: "light"`, `themeColor: "#ffffff"`.
- `public/brand`, `brand/`: redraw the mark as two ink circles with a g1 lens; keep the
  16px optical variant.

Tests affected: `tests/rules.test.ts` (soulmate cases go), `tests/reveal-copy.test.ts`
(new copy rules), `tests/product-events.test.ts`, `tests/convex/events.test.ts`
(`revealNames` and `mode: "soulmate"` calls).

## Validation plan

- Capture every state in the Journey table at 390 by 844 and 1280 by 800, plus Room sheet
  and override picker, on the production build (`skill://visual-state-review`).
- Play one full real game with 2 players and one with 5, with the real Jev judge, and
  record per-prompt match rate. A prompt that matched nobody in both games is replaced.
- Keyboard-only pass: create, join, answer, reveal, override, share.
- Reduced-motion pass: flip and gather replaced by crossfades.
- axe-core on each captured state; `design-check` on changed player copy.
