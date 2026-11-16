// Browser smoke test: drives the real web app and API through signup,
// verification, organizations and invitations, saving screenshots.
// Run by .github/workflows/ui-smoke.yml; Playwright is installed there only.
const { chromium } = require('playwright');
const fs = require('node:fs');
const path = require('node:path');

const BASE = process.env.WEB_ORIGIN ?? 'http://127.0.0.1:3000';
const API_LOG = process.env.API_LOG ?? 'api.log';
const OUT = process.env.SCREENSHOT_DIR ?? 'screenshots';
const PASSWORD = 'correct horse battery staple';
const run = Date.now().toString(36);

fs.mkdirSync(OUT, { recursive: true });

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
  await alice.goto(`${BASE}/account`);
  await alice
    .getByRole('heading', { name: 'Where you are signed in' })
    .waitFor();
  await shot(alice, '12-account-sessions');

  const phone = await open({
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 2,
  });
  await phone.goto(`${BASE}/login`);
  await shot(phone, '13-login-mobile');

  await browser.close();
  console.log('UI smoke test passed');
})().catch(async (error) => {
  console.error(error);
  // Capture every open page so failures can be diagnosed from the artifact.
  for (const [index, page] of pages.entries()) {
    try {
      console.error(`page ${index}: ${page.url()}`);
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
