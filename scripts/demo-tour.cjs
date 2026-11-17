// Records a short walkthrough of the seeded demo for the README (ADR-062).
// Run by .github/workflows/ui-smoke.yml when dispatched with record_tour,
// after scripts/demo-seed.mjs; ffmpeg then turns the video into a GIF.
const { chromium } = require('playwright');
const fs = require('node:fs');
const path = require('node:path');

const BASE = process.env.WEB_ORIGIN ?? 'http://127.0.0.1:3000';
const OUT = process.env.TOUR_DIR ?? 'tour';
const PASSWORD = process.env.DEMO_PASSWORD;
const org = `${BASE}/organizations/harbour-works`;
const project = `${org}/projects/HBR`;
const size = { width: 1280, height: 800 };

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const browser = await chromium.launch();
  const context = await browser.newContext({
    viewport: size,
    recordVideo: { dir: OUT, size },
  });
  const page = await context.newPage();
  const pause = (ms = 1800) => page.waitForTimeout(ms);
  const settle = async () => {
    await page.waitForLoadState('networkidle');
    await pause();
  };

  await page.goto(`${BASE}/login`);
  await page.getByLabel('Email').pressSequentially('demo@atlas.example', {
    delay: 25,
  });
  await page.getByLabel('Password', { exact: true }).fill(PASSWORD);
  await pause(500);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await page.getByRole('heading', { name: 'Your organizations' }).waitFor();

  // Board, then a task with its discussion.
  await page.goto(project);
  await page.getByRole('region', { name: 'In review' }).waitFor();
  await settle();
  await page.goto(`${project}/tasks/3`);
  await page.getByRole('heading', { name: 'Comments' }).waitFor();
  await settle();
  await page.mouse.wheel(0, 700);
  await settle();

  // Other views of the same work.
  for (const view of ['Table', 'Timeline', 'Calendar']) {
    await page.goto(project);
    await page.getByRole('link', { name: view, exact: true }).click();
    await settle();
  }

  // Search and the team's workload.
  await page.goto(`${org}/search?q=chart`);
  await page
    .getByRole('link', { name: 'Chart the northern channel' })
    .waitFor();
  await settle();
  await page.goto(`${org}/workload`);
  await page
    .getByRole('heading', { name: /workload/i })
    .first()
    .waitFor();
  await settle();

  const video = page.video();
  await context.close();
  await browser.close();
  const file = await video.path();
  fs.renameSync(file, path.join(OUT, 'tour.webm'));
  console.log('tour recorded');
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
