// Browser smoke test: drives the real web app and API through signup,
// verification, organizations, invitations, projects and tasks, saving
// screenshots. Every screenshot is also checked with axe-core against WCAG
// 2.2 A/AA rules, and phone and tablet viewports must not scroll sideways.
// Run by .github/workflows/ui-smoke.yml; Playwright and axe-core are
// installed there only.
const { chromium } = require('playwright');
const fs = require('node:fs');
const path = require('node:path');

const BASE = process.env.WEB_ORIGIN ?? 'http://127.0.0.1:3000';
const API_LOG = process.env.API_LOG ?? 'api.log';
const OUT = process.env.SCREENSHOT_DIR ?? 'screenshots';
const PASSWORD = 'correct horse battery staple';
const run = Date.now().toString(36);

const AXE = require.resolve('axe-core/axe.min.js');
const violations = [];

fs.mkdirSync(OUT, { recursive: true });

async function audit(page, name) {
  await page.addScriptTag({ path: AXE });
  const results = await page.evaluate(() =>
    window.axe.run(document, {
      runOnly: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'],
    }),
  );
  for (const v of results.violations) {
    if (v.impact !== 'serious' && v.impact !== 'critical') continue;
    const line = `${name}: ${v.id} (${v.impact}) ${v.help}\n    ${v.nodes
      .slice(0, 3)
      .map((n) => n.target.join(' '))
      .join('\n    ')}`;
    console.log(`axe ${line}`);
    violations.push(line);
  }
}

async function noSidewaysScroll(page, name) {
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - window.innerWidth,
  );
  if (overflow > 1) violations.push(`${name}: page is ${overflow}px too wide`);
}

function latestToken(email, linkPath) {
  const log = fs.readFileSync(API_LOG, 'utf8');
  const blocks = log.split('To: ').filter((b) => b.startsWith(email));
  const pattern = new RegExp(`${linkPath}\\?token=([A-Za-z0-9_-]+)`);
  for (let i = blocks.length - 1; i >= 0; i -= 1) {
    const match = pattern.exec(blocks[i]);
    if (match) return match[1];
  }
  throw new Error(`no ${linkPath} token for ${email}`);
}

async function waitForToken(email, linkPath) {
  for (let i = 0; i < 50; i += 1) {
    try {
      return latestToken(email, linkPath);
    } catch {
      await new Promise((r) => setTimeout(r, 200));
    }
  }
  return latestToken(email, linkPath);
}

async function shot(page, name) {
  await page.waitForLoadState('networkidle');
  await page.screenshot({
    path: path.join(OUT, `${name}.png`),
    fullPage: true,
  });
  console.log(`screenshot ${name}`);
  await audit(page, name);
}

async function signUp(page, name, email) {
  await page.goto(`${BASE}/signup`);
  await page.getByLabel('Your name').fill(name);
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password').fill(PASSWORD);
  await page.getByRole('button', { name: 'Create account' }).click();
  await page.getByRole('heading', { name: 'Check your email' }).waitFor();
}

async function verify(page, email, capture) {
  const token = await waitForToken(email, '/verify-email');
  await page.goto(`${BASE}/verify-email?token=${token}`);
  if (capture) await shot(page, '04-verify-email');
  await page.getByRole('button', { name: 'Verify email' }).click();
  await page.getByText('Your email is verified.').waitFor();
}

async function signIn(page, email, next) {
  await page.goto(
    `${BASE}/login${next ? `?next=${encodeURIComponent(next)}` : ''}`,
  );
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password', { exact: true }).fill(PASSWORD);
  await page.getByRole('button', { name: 'Sign in' }).click();
}

const pages = [];

(async () => {
  const browser = await chromium.launch();
  browser.on('disconnected', () => undefined);
  const desktop = { viewport: { width: 1280, height: 800 } };
  const open = async (options) => {
    const page = await browser.newPage(options);
    pages.push(page);
    return page;
  };
  const alice = await open(desktop);
  const aliceEmail = `alice-${run}@example.test`;
  const bobEmail = `bob-${run}@example.test`;
  const carolEmail = `carol-${run}@example.test`;

  await alice.goto(`${BASE}/login`);
  await shot(alice, '01-login');
  await alice.goto(`${BASE}/signup`);
  await shot(alice, '02-signup');

  await signUp(alice, 'Alice Rahman', aliceEmail);
  await shot(alice, '03-check-email');
  await verify(alice, aliceEmail, true);
  await signIn(alice, aliceEmail);
  await alice.getByRole('heading', { name: 'Your organizations' }).waitFor();
  await shot(alice, '05-organizations-empty');

  await alice.getByLabel('Name', { exact: true }).fill('Northwind Survey');
  await alice.getByRole('button', { name: 'Create organization' }).click();
  await alice.getByRole('heading', { name: 'Northwind Survey' }).waitFor();
  await shot(alice, '06-organization-owner');

  // Bob and Carol sign up in their own browsers.
  const bob = await open(desktop);
  await signUp(bob, 'Bob Haddad', bobEmail);
  await verify(bob, bobEmail, false);
  const carol = await open(desktop);
  await signUp(carol, 'Carol Ng', carolEmail);
  await verify(carol, carolEmail, false);

  await alice.getByLabel('Email').fill(bobEmail);
  await alice.locator('#inviteRole').selectOption('admin');
  await alice.getByRole('button', { name: 'Send invitation' }).click();
  await alice.getByText(`Invitation sent to ${bobEmail}.`).waitFor();
  await shot(alice, '07-invitation-sent');

  // Bob opens the emailed link while signed out: sign-in keeps the token.
  const inviteToken = await waitForToken(bobEmail, '/invitations/accept');
  await bob.goto(`${BASE}/invitations/accept?token=${inviteToken}`);
  await bob.getByRole('heading', { name: 'Sign in' }).waitFor();
  const next = new URL(bob.url()).searchParams.get('next') ?? '';
  if (!next.includes(inviteToken)) {
    throw new Error('sign-in redirect lost the invitation token');
  }
  await bob.getByLabel('Email').fill(bobEmail);
  await bob.getByLabel('Password', { exact: true }).fill(PASSWORD);
  await bob.getByRole('button', { name: 'Sign in' }).click();
  // Signing in returns Bob to the invitation.
  await bob.getByRole('button', { name: 'Accept invitation' }).waitFor();
  await shot(bob, '08-accept-invitation');
  await bob.getByRole('button', { name: 'Accept invitation' }).click();
  await bob.getByRole('heading', { name: 'Northwind Survey' }).waitFor();
  await shot(bob, '09-organization-admin');

  // Carol is not a member: the organization must look nonexistent.
  await signIn(carol, carolEmail, null);
  await carol.getByRole('heading', { name: 'Your organizations' }).waitFor();
  const slug = new URL(alice.url()).pathname.split('/')[2];
  await carol.goto(`${BASE}/organizations/${slug}`);
  await carol
    .getByRole('heading', { name: 'Organization not found' })
    .waitFor();
  await shot(carol, '10-outsider-not-found');

  await alice.reload();
  await alice.getByText('Bob Haddad').waitFor();
  await shot(alice, '11-members');

  // Projects and tasks (M2).
  await alice.getByLabel('Project name').fill('Coastal survey');
  await alice.getByLabel('Key').fill('COAST');
  await alice.getByRole('button', { name: 'Create project' }).click();
  await alice.getByRole('link', { name: 'Coastal survey' }).click();
  await alice.getByRole('heading', { name: 'Coastal survey' }).waitFor();
  for (const title of [
    'Chart the harbour',
    'Survey the cliffs',
    'Mark the tide lines',
  ]) {
    await alice.getByLabel('New task').fill(title);
    await alice.getByRole('button', { name: 'Add task' }).click();
    await alice.getByRole('link', { name: new RegExp(title) }).waitFor();
  }
  await alice.getByRole('link', { name: /Chart the harbour/ }).click();
  await alice.waitForURL(/\/tasks\/1$/);
  await alice
    .getByLabel('Status', { exact: true })
    .selectOption({ label: 'In progress' });
  await alice.getByText('Status changed.').waitFor();
  await alice.getByLabel('Assignee').selectOption({ label: 'Alice Rahman' });
  await alice.getByText('Assignee changed.').waitFor();
  await alice
    .getByLabel('Add a comment')
    .fill('Tide tables are in the shared folder.');
  await alice.getByRole('button', { name: 'Post comment' }).click();
  await alice.getByText('Tide tables are in the shared folder.').waitFor();
  await shot(alice, '11c-task');
  await alice.getByRole('link', { name: 'Coastal survey' }).click();
  await alice
    .getByRole('region', { name: 'In progress' })
    .getByText('Chart the harbour')
    .waitFor();
  await shot(alice, '11b-board');
  await alice.getByLabel('New status').fill('In review');
  await alice.getByRole('button', { name: 'Add status' }).click();
  await alice.getByRole('region', { name: 'In review' }).waitFor();
  // Drag a card to another column, and move one with the keyboard control.
  await alice
    .locator('.card', { hasText: 'Survey the cliffs' })
    .dragTo(alice.getByRole('region', { name: 'Done' }));
  await alice
    .getByRole('region', { name: 'Done' })
    .getByText('Survey the cliffs')
    .waitFor();
  await alice
    .getByLabel('Move COAST-3 to')
    .selectOption({ label: 'In review' });
  await alice
    .getByRole('region', { name: 'In review' })
    .getByText('Mark the tide lines')
    .waitFor();
  await alice.reload();
  await alice
    .getByRole('region', { name: 'Done' })
    .getByText('Survey the cliffs')
    .waitFor();
  await shot(alice, '11d-board-moved');
  // Table view with a filter, saved as a shared view.
  await alice.getByRole('link', { name: 'Table', exact: true }).click();
  await alice.getByRole('columnheader', { name: 'Title' }).waitFor();
  await alice
    .getByLabel('Status', { exact: true })
    .selectOption({ label: 'Done' });
  await alice.getByRole('cell', { name: 'Survey the cliffs' }).waitFor();
  await alice.getByLabel('Save this view as').fill('Finished work');
  await alice.getByLabel('Share with the project').check();
  await alice.getByRole('button', { name: 'Save view' }).click();
  await alice.getByRole('button', { name: 'Finished work (shared)' }).waitFor();
  await shot(alice, '11e-table-view');
  await alice.getByRole('button', { name: 'Clear filters' }).click();
  // A custom choice field, set on a task and shown as a table column.
  await alice.getByLabel('New field').fill('Region');
  await alice.locator('#fieldType').selectOption('select');
  await alice.getByLabel('Choices, separated by commas').fill('North, South');
  await alice.getByRole('button', { name: 'Add field' }).click();
  await alice.getByText('Choice list: North, South').waitFor();
  await alice.getByRole('columnheader', { name: 'Region' }).waitFor();
  await alice.getByRole('link', { name: 'Chart the harbour' }).click();
  await alice.waitForURL(/\/tasks\/1$/);
  await alice.getByLabel('Region').selectOption('North');
  await alice.getByText('Region saved.').waitFor();
  await alice.getByRole('link', { name: 'Coastal survey' }).click();
  await alice.getByRole('link', { name: 'Table', exact: true }).click();
  await alice.getByRole('cell', { name: 'North' }).waitFor();
  await shot(alice, '11g-custom-field');
  await alice.getByRole('link', { name: 'Calendar', exact: true }).click();
  await alice.getByRole('table', { name: /\d{4}/ }).waitFor();
  await shot(alice, '11f-calendar');
  await alice.goto(`${BASE}/organizations/${slug}`);
  await alice.getByText('Bob Haddad').waitFor();

  // Removing a member ends their access on the next request.
  alice.once('dialog', (dialog) => void dialog.accept());
  await alice
    .getByRole('listitem')
    .filter({ hasText: 'Bob Haddad' })
    .getByRole('button', { name: 'Remove' })
    .click();
  await alice.getByText('Bob Haddad was removed.').waitFor();
  await shot(alice, '12-member-removed');
  await bob.reload();
  await bob.getByRole('heading', { name: 'Organization not found' }).waitFor();
  await shot(bob, '13-removed-member-not-found');

  await alice.goto(`${BASE}/account`);
  await alice
    .getByRole('heading', { name: 'Where you are signed in' })
    .waitFor();
  await shot(alice, '14-account-sessions');

  const phone = await open({
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 2,
  });
  await phone.goto(`${BASE}/login`);
  await shot(phone, '15-login-mobile');
  await noSidewaysScroll(phone, '15-login-mobile');

  // Signed-in pages on a phone and a tablet.
  const project = `${BASE}/organizations/${slug}/projects/COAST`;
  for (const [label, viewport] of [
    ['phone', { width: 390, height: 844 }],
    ['tablet', { width: 820, height: 1180 }],
  ]) {
    const page = await open({ viewport });
    await signIn(page, aliceEmail, null);
    await page.getByRole('heading', { name: 'Your organizations' }).waitFor();
    for (const [name, url, heading] of [
      ['organization', `${BASE}/organizations/${slug}`, 'Northwind Survey'],
      ['board', project, 'Coastal survey'],
      ['table', project, 'Coastal survey'],
      ['task', `${project}/tasks/1`, 'Chart the harbour'],
    ]) {
      await page.goto(url);
      await page.getByRole('heading', { name: heading }).first().waitFor();
      if (name === 'table') {
        await page.getByRole('link', { name: 'Table', exact: true }).click();
        await page.getByRole('columnheader', { name: 'Region' }).waitFor();
      }
      await shot(page, `16-${label}-${name}`);
      await noSidewaysScroll(page, `16-${label}-${name}`);
    }
  }

  await browser.close();
  if (violations.length > 0) {
    console.error(
      `Accessibility and layout problems:\n${violations.join('\n')}`,
    );
    process.exit(1);
  }
  console.log('UI smoke test passed, no serious accessibility violations');
})().catch(async (error) => {
  console.error(error);
  // Capture every open page so failures can be diagnosed from the artifact.
  for (const [index, page] of pages.entries()) {
    try {
      console.error(`page ${index}: ${page.url()}`);
      const text = await page.evaluate(() => document.body.innerText);
      console.error(text.slice(0, 600));
      await page.screenshot({
        path: path.join(OUT, `failure-page-${index}.png`),
        fullPage: true,
      });
    } catch {
      // The page may already be closed.
    }
  }
  process.exit(1);
});
