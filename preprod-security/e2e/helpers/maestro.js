// Pokreće Maestro flow na emulatoru robotik_sec (ili telefonu iz ANDROID_SERIAL) iz Playwright testa.
const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const { JAVA_HOME, ANDROID_HOME, MAESTRO_BIN, MAESTRO_DIR, OUT_DIR, SERIAL, ADB } = require('./env');

// Na Windows-u se .bat pokreće kroz shell, pa svaki argument ide pod navodnike
const q = (s) => `"${String(s).replace(/"/g, '\\"')}"`;

// takeScreenshot iz flow-a upisuje sliku u shotsDir (podrazumevano folder sa izlazom tog pokretanja)
function runFlow(flowFile, vars = {}, { timeoutMs = 6 * 60 * 1000, shotsDir } = {}) {
  const flow = path.isAbsolute(flowFile) ? flowFile : path.join(MAESTRO_DIR, flowFile);
  const debugDir = path.join(OUT_DIR, 'maestro', `${path.basename(flow, '.yaml')}-${Date.now()}`);
  fs.mkdirSync(debugDir, { recursive: true });
  const cwd = shotsDir || debugDir;
  fs.mkdirSync(cwd, { recursive: true });
  const args = ['--device', SERIAL, 'test', flow, '--debug-output', debugDir, '--flatten-debug-output'];
  for (const [k, v] of Object.entries(vars)) args.push('-e', `${k}=${v}`);
  const res = spawnSync(`${q(MAESTRO_BIN)} ${args.map(q).join(' ')}`, {
    shell: true,
    cwd,
    encoding: 'utf8',
    timeout: timeoutMs,
    env: {
      ...process.env,
      JAVA_HOME,
      ANDROID_HOME,
      ANDROID_SERIAL: SERIAL,
      MAESTRO_CLI_NO_ANALYTICS: '1',
      PATH: [path.join(JAVA_HOME, 'bin'), path.join(ANDROID_HOME, 'platform-tools'), process.env.PATH].join(path.delimiter),
    },
  });
  const out = `${res.stdout || ''}\n${res.stderr || ''}`;
  fs.writeFileSync(path.join(debugDir, 'maestro-output.txt'), out);
  if (res.status !== 0) throw new Error(`[maestro] flow ${path.basename(flow)} nije prošao (exit ${res.status}). Detalji: ${debugDir}\n${out.slice(-2500)}`);
  return out;
}

// adb samo na naš uređaj
function adb(...args) {
  const res = spawnSync(ADB, ['-s', SERIAL, ...args], { encoding: 'utf8', timeout: 60000 });
  if (res.status !== 0) throw new Error(`[adb] ${args.join(' ')}: ${res.stderr || res.stdout}`);
  return res.stdout;
}

function screenshot(file) {
  const res = spawnSync(ADB, ['-s', SERIAL, 'exec-out', 'screencap', '-p'], { encoding: 'buffer', timeout: 60000, maxBuffer: 64 * 1024 * 1024 });
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, res.stdout);
  return file;
}

module.exports = { runFlow, adb, screenshot };
