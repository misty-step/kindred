# Kindred mechanics: competition and winnability

Exploration round 2, 2026-09-23. Open decision raised by the operator: the game needs a real
way to win, and Soulmate's tension (say something your partner will get and the room will
not) was the most interesting thing in the old rules. This round explores that space before
anything is locked. It supersedes the scoring section of `README.md` section 7; everything
else in the reimagining (screens, look, reveal) stands.

- Simulation: `mechanics/strategy_sim.py` (toy model, method in section 4)
- Clickable prototype of the current recommendation: `prototypes/compete.html`
  (links to every state in `prototypes/index.html`)

## Round 5: exact pairs, nothing seeded (current direction)

Operator decisions, 2026-09-23: a pair only scores if nobody else said the same thing, and
the game must regulate itself; no taken answers.

**The whole game.**

> When exactly two of you say the same thing, you both score. Three or more, nobody does.
> The pair with the most points wins.

Six questions. Tied pairs get one more question in which only they can score; still tied,
they share the win. Two players: every match is an exact pair, so they play together and
see "You and Sam matched 4 of 6." In the reveal, scoring pairs get a group color and crowds
gather in neutral gray, so color still means exactly one thing.

**Does it regulate itself?** Simulated (2,000 games per cell), "kindred two", no taken answers:

| Players | Obvious answer, mixed table | Two friends vs a safe table | Ties for 1st |
| --- | --- | --- | --- |
| 3 | 1.09 | 1.12 to 1.29 | 31% |
| 4 | 1.30 | 0.41 | 36% |
| 5 | 1.46 | 0.94 to 0.96 | 42% |
| 6 | 1.46 | 1.48 to 1.68 | 45% |
| 8 | 1.29 | 2.04 to 2.43 | 51% |

- **Yes, from six players up.** If everyone plays it safe, they crowd one answer, score
  nothing, and two friends who read each other win 1.5 to 2.4 times their share.
- **No at four or five.** Two safe players form exactly the pair the rule rewards.
- **In a mixed table the few safe players still pair with each other** (obvious 1.3 to 1.46
  at every size from 4). That is the nature of a crowd-avoiding rule: safe play pays when
  few people do it and fails when many do. Real players see crowds forming and adapt; the
  model does not, so this is the main thing a real test must watch.
- For the record, adding taken answers back would make every size fair (obvious 0.91 to
  0.97; friends beat a safe table 1.08 to 1.50 at 4 to 8). Not adopted: the operator wants
  self-regulation.

Prototype: `prototypes/compete.html` plays this rule end to end.

Playtest focus: 4 and 5 player games. If safe pairs dominate there, options that stay
self-regulating are to raise the minimum room size, or to let the crowd be every past
player of that question instead of this room (answers that are common across all games
count as crowded). Both are unexplored.

## Round 4: no pick (superseded by round 5)

Operator feedback, 2026-09-23: picking a person and guessing what they will say is too
constraining. Three pick-free rules were simulated, all with taken answers (2,000 games per
cell, same toy model):

| Rule (all + taken) | Obvious answer, mixed table (4 / 6 / 8) | Two friends vs a safe table (4 / 6 / 8) | Ties for 1st |
| --- | --- | --- | --- |
| **Match anyone**: a point for everyone who said what you said | 0.96 / 1.05 / 1.21 | 1.24 / 0.75 / 0.48 | 35 to 48% |
| **Kindred pair**: every match adds to that pair's tally; the pair with the most wins together | 0.94 / 1.04 / 1.00 | 1.20 / 0.97 / 0.74 | 40 to 51% (two top pairs) |
| **Just two**: 3 if exactly one other person said it, 1 if more | 0.92 / 1.02 / 1.12 | 1.20 / 0.88 / 0.90 | 24 to 47% |
| Pick (round 3, for comparison) | 0.79 / 0.71 / 0.66 | 1.38 / 1.46 / 1.44 | 58 to 62% |

Findings: taken answers alone make every pick-free rule fair. No strategy wins much more
than its share, where today's rules let the obvious answer win 1.35 to 2.38 times. But
without a pick, knowing a friend stops beating a safe table at 6 and 8 players. The pick is
what makes knowing people decisive; removing it trades that for freedom. Kindred pair
resists safe play best at large tables and keeps the Soulmate ending as the win
condition; Match anyone is the simplest to say and closest to the current code
(`hiveMindRoundScores` unchanged). Prototype still shows round 3 until this is decided.

## 0. Round 3: as simple as possible (the pick rule; reopened by round 4)

Operator direction, 2026-09-23: make the game as simple as possible. Every element of the
round 2 recommendation was put to one test: does removing it break a requirement in
section 1? Only two things survived beyond answering: taken answers and the pick.

**The whole game.**

> The obvious answers are taken. Answer, then pick who will say the same thing. A point if
> they did.

Six questions; most points wins. A tie gets one more question in which only the tied
players can score; still tied, they share the win. The extra question explains itself on
screen when it happens, so it is not on the rules card.

**What was cut, and what each cut costs** (same toy model, 2,000 games per cell):

| Cut | Why it can go | Cost |
| --- | --- | --- |
| Point tiers (4 for only-you-two, 2 for a right pick) | Knowing people wins just as often without them: readers 1.30 to 1.46 versus 1.23 to 1.44 tiered; the obvious answer wins 0.67 to 0.79 versus 0.73 to 0.83 | Ties for first rise to 58 to 64% before the extra question |
| Consolation point, doubled last question | They only existed to reduce ties | The extra question handles ties instead |
| Partners | A second rule set, teams, odd counts | None for the recommended path |
| "We meant the same thing" | Any override is gameable once points count; a room vote is more rules | Judge mistakes stand. Playtests must record disputes; add a room vote only if they are common |
| Two-player ranks | Named ranks are a second scoring system | Two players see "You and Sam matched 4 of 6" |
| Mutual-pick bonus | A bonus is a rule | Kept as a sentence in the reveal ("Jo and Theo picked each other."), worth nothing |

**What cannot go:**

| Removed | Result | Verdict |
| --- | --- | --- |
| Taken answers | The same pick rule loses to a safe table: two friends reading each other win 0.63 / 0.30 / 0.12 of a fair share at 4 / 6 / 8 players; the obvious answer wins 1.13 to 1.33 | Keep. The row on the question screen explains itself |
| The pick | Hive Mind + taken: at 6 and 8 players two friends win 0.21 to 0.65 against a safe table; the obvious answer wins 1.24 at 8 | Keep. One tap, and it is the Soulmate moment |

**Vocabulary.** Players *pick*, never *call*; the reveal says "picked Sam" and "Good pick."
"Call it" survives only as the working name of the rule in these documents.

Everything from section 1 onward is the round 2 record, kept for lineage. Where it
disagrees with this section (tiers, doubling, Partners as a finalist, two-player ranks),
this section wins.

## 1. What a competitive rule must do

1. **Knowing people must beat playing it safe.** If the obvious answer is the best strategy,
   every game converges on it and nobody is kindred with anyone in particular.
2. **Everyone has a stake every round.** Nobody watches; nobody's goal is unclear. This is
   where Soulmate fell short: pairs were assigned by seat, and a player's only effect on
   other pairs was accidentally spoiling their bonus.
3. **A winner, usually alone.** Ties for first should be rare, with a stated tiebreak.
4. **Still open at the end.** The last question should be able to change the result.
5. **One screen of rules.** Anything past three short lines has to earn its place.

## 2. The design space

| Axis | Options explored |
| --- | --- |
| Whom you try to match | anyone (Hive Mind) · the majority (Herd) · exactly one other (Just two) · a fixed partner (Partners) · a person you pick each round (Call it) · a rotating spotlight pair (Spotlight) |
| Whom you try to avoid | nobody · everyone outside your pair · the obvious answer itself (taken answers) |
| Structure | individual · fixed teams of two · rotating roles |
| Pace | 6 questions · last question counts double |

## 3. Candidate rules

- **Hive Mind (today).** 1 point per other person who said what you said.
- **Herd.** 1 point if you are in the biggest group.
- **Just two.** 3 points if exactly one other person said it, 1 if more did.
- **Partners (Soulmate, fixed).** Teams of two chosen in the lobby. Match your partner: 2;
  only you two said it: 4.
- **Spotlight.** Each round two people are the pair and everyone else is the crowd. The pair
  scores 3 each if they match and nobody in the crowd does; the crowd scores for saying
  what the pair said.
- **Call it.** Answer, then secretly name the one person you think will say the same thing.
  Right call: 2. Right call and only you two said it: 4. Variants tested: a bonus when two
  players call each other ("mutual"), a 1-point floor per match ("plus"), and 1 point for
  matching someone you did not call ("consolation").
- **Taken answers (modifier).** Each question shows its three most common answers before
  anyone types: *A famous duo. Taken: Batman and Robin, PB&J, salt and pepper.* They
  cannot score. The codebase already has an unused slot for this: the decoy
  `houseAnswers` field.

## 4. Simulation

**Method.** Toy model, for comparisons between rules only.
- **Prompts.** Each has 15 candidate answers with Zipf popularity.
- **Players.** Each has a private taste per answer. Friends come in pairs and share 60% of
  their taste. You estimate a friend's taste with small error and anyone else's with large
  error.
- **Strategies.** *Obvious* chases popularity. *Personal* follows your own taste. *Reader*
  aims at a person while still respecting popularity. *Insider* aims at a person and avoids
  the obvious.
- **Measures.**
  - *Mixed table:* win share by strategy when strategies are drawn at random.
  - *Safe table:* two friends play one strategy and everyone else says the obvious thing.
  - *Ties* for first.
  - *Rounds where nobody scores.*
  - *Open at the last question:* the leader could still lose.

Not modeled: the real Jev judge, bluffing, table talk, learning within a game. The numbers
are relative only; real play decides.

**Headline results.** Win edge of 1.00 is a fair share. 2,000 to 2,500 games per cell.

| Rule | Obvious answer, mixed table (4 / 6 / 8 players) | Two friends vs a safe table (4 / 6 / 8) | Ties for 1st | Rounds nobody scores | Open at last |
| --- | --- | --- | --- | --- | --- |
| Hive Mind (today) | 1.35 / 1.91 / 2.38 | 0.30 / 0.01 / 0.00 | 37 to 50% | 2 to 38% | 54 to 63% |
| Herd, Just two (4 / 6 players) | 1.3 to 1.9 | 0.0 to 0.7 | 28 to 53% | 12 to 39% | 50 to 65% |
| Only two, strict (4 / 5 / 6 / 8) | 1.34 / 1.50 / 1.49 / 1.15 | 0.32 / 0.78 / 1.57 / 2.56 | 49 to 54% | 26 to 48% | 65 to 66% |
| Only two + taken (4 / 5 / 6 / 8) | 0.91 / 0.96 / 0.98 / 1.05 | 1.20 / 1.06 / 0.99 / 1.17 | 42 to 54% | 18 to 48% | 58 to 67% |
| Spotlight + taken | 0.89 / 0.88 / 0.92 | 1.08 / 0.90 / 0.77 | 31 to 40% | 20 to 46% | 49 to 58% |
| Partners + taken | 0.83 / 0.68 / 0.60 | 1.22 / 1.54 / 1.97 | 21 to 25% | 41 to 63% | 31 to 38% |
| Call it + taken | 0.83 / 0.74 / 0.65 | 1.36 / 1.59 / 1.93 | 52 to 55% | 33 to 58% | 62 to 64% |
| **Call it + taken, consolation, last x2** (5 / 6 players) | 0.88 / 0.80 | 1.39 / 1.39 (insider) | 17% | 13 to 24% | 48 to 52% |

What the model says:

1. **Today's scoring rewards being boring, and worse the bigger the room.** The obvious
   answer wins twice its share at six players, and two friends who read each other
   essentially never beat a table that plays it safe. This is a plausible root cause of the
   "rough" feel: the best play is the least interesting one.
2. **Taking the obvious answers off the board is the single biggest lever.** It moved every
   pair-based rule from losing to a safe table to beating it. Without it, no rule escapes
   the obvious-answer trap.
3. **Only rules with a named person reward knowing people consistently.** Hive + taken falls
   back to 0.61 against a safe table at six players because the fourth most common answer
   becomes the new obvious one. Partners and Call it grow stronger as the table grows.
4. **Pure Call it ties half the time.** Its points are coarse (0, 2, 4). The consolation
   point for matching someone you did not call cut ties to 17% and scoreless rounds to about
   a fifth while keeping the edge for readers. The mutual-call bonus raised that edge
   further but left ties at about 50%.
5. **Last question x2** raises "open at last" by 2 to 15 points and cuts ties a few points in
   most rules. Cheap drama; keep it.

## 5. Critique

### Call it + taken, recommended
- Optimizes: everyone is in the Soulmate position every round, with a partner they chose,
  and the choice is itself a read ("Priya and Sam called each other"). Individual scores,
  a clear winner, reading people beats safe play at every size modeled.
- Sacrifices: one extra tap per question (pick a name); three lines of rules instead of one.
- Wins for: 3 to 8 friends who know each other unevenly, which is most rooms.
- Fails when: calls sting. "Nobody called Jo" is visible in the reveal. Needs real play to
  see whether it reads as spicy fun or as exclusion.
- Rules on the lobby card: *Answer in secret. Then call who will say the same thing. Right
  call, only you two: 4. Right call: 2. You matched someone you didn't call: 1. The obvious
  answers are taken. The last question counts double.*

### Partners + taken, the finalist alternative
- Optimizes: the purest inside-joke feeling; team identity for the whole game; closest to
  what Soulmate was reaching for.
- Sacrifices: needs an even count or a team of three; team formation in the lobby; half of
  rounds score nothing for anyone; games are decided early (only a third still open at the
  last question in the model).
- Wins for: couples' nights, 4 or 6 players who arrive in pairs.

### Only two (strict): rejected as the scoring, kept as the spirit
Operator question, 2026-09-23: score only when exactly one other person said the same thing.
- Optimizes: a one-sentence rule with no extra tap; it punishes the herd by itself, and
  hardest when the herd is biggest. At a safe table of 6 or 8, two friends win 1.6 to
  2.6 times their share.
- Sacrifices: at 4 and 5 players (most sessions) the obvious answer wins (1.34 to 1.50 in
  a mixed table), because two safe players often make an exact pair. First place ties
  about half the time (points are 0 or 2). A three-way match, today's best moment, scores
  zero. Adding taken answers flattens every strategy to about 1.0: nothing is rewarded.
- Keep: the idea survives inside Call it as its top score (right call, and only you two
  said it: 4).

### Spotlight: rejected
Explicit crowd role is appealing ("read the pair"), but reading people beat a safe table
only weakly at 4 and not at 6 or 8, and rotating roles add a screen every round.

### Hive Mind (today), Herd, Just two: rejected as scoring
All three let the obvious answer dominate. Hive Mind's grouping survives as the *reveal*;
it stops being the *scoring*.

## 6. Winnability layer (both finalists)

- Standings after every reveal: rank, name, +points this round, total. The leader's row is
  marigold; your row has an ink ring.
- The last question is announced on its question screen ("Last question. Points count
  double.") and doubled in the outcome line.
- End screen leads with the winner ("You win." / "Jo and Priya win."), then how it happened
  ("Sam led going into the last question."), then your best read ("Your best read: Sam. You
  called them right 3 times.").
- Tiebreak: right calls, then solo matches, then a shared win ("Theo and you share the win.").

## 7. Two players

Calling is automatic with one other person, so two players play together against the taken
answers: 6 questions, 28 points possible (4 per solo match, last doubled), with named ranks
at 6, 12, and 18 points: Friends, Close, Kindred. Taken answers are what make this
interesting; without them two players match on the obvious thing and the game is binary.

## 8. Interactions with earlier decisions

- **"We meant the same thing" is exploitable once points are at stake.** Two players can
  agree to call any pair of answers a match and both score. In competitive rules the claim
  must go to the room ("Does *sofa* count as *couch*?"), decided by everyone else. The
  prototype does not include overrides.
- **Taken answers change deck authoring.** Every prompt ships with its three gravity-well
  answers. The earlier rule ("write the answer 40% of people give") still applies; that
  answer now becomes the first taken one, and the prompt must still have a rich tail after
  three are removed.
- **The reveal is unchanged.** Flip, gather into colored groups. Calls add one line per tile
  ("called Sam", with a check when right).

## 9. Proposed story changes (for the operator)

- **US-002 Understand without instructions** changes: *A first-time player can explain the
  scoring after one question; the lobby states it in one sentence plus "The obvious
  answers are taken."*
- **US-007 Win or lose clearly (new).** *After every question every player sees each
  player's total and change; after the sixth question exactly one winner is named, or the
  tied players get one more question, after which a shared win is possible.*
- **US-008 Knowing people pays (new).** *In playtests, players who say they chose answers
  for a specific person outscore players who say they played it safe.*

## 10. What to test with people

The simulation cannot tell us how picks feel socially, how often real friends match off the
taken list, how often the judge is disputed now that there is no override, or how often
games go to the extra question. A real test: three game nights (one of 4, one of 6, one of
2 players) with the round 3 rules on the live judge, recording per question match rate,
right-pick rate, extra questions played, disputes, and a one-question exit poll ("Did
knowing people help you win?").
