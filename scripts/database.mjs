import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const commands = {
  validate: ['validate'],
  generate: ['generate'],
  migrate: ['migrate', 'deploy'],
};
const args = commands[process.argv[2]];
if (!args) throw new Error('Unknown database command');
const cwd = fileURLToPath(new URL('../packages/database', import.meta.url));
const result = spawnSync(
  process.execPath,
  [path.join(cwd, 'node_modules/prisma/build/index.js'), ...args],
  { cwd, env: process.env, stdio: 'inherit' },
);
if (result.error) throw result.error;
process.exitCode = result.status ?? 1;
