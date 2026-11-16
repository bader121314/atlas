import { spawn, spawnSync } from 'node:child_process';
import assert from 'node:assert/strict';

async function main() {
  if (!process.env.npm_execpath) throw new Error('Run with pnpm smoke:dev');
  const child = spawn(process.execPath, [process.env.npm_execpath, 'dev'], {
    detached: process.platform !== 'win32',
    env: {
      ...process.env,
      NODE_ENV: 'development',
      API_PORT: '3101',
      WORKER_PORT: '3102',
      DATABASE_URL: 'postgresql://smoke@127.0.0.1:1/unavailable',
      REDIS_URL: 'redis://127.0.0.1:1',
      NEXT_TELEMETRY_DISABLED: '1',
      TURBO_TELEMETRY_DISABLED: '1',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let output = '';
  for (const stream of [child.stdout, child.stderr]) {
    stream.on('data', (data) => {
      output = (output + data).slice(-12000);
    });
  }
  try {
    const urls = [
      ['http://127.0.0.1:3000/health/live', 'web'],
      ['http://127.0.0.1:3101/v1/health/live', 'api'],
      ['http://127.0.0.1:3102/v1/health/live', 'worker'],
    ];
    for (let attempt = 0; ; attempt++) {
      try {
        for (const [url, service] of urls) {
          const response = await fetch(url, {
            signal: AbortSignal.timeout(2000),
          });
          assert.equal(response.status, 200);
          assert.deepEqual(await response.json(), { status: 'ok', service });
        }
        const home = await fetch('http://127.0.0.1:3000');
        assert.equal(home.status, 200);
        assert.match(await home.text(), /A foundation for better teamwork/);
        break;
      } catch (error) {
        if (attempt >= 40 || child.exitCode !== null) throw error;
        await new Promise((resolve) => setTimeout(resolve, 500));
      }
    }
    console.log(
      'PASS: pnpm dev serves web, API and worker health plus the home page.',
    );
  } catch (error) {
    console.error(output);
    throw error;
  } finally {
    if (child.pid) {
      if (process.platform === 'win32') {
        spawnSync('taskkill', ['/pid', String(child.pid), '/t', '/f'], {
          stdio: 'ignore',
        });
      } else {
        process.kill(-child.pid, 'SIGTERM');
      }
    }
  }
}
main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
