import { readdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
for (const file of readdirSync('contracts').filter(f => f.endsWith('.py'))) {
  const result = spawnSync('genvm-lint', ['check', `contracts/${file}`], { stdio: 'inherit' });
  if (result.status !== 0) process.exit(result.status || 1);
}
