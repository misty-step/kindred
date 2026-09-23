/**
 * Real-path playthrough for the pair rule (USER_STORIES.md US-001..US-009).
 * Runs against a live app + Convex backend with the real Jev judge; no fixtures.
 * Answers are chosen so the judge must decide synonyms (sofa/couch, TV/television,
 * car/automobile, whisky/whiskey, kid/child) and distinct pairs (coffee/tea).
 *
 * Env: KINDRED_QA_URL (default http://127.0.0.1:3000), KINDRED_QA_OUTPUT (screenshots dir),
 *      KINDRED_QA_RECEIPT (receipt path). Screenshots never belong in the repository.
 * Every captured state is also scanned with axe-core (pinned CDN build).
 */
import { chromium } from "@playwright/test";
import { mkdir, writeFile } from "node:fs/promises";

const baseUrl = process.env["KINDRED_QA_URL"] ?? "http://127.0.0.1:3000";
const outputDir =
  process.env["KINDRED_QA_OUTPUT"] ?? `${process.env.HOME}/kindred-qa/shots`;
const receiptPath =
  process.env["KINDRED_QA_RECEIPT"] ??
  `${process.env.HOME}/kindred-qa/receipt.json`;
await mkdir(outputDir, { recursive: true });

const NAMES = ["Ana", "Ben", "Cleo", "Dev", "Eli"];
const receipt = {
  schemaVersion: 2,
  baseUrl,
  judge: "live Jev",
  checks: {},
  rounds: [],
  shots: [],
  browserErrors: [],
};
const phone = { width: 390, height: 844 };
const desktop = { width: 1280, height: 800 };

const browser = await chromium.launch({ headless: true });
const players = [];
const axeSource = await (
  await fetch("https://cdn.jsdelivr.net/npm/axe-core@4.10.2/axe.min.js")
).text();

function check(name, ok, detail) {
  receipt.checks[name] = ok ? "pass" : `FAIL: ${detail ?? ""}`;
  if (!ok) throw new Error(`check failed: ${name} ${detail ?? ""}`);
}

async function shot(page, name, fullPage = true) {
  await page.waitForTimeout(250);
  const path = `${outputDir}/${name}.png`;
  await page.screenshot({ path, fullPage });
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth > window.innerWidth + 1,
  );
  const violations = await page.evaluate(async (source) => {
    if (!("axe" in window)) new Function(source)();
    const result = await window.axe.run(document, {
      resultTypes: ["violations"],
    });
    return result.violations.map(
      (v) => `${v.id}: ${v.nodes.map((n) => n.target.join(" ")).join(", ")}`,
    );
  }, axeSource);
  receipt.shots.push({
    name,
    viewport: page.viewportSize(),
    overflow,
    violations,
  });
  if (overflow) throw new Error(`horizontal overflow in ${name}`);
  if (violations.length)
    throw new Error(`accessibility in ${name}: ${violations.join(" | ")}`);
}

async function newPlayer(
  name,
  viewport = phone,
  reducedMotion = "no-preference",
) {
  const context = await browser.newContext({
    viewport,
    reducedMotion,
    permissions: ["clipboard-read", "clipboard-write"],
  });
  const page = await context.newPage();
  page.on("pageerror", (error) =>
    receipt.browserErrors.push(`${name}: ${error.message}`),
  );
  page.on("console", (message) => {
    if (message.type() === "error")
      receipt.browserErrors.push(`${name}: ${message.text()}`);
  });
  return { name, context, page };
}

async function createRoom(player, capture) {
  const { page } = player;
  await page.goto(baseUrl);
  await page.getByRole("button", { name: "Start a game" }).waitFor();
  if (capture) await shot(page, "01-home");
  await page.getByRole("button", { name: "Start a game" }).click();
  await page.locator("#display-name").fill(player.name);
  if (capture) await shot(page, "02-name");
  await page
    .getByRole("button", { name: "Create room" })
    .click({ timeout: 15_000 });
  await page
    .getByRole("heading", { name: "Room code" })
    .waitFor({ timeout: 15_000 });
  return new URL(page.url()).searchParams.get("room");
}

async function joinRoom(player, code, capture) {
  const { page } = player;
  await page.goto(`${baseUrl}/?room=${code}`);
  await page.getByRole("heading", { name: "Join a game" }).waitFor();
  await page.locator("#join-name").fill(player.name);
  await page.getByRole("button", { name: "Join", exact: true }).waitFor();
  if (capture) await shot(page, "04-join");
  await page.getByRole("button", { name: "Join", exact: true }).click();
  await page
    .getByRole("heading", { name: "Room code" })
    .waitFor({ timeout: 15_000 });
}

async function answer(player, text) {
  const { page } = player;
  await page.locator("#answer").waitFor({ timeout: 20_000 });
  await page.locator("#answer").fill(text);
  await page.getByRole("button", { name: "Send" }).click();
}

async function waitReveal(page) {
  await page.locator("main h2.headline").waitFor({ timeout: 120_000 });
  await page.waitForTimeout(700);
}

/** Plays one question: host answers first (to capture waiting), the rest follow. */
async function playRound(
  group,
  answers,
  label,
  { captureWaiting = false } = {},
) {
  const host = group[0];
  await host.page.locator("#answer").waitFor({ timeout: 20_000 });
  const prompt = (await host.page.locator("#prompt").textContent()) ?? "";
  await answer(host, answers[0]);
  if (captureWaiting) {
    await host.page.getByText(/^Waiting for /).waitFor();
    await shot(host.page, `${label}-waiting`);
    // US-003: nobody's device shows another player's text before the reveal.
    const hostBody = await host.page.locator("main").innerText();
    const leaked = answers
      .slice(1)
      .filter((text) => text !== answers[0] && hostBody.includes(text));
    check(`${label} secrecy`, leaked.length === 0, leaked.join(","));
  }
  for (let i = 1; i < group.length; i += 1) await answer(group[i], answers[i]);
  await Promise.all(group.map((player) => waitReveal(player.page)));
  const head = await host.page.locator("main h2.headline").innerText();
  const subs = await host.page.locator("main .fade .sub").allInnerTexts();
  const standings = await host.page
    .locator(".standings li")
    .allInnerTexts()
    .catch(() => []);
  const groups = await host.page.locator(".reveal .group").evaluateAll((els) =>
    els.map((el) => ({
      label: el.getAttribute("aria-label"),
      answers: [...el.querySelectorAll(".t")].map((t) => t.textContent),
    })),
  );
  const next = host.page.locator(".actions .btn").last();
  const nextLabel = await next.innerText();
  receipt.rounds.push({
    label,
    prompt,
    answers,
    head,
    subs,
    groups,
    standings: standings.map((s) => s.replace(/\s+/g, " ")),
    nextLabel,
  });
  return { head, subs, groups, standings, nextLabel, next };
}

try {
  // Game 1: five players, clean win for Ana and Ben (US-001, US-002, US-004, US-005, US-006).
  for (const name of NAMES) players.push(await newPlayer(name));
  const [ana, ben, cleo, dev, eli] = players;
  const code = await createRoom(ana, true);
  check("room code issued", /^[A-Z0-9]{4}$/.test(code ?? ""), code);
  await shot(ana.page, "03-lobby-alone");
  await joinRoom(ben, code, true);
  for (const p of [cleo, dev, eli]) await joinRoom(p, code, false);
  await ana.page.getByText("5 people here").waitFor({ timeout: 15_000 });
  await shot(ana.page, "05-lobby-host");
  await shot(ben.page, "06-lobby-guest");
  const lobbyRule = await ana.page.locator(".rule-line").innerText();
  check(
    "lobby states the rule",
    /exactly two of you say the same thing/.test(lobbyRule),
    lobbyRule,
  );

  await ana.page.getByRole("button", { name: "Start game" }).click();
  await ana.page.locator("#answer").waitFor({ timeout: 20_000 });
  await shot(ana.page, "07-question");
  await ana.page.getByRole("button", { name: "Room" }).click();
  await ana.page.locator("dialog[open]").waitFor();
  await shot(ana.page, "08-room-sheet", false);
  await ana.page.getByRole("button", { name: "Close", exact: true }).click();

  const all = [ana, ben, cleo, dev, eli];
  let r = await playRound(
    all,
    ["sofa", "couch", "chair", "lamp", "table"],
    "g1-r1",
    { captureWaiting: true },
  );
  await shot(ana.page, "09-reveal-pair");
  check(
    "synonym pair scores (sofa/couch)",
    r.head === "You and Ben." && r.standings.length === 1,
    `${r.head} ${r.standings}`,
  );
  await shot(cleo.page, "10-reveal-single-guest");
  await r.next.click();

  r = await playRound(all, ["dog", "dog", "dog", "cat", "bird"], "g1-r2");
  await shot(ana.page, "11-reveal-crowd");
  check(
    "crowd of three scores nothing",
    r.head === "Too many." &&
      r.groups.some((g) => /3 people, nobody scores/.test(g.label ?? "")),
    r.head,
  );
  await r.next.click();

  r = await playRound(
    all,
    ["TV", "television", "car", "automobile", "bus"],
    "g1-r3",
  );
  await shot(ana.page, "12-reveal-two-pairs");
  check(
    "two synonym pairs in one round",
    r.groups.filter((g) => g.label === "A pair, scores").length === 2,
    JSON.stringify(r.groups),
  );
  await r.next.click();

  r = await playRound(
    all,
    ["pizza", "apple", "apple", "banana", "grape"],
    "g1-r4",
  );
  await r.next.click();

  r = await playRound(
    all,
    ["coffee", "tea", "water", "juice", "milk"],
    "g1-r5",
  );
  check(
    "related but different answers do not pair (coffee/tea)",
    r.groups.length === 0,
    JSON.stringify(r.groups),
  );
  await shot(ana.page, "13-reveal-nobody");
  await r.next.click();

  r = await playRound(
    all,
    ["whisky", "whiskey", "kid", "child", "train"],
    "g1-r6",
  );
  check(
    "last question offers the result",
    r.nextLabel === "See who won",
    r.nextLabel,
  );
  await r.next.click();
  await ana.page.locator("#end-title").waitFor({ timeout: 20_000 });
  const endHead = await ana.page.locator("#end-title").innerText();
  check("clean winner named", endHead === "You and Ben win.", endHead);
  await shot(ana.page, "14-end-winner");
  await shot(eli.page, "15-end-guest");
  await ana.page.getByRole("button", { name: "Share results" }).click();
  const shared = await ana.page.evaluate(() => navigator.clipboard.readText());
  const leakedInShare = ["sofa", "couch", "whisky", "television"].filter((t) =>
    shared.includes(t),
  );
  check(
    "share names everyone and has no answer text",
    leakedInShare.length === 0 &&
      shared.startsWith("Kindred\nAna and Ben win.") &&
      !shared.includes("You"),
    shared,
  );

  // Game 2: same room, tie after six, one extra question (US-006).
  await ana.page.getByRole("button", { name: "Play again" }).click();
  const tiePlan = [
    ["sofa", "couch", "red", "blue", "green"],
    ["hat", "shoe", "car", "automobile", "sock"],
    ["TV", "television", "kid", "child", "bus"],
    ["one", "two", "three", "four", "five"],
    ["north", "south", "east", "west", "up"],
    ["cat", "dog", "bird", "fish", "mouse"],
  ];
  for (let i = 0; i < tiePlan.length; i += 1) {
    r = await playRound(all, tiePlan[i], `g2-r${i + 1}`);
    if (i === tiePlan.length - 1) {
      check(
        "tie offers one more question",
        r.nextLabel === "One more question",
        r.nextLabel,
      );
      await shot(ana.page, "16-reveal-tied");
    }
    await r.next.click();
  }
  await ana.page.locator(".notice").waitFor({ timeout: 20_000 });
  await shot(ana.page, "17-extra-question");
  // Ana and Ben pair (tied); Cleo pairs with Eli (not tied: recorded, scores nothing).
  r = await playRound(
    all,
    ["whisky", "whiskey", "lamp", "rug", "lamp"],
    "g2-extra",
  );
  await shot(cleo.page, "18-extra-reveal-untied-pair");
  const cleoSub = await cleo.page
    .locator("main .fade .sub")
    .first()
    .innerText();
  check(
    "untied pair scores nothing in the extra question",
    /only the tied pairs can score/.test(cleoSub),
    cleoSub,
  );
  await r.next.click();
  await ana.page.locator("#end-title").waitFor({ timeout: 20_000 });
  const tieEnd = await ana.page.locator("main .sub").first().innerText();
  check(
    "won on the extra question",
    tieEnd === "Won on the extra question.",
    tieEnd,
  );
  await shot(ana.page, "19-end-extra");

  // Game 3: two players, desktop host and reduced motion (US-007).
  const duoA = await newPlayer("Fay", desktop, "reduce");
  const duoB = await newPlayer("Gus", phone);
  players.push(duoA, duoB);
  const duoCode = await createRoom(duoA, false);
  await joinRoom(duoB, duoCode, false);
  await duoA.page.getByText("2 people here").waitFor({ timeout: 15_000 });
  await shot(duoA.page, "20-duo-lobby-desktop");
  await duoA.page.getByRole("button", { name: "Start game" }).click();
  const duoPlan = [
    ["sofa", "couch"],
    ["tea", "coffee"],
    ["TV", "television"],
    ["kid", "child"],
    ["up", "down"],
    ["car", "automobile"],
  ];
  for (let i = 0; i < duoPlan.length; i += 1) {
    r = await playRound([duoA, duoB], duoPlan[i], `g3-r${i + 1}`);
    if (i === 0) {
      check("duo reveal reads as co-op", r.head === "Same thing.", r.head);
      await shot(duoA.page, "21-duo-reveal-desktop-reduced-motion");
    }
    if (i === duoPlan.length - 1)
      check(
        "duo never gets an extra question",
        r.nextLabel === "See results",
        r.nextLabel,
      );
    await r.next.click();
  }
  await duoA.page.locator("#end-title").waitFor({ timeout: 20_000 });
  const duoEnd = await duoA.page.locator("#end-title").innerText();
  check(
    "duo end counts matches",
    /^You matched \d of 6\.$/.test(duoEnd),
    duoEnd,
  );
  await shot(duoA.page, "22-duo-end-desktop");
  await shot(duoB.page, "23-duo-end-phone");

  check(
    "no browser errors",
    receipt.browserErrors.length === 0,
    receipt.browserErrors.join(" | "),
  );
  receipt.checks.allRequiredJourneys = "pass";
} catch (error) {
  receipt.failure = error instanceof Error ? error.message : String(error);
  for (const p of players)
    await p.page
      .screenshot({
        path: `${outputDir}/failure-${p.name}.png`,
        fullPage: true,
      })
      .catch(() => {});
} finally {
  await writeFile(receiptPath, `${JSON.stringify(receipt, null, 2)}\n`);
  await browser.close();
}
if (receipt.failure) {
  console.error(`playthrough failed: ${receipt.failure}`);
  process.exit(1);
}
console.log(`playthrough passed; receipt: ${receiptPath}`);
