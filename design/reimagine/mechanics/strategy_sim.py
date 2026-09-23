"""
Toy strategy simulation for Kindred scoring rules.

Not a prediction of real play. It asks relative questions only:
  - Mixed table: does a lazy strategy (always say the obvious thing) win more than its share?
  - Safe table: if everyone else plays it safe, does a player who reads people beat them?
    If not, "everyone says the obvious thing" is a resting point and games go flat.
  - How often is first place tied, and is the game still open at the last question?

Model
  Each prompt has K candidate answers with Zipf popularity. Each player has a private
  taste per answer; friends (fixed pairs) share 60% of taste. A player's estimate of
  someone else's taste is that taste plus noise (small for friends, large otherwise).
  A player picks argmax of  a*log(popularity) + b*own_taste + c*estimate(target) + Gumbel.
  Strategies set (a, b, c). Readers aim at whoever the rule points them at (friend,
  partner, spotlight pair, or the person they call). Lazy strategies call a random person
  in "call it". Team rules (partners) are judged team against team.

Run: python3 strategy_sim.py [games_per_cell]
"""

import math
import random
import sys
from collections import defaultdict

K = 15
ZIPF = 1.0
FRIEND_RHO = 0.6
SIGMA_FRIEND = 0.6
SIGMA_OTHER = 1.3
GAMES = int(sys.argv[1]) if len(sys.argv) > 1 else 2000
ROUNDS = 6

STRATEGIES = {
    #            a     b    c
    "obvious": (2.5, 0.3, 0.0),
    "personal": (0.3, 1.5, 0.0),
    "reader": (1.0, 0.5, 1.5),  # reads a target, still respects popularity
    "insider": (-0.2, 0.5, 2.0),  # reads a target, avoids the obvious
}
READS = {"reader", "insider"}


def gumbel():
    return -math.log(-math.log(random.random()))


def make_prompt():
    pop = [1 / (r + 1) ** ZIPF for r in range(K)]
    random.shuffle(pop)
    s = sum(pop)
    return [math.log(p / s) for p in pop]


def make_tastes(n, friend_of):
    shared = {}
    tastes = []
    for i in range(n):
        f = friend_of.get(i)
        key = tuple(sorted((i, f))) if f is not None else None
        if key is not None and key not in shared:
            shared[key] = [random.gauss(0, 1) for _ in range(K)]
        row = []
        for k in range(K):
            own = random.gauss(0, 1)
            row.append(math.sqrt(FRIEND_RHO) * shared[key][k] + math.sqrt(1 - FRIEND_RHO) * own if key else own)
        tastes.append(row)
    return tastes


def estimate(tastes, i, j, friend_of):
    sigma = SIGMA_FRIEND if friend_of.get(i) == j else SIGMA_OTHER
    return [t + random.gauss(0, sigma) for t in tastes[j]]


def choose(i, strat, logp, tastes, targets, friend_of, allowed):
    a, b, c = STRATEGIES[strat]
    est = [0.0] * K
    if c and targets:
        ests = [estimate(tastes, i, j, friend_of) for j in targets]
        est = [sum(e[k] for e in ests) / len(ests) for k in range(K)]
    return max(allowed, key=lambda k: a * logp[k] + b * tastes[i][k] + c * est[k] + gumbel())


def groups_of(answers):
    g = defaultdict(list)
    for p, a in enumerate(answers):
        g[a].append(p)
    return g


# Scoring rules: (answers, ctx) -> per-player points for one round.

def score_hive(answers, ctx):
    g = groups_of(answers)
    return [len(g[a]) - 1 for a in answers]


def score_herd(answers, ctx):
    g = groups_of(answers)
    top = max(len(v) for v in g.values())
    return [1 if top >= 2 and len(g[a]) == top else 0 for a in answers]


def score_just_two(answers, ctx):
    g = groups_of(answers)
    return [3 if len(g[a]) == 2 else 1 if len(g[a]) >= 3 else 0 for a in answers]


def score_partners(answers, ctx):
    pts = [0] * len(answers)
    g = groups_of(answers)
    for x, y in ctx["pairs"]:
        if answers[x] == answers[y]:
            v = 4 if len(g[answers[x]]) == 2 else 2
            pts[x] = pts[y] = v
    return pts


def spotlight(intercepted_pair_points, crowd_points):
    def score(answers, ctx):
        x, y = ctx["spot"]
        pts = [0] * len(answers)
        crowd = [p for p in range(len(answers)) if p not in (x, y)]
        for p in crowd:
            pts[p] = crowd_points * ((answers[p] == answers[x]) + (answers[p] == answers[y]))
        if answers[x] == answers[y]:
            intercepted = any(answers[p] == answers[x] for p in crowd)
            pts[x] = pts[y] = intercepted_pair_points if intercepted else 3
        return pts
    return score


def call_it(answers, ctx):
    """You secretly name one person you think will say what you say.
    Hit: 2. Hit and nobody else said it: 4. Anything else: 0."""
    g = groups_of(answers)
    pts = []
    for i, a in enumerate(answers):
        c = ctx["calls"][i]
        if answers[c] == a:
            pts.append(4 if len(g[a]) == 2 else 2)
        else:
            pts.append(0)
    return pts


RULES = {
    "hive (today)": score_hive,
    "herd": score_herd,
    "just two": score_just_two,
    "partners (soulmate)": score_partners,
    "spotlight 3/1, crowd +1": spotlight(1, 1),
    "spotlight 3/0, crowd +2": spotlight(0, 2),
    "call it": call_it,
}


def call_plus(answers, ctx):
    """1 point for each person who said what you said; 2 more if you called one of them."""
    g = groups_of(answers)
    return [len(g[a]) - 1 + (2 if answers[ctx["calls"][i]] == a else 0) for i, a in enumerate(answers)]


RULES["call plus"] = call_plus


def call_mutual(answers, ctx):
    """Call it, plus 1 when the person you called also called you and you matched."""
    base = call_it(answers, ctx)
    calls = ctx["calls"]
    return [p + (1 if p and calls[calls[i]] == i else 0) for i, p in enumerate(base)]


def call_consolation(answers, ctx):
    """Call it, plus 1 if you matched someone but called the wrong person."""
    g = groups_of(answers)
    base = call_it(answers, ctx)
    return [p if p else (1 if len(g[a]) >= 2 else 0) for p, a in zip(base, answers)]


RULES["call mutual"] = call_mutual
RULES["call consolation"] = call_consolation


def only_two(answers, ctx):
    """Points only when exactly one other person said what you said. Three or more: nothing."""
    g = groups_of(answers)
    return [2 if len(g[a]) == 2 else 0 for a in answers]


RULES["only two"] = only_two


def call_simple(answers, ctx):
    """One point if the person you called said what you said. Nothing else scores."""
    return [1 if answers[ctx["calls"][i]] == a else 0 for i, a in enumerate(answers)]


RULES["call simple"] = call_simple
# "kindred pair": no pick, no per-player score. Every match adds to that pair's tally; the pair
# with the highest tally after six questions wins together. Per-round points here only feed
# the "rounds nobody scores" metric (a round with any match counts as scoring).
RULES["kindred pair"] = score_hive
# "kindred two": the same, but a pair's tally only grows when exactly those two said it.
# Three or more on one answer: nobody's tally moves. No taken answers needed in principle:
# a crowded answer scores nothing, so the game can regulate itself.
RULES["kindred two"] = only_two
PAIR_WIN_RULES = {"kindred pair", "kindred two"}
EXACT_PAIR_RULES = {"kindred two"}
TAKEN = 3  # "+ taken": the prompt shows its 3 most common answers; they cannot score
for base in ["hive (today)", "just two", "partners (soulmate)", "spotlight 3/0, crowd +2", "call it", "call plus", "call mutual", "call consolation", "only two", "call simple", "kindred pair", "kindred two"]:
    RULES[f"{base} + taken"] = RULES[base]
TEAM_RULES = {"partners (soulmate)", "partners (soulmate) + taken"}


def base_of(rule):
    return rule.removesuffix(" + taken")


def targets_for(rule, i, strat, n, friend_of, pairs, spot, calls):
    rule = base_of(rule)
    if rule.startswith("spotlight"):
        if i in spot:
            return [spot[1] if i == spot[0] else spot[0]]
        return list(spot)
    if rule == "partners (soulmate)":
        for x, y in pairs:
            if i in (x, y):
                return [y if i == x else x]
        return []
    if rule == "call it":
        return [calls[i]]
    f = friend_of.get(i)
    return [f] if f is not None else [random.choice([j for j in range(n) if j != i])]


def play(rule, strat, final_double, shuffle_seats=True):
    n = len(strat)
    order = list(range(n))
    if shuffle_seats:
        random.shuffle(order)
    pairs = [(order[i], order[i + 1]) for i in range(0, n - 1, 2)]
    friend_of = {}
    for x, y in pairs:
        friend_of[x], friend_of[y] = y, x
    rounds = n if rule.startswith("spotlight") else ROUNDS
    totals = [0] * n
    pair_counts = defaultdict(int)  # "kindred" rules: how often each pair matched
    before_last = None
    before_last_pairs = None
    dead = 0
    for r in range(rounds):
        logp = make_prompt()
        taken = TAKEN if rule.endswith(" + taken") else 0
        allowed = sorted(range(K), key=lambda k: -logp[k])[taken:]
        tastes = make_tastes(n, friend_of)
        spot = (r % n, (r + 1) % n)
        calls = [
            friend_of[i] if strat[i] in READS and i in friend_of else random.choice([j for j in range(n) if j != i])
            for i in range(n)
        ]
        answers = [
            choose(i, strat[i], logp, tastes, targets_for(rule, i, strat[i], n, friend_of, pairs, spot, calls), friend_of, allowed)
            for i in range(n)
        ]
        pts = RULES[rule](answers, {"pairs": pairs, "spot": spot, "calls": calls})
        for members in groups_of(answers).values():
            if base_of(rule) in EXACT_PAIR_RULES and len(members) != 2:
                continue
            for a in range(len(members)):
                for b in range(a + 1, len(members)):
                    pair_counts[(members[a], members[b])] += 1
        if final_double and r == rounds - 1:
            pts = [2 * p for p in pts]
        dead += not any(pts)
        totals = [t + p for t, p in zip(totals, pts)]
        if r == rounds - 2:
            before_last = list(totals)
            before_last_pairs = dict(pair_counts)
    if base_of(rule) in PAIR_WIN_RULES:
        # The pair who matched most wins together. Winners are players; a tie is two or more top pairs.
        units = [[i] for i in range(n)]
        all_pairs = [(a, b) for a in range(n) for b in range(a + 1, n)]
        top = max(pair_counts.get(p, 0) for p in all_pairs)
        top_pairs = [p for p in all_pairs if pair_counts.get(p, 0) == top]
        winners = sorted({x for p in top_pairs for x in p})
        prev_top = max(before_last_pairs.get(p, 0) for p in all_pairs)
        prev_leaders = [p for p in all_pairs if before_last_pairs.get(p, 0) == prev_top]
        tied = len(top_pairs) > 1
        open_at_last = tied or len(prev_leaders) > 1 or prev_leaders != top_pairs
        return units, winners, dead / rounds, open_at_last, tied
    # Competitors: players, or teams for team rules (a team shares one score).
    if rule in TEAM_RULES:
        units = [list(p) for p in pairs]
    else:
        units = [[i] for i in range(n)]
    final = [totals[u[0]] for u in units]
    prev = [before_last[u[0]] for u in units]
    top = max(final)
    winners = [k for k, v in enumerate(final) if v == top]
    lead = max(prev)
    open_at_last = len(winners) > 1 or prev[winners[0]] < lead or prev.count(lead) > 1
    return units, winners, dead / rounds, open_at_last, len(winners) > 1


def mixed_table(rule, n, final_double):
    wins, seats = defaultdict(float), defaultdict(float)
    ties = dead = open_last = 0
    for _ in range(GAMES):
        strat = [random.choice(list(STRATEGIES)) for _ in range(n)]
        units, winners, d, o, tied = play(rule, strat, final_double)
        for u in units:
            for p in u:
                seats[strat[p]] += 1 / len(u)
        for w in winners:
            for p in units[w]:
                wins[strat[p]] += 1 / len(winners) / len(units[w])
        ties += tied
        dead += d
        open_last += o
    units_n = len(units)
    edge = {s: wins[s] / seats[s] * units_n if seats[s] else float("nan") for s in STRATEGIES}
    return edge, ties / GAMES, dead / GAMES, open_last / GAMES


def safe_table(rule, n, focal):
    """Two friends (seats 0 and 1) play the focal strategy; everyone else says the obvious
    thing. Returns seat 0's win edge (1.00 = fair share). This is the Soulmate question:
    can two people who know each other beat a table that plays it safe?"""
    wins = 0.0
    for _ in range(GAMES):
        strat = ["obvious"] * n
        strat[0] = strat[1] = focal
        units, winners, _, _, _ = play(rule, strat, False, shuffle_seats=False)
        mine = next(k for k, u in enumerate(units) if 0 in u)
        if mine in winners:
            wins += 1 / len(winners)
    return wins / GAMES * len(units)


if __name__ == "__main__":
    random.seed(7)
    wanted = sys.argv[2].split(";") if len(sys.argv) > 2 else None
    SELECTED = [r for r in RULES if not wanted or r in wanted]
    sizes = [int(s) for s in sys.argv[3].split(",")] if len(sys.argv) > 3 else [4, 6]
    for n in sizes:
        print(f"\n=== {n} players, {GAMES} games per cell ===")
        print("Win edge vs fair share (1.00 = average). Mixed table: strategies drawn at random.")
        print(f"{'rule':<26}{'obvious':>8}{'personal':>9}{'reader':>8}{'insider':>8}{'tie 1st':>8}{'dead rd':>8}{'open@last':>10}")
        for rule in SELECTED:
            for fd in (False, True):
                edge, tie, dead, open_last = mixed_table(rule, n, fd)
                label = rule + (" x2 last" if fd else "")
                print(
                    f"{label:<26}"
                    + "".join(f"{edge[s]:>8.2f}" if s != "personal" else f"{edge[s]:>9.2f}" for s in STRATEGIES)
                    + f"{tie:>8.0%}{dead:>8.0%}{open_last:>10.0%}"
                )
        print("\nSafe table: two friends play this strategy; everyone else says the obvious thing (1.00 = fair share).")
        print(f"{'rule':<26}{'obvious':>8}{'personal':>9}{'reader':>8}{'insider':>8}")
        for rule in SELECTED:
            row = [safe_table(rule, n, s) for s in STRATEGIES]
            print(f"{rule:<26}" + "".join(f"{v:>8.2f}" if s != "personal" else f"{v:>9.2f}" for v, s in zip(row, STRATEGIES)))
