import { spawnSync } from 'node:child_process';
function run(command, args) {
  const result = spawnSync(command, args, { stdio: 'inherit', env: process.env });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
}
// Vercel builds the generated eve service separately. Self-hosts need its Node output.
if (!process.env.VERCEL) run('node_modules/.bin/eve', ['build']);
run('node_modules/.bin/next', ['build']);
