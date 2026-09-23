/*
 * Kindred, pair rule (MECHANICS.md, round 5).
 *   When exactly two of you say the same thing, that pair scores a point.
 *   Three or more on one answer: nobody scores. Nothing is seeded; crowds regulate themselves.
 *   Six questions. The pair with the most points wins together. Tied pairs get one more
 *   question; still tied, they share the win.
 */
(() => {
  const K = window.KindredSim;
  const MAIN = K.PROMPTS.length;
  const TB = K.TIEBREAK_Q;
  const COLORS = ["--g1", "--g2", "--g3", "--g4", "--g5", "--g6"];
  const params = new URLSearchParams(location.search);
  const reduce = () => matchMedia("(prefers-reduced-motion: reduce)").matches;
  // Default answers for deep links. You and Theo pair three times; tie=1 crowds question 3 instead.
  const DEFAULT_ME = ["keys", "Tom and Jerry", params.get("tie") === "1" ? "pepperoni" : "pineapple", "syrup", "play-doh", "my dog", "umbrella"];

  const S = {
    screen: "lobby",
    host: params.get("host") !== "0",
    players: params.get("players") === "2" ? 2 : 5,
    q: 0,
    phase: "answering",
    mine: "",
    answered: new Set(),
    history: [],
    tied: null, // pair keys in the extra question, once one is needed
    palette: new Map(),
    timers: [],
    arrived: 1,
  };
  const bots = () => K.BOTS.slice(0, S.players - 1);
  const everyone = () => ["You", ...bots()];
  const duo = () => S.players === 2;

  const $ = (s, r = document) => r.querySelector(s);
  const app = $("#app");
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const later = (ms, fn) => { const t = setTimeout(fn, reduce() ? Math.min(ms, 60) : ms); S.timers.push(t); return t; };
  const clearTimers = () => { S.timers.forEach(clearTimeout); S.timers = []; };
  const announce = (text) => { $("#live").textContent = ""; setTimeout(() => ($("#live").textContent = text), 30); };
  function toast(text) { const t = $("#toast"); t.textContent = text; t.classList.add("show"); clearTimeout(toast.t); toast.t = setTimeout(() => t.classList.remove("show"), 1800); }
  const youFirst = (names) => [...names].sort((a, b) => (a === "You" ? -1 : b === "You" ? 1 : 0));
  function list(names) {
    const n = youFirst(names).map((x, i) => (x === "You" && i > 0 ? "you" : x));
    if (n.length === 1) return n[0];
    if (n.length === 2) return `${n[0]} and ${n[1]}`;
    return `${n.slice(0, -1).join(", ")} and ${n[n.length - 1]}`;
  }
  const pairKey = (a, b) => [a, b].sort().join("|");
  const pairName = (key) => list(key.split("|"));

  const roundAnswers = (q, mine) => [{ name: "You", text: mine }, ...K.botAnswers(q, S.players - 1)];

  /* A group of exactly two scores for that pair. In the extra question only tied pairs score. */
  function score(q, answers) {
    const res = K.cluster(q, answers);
    const pairs = [];
    const crowds = [];
    for (const g of res.groups) {
      if (g.members.length === 2) {
        const key = pairKey(g.members[0].name, g.members[1].name);
        pairs.push({ key, group: g, counts: q !== TB || (S.tied ?? []).includes(key) });
      } else crowds.push(g);
    }
    return { res, pairs, crowds };
  }

  function standings(upTo) {
    const t = new Map();
    S.history.slice(0, upTo).forEach((h, q) => {
      if (!h) return;
      for (const p of score(q, h.answers).pairs) {
        if (!p.counts) continue;
        const e = t.get(p.key) ?? { total: 0, delta: 0 };
        e.total++;
        if (q === upTo - 1) e.delta = 1;
        t.set(p.key, e);
      }
    });
    return [...t].map(([key, e]) => ({ key, ...e })).sort((a, b) => b.total - a.total || (a.key.includes("You") ? -1 : 1));
  }
  const leaders = (rows) => (rows.length ? rows.filter((r) => r.total === rows[0].total).map((r) => r.key) : []);

  /* Chrome */
  function chrome() {
    $("#roomBtn").hidden = false;
    const p = $("#progress");
    p.hidden = S.screen !== "round";
    document.querySelector(".bar").classList.toggle("playing", !p.hidden);
    if (!p.hidden) {
      const q = Math.min(S.q, MAIN - 1);
      p.setAttribute("aria-label", S.q === TB ? "Extra question" : `Question ${S.q + 1} of ${MAIN}`);
      p.innerHTML = Array.from({ length: MAIN }, (_, i) => `<i class="${i < q || S.q === TB ? "done" : i === q ? "now" : ""}"></i>`).join("");
    }
  }
  function go(screen, opts = {}) { clearTimers(); S.screen = screen; Object.assign(S, opts); render(); }
  function render() { chrome(); ({ lobby, round, end })[S.screen](); }

  /* Lobby */
  function lobby() {
    const all = everyone();
    const here = all.slice(0, S.arrived);
    const rules = duo()
      ? `<p class="rule-line">Say the same thing as Sam. Six questions.</p>`
      : `<p class="rule-line">When exactly two of you say the same thing, you both score. Three or more, nobody does.</p><p class="hint">The pair with the most points wins.</p>`;
    app.innerHTML = `
      <section class="screen" aria-labelledby="h">
        <h1 class="headline" id="h" style="margin-top:4vh">Room code</h1>
        <div class="code-tiles" role="img" aria-label="K D R D">${"KDRD".split("").map((c) => `<span aria-hidden="true">${c}</span>`).join("")}</div>
        <div class="rules">${rules}</div>
        <p class="section-title">${here.length} ${here.length === 1 ? "person" : "people"} here</p>
        <ul class="people">${here.map((n, i) => `<li class="${i === here.length - 1 && S.arrived > 1 ? "arrive" : ""}"><span class="av" aria-hidden="true">${n === "You" ? "A" : n[0]}</span><span class="who">${n === "You" ? "Ana (you)" : n}</span><span class="role">${n === "You" && S.host ? "Host" : ""}</span></li>`).join("")}</ul>
        <div class="actions"><button class="btn" type="button" id="startGame" ${here.length < 2 ? "disabled" : ""}>Start game</button></div>
      </section>`;
    $("#startGame").onclick = () => { S.history = []; S.tied = null; startRound(0); };
    if (S.arrived < all.length && !params.has("static")) later(700, () => { S.arrived++; lobby(); });
  }

  /* Round */
  function startRound(q) {
    clearTimers();
    Object.assign(S, { screen: "round", q, phase: "answering", mine: "", answered: new Set(), palette: new Map() });
    render();
    bots().forEach((b, i) => later(1600 + i * 1300 + (i % 2) * 600, () => {
      S.answered.add(b);
      if (S.phase === "answering") answeredLine();
      else if (S.phase === "waiting") { renderBoard(); announce(`${b} answered.`); }
      maybeReveal();
    }));
  }
  function maybeReveal() {
    if (S.phase !== "waiting" || S.answered.size < S.players - 1) return;
    S.phase = "checking";
    renderBoard();
    later(900, flipAll);
  }
  function round() {
    if (S.phase === "answering") return renderQuestion();
    if (S.phase === "gathered") return renderGathered();
    return renderBoard(S.phase === "flipping");
  }

  function renderQuestion() {
    const P = K.promptAt(S.q);
    const tb = S.q === TB ? `<p class="notice">One more question. Only the tied pairs can score: ${S.tied.map(pairName).join("; ")}.</p>` : "";
    app.innerHTML = `
      <form class="screen" id="f" aria-labelledby="h">
        ${tb}
        <h1 class="prompt" id="h" style="${tb ? "margin-top:3vh" : ""}">${esc(P.text)}</h1>
        <label class="sr-only" for="ans">Your answer</label>
        <input class="input" id="ans" maxlength="64" autocomplete="off" placeholder="Your answer" value="${esc(S.mine)}">
        <p class="hint">A word or a few. Nobody sees it until everyone answers.</p>
        <div class="actions">
          <button class="btn" type="submit" id="send">Send</button>
          <p class="hint" id="answeredLine"></p>
        </div>
      </form>`;
    const ans = $("#ans"), send = $("#send");
    const sync = () => (send.disabled = !ans.value.trim());
    ans.oninput = sync;
    sync();
    answeredLine();
    if (!params.has("state")) ans.focus();
    $("#f").onsubmit = (e) => {
      e.preventDefault();
      if (send.disabled) return;
      S.mine = ans.value.trim();
      S.phase = "waiting";
      renderBoard();
      maybeReveal();
    };
  }
  function answeredLine() {
    const el = $("#answeredLine");
    if (el) el.textContent = S.answered.size ? `${list([...S.answered])} ${S.answered.size === 1 ? "has" : "have"} answered.` : "";
  }

  function tileHTML(a, cls = "") {
    const me = a.name === "You";
    return `<div class="tile ${me ? "me" : ""} ${cls}" data-name="${esc(a.name)}"><span class="t">${esc(a.text)}</span><span class="n">${me ? "You" : esc(a.name)}</span></div>`;
  }

  function renderBoard(flipReady) {
    const P = K.promptAt(S.q);
    const answers = roundAnswers(S.q, S.mine);
    const waitingOn = bots().filter((b) => !S.answered.has(b));
    const status = S.phase === "checking" ? `<span class="spinner" aria-hidden="true"></span>Everyone's in.` : `Waiting for ${list(waitingOn)}.`;
    app.innerHTML = `
      <section class="screen" aria-labelledby="h">
        <h1 class="prompt small" id="h">${esc(P.text)}</h1>
        <div class="reveal" id="board"><div class="loners" id="flat">${answers.map((a) => {
          if (a.name === "You") return tileHTML(a, "mine");
          const done = S.answered.has(a.name) || flipReady;
          return tileHTML(done ? a : { ...a, text: "Thinking" }, done ? "down" : "pending");
        }).join("")}</div></div>
        <p class="sub" id="status" style="margin-top:22px">${status}</p>
        <div class="actions" id="acts"></div>
      </section>`;
  }

  function flipAll() {
    S.phase = "flipping";
    renderBoard(true);
    const others = [...document.querySelectorAll("#flat .tile")].filter((t) => t.dataset.name !== "You");
    $("#status").textContent = "";
    others.forEach((t, i) => later(i * 130, () => { t.classList.add("flipping"); later(260, () => t.classList.remove("down")); }));
    later(others.length * 130 + 520 + 650, () => {
      S.phase = "gathered";
      commitRound();
      const s = score(S.q, S.history[S.q].answers);
      gather($("#board"), s);
      later(reduce() ? 0 : 560, () => showOutcome(s));
    });
  }

  /* Pairs that score get a color; crowds (three or more) gather in neutral gray; loners stay white. */
  function colorFor(gid) { if (!S.palette.has(gid)) S.palette.set(gid, S.palette.size); return COLORS[S.palette.get(gid) % COLORS.length]; }
  function groupedHTML(s) {
    const pairs = s.pairs.map((p) => `<div class="group ${p.counts ? "" : "crowd"}" style="--g: var(${p.counts ? colorFor(p.group.gid) : "--down"})">${p.group.members.map((m) => tileHTML(m)).join("")}</div>`).join("");
    const crowds = s.crowds.map((g) => `<div class="group crowd" style="--g: var(--down)" aria-label="${g.members.length} people, nobody scores">${g.members.map((m) => tileHTML(m)).join("")}</div>`).join("");
    const loners = s.res.loners.length ? `<div class="loners">${s.res.loners.map((m) => tileHTML(m, m.name === "You" ? "mine" : "")).join("")}</div>` : "";
    return pairs + crowds + loners;
  }
  function gather(container, s) {
    const first = new Map();
    container.querySelectorAll(".tile").forEach((t) => first.set(t.dataset.name, t.getBoundingClientRect()));
    container.innerHTML = groupedHTML(s);
    const groups = [...container.querySelectorAll(".group")];
    if (reduce()) { groups.forEach((g) => g.classList.add("formed")); return; }
    const tiles = [...container.querySelectorAll(".tile")];
    tiles.forEach((t) => {
      const f = first.get(t.dataset.name);
      if (!f) return;
      const l = t.getBoundingClientRect();
      t.style.transition = "none";
      t.style.transform = `translate(${f.left - l.left}px, ${f.top - l.top}px)`;
    });
    container.getBoundingClientRect();
    requestAnimationFrame(() => {
      tiles.forEach((t) => { t.style.transition = "transform 600ms var(--ease), background-color 320ms var(--ease), border-color 320ms var(--ease)"; t.style.transform = ""; });
      setTimeout(() => groups.forEach((g) => { g.classList.add("formed"); g.querySelectorAll(".tile").forEach((t) => t.classList.add("landed")); }), 380);
    });
  }

  function outcomeCopy(s) {
    const answers = roundAnswers(S.q, S.mine);
    const mineText = answers[0].text;
    const myPair = s.pairs.find((p) => p.group.members.some((m) => m.name === "You"));
    const myCrowd = s.crowds.find((g) => g.members.some((m) => m.name === "You"));
    if (duo()) {
      const sam = answers[1].text;
      return { head: myPair ? "Same thing." : "Different things.", sub: myPair ? `You and Sam both said ${esc(sam)}.` : `Sam said ${esc(sam)}.`, extra: "" };
    }
    let head, sub;
    if (myPair) {
      const other = myPair.group.members.find((m) => m.name !== "You").name;
      head = `You and ${other}.`;
      sub = myPair.counts ? `Nobody else said it. <strong>+1</strong> for you both.` : `Nobody else said it, but only tied pairs score now.`;
    } else if (myCrowd) {
      head = "Too many.";
      sub = `${list(myCrowd.members.map((m) => m.name))} all said ${esc(mineText)}. Nobody scores.`;
    } else {
      head = "Just you.";
      sub = `Nobody else said ${esc(mineText)}.`;
    }
    const others = s.pairs.filter((p) => p !== myPair && p.counts).map((p) => pairName(p.key));
    const crowdOthers = s.crowds.filter((g) => g !== myCrowd);
    const extra = [
      others.length ? `${others.join(" and ")} ${others.length === 1 ? "paired" : "paired too"}.` : "",
      crowdOthers.length ? `${crowdOthers.map((g) => list(g.members.map((m) => m.name))).join(" and ")} crowded ${crowdOthers.length === 1 ? "one answer" : "answers"}.` : "",
    ].filter(Boolean).join(" ");
    return { head, sub, extra };
  }

  function standingsHTML(upTo, withDelta = true) {
    if (duo()) {
      const t = standings(upTo)[0]?.total ?? 0;
      return `<p class="sub" style="margin-top:14px">You and Sam have matched <strong>${t} of ${Math.min(upTo, MAIN)}</strong>.</p>`;
    }
    const rows = standings(upTo);
    if (!rows.length) return `<p class="sub" style="margin-top:14px">No pair has scored yet.</p>`;
    return `<ol class="standings" aria-label="Pairs">${rows.map((r, i) => `<li class="${r.total === rows[0].total ? "lead" : ""} ${r.key.includes("You") ? "you" : ""}"><span class="rank">${i > 0 && r.total === rows[i - 1].total ? "" : i + 1}</span><span class="who">${esc(pairName(r.key))}</span>${withDelta && r.delta ? `<span class="delta">+1</span>` : `<span class="delta none" aria-hidden="true"></span>`}<span class="total">${r.total}</span></li>`).join("")}</ol>`;
  }

  function showOutcome(s) {
    const { head, sub, extra } = outcomeCopy(s);
    $("#status")?.remove();
    const acts = $("#acts");
    const upTo = S.q + 1;
    let next = "Next question";
    let tieLine = "";
    if (S.q === MAIN - 1 && !duo()) {
      const top = leaders(standings(MAIN));
      if (top.length > 1) { S.tied = top; next = "One more question"; tieLine = `<p class="sub fade" style="color:var(--ink)">Tied: ${top.map(pairName).join("; ")}. One more question decides it.</p>`; }
      else next = "See who won";
    }
    if (S.q === TB || (S.q === MAIN - 1 && duo())) next = "See results";
    acts.insertAdjacentHTML("beforebegin", `<h2 class="headline fade" id="headline">${head}</h2><p class="sub fade" id="subline">${sub}</p>${extra ? `<p class="sub fade">${extra}</p>` : ""}<div class="fade">${standingsHTML(upTo)}</div>${tieLine}`);
    acts.innerHTML = S.host
      ? `<button class="btn" type="button" id="next">${next}</button>`
      : `<p class="hint" style="color:var(--ink)">Sam will start the next question.</p>`;
    requestAnimationFrame(() => document.querySelectorAll(".fade").forEach((e) => e.classList.add("in")));
    announce(`${head} ${sub.replace(/<[^>]+>/g, "")} ${extra}`);
    if ($("#next")) $("#next").onclick = () => (next === "One more question" ? startRound(TB) : next === "Next question" ? startRound(S.q + 1) : go("end"));
  }

  function renderGathered() {
    const P = K.promptAt(S.q);
    commitRound();
    const s = score(S.q, S.history[S.q].answers);
    app.innerHTML = `
      <section class="screen" aria-labelledby="h">
        <h1 class="prompt small" id="h">${esc(P.text)}</h1>
        <div class="reveal" id="board">${groupedHTML(s)}</div>
        <p class="sub" id="status"></p>
        <div class="actions" id="acts"></div>
      </section>`;
    document.querySelectorAll(".group").forEach((g) => g.classList.add("formed"));
    showOutcome(s);
  }
  function commitRound() { S.history[S.q] = { answers: roundAnswers(S.q, S.mine) }; }

  /* End */
  function end() {
    const played = S.history[TB] ? TB + 1 : MAIN;
    const rows = standings(played);
    const top = leaders(rows);
    let head, sub;
    if (duo()) {
      const t = rows[0]?.total ?? 0;
      head = `You and Sam matched ${t} of ${MAIN}.`;
      sub = t === MAIN ? "Every single one." : t === 0 ? "Not one. Try again?" : "Play again to beat it.";
    } else if (!top.length) {
      head = "No pair scored.";
      sub = "Every match was a crowd or nobody matched.";
    } else if (top.length > 1) {
      head = `${top.map(pairName).join(" and ")} share the win.`;
      sub = "Still tied after one more question.";
    } else {
      head = `${pairName(top[0])} win.`;
      sub = S.history[TB] ? "Won on the extra question." : `Matched ${rows[0].total === 1 ? "once" : `${rows[0].total} times`}, and nobody else said it.`;
    }
    app.innerHTML = `
      <section class="screen" aria-labelledby="h">
        <h1 class="headline" id="h" style="margin-top:7vh;font-size:clamp(32px,8.6vw,46px)">${head}</h1>
        <p class="sub">${sub}</p>
        ${duo() || !rows.length ? "" : `<p class="section-title">Pairs</p>${standingsHTML(played, false)}`}
        <div class="actions row">
          <button class="btn secondary" type="button" id="share">Share results</button>
          ${S.host ? `<button class="btn" type="button" id="again">Play again</button>` : ""}
        </div>
      </section>`;
    $("#share").onclick = async () => {
      const lines = ["Kindred", head, ...(duo() ? [] : rows.map((r) => `${pairName(r.key)} ${r.total}`))];
      try { await navigator.clipboard.writeText(lines.join("\n")); toast("Results copied"); } catch { toast("Copy is unavailable here"); }
    };
    if ($("#again")) $("#again").onclick = () => { S.history = []; S.tied = null; startRound(0); };
    announce(`${head} ${sub}`);
  }

  /* Room sheet */
  $("#roomBtn").onclick = () => {
    const rows = standings(S.history.length);
    $("#roomPeople").innerHTML = everyone().map((n) => {
      const best = rows.find((r) => r.key.split("|").includes(n));
      const partner = best ? best.key.split("|").find((x) => x !== n) : null;
      return `<li><span>${esc(n === "You" ? "Ana (you)" : n)}</span><span class="count">${best ? `best pair: ${partner === "You" ? "you" : esc(partner)}, ${best.total}` : "no pairs yet"}</span></li>`;
    }).join("");
    $("#roomHost").innerHTML = `<button class="btn secondary" type="button" id="leave">Leave room</button>`;
    $("#leave").onclick = () => { $("#room").close(); S.history = []; S.tied = null; go("lobby", { arrived: 1 }); };
    $("#room").showModal();
  };
  document.querySelectorAll("[data-close]").forEach((b) => (b.onclick = () => b.closest("dialog").close()));
  document.querySelectorAll("[data-copy-link]").forEach((b) => (b.onclick = async () => {
    try { await navigator.clipboard.writeText(`${location.origin}${location.pathname}?room=KDRD`); toast("Invite link copied"); } catch { toast("Copy is unavailable here"); }
  }));

  /* Deep links: ?state=lobby|question|waiting|reveal|tiebreak|tiebreak-reveal|end &q=N &tie=1 &players=2 */
  function seed(upTo) {
    S.history = [];
    S.tied = null;
    for (let q = 0; q < upTo; q++) S.history[q] = { answers: roundAnswers(q, DEFAULT_ME[q]) };
    if (upTo >= MAIN && !duo()) {
      const top = leaders(standings(MAIN));
      if (top.length > 1) S.tied = top;
    }
  }
  function deepLink() {
    const st = params.get("state");
    if (!st) return render();
    const q = st === "tiebreak" || st === "tiebreak-reveal" ? TB : Math.max(0, Math.min(MAIN - 1, Number(params.get("q") ?? 0)));
    const at = (phase, extra = {}) => {
      if (q === TB) { seed(MAIN); S.tied = S.tied ?? [pairKey("You", "Theo"), pairKey("Jo", "Theo")]; }
      else seed(q);
      Object.assign(S, { screen: "round", q, phase, mine: DEFAULT_ME[q], answered: new Set(), palette: new Map() }, extra);
      render();
    };
    switch (st) {
      case "lobby": return go("lobby", { arrived: S.players });
      case "question": case "tiebreak": at("answering", { mine: "" }); S.answered.add("Sam"); return answeredLine();
      case "waiting": at("waiting"); S.answered.add("Sam"); S.answered.add("Jo"); return renderBoard();
      case "reveal": case "tiebreak-reveal": return at("gathered");
      case "end": seed(MAIN); if (S.tied) S.history[TB] = { answers: roundAnswers(TB, DEFAULT_ME[TB]) }; return go("end");
      default: return render();
    }
  }
  deepLink();
})();
