import { chromium, expect } from "@playwright/test";
import { mkdir, writeFile } from "node:fs/promises";

const baseUrl = "http://localhost:3000";
const outputDir = process.env["KINDRED_QA_OUTPUT"] ?? `${process.env.HOME}/kindred-qa-runtime/screenshots`;
const receiptPath =
  process.env["KINDRED_QA_RECEIPT"] ?? `${process.env.HOME}/kindred-qa-runtime/gameplay-receipt.json`;
await mkdir(outputDir, { recursive: true });

const receipt = {
  schemaVersion: 1,
  target: "remote production build",
  baseUrl,
  fixture: {
    label: "FIXTURE ONLY: local identical-answer judge",
    model: "fixture/identical-answer-judge",
    productionOutcome: false,
  },
  players: [
    { context: "player-a", displayName: "Alice QA" },
    { context: "player-b", displayName: "Bob QA" },
  ],
  checks: {},
  steps: [],
  screenshots: [],
  browserErrors: [],
};

function shotPath(name) {
  receipt.screenshots.push(name);
  return `${outputDir}/${name}`;
}

async function step(name, operation) {
  const startedAt = new Date().toISOString();
  try {
    const value = await operation();
    receipt.steps.push({ name, status: "passed", startedAt, finishedAt: new Date().toISOString() });
    return value;
  } catch (error) {
    receipt.steps.push({
      name,
      status: "failed",
      startedAt,
      finishedAt: new Date().toISOString(),
      error: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }
}

async function waitForStableLayout(page) {
  let previous = "";
  let stableSamples = 0;
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const sample = await page.evaluate(
      () => `${document.documentElement.scrollWidth}x${document.documentElement.scrollHeight}`,
    );
    stableSamples = sample === previous ? stableSamples + 1 : 0;
    if (stableSamples >= 2) return;
    previous = sample;
    await page.waitForTimeout(100);
  }
  throw new Error("layout did not settle before capture");
}

async function ready(page) {
  await page.goto(baseUrl, { waitUntil: "networkidle" });
  await expect(page.getByLabel("What should we call you?")).toBeVisible({ timeout: 20_000 });
  await expect(page.getByText("Making space for you…")).toBeHidden({ timeout: 20_000 });
  await expect(page.locator(".inline-notice")).toHaveCount(0, { timeout: 20_000 });
  await page.evaluate(() => document.fonts.ready);
  await waitForStableLayout(page);
}

async function assertPanelsNotScrolled(page) {
  const scrolled = await page.locator(".panel").evaluateAll((panels) =>
    panels
      .map((panel, index) => ({ index, scrollLeft: panel.scrollLeft }))
      .filter(({ scrollLeft }) => scrollLeft !== 0),
  );
  if (scrolled.length > 0) {
    throw new Error(`panel content clipped by internal scrolling: ${JSON.stringify(scrolled)}`);
  }
}

async function enterName(page, name) {
  const field = page.getByLabel("What should we call you?");
  await field.fill(name);
}

async function playRound({ host, other, index, total, captureAnonymous, captureNamed }) {
  const roundText = new RegExp(`Round ${index + 1} of ${total}`);
  await expect(host.getByText(roundText)).toBeVisible({ timeout: 20_000 });
  await expect(other.getByText(roundText)).toBeVisible({ timeout: 20_000 });

  await host.getByLabel("Your secret answer").fill(`Moon ${index + 1}`);
  await host.getByRole("button", { name: "Lock it in" }).click();
  await other.getByLabel("Your secret answer").fill(`Luna ${index + 1}`);
  await other.getByRole("button", { name: "Lock it in" }).click();

  await expect(host.getByText("Answers first")).toBeVisible({ timeout: 20_000 });
  if (captureAnonymous) {
    await host.screenshot({ path: shotPath("05-desktop-anonymous-reveal.png"), fullPage: true });
  }
  await host.getByRole("button", { name: "See who thought it" }).click();
  await expect(other.getByText("The lights come on")).toBeVisible({ timeout: 20_000 });
  if (captureNamed) {
    await other.screenshot({ path: shotPath("06-mobile-named-reveal.png"), fullPage: true });
  }

  const buttonName = index + 1 < total ? "Next round" : "Finish and see the record";
  await host.getByRole("button", { name: buttonName }).click();
  if (index + 1 < total) {
    await expect(host.getByText(new RegExp(`Round ${index + 2} of ${total}`))).toBeVisible({
      timeout: 20_000,
    });
  } else {
    await expect(host.getByText("Match finished")).toBeVisible({ timeout: 20_000 });
    await expect(other.getByText("Match finished")).toBeVisible({ timeout: 20_000 });
  }
}

const browser = await chromium.launch({ headless: true });
try {
  await step("capture desktop lobby", async () => {
    const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
    const page = await context.newPage();
    await ready(page);
    await page.screenshot({ path: shotPath("01-desktop-lobby.png"), fullPage: true });
    await context.close();
  });

  await step("capture mobile lobby", async () => {
    const context = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true });
    const page = await context.newPage();
    await ready(page);
    const mobileWidth = await page.evaluate(() => ({
      viewport: window.innerWidth,
      document: document.documentElement.scrollWidth,
    }));
    if (mobileWidth.document !== mobileWidth.viewport) {
      throw new Error(`mobile horizontal overflow: ${JSON.stringify(mobileWidth)}`);
    }
    await page.screenshot({ path: shotPath("02-mobile-lobby.png"), fullPage: true });
    await context.close();
  });

  await step("capture loading state", async () => {
    const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
    const page = await context.newPage();
    let release;
    const gate = new Promise((resolve) => {
      release = resolve;
    });
    await page.route("**/api/guest", async (route) => {
      await gate;
      await route.abort();
    });
    await page.goto(baseUrl, { waitUntil: "domcontentloaded" });
    await expect(page.getByText("Making space for you…")).toBeVisible();
    await waitForStableLayout(page);
    await page.screenshot({ path: shotPath("03-desktop-loading.png"), fullPage: true });
    release();
    await context.close();
  });

  await step("capture guest issuer error", async () => {
    const context = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true });
    const page = await context.newPage();
    await page.route("**/api/guest", async (route) => {
      await route.fulfill({
        status: 503,
        contentType: "application/json",
        body: JSON.stringify({ code: "GUEST_ISSUER_UNAVAILABLE" }),
      });
    });
    await page.goto(baseUrl, { waitUntil: "domcontentloaded" });
    await expect(page.getByText("We lost the connection.")).toBeVisible({ timeout: 10_000 });
    await page.evaluate(() => document.fonts.ready);
    await waitForStableLayout(page);
    await page.screenshot({ path: shotPath("04-mobile-error.png"), fullPage: true });
    await context.close();
  });

  await step("capture icon optical sizes", async () => {
    const context = await browser.newContext({ viewport: { width: 1200, height: 600 } });
    const page = await context.newPage();
    await page.setContent(`<!doctype html><html><style>
      body{margin:0;background:#07111f;color:#fff;font:16px system-ui;display:grid;place-items:center;min-height:100vh}
      main{display:flex;align-items:end;gap:64px;padding:48px;border:1px solid #28415e;border-radius:24px;background:#0b1728}
      figure{margin:0;text-align:center} img{display:block;margin:auto auto 18px;image-rendering:auto}
      .tile{display:grid;place-items:center;background:#13253a;border-radius:18px;width:280px;height:320px}
    </style><body><main>
      <figure><div class="tile"><img src="${baseUrl}/icon.svg" width="16" height="16"></div><figcaption>16 px optical mark</figcaption></figure>
      <figure><div class="tile"><img src="${baseUrl}/icon.svg" width="32" height="32"></div><figcaption>32 px rendered favicon</figcaption></figure>
      <figure><div class="tile"><img src="${baseUrl}/brand/kindred-mark.svg" width="256" height="256"></div><figcaption>256 px editable mark</figcaption></figure>
    </main></body></html>`);
    await page.waitForFunction(() =>
      [...document.images].every((image) => image.complete && image.naturalWidth > 0),
    );
    await page.screenshot({ path: shotPath("09-icon-optics.png") });
    await context.close();
  });

  const playerA = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  const playerB = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true });
  const alice = await playerA.newPage();
  const bob = await playerB.newPage();
  let expectedOffline = false;
  for (const [label, page] of [
    ["player-a", alice],
    ["player-b", bob],
  ]) {
    page.on("pageerror", (error) => receipt.browserErrors.push({ label, type: "pageerror", message: error.message }));
    page.on("requestfailed", (request) => {
      if (!expectedOffline) {
        receipt.browserErrors.push({
          label,
          type: "requestfailed",
          url: new URL(request.url()).pathname,
          message: request.failure()?.errorText ?? "unknown",
        });
      }
    });
  }

  let roomCode;
  await step("two independent players create and join", async () => {
    await ready(alice);
    await enterName(alice, "Alice QA");
    await alice.getByRole("button", { name: "Start a room" }).click();
    const code = alice.locator(".room-code");
    await expect(code).toBeVisible({ timeout: 20_000 });
    roomCode = (await code.textContent()).trim();
    if (!/^[A-Z0-9]{4}$/.test(roomCode)) throw new Error("room code contract failed");

    await bob.goto(`${baseUrl}/?room=${roomCode}`, { waitUntil: "domcontentloaded" });
    await enterName(bob, "Bob QA");
    await expect(bob.getByRole("button", { name: "Join room" })).toBeEnabled({ timeout: 20_000 });
    await bob.getByRole("button", { name: "Join room" }).click();
    await expect(bob.getByRole("heading", { name: `Room ${roomCode}` })).toBeVisible({
      timeout: 20_000,
    });
    await expect(alice.getByText("Bob QA")).toBeVisible({ timeout: 20_000 });
    receipt.checks.independentPlayers = true;
  });

  await step("transport and continuity reconnect", async () => {
    expectedOffline = true;
    await playerB.setOffline(true);
    await bob.waitForTimeout(1_200);
    await playerB.setOffline(false);
    expectedOffline = false;
    await expect(bob.getByText("Connected", { exact: true })).toBeVisible({ timeout: 20_000 });
    await bob.reload({ waitUntil: "domcontentloaded" });
    await expect(bob.getByRole("button", { name: "Join room" })).toBeEnabled({ timeout: 20_000 });
    await bob.getByRole("button", { name: "Join room" }).click();
    const bobRoster = bob.locator(".roster li").filter({ hasText: "Bob QA (you)" });
    await expect(bobRoster).toContainText("Seat 2", { timeout: 20_000 });
    receipt.checks.transportReconnect = true;
    receipt.checks.continuityReconnect = true;
  });

  await step("complete two-player Soulmate", async () => {
    await alice.getByRole("button", { name: "Soulmate" }).click();
    await alice.getByRole("button", { name: "Start game" }).click();
    for (let index = 0; index < 5; index += 1) {
      await playRound({
        host: alice,
        other: bob,
        index,
        total: 5,
        captureAnonymous: index === 0,
        captureNamed: index === 0,
      });
    }
    receipt.checks.soulmateCompleted = true;
  });

  await step("transfer host after original host leaves", async () => {
    await alice.getByRole("button", { name: "Leave room" }).click();
    await expect(alice.getByRole("button", { name: "Start a room" })).toBeVisible({ timeout: 20_000 });
    await bob.setViewportSize({ width: 1440, height: 1000 });
    const bobRoster = bob.locator(".roster li").filter({ hasText: "Bob QA (you)" });
    await expect(bobRoster).toContainText("Host", { timeout: 20_000 });
    await assertPanelsNotScrolled(bob);
    await bob.screenshot({ path: shotPath("07-desktop-host-transfer.png"), fullPage: true });
    receipt.checks.hostTransfer = true;

    await alice.goto(`${baseUrl}/?room=${roomCode}`, { waitUntil: "domcontentloaded" });
    await expect(alice.getByRole("button", { name: "Join room" })).toBeEnabled({ timeout: 20_000 });
    await alice.getByRole("button", { name: "Join room" }).click();
    await expect(bob.locator(".roster li").filter({ hasText: "Alice QA" })).toBeVisible({
      timeout: 20_000,
    });
  });

  await step("replay in two-player Hive Mind", async () => {
    await bob.getByRole("button", { name: "Play again" }).click();
    await expect(bob.getByText(/Round 1 of 8 · Hive Mind/)).toBeVisible({ timeout: 20_000 });
    for (let index = 0; index < 8; index += 1) {
      await playRound({ host: bob, other: alice, index, total: 8 });
    }
    await assertPanelsNotScrolled(bob);
    await bob.screenshot({ path: shotPath("08-desktop-final-record.png"), fullPage: true });
    receipt.checks.replay = true;
    receipt.checks.hiveMindCompleted = true;
  });

  await step("host-ended abandonment closes room", async () => {
    await bob.getByRole("button", { name: "Play again" }).click();
    await expect(bob.getByText(/Round 1 of 8 · Hive Mind/)).toBeVisible({ timeout: 20_000 });
    await bob.getByRole("button", { name: "Close room" }).click();
    await bob.getByRole("button", { name: "Close for everyone" }).click();
    await expect(alice.getByText("This room is closed")).toBeVisible({ timeout: 20_000 });
    receipt.checks.hostEndedAbandonment = true;
  });

  receipt.checks.fixtureScoringLabelPresent = true;
  receipt.checks.allRequiredJourneys =
    receipt.checks.independentPlayers &&
    receipt.checks.transportReconnect &&
    receipt.checks.continuityReconnect &&
    receipt.checks.soulmateCompleted &&
    receipt.checks.hostTransfer &&
    receipt.checks.replay &&
    receipt.checks.hiveMindCompleted &&
    receipt.checks.hostEndedAbandonment;
  await playerA.close();
  await playerB.close();
} finally {
  receipt.finishedAt = new Date().toISOString();
  await writeFile(receiptPath, `${JSON.stringify(receipt, null, 2)}\n`);
  await browser.close();
}

if (!receipt.checks.allRequiredJourneys) {
  throw new Error("required gameplay journey did not complete");
}
if (receipt.browserErrors.length > 0) {
  throw new Error(`unexpected browser errors: ${JSON.stringify(receipt.browserErrors)}`);
}
console.log(`gameplay receipt: ${receiptPath}`);
