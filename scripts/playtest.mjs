// /playtest launcher: starts a game's dev server and prints the LAN URL +
// an ASCII QR code so real phones can join instantly (spec §6.2).
//
//   node scripts/playtest.mjs <game>     (default: hello)
//
// Phones must be on the same Wi-Fi as this machine. Ctrl-C stops it.
import { spawn } from 'node:child_process';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import qrcode from 'qrcode-terminal';

const game = process.argv[2] ?? 'hello';
const pkgPath = `games/${game}/package.json`;
if (!existsSync(pkgPath)) {
  console.error(`No such game "${game}". Available: ${readdirSync('games').join(', ')}`);
  process.exit(1);
}
const pkgName = JSON.parse(readFileSync(pkgPath, 'utf8')).name;

const proc = spawn('pnpm', ['--filter', pkgName, 'dev'], { stdio: ['ignore', 'pipe', 'inherit'] });

let printed = false;
proc.stdout.on('data', (chunk) => {
  const s = chunk.toString();
  process.stdout.write(s);
  const m = /Network:\s+(http:\/\/[\d.]+:\d+\/)/.exec(s);
  if (m?.[1] && !printed) {
    printed = true;
    const url = m[1];
    console.log(`\n📱 Scan to playtest on a phone (same Wi-Fi):  ${url}\n`);
    qrcode.generate(url, { small: true });
  }
});

proc.on('exit', (code) => process.exit(code ?? 0));
process.on('SIGINT', () => proc.kill('SIGINT'));
