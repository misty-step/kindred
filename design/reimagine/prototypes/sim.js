/*
 * Kindred prototype simulation. Static stand-in for the room, bots, and judge.
 * Not production logic: the real judge is Jev (convex/rubric.ts). This file
 * fakes "same thing, different words" with authored synonym groups per prompt.
 *
 * Contract (window.KindredSim):
 *   BOTS                     ["Sam", "Jo", "Priya", "Theo"]
 *   PROMPTS                  [{ id, text, bots: { name: answer }, groups: { gid: [synonyms] } }]
 *   normalize(text)          canonical form used for matching
 *   groupOf(q, text)         gid or null for prompt index q
 *   botAnswers(q, n)         [{ name, text }] for the first n bots
 *   cluster(q, answers, merges?)
 *                            { groups: [{ gid, members: [{ name, text }] }], loners: [{ name, text }] }
 *                            groups have 2+ members, largest first; merges is [[nameA, nameB]]
 *                            forcing two players' answers into one group (mutual override)
 *   pairTally(rounds)        rounds: array of cluster() results; returns
 *                            [{ a, b, count }] sorted by count desc (count > 0 only)
 *
 * Competitive layer (see MECHANICS.md):
 *   PROMPTS[q].taken         gids of the three answers shown as taken
 *   PROMPTS[q].takenText     their display strings
 *   isTaken(q, text)         true when text lands on a taken answer
 *   rivalAnswers(q, n)       [{ name, text, call }] bot answers that avoid taken answers,
 *                            with the person each bot secretly called
 *   TIEBREAK_Q, promptAt(q)  a seventh question used only to break ties; every
 *                            q-indexed helper accepts TIEBREAK_Q, PROMPTS stays six long
 */
(function () {
  const BOTS = ["Sam", "Jo", "Priya", "Theo"];

  const PROMPTS = [
    {
      id: "junk-drawer",
      text: "Something you\u2019d find in a junk drawer",
      bots: { Sam: "batteries", Jo: "rubber bands", Priya: "dead batteries", Theo: "mystery keys" },
      groups: {
        batteries: ["battery", "batteries", "dead batteries", "aa batteries", "old batteries"],
        rubberbands: ["rubber band", "rubber bands", "elastic bands", "elastics"],
        keys: ["key", "keys", "spare key", "random keys", "mystery keys", "old keys"],
        menus: ["menu", "menus", "takeout menu", "take out menu", "delivery menu"],
        tape: ["tape", "scotch tape", "masking tape"],
        pens: ["pen", "pens", "dead pens"],
        scissors: ["scissors"],
        twistties: ["twist tie", "twist ties"],
      },
    },
    {
      id: "famous-duo",
      text: "A famous duo",
      bots: { Sam: "Batman and Robin", Jo: "Tom and Jerry", Priya: "PB&J", Theo: "batman & robin" },
      groups: {
        batman: ["batman and robin", "batman robin"],
        tomjerry: ["tom and jerry"],
        pbj: ["pb and j", "pbj", "peanut butter and jelly", "peanut butter and jam"],
        simon: ["simon and garfunkel"],
        bert: ["bert and ernie"],
        salt: ["salt and pepper"],
        mario: ["mario and luigi"],
        sonny: ["sonny and cher"],
      },
    },
    {
      id: "pizza-topping",
      text: "The best pizza topping",
      bots: { Sam: "pepperoni", Jo: "mushrooms", Priya: "Pepperoni!", Theo: "pineapple (fight me)" },
      groups: {
        pepperoni: ["pepperoni", "roni"],
        mushroom: ["mushroom", "mushrooms"],
        pineapple: ["pineapple"],
        cheese: ["cheese", "extra cheese", "just cheese", "mozzarella"],
        sausage: ["sausage"],
        olives: ["olive", "olives"],
        basil: ["basil"],
      },
    },
    {
      id: "always-sticky",
      text: "Something that\u2019s always sticky",
      bots: { Sam: "tape", Jo: "honey", Priya: "movie theater floors", Theo: "Honey" },
      groups: {
        honey: ["honey"],
        tape: ["tape", "duct tape", "scotch tape", "sticky tape"],
        floor: ["movie theater floor", "movie theatre floor", "cinema floor", "theater floor"],
        syrup: ["syrup", "maple syrup"],
        kids: ["kids", "toddlers", "children", "toddler hands", "kid hands"],
        glue: ["glue"],
        gum: ["gum", "chewing gum"],
      },
    },
    {
      id: "childhood-smell",
      text: "A smell from your childhood",
      bots: { Sam: "cut grass", Jo: "crayons", Priya: "chlorine", Theo: "play-doh" },
      groups: {
        grass: ["cut grass", "fresh cut grass", "freshly cut grass", "mowed lawn", "lawn", "grass"],
        crayons: ["crayon", "crayons"],
        chlorine: ["chlorine", "pool", "swimming pool"],
        playdoh: ["play doh", "playdoh", "playdough", "play dough"],
        grandma: ["grandmas house", "grandma", "grandmothers house"],
        rain: ["rain", "petrichor"],
        bread: ["bread", "fresh bread", "baking bread"],
      },
    },
    {
      id: "grab-in-fire",
      text: "The first thing you\u2019d grab in a fire",
      bots: { Sam: "my dog", Jo: "phone", Priya: "the dog", Theo: "my phone" },
      groups: {
        dog: ["dog", "doggo", "puppy"],
        cat: ["cat", "kitty"],
        phone: ["phone", "cell phone", "iphone", "cellphone"],
        photos: ["photos", "photo albums", "pictures", "family photos"],
        laptop: ["laptop", "computer"],
        wallet: ["wallet", "purse"],
        kids: ["kids", "children", "my kids", "baby"],
      },
    },
  ];

  /*
   * Competitive layer (MECHANICS.md). Each prompt shows three taken answers that cannot
   * score; bots answer around them ("rival") and secretly call one person ("calls").
   * Extra synonym groups cover the rival answers.
   */
  const RIVAL = {
    "junk-drawer": {
      taken: ["batteries", "rubberbands", "menus"],
      bots: { Sam: "mystery keys", Jo: "birthday candles", Priya: "a single key", Theo: "soy sauce packets" },
      calls: { Sam: "Priya", Jo: "You", Priya: "Sam", Theo: "Jo" },
      groups: { candles: ["candle", "candles", "birthday candles"], soysauce: ["soy sauce", "soy sauce packet", "soy sauce packets"] },
    },
    "famous-duo": {
      taken: ["batman", "pbj", "salt"],
      bots: { Sam: "Tom and Jerry", Jo: "Bert and Ernie", Priya: "Simon and Garfunkel", Theo: "Tom & Jerry" },
      calls: { Sam: "Theo", Jo: "Priya", Priya: "Jo", Theo: "Sam" },
      groups: {},
    },
    "pizza-topping": {
      taken: ["pepperoni", "cheese", "mushroom"],
      bots: { Sam: "pineapple", Jo: "olives", Priya: "hot honey", Theo: "Pineapple" },
      calls: { Sam: "Priya", Jo: "Theo", Priya: "Jo", Theo: "Sam" },
      groups: { hothoney: ["hot honey", "chili honey"], jalapeno: ["jalapeno", "jalapenos", "jalape\u00f1o", "jalape\u00f1os"] },
    },
    "always-sticky": {
      taken: ["honey", "tape", "glue"],
      bots: { Sam: "syrup", Jo: "toddlers", Priya: "movie theater floors", Theo: "maple syrup" },
      calls: { Sam: "Theo", Jo: "You", Priya: "Jo", Theo: "Jo" },
      groups: {},
    },
    "childhood-smell": {
      taken: ["grass", "crayons", "chlorine"],
      bots: { Sam: "play-doh", Jo: "sunscreen", Priya: "play dough", Theo: "rain" },
      calls: { Sam: "Priya", Jo: "Theo", Priya: "Sam", Theo: "You" },
      groups: { sunscreen: ["sunscreen", "sun screen", "sunblock", "sun cream"] },
    },
    "grab-in-fire": {
      taken: ["phone", "dog", "photos"],
      bots: { Sam: "laptop", Jo: "my cat", Priya: "passport", Theo: "the cat" },
      calls: { Sam: "You", Jo: "Theo", Priya: "Sam", Theo: "Jo" },
      groups: { passport: ["passport"] },
    },
  };
  const TAKEN_TEXT = {
    "junk-drawer": ["batteries", "rubber bands", "takeout menus"],
    "famous-duo": ["Batman and Robin", "PB&J", "salt and pepper"],
    "pizza-topping": ["pepperoni", "cheese", "mushrooms"],
    "always-sticky": ["honey", "tape", "glue"],
    "childhood-smell": ["cut grass", "crayons", "chlorine"],
    "grab-in-fire": ["phone", "the dog", "photos"],
  };
  for (const p of PROMPTS) {
    const r = RIVAL[p.id];
    Object.assign(p.groups, r.groups);
    p.taken = r.taken;
    p.rivalBots = r.bots;
    p.calls = r.calls;
    p.takenText = TAKEN_TEXT[p.id];
  }

  /* Tiebreak question: index TIEBREAK_Q, never part of the main six (PROMPTS stays length 6). */
  const TIEBREAK = {
    id: "beach-bag",
    text: "Something you\u2019d pack for a beach day",
    bots: { Sam: "a book", Jo: "shades", Priya: "sunglasses", Theo: "umbrella" },
    groups: {
      sunscreen: ["sunscreen", "sunblock", "sun cream"],
      towel: ["towel", "beach towel"],
      snacks: ["snack", "snacks"],
      book: ["book", "novel", "paperback", "a good book"],
      sunglasses: ["sunglasses", "shades"],
      umbrella: ["umbrella", "beach umbrella", "parasol"],
      speaker: ["speaker", "bluetooth speaker"],
      water: ["water", "water bottle"],
    },
    taken: ["sunscreen", "towel", "snacks"],
    takenText: ["sunscreen", "a towel", "snacks"],
    calls: { Sam: "Priya", Jo: "Theo", Priya: "Sam", Theo: "You" },
  };
  TIEBREAK.rivalBots = TIEBREAK.bots;
  const ALL = [...PROMPTS, TIEBREAK];
  const TIEBREAK_Q = ALL.length - 1;

  const LEADING = /^(a|an|the|my|some|your|our)\s+/;

  function normalize(raw) {
    return String(raw)
      .normalize("NFKC")
      .toLowerCase()
      .replace(/&/g, " and ")
      .replace(/[\u2019']/g, "")
      .replace(/[^\p{L}\p{N}\s]/gu, " ")
      .replace(/\s+/g, " ")
      .trim()
      .replace(LEADING, "")
      .replace(LEADING, "");
  }

  const compiled = ALL.map((p) =>
    Object.entries(p.groups).map(([gid, words]) => ({
      gid,
      words: words.map(normalize).sort((a, b) => b.length - a.length),
    })),
  );

  function groupOf(q, text) {
    const n = normalize(text);
    if (!n) return null;
    for (const { gid, words } of compiled[q]) {
      if (words.includes(n)) return gid;
    }
    const padded = ` ${n} `;
    for (const { gid, words } of compiled[q]) {
      if (words.some((w) => padded.includes(` ${w} `))) return gid;
    }
    return null;
  }

  function botAnswers(q, n) {
    return BOTS.slice(0, n).map((name) => ({ name, text: ALL[q].bots[name] }));
  }

  function cluster(q, answers, merges = []) {
    const key = new Map();
    answers.forEach((a) => key.set(a.name, groupOf(q, a.text) ?? `solo:${a.name}`));
    for (const [x, y] of merges) {
      if (!key.has(x) || !key.has(y)) continue;
      const from = key.get(y);
      const to = key.get(x);
      for (const [name, k] of key) if (k === from) key.set(name, to);
    }
    const buckets = new Map();
    answers.forEach((a) => {
      const k = key.get(a.name);
      if (!buckets.has(k)) buckets.set(k, []);
      buckets.get(k).push(a);
    });
    const groups = [];
    const loners = [];
    for (const [gid, members] of buckets) {
      if (members.length > 1) groups.push({ gid, members });
      else loners.push(members[0]);
    }
    groups.sort((a, b) => b.members.length - a.members.length);
    return { groups, loners };
  }

  function pairTally(rounds) {
    const counts = new Map();
    for (const r of rounds) {
      for (const g of r.groups) {
        const names = g.members.map((m) => m.name);
        for (let i = 0; i < names.length; i++) {
          for (let j = i + 1; j < names.length; j++) {
            const [a, b] = [names[i], names[j]].sort();
            const k = `${a}|${b}`;
            counts.set(k, (counts.get(k) ?? 0) + 1);
          }
        }
      }
    }
    return [...counts.entries()]
      .map(([k, count]) => {
        const [a, b] = k.split("|");
        return { a, b, count };
      })
      .sort((x, y) => y.count - x.count);
  }

  /** True when this text lands on one of the prompt's taken answers. */
  function isTaken(q, text) {
    const gid = groupOf(q, text);
    return gid !== null && ALL[q].taken.includes(gid);
  }

  /** Bot answers under the taken rule: [{ name, text, call }] for the first n bots. */
  function rivalAnswers(q, n) {
    return BOTS.slice(0, n).map((name) => ({ name, text: ALL[q].rivalBots[name], call: ALL[q].calls[name] }));
  }

  /** Any question by index, including the tiebreak (TIEBREAK_Q). */
  const promptAt = (q) => ALL[q];

  window.KindredSim = { BOTS, PROMPTS, TIEBREAK_Q, promptAt, normalize, groupOf, botAnswers, cluster, pairTally, isTaken, rivalAnswers };
})();
