// Seeds a demo organization for evaluators (M8). Fictional people and work
// only; no personal data. Uses the running API for everything except
// creating the accounts, so all rules, history and events apply.
//
//   DATABASE_URL=... ATLAS_API=http://127.0.0.1:3001/v1 WEB_ORIGIN=http://localhost:3000 \
//     node scripts/demo-seed.mjs
//
// Prints the demo sign-in once. Safe to re-run: an existing demo
// organization is left alone and only the demo password is reset.
import { randomBytes } from 'node:crypto';
import { createRequire } from 'node:module';
import pg from 'pg';

const require = createRequire(import.meta.url);
const { hashPassword } = require('../packages/shared/dist/index.js');

const API = (process.env.ATLAS_API ?? 'http://127.0.0.1:3001/v1').replace(
  /\/$/,
  '',
);
const ORIGIN = process.env.WEB_ORIGIN ?? 'http://localhost:3000';
const SLUG = 'harbour-works';
const DEMO_EMAIL = 'demo@atlas.example';
const day = 86_400_000;
const inDays = (n) => new Date(Date.now() + n * day).toISOString();

const people = [
  { key: 'demo', name: 'Demo Visitor', email: DEMO_EMAIL },
  {
    key: 'maha',
    name: 'Maha Al-Harbi',
    email: 'maha@atlas.example',
    role: 'admin',
  },
  {
    key: 'omar',
    name: 'Omar Haddad',
    email: 'omar@atlas.example',
    role: 'member',
  },
  {
    key: 'lina',
    name: 'Lina Park',
    email: 'lina@atlas.example',
    role: 'member',
  },
];

const db = new pg.Client({ connectionString: process.env.DATABASE_URL });
await db.connect();

const passwords = {};
const ids = {};
for (const person of people) {
  // A deployment can choose the shared demo password (ADR-062).
  passwords[person.key] =
    person.key === 'demo' && process.env.DEMO_PASSWORD
      ? process.env.DEMO_PASSWORD
      : randomBytes(12).toString('base64url');
  const row = await db.query(
    `INSERT INTO users (email_normalized, display_name, password_hash, email_verified_at)
     VALUES ($1, $2, $3, now())
     ON CONFLICT (email_normalized) DO UPDATE SET password_hash = EXCLUDED.password_hash
     RETURNING id`,
    [person.email, person.name, await hashPassword(passwords[person.key])],
  );
  ids[person.key] = row.rows[0].id;
}

const cookies = {};
async function call(who, method, path, body) {
  const response = await fetch(`${API}${path}`, {
    method,
    headers: {
      origin: ORIGIN,
      ...(cookies[who] ? { cookie: cookies[who] } : {}),
      ...(body === undefined ? {} : { 'content-type': 'application/json' }),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const text = await response.text();
  if (!response.ok)
    throw new Error(`${method} ${path}: ${response.status} ${text}`);
  return text ? JSON.parse(text) : undefined;
}

for (const person of people) {
  const response = await fetch(`${API}/auth/login`, {
    method: 'POST',
    headers: { origin: ORIGIN, 'content-type': 'application/json' },
    body: JSON.stringify({
      email: person.email,
      password: passwords[person.key],
    }),
  });
  if (response.status !== 204)
    throw new Error(`login ${person.email}: ${response.status}`);
  cookies[person.key] = (response.headers.get('set-cookie') ?? '').split(
    ';',
  )[0];
}

const existing = await db.query(
  'SELECT id FROM organizations WHERE slug = $1',
  [SLUG],
);
if (existing.rowCount) {
  console.log(
    'The demo organization already exists; the demo password was reset.',
  );
} else {
  const org = await call('demo', 'POST', '/organizations', {
    name: 'Harbour Works',
    slug: SLUG,
  });
  for (const person of people.filter((p) => p.role)) {
    await db.query(
      `INSERT INTO organization_memberships (organization_id, user_id, role) VALUES ($1, $2, $3)`,
      [org.id, ids[person.key], person.role],
    );
  }
  const o = `/organizations/${SLUG}`;
  const label = {};
  for (const [name, color] of [
    ['Field work', 'sea'],
    ['Safety', 'rose'],
    ['Permits', 'sand'],
    ['Equipment', 'violet'],
  ]) {
    label[name] = (
      await call('demo', 'POST', `${o}/labels`, { name, color })
    ).id;
  }

  async function project(key, name, description, tasks, extra) {
    await call('demo', 'POST', `${o}/projects`, { key, name, description });
    const p = `${o}/projects/${key}`;
    const states = await call('demo', 'GET', `${p}/states`);
    const state = (k) => states.find((s) => s.key === k).id;
    const review = await call('demo', 'POST', `${p}/states`, {
      label: 'In review',
      category: 'in_progress',
    });
    const milestones = {};
    for (const [title, due] of extra.milestones) {
      milestones[title] = (
        await call('demo', 'POST', `${p}/milestones`, {
          title,
          dueAt: inDays(due),
        })
      ).id;
    }
    let number = 0;
    for (const t of tasks) {
      number += 1;
      const created = await call(t.by ?? 'demo', 'POST', `${p}/tasks`, {
        title: t.title,
        description: t.description ?? '',
        priority: t.priority ?? 'none',
        assigneeId: t.assignee ? ids[t.assignee] : null,
        dueAt: t.due === undefined ? null : inDays(t.due),
        milestoneId: t.milestone ? milestones[t.milestone] : null,
      });
      let version = created.version;
      if (t.state) {
        const stateId = t.state === 'in_review' ? review.id : state(t.state);
        version = (
          await call('demo', 'PATCH', `${p}/tasks/${number}`, {
            version,
            stateId,
          })
        ).version;
      }
      if (t.labels) {
        await call('demo', 'PUT', `${p}/tasks/${number}/labels`, {
          labelIds: t.labels.map((l) => label[l]),
        });
      }
      for (const [who, body] of t.comments ?? []) {
        await call(who, 'POST', `${p}/tasks/${number}/comments`, { body });
      }
    }
    for (const [task, blocker] of extra.dependencies ?? []) {
      await call('demo', 'POST', `${p}/tasks/${task}/dependencies`, {
        blockerNumber: blocker,
      });
    }
    return p;
  }

  const hbr = await project(
    'HBR',
    'Harbour survey',
    'Depth survey of the inner harbour before the spring dredging.',
    [
      {
        title: 'Book the survey boat for March',
        priority: 'high',
        assignee: 'maha',
        state: 'done',
        labels: ['Equipment'],
        milestone: 'Spring survey',
      },
      {
        title: 'Calibrate the echo sounder',
        priority: 'high',
        assignee: 'omar',
        state: 'done',
        labels: ['Equipment', 'Field work'],
        milestone: 'Spring survey',
        comments: [
          [
            'omar',
            'Calibrated against the bar check at 2 m and 5 m; within 3 cm.',
          ],
        ],
      },
      {
        title: 'Chart the northern channel',
        priority: 'urgent',
        assignee: 'omar',
        state: 'in_progress',
        due: 3,
        labels: ['Field work'],
        milestone: 'Spring survey',
        description:
          'Run lines every 10 m from the breakwater to buoy 4. Log tide height at the start and end of each run.',
        comments: [
          ['lina', 'Tide tables for the week are in the shared folder.'],
          ['omar', 'Two of six sections done; wind picked up after lunch.'],
        ],
      },
      {
        title: 'Chart the southern basin',
        priority: 'high',
        assignee: 'lina',
        state: 'todo',
        due: 6,
        labels: ['Field work'],
        milestone: 'Spring survey',
      },
      {
        title: 'Safety briefing for the boat crew',
        priority: 'urgent',
        assignee: 'maha',
        state: 'done',
        labels: ['Safety'],
      },
      {
        title: 'Check life jackets and flares',
        priority: 'medium',
        assignee: 'lina',
        state: 'in_review',
        due: 1,
        labels: ['Safety', 'Equipment'],
        comments: [
          ['lina', 'Two flares expire next month; ordered replacements.'],
        ],
      },
      {
        title: 'Apply for the port authority work permit',
        priority: 'high',
        assignee: 'maha',
        state: 'in_progress',
        due: -2,
        labels: ['Permits'],
        comments: [['maha', 'Submitted; they asked for the crew list again.']],
      },
      {
        title: 'Process soundings into a depth grid',
        priority: 'medium',
        assignee: 'omar',
        due: 10,
        milestone: 'Survey report',
      },
      {
        title: 'Compare depths with the 2024 survey',
        priority: 'medium',
        due: 14,
        milestone: 'Survey report',
      },
      {
        title: 'Draft the survey report',
        priority: 'high',
        assignee: 'maha',
        due: 18,
        milestone: 'Survey report',
      },
      {
        title: 'Share results with the dredging contractor',
        priority: 'medium',
        due: 21,
        milestone: 'Survey report',
      },
      {
        title: 'Replace the transducer mount bolts',
        priority: 'low',
        assignee: 'omar',
        labels: ['Equipment'],
      },
    ],
    {
      milestones: [
        ['Spring survey', 7],
        ['Survey report', 21],
      ],
      dependencies: [
        [8, 3],
        [8, 4],
        [9, 8],
        [10, 9],
        [11, 10],
        [3, 7],
      ],
    },
  );

  await project(
    'LHR',
    'Lighthouse restoration',
    'Repairs to the old harbour light before the summer season.',
    [
      {
        title: 'Inspect the lantern room glazing',
        priority: 'high',
        assignee: 'lina',
        state: 'done',
        labels: ['Safety'],
      },
      {
        title: 'Order replacement glass panels',
        priority: 'high',
        assignee: 'maha',
        state: 'in_progress',
        due: 5,
        labels: ['Equipment'],
      },
      {
        title: 'Repaint the gallery railing',
        priority: 'medium',
        assignee: 'omar',
        due: 30,
        milestone: 'Ready for summer',
      },
      {
        title: 'Test the backup light',
        priority: 'medium',
        assignee: 'lina',
        due: 12,
        milestone: 'Ready for summer',
        labels: ['Safety'],
      },
      {
        title: 'Heritage approval for the new door',
        priority: 'low',
        labels: ['Permits'],
      },
    ],
    { milestones: [['Ready for summer', 35]] },
  );

  // A project written in Arabic, to show the right-to-left interface with
  // real content (ADR-066).
  await project(
    'MRN',
    'تجديد مرسى القوارب',
    'إصلاح أرصفة المرسى وتحسين السلامة قبل موسم الصيد.',
    [
      {
        title: 'فحص الأرصفة الخشبية واستبدال التالف منها',
        priority: 'high',
        assignee: 'omar',
        state: 'in_progress',
        due: 4,
        labels: ['Safety'],
        comments: [
          ['omar', 'وجدنا ثلاثة ألواح متشققة عند الرصيف الشمالي.'],
          ['maha', 'ممتاز، سأطلب الألواح البديلة اليوم.'],
        ],
      },
      {
        title: 'طلب ألواح بديلة من المورد',
        priority: 'medium',
        assignee: 'maha',
        due: 6,
        labels: ['Equipment'],
      },
      {
        title: 'تركيب إنارة جديدة على الممرات',
        priority: 'medium',
        assignee: 'lina',
        due: 20,
        milestone: 'جاهز لموسم الصيد',
      },
      {
        title: 'الحصول على تصريح الأعمال من إدارة الميناء',
        priority: 'high',
        state: 'done',
        labels: ['Permits'],
      },
      {
        title: 'تدريب فريق المرسى على إجراءات الطوارئ',
        priority: 'low',
        assignee: 'lina',
        due: 25,
        milestone: 'جاهز لموسم الصيد',
        labels: ['Safety'],
      },
    ],
    {
      milestones: [['جاهز لموسم الصيد', 30]],
      dependencies: [[2, 1]],
    },
  );

  // Custom fields, a rule and a recurring task on the survey project.
  const depth = await call('demo', 'POST', `${hbr}/fields`, {
    name: 'Depth (m)',
    type: 'number',
  });
  const area = await call('demo', 'POST', `${hbr}/fields`, {
    name: 'Area',
    type: 'select',
    options: ['North channel', 'South basin', 'Entrance'],
  });
  for (const [n, d, a] of [
    [3, 7.5, 'North channel'],
    [4, 4.2, 'South basin'],
  ]) {
    await call('demo', 'PUT', `${hbr}/tasks/${n}/fields/${depth.id}`, {
      value: d,
    });
    await call('demo', 'PUT', `${hbr}/tasks/${n}/fields/${area.id}`, {
      value: a,
    });
  }
  await call('demo', 'POST', `${hbr}/automations`, {
    name: 'Urgent work goes to Maha',
    trigger: { type: 'task.created' },
    conditions: { priorities: ['urgent'] },
    actions: [
      { type: 'assign', userId: ids.maha },
      { type: 'add_label', labelId: label.Safety },
    ],
  });
  await call('demo', 'POST', `${hbr}/recurrences`, {
    title: 'Weekly boat engine check',
    frequency: 'weekly',
    priority: 'medium',
    assigneeId: ids.omar,
    dueInDays: 2,
    startsAt: inDays(2),
  });
  console.log('Seeded Harbour Works with three projects.');
}

await db.end();
console.log(`Demo sign-in: ${DEMO_EMAIL} / ${passwords.demo}`);
