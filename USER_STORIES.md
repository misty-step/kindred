# Kindred user stories

What players must be able to do. Every behavioral change cites a story id. Only the
operator changes a story's intent; agents propose diffs. Rationale for the current game
design lives in `design/reimagine/` (see `MECHANICS.md`, round 5).

Proposed 2026-09-23 with the pair-rule rebuild; pending operator review.

## US-001 Join fast

A friend with a four-letter code or a room link is in the lobby after typing a name once.
The host can start with two people present; nobody else can start.

- Joining with a closed or unknown code shows what to do next, not a system error.
- The lobby shows the room code in large letters and a way to copy the invite link.

## US-002 Understand the rule without instructions

Before the first question, every player sees the whole rule in the lobby: when exactly two
players say the same thing, both score; three or more on one answer score nothing; the
pair with the most points wins.

- No screen asks anyone to choose a mode, a team, a partner, or a person to pick.

## US-003 Answer in secret

Each player types one short answer per question. No player's device receives another
player's answer text before every participant has answered.

- While waiting, every player can see who has answered, never what.

## US-004 One reveal

After the last answer is judged, every player sees all answers at once, grouped by
sameness with names, without pressing anything.

- Answers the judge considers the same (sofa and couch) share a group; related but
  different answers (sofa and chair) do not.
- A group of exactly two that scored is shown in color; a group of three or more is shown
  in neutral gray; a lone answer stands alone.

## US-005 Score as a pair

When exactly two players' answers form one group, that pair gains one point. Groups of
three or more give nobody a point.

- After every reveal, every player sees each scoring pair's total and which pairs just
  scored.

## US-006 Win or share clearly

A game is six questions. After the sixth, the pair with the most points is named the
winner. If two or more pairs are tied at the top, exactly one extra question is played in
which only the tied pairs can score; if still tied, they share the win.

- If no pair scored at all, the end screen says so.

## US-007 Play as two

With exactly two players, every match is theirs: they play together, and the end screen
says how many of the six questions they matched. No extra question is played.

## US-008 An honest judge

If the judge is unavailable, the round waits and says it is still checking; it never
invents a verdict. The host can ask it to try again. A retry never changes an answer
already judged for the same question.

## US-009 Share without spoilers

At the end, any player can copy a result summary that names the pairs and their points
and contains no answer text.
