import { spawn } from 'child_process';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DASHBOARD_DIR = join(__dirname, '..', '..', '..', 'dashboard');

export async function run(args: string[]) {
  const port = args.find(a => a.startsWith('--port='))?.split('=')[1] ?? '4242';
  console.log(`\n  Starting Token Optimizer Dashboard on http://localhost:${port}\n`);

  const proc = spawn('npm', ['run', 'dev', '--', '-p', port], {
    cwd: DASHBOARD_DIR,
    stdio: 'inherit',
    env: { ...process.env, PORT: port },
  });

  proc.on('error', (e) => {
    console.error(`\n  Dashboard error: ${e.message}`);
    console.error(`  Make sure dashboard is built: cd packages/dashboard && npm install\n`);
  });

  process.on('SIGINT', () => { proc.kill(); process.exit(0); });
}
