// Captures README screenshots of the seeded demo organization (M8).
// Run by .github/workflows/ui-smoke.yml after scripts/demo-seed.mjs.
const { chromium } = require('playwright');
const fs = require('node:fs');
const path = require('node:path');

const BASE = process.env.WEB_ORIGIN ?? 'http://127.0.0.1:3000';
const OUT = process.env.SCREENSHOT_DIR ?? 'screenshots/demo';
const PASSWORD = process.env.DEMO_PASSWORD;
const project = `${BASE}/organizations/harbour-works/projects/HBR`;

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const browser = await chromium.launch();
  const page = await browser.newPage({
    viewport: { width: 1360, height: 900 },
    deviceScaleFactor: 1,
  });
  const shot = async (name, full = false) => {
    await page.waitForLoadState('networkidle');
    await page.screenshot({
      path: path.join(OUT, `${name}.png`),
      fullPage: full,
    });
    console.log(`demo screenshot ${name}`);
  };
  await page.goto(`${BASE}/login`);
  await page.getByLabel('Email').fill('demo@atlas.example');
  await page.getByLabel('Password', { exact: true }).fill(PASSWORD);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await page.getByRole('heading', { name: 'Your organizations' }).waitFor();

  await page.goto(project);
  await page.getByRole('region', { name: 'In review' }).waitFor();
  await shot('board');
  await page.getByRole('link', { name: 'Table', exact: true }).click();
  await page.getByRole('columnheader', { name: 'Depth (m)' }).waitFor();
  await shot('table');
  await page.goto(`${project}/tasks/3`);
  await page.getByRole('heading', { name: 'Comments' }).waitFor();
  await shot('task', true);
  await page.goto(project);
  await page
    .getByRole('heading', { name: 'Project numbers' })
    .scrollIntoViewIfNeeded();
  await page.getByRole('heading', { name: 'Project numbers' }).waitFor();
  await page.screenshot({
    path: path.join(OUT, 'numbers.png'),
    clip: await page
      .getByRole('region', { name: 'Project numbers' })
      .boundingBox()
      .then((b) => ({
        x: 0,
        y: b.y - 16,
        width: 1360,
        height: Math.min(b.height + 32, 900),
      })),
  });
  console.log('demo screenshot numbers');
  await page.goto(`${BASE}/organizations/harbour-works/search?q=chart`);
  await page
    .getByRole('link', { name: 'Chart the northern channel' })
    .waitFor();
  await shot('search');
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`${project}/tasks/3`);
  await page.getByRole('heading', { name: 'Comments' }).waitFor();
  await shot('task-phone');
  await browser.close();

  if (process.env.PRINT_SCREENSHOTS === 'true') {
    // The artifact store is not reachable from every environment, so the
    // images can also be read from the job log.
    for (const file of fs.readdirSync(OUT)) {
      const data = fs.readFileSync(path.join(OUT, file)).toString('base64');
      console.log(`BEGIN-IMAGE ${file}`);
      for (let i = 0; i < data.length; i += 40000)
        console.log(data.slice(i, i + 40000));
      console.log('END-IMAGE');
    }
  }
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
