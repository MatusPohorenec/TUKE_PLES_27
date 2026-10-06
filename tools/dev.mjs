// npm run dev: API (http://localhost:8787) and web (http://localhost:5173) side by side, prefixed output.
import { spawn } from 'node:child_process';

const procs = [
  ['api', ['run', 'dev', '-w', '@ples/api'], '\x1b[35m'],
  ['web', ['run', 'dev', '-w', '@ples/web'], '\x1b[36m'],
].map(([name, args, color]) => {
  const p = spawn(process.platform === 'win32' ? 'npm.cmd' : 'npm', args, { stdio: ['ignore', 'pipe', 'pipe'], shell: process.platform === 'win32' });
  const out = chunk => chunk.toString().split(/\r?\n/).filter(Boolean).forEach(line => console.log(`${color}[${name}]\x1b[0m ${line}`));
  p.stdout.on('data', out);
  p.stderr.on('data', out);
  p.on('exit', code => { console.log(`[${name}] exited with ${code}`); procs.forEach(o => o !== p && o.kill()); process.exit(code ?? 0); });
  return p;
});

process.on('SIGINT', () => procs.forEach(p => p.kill()));
