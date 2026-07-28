#!/usr/bin/env node
/**
 * GoldenPie doctor — dumps everything needed to debug a Quake III (Spearmint) setup.
 *
 *   node scripts/windows-doctor.js
 *
 * Cross-platform (named for its main use: bringing up a Windows box), safe to paste the output
 * anywhere: it reports whether payment settings EXIST but never prints keys or balances.
 */

const fs = require('fs');
const path = require('path');
const os = require('os');

const ROOT = path.join(__dirname, '..');
const ok = (b) => (b ? 'OK' : 'MISSING');
function head(t) { console.log('\n=== ' + t + ' ' + '='.repeat(Math.max(0, 60 - t.length))); }
function line(k, v) { console.log('  ' + String(k).padEnd(26) + (v == null ? '' : v)); }

// Same path expansion + platform-overlay merge the adapter and main process use.
function expandUserPath(p) {
  if (!p) return p;
  let out = String(p);
  if (out.startsWith('~')) out = path.join(os.homedir(), out.slice(1));
  return out.replace(/%([^%]+)%/g, (m, v) => process.env[v] || m);
}
function platKey() {
  return process.platform === 'win32' ? 'win' : (process.platform === 'darwin' ? 'mac' : 'linux');
}

head('ENVIRONMENT');
line('platform', process.platform + ' ' + process.arch + ' (' + os.release() + ')');
line('node', process.version);
line('repo', ROOT);
try {
  const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
  line('app version', pkg.version);
  line('electron', (pkg.devDependencies && pkg.devDependencies.electron) || '(not in devDependencies)');
} catch (e) { line('package.json', 'UNREADABLE: ' + e.message); }
line('node_modules', ok(fs.existsSync(path.join(ROOT, 'node_modules'))));

let config;
try {
  config = JSON.parse(fs.readFileSync(path.join(ROOT, 'config.json'), 'utf8'));
} catch (e) {
  console.error('\nFATAL: cannot read config.json: ' + e.message);
  process.exit(1);
}

const game = (config.games && config.games.quake3) || null;
if (!game) { console.error('\nFATAL: no games.quake3 in config.json'); process.exit(1); }

const base = game.spearmint || {};
const sp = Object.assign({}, base, base[platKey()] || {});
const modDir = sp.fs_game || 'baseq3';
const homeRoot = expandUserPath(sp.fs_homepath);
const baseRoot = expandUserPath(sp.fs_basepath);
const exe = expandUserPath(sp.executablePath);

head('RESOLVED SPEARMINT PATHS (overlay: ' + platKey() + ')');
line('executablePath', exe);
line('  exists', ok(exe && fs.existsSync(exe)));
line('fs_basepath', baseRoot);
line('  exists', ok(baseRoot && fs.existsSync(baseRoot)));
line('fs_homepath', homeRoot);
line('  exists', ok(homeRoot && fs.existsSync(homeRoot)));
line('fs_game (mod dir)', modDir);
line('detect mode', sp.detect || '(default)');
line('fullscreen', String(sp.fullscreen));
line('fillGameArea', String(sp.fillGameArea));

// --- Game content: pak files (must be present for Q3 to run) and installed pk3s ---
head('INSTALLED CONTENT (.pk3)');
for (const root of [baseRoot, homeRoot]) {
  if (!root) continue;
  const dir = path.join(root, modDir);
  console.log('  ' + dir);
  if (!fs.existsSync(dir)) { console.log('    (dir does not exist)'); continue; }
  let files;
  try { files = fs.readdirSync(dir); } catch (e) { console.log('    UNREADABLE: ' + e.message); continue; }
  const pk3s = files.filter(f => f.toLowerCase().endsWith('.pk3')).sort();
  if (!pk3s.length) console.log('    (no .pk3 files)');
  pk3s.forEach(f => {
    let sz = '';
    try { sz = (fs.statSync(path.join(dir, f)).size / 1048576).toFixed(1) + ' MB'; } catch (_) {}
    console.log('    ' + f.padEnd(34) + sz);
  });
  const hasPak0 = pk3s.some(f => /^pak0\.pk3$/i.test(f));
  if (hasPak0) console.log('    -> pak0.pk3 present (retail Quake III data found here)');
}
const anyPak0 = [baseRoot, homeRoot].filter(Boolean).some(r => fs.existsSync(path.join(r, modDir, 'pak0.pk3')));
if (!anyPak0) console.log('  !! pak0.pk3 not found in either root — Quake III will not run without retail data.');

// --- Map availability (mirrors the get-map-availability IPC) ---
head('MAP AVAILABILITY (level select)');
const roots = [homeRoot, baseRoot].filter(Boolean);
(sp.maps || []).forEach(m => {
  if (!m || !m.id) return;
  if (!m.requiresPk3) { line(m.id, 'stock (always available)'); return; }
  const searched = roots.map(r => path.join(r, modDir, m.requiresPk3));
  const found = searched.some(f => { try { return fs.existsSync(f); } catch (_) { return false; } });
  line(m.id, (found ? 'AVAILABLE' : 'GREYED OUT') + ' — needs ' + m.requiresPk3);
  if (!found) searched.forEach(s => console.log('      copy it to: ' + s));
});

// --- Deployed gamepad config (written at launch; proves binds/cvars reached the engine) ---
head('DEPLOYED GAMEPAD CONFIG');
const cfgName = sp.gamepadConfig;
if (!cfgName) {
  console.log('  (no gamepadConfig configured)');
} else {
  const deployed = homeRoot ? path.join(homeRoot, modDir, cfgName) : null;
  line('source (repo)', path.join(ROOT, 'spearmint', cfgName));
  line('  exists', ok(fs.existsSync(path.join(ROOT, 'spearmint', cfgName))));
  line('deployed', deployed);
  line('  exists', ok(deployed && fs.existsSync(deployed)));
  if (deployed && fs.existsSync(deployed)) {
    let txt = '';
    try { txt = fs.readFileSync(deployed, 'utf8'); } catch (_) {}
    const analog = (txt.match(/seta (\d?)in_joystickUseAnalog "(\d)"/g) || []).join(', ');
    line('  useAnalog lines', analog || '(none)');
    line('  P1 binds', (txt.match(/bind JOY_\w+/g) || []).length);
    ['2', '3', '4'].forEach(n => {
      line('  P' + n + ' binds', (txt.match(new RegExp('bind ' + n + 'JOY_\\w+', 'g')) || []).length +
        ' (prefixed cmds: ' + (txt.match(new RegExp('"\\+' + n + '\\w+"', 'g')) || []).length + ')');
    });
    const pitch = txt.match(/seta cg_pitchspeed(analog)? "([\d.]+)"/);
    line('  pitch speed', pitch ? pitch[0] : '(not set)');
  } else {
    console.log('  -> Launch the game once; the adapter writes this file at launch.');
  }
}

// --- Bot setup ---
head('BOTS');
line('config botCount', String(sp.botCount));
line('config botSkill', String(sp.botSkill) + '  (default for a fresh install)');
const gpFile = path.join(ROOT, '.gameplay-settings.json');
if (fs.existsSync(gpFile)) {
  try {
    const gp = JSON.parse(fs.readFileSync(gpFile, 'utf8'));
    line('settings botSkill', gp.botSkill != null ? String(gp.botSkill) + '  (OVERRIDES config)' : '(not set)');
  } catch (e) { line('settings file', 'UNREADABLE: ' + e.message); }
} else {
  line('settings botSkill', '(not set yet — using config default)');
}
const botFix = sp.botFixPk3;
if (botFix) {
  line('bot-fix pk3 (repo)', ok(fs.existsSync(path.join(ROOT, 'spearmint', botFix))));
  line('bot-fix pk3 (deployed)', ok(homeRoot && fs.existsSync(path.join(homeRoot, modDir, botFix))));
}

// --- Local app state: existence only, never contents (keys/balances stay private) ---
head('APP STATE (existence only — no contents printed)');
[['.bitcoin-settings.enc', 'payment settings (encrypted)'],
 ['.player-sessions.enc', 'linked player addresses'],
 ['.player-balances.json', 'unlinked balances'],
 ['.current-pot.json', 'in-flight pot'],
 ['.gameplay-settings.json', 'gameplay prefs'],
 ['.selected-game.json', 'active game']].forEach(([f, desc]) => {
  line(f, ok(fs.existsSync(path.join(ROOT, f))) + '  — ' + desc);
});
console.log('  NOTE: if an in-flight pot exists, buy-ins may be held. Settle or cancel it in-app.');

// --- Engine logs: the most useful signal when something fails ---
head('ENGINE LOGS');
if (!homeRoot) {
  console.log('  (no fs_homepath configured)');
} else {
  const logDir = path.join(homeRoot, modDir);
  const interesting = /(BotLoad|BotAI|Hunk_Alloc|couldn't load|could not load|ERROR|Bad cvar|not found|SDL|joystick|Joystick|no controller|InitGame|ShutdownGame|Kill:)/;
  ['games.log', 'console.log', 'qconsole.log'].forEach(name => {
    const f = path.join(logDir, name);
    console.log('  ' + f + '  [' + ok(fs.existsSync(f)) + ']');
    if (!fs.existsSync(f)) return;
    let txt = '';
    try { txt = fs.readFileSync(f, 'utf8'); } catch (e) { console.log('    UNREADABLE: ' + e.message); return; }
    const lines = txt.split(/\r?\n/).filter(Boolean);
    line('    total lines', String(lines.length));
    const hits = lines.filter(l => interesting.test(l));
    console.log('    --- notable lines (last 25 of ' + hits.length + ') ---');
    hits.slice(-25).forEach(l => console.log('    | ' + l.slice(0, 200)));
    console.log('    --- tail (last 12) ---');
    lines.slice(-12).forEach(l => console.log('    | ' + l.slice(0, 200)));
  });
}

head('DONE');
console.log('  Paste this whole output into the Claude Code session to debug.');
console.log('  It contains no API keys, invoices, or balances.\n');
