/*
 * SpearmintLogAdapter — Quake III Arena (Spearmint engine) frag detection.
 *
 * Spearmint prints obituary lines to the process console (stdout/stderr) and, with
 * `g_log`, also to a log file. We parse the lines:
 *   "MM:SS Kill: <killerEnt> <victimEnt> <modCode>: <killerName> killed <victimName> by <MOD>"
 * Local splitscreen players are entities 0..3 → players 1..4. World/bot killers (e.g.
 * 4094 = <world>, or bot entities >= local player count) are ignored.
 *
 * Detection method (config.games.quake3.spearmint.detect):
 *   "stdout" (default) — parse the spawned process's stdout+stderr. Most robust: no log
 *                        file path to discover, no truncation handling, real-time.
 *   "log"             — tail the games.log file (fallback if a build doesn't echo kills).
 *
 * Config (config.games.quake3.spearmint):
 *   executablePath, fs_basepath, fs_homepath, fs_game, logRelPath, logName,
 *   splitClients, gametype, map, bots[], fraglimit, pollMs, playerMap, extraArgs,
 *   launchDelayMs, detect
 * config.games.quake3.debugLog - log every raw Kill line + parsed attribution.
 */

const { EventEmitter } = require('events');
const { spawn, exec } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');

class SpearmintLogAdapter extends EventEmitter {
  constructor(ctx) {
    super();
    this.ctx = ctx || {};
    this.game = this.ctx.game || {};
    // Merge platform-specific overrides (spearmint.win / .mac / .linux) over the base config,
    // so the same game entry works on macOS and Windows with different paths/launch methods.
    const baseCfg = this.game.spearmint || {};
    const platKey = process.platform === 'win32' ? 'win'
      : (process.platform === 'darwin' ? 'mac' : 'linux');
    this.cfg = Object.assign({}, baseCfg, baseCfg[platKey] || {});
    this.debug = !!this.game.debugLog;
    // macOS must launch via the .app bundle so the bundle's permissions apply (Input
    // Monitoring for controllers, etc.) — but that has no usable stdout, so it tails the log.
    // Windows/Linux spawn the executable directly (controllers work natively; no TCC).
    this.launchViaBundle = (this.cfg.launchViaBundle != null)
      ? this.cfg.launchViaBundle
      : (process.platform === 'darwin');
    this.detect = this.cfg.detect || (this.launchViaBundle ? 'log' : 'stdout');

    this.proc = null;          // child_process handle (raw mode) or the `open` launcher
    this.gamePid = null;       // resolved PID of the actual game process (bundle mode)
    this.gamePollTimer = null; // polls for game exit (bundle mode)
    this.seenRunning = false;
    this.procMatch = 'Contents/MacOS/spearmint'; // pgrep/pkill match for the game process
    this.onMemoryData = null;
    this.emitTimer = null;
    this.frags = [0, 0, 0, 0];     // cumulative frags per local player (entity 0..3)

    // stdout-detection line buffers
    this.outBuf = '';
    this.errBuf = '';

    // log-file-detection state
    this.tailTimer = null;
    this.logPath = null;
    this.readPos = 0;
    this.partial = '';

    // killer entity number -> player slot (1..4)
    this.playerMap = this.cfg.playerMap || { 0: 1, 1: 2, 2: 3, 3: 4 };
  }

  expandHome(p) {
    if (!p) return p;
    if (p === '~') return os.homedir();
    if (p.startsWith('~/')) return path.join(os.homedir(), p.slice(2));
    // Windows %ENVVAR% expansion (e.g. %USERPROFILE%, %APPDATA%)
    return p.replace(/%([^%]+)%/g, (m, v) => process.env[v] || m);
  }

  resolveHomePath() {
    return this.expandHome(this.cfg.fs_homepath) ||
      path.join(os.homedir(), 'Library', 'Application Support', 'Spearmint');
  }

  resolveLogPath() {
    const rel = this.cfg.logRelPath || 'baseq3/games.log';
    return path.join(this.resolveHomePath(), rel);
  }

  async launch() {
    const exe = this.expandHome(this.cfg.executablePath);
    if (!exe || !fs.existsSync(exe)) {
      this.emit('error', `Spearmint executable not found: ${exe || '(unset)'}`);
      return;
    }
    this.logPath = this.resolveLogPath();
    console.log('🎮 Spearmint launching:', exe);
    console.log('   frag detection:', this.detect, this.detect === 'log' ? `(log: ${this.logPath})` : '(stdout)');

    // A launch profile selects player count / main menu (from the in-app buttons).
    //   { menu: true }   -> boot to the main menu (no map); set up players manually
    //   { players: N }   -> load the map, then add local splitscreen players 2..N via
    //                       Spearmint's `<n>dropin` console commands (player 1 is automatic).
    // No profile -> config default player count + map (plain Deploy).
    // NOTE: each splitscreen player needs a controller connected BEFORE launch and bound
    // once in Setup -> Controls -> Player # -> Joy (Spearmint requirement).
    const profile = this.ctx.profile || {};
    let players = (typeof this.cfg.defaultPlayers === 'number' ? this.cfg.defaultPlayers : 4);
    let loadMap = !!this.cfg.map;
    if (profile.menu) {
      players = 1;
      loadMap = false;
    } else if (typeof profile.players === 'number') {
      players = Math.max(1, Math.min(4, profile.players));
    }
    console.log(`   profile: ${profile.label || (profile.menu ? 'menu' : players + 'p')} (players=${players}, map=${loadMap ? this.cfg.map : 'none'})`);

    const args = [
      '+set', 'g_gametype', String(this.cfg.gametype != null ? this.cfg.gametype : 0),
      '+set', 'g_log', String(this.cfg.logName || 'games.log'),
      '+set', 'g_logSync', '1', // 1 = flush every line immediately (required for live tailing)
      '+set', 'fraglimit', String(this.cfg.fraglimit != null ? this.cfg.fraglimit : 0)
    ];
    if (this.cfg.fs_homepath) args.push('+set', 'fs_homepath', this.resolveHomePath());
    if (this.cfg.fs_basepath) args.push('+set', 'fs_basepath', this.expandHome(this.cfg.fs_basepath));
    if (this.cfg.fs_game) args.push('+set', 'fs_game', this.cfg.fs_game);

    // Deploy + exec default gamepad bindings (best-guess Xbox config for all players).
    if (this.cfg.gamepadConfig) {
      try {
        const src = path.join(this.ctx.appDir || process.cwd(), 'spearmint', this.cfg.gamepadConfig);
        const destDir = path.join(this.resolveHomePath(), this.cfg.fs_game || 'baseq3');
        if (fs.existsSync(src)) {
          fs.mkdirSync(destDir, { recursive: true });
          fs.copyFileSync(src, path.join(destDir, this.cfg.gamepadConfig));
          args.push('+exec', this.cfg.gamepadConfig);
          console.log('   gamepad config:', this.cfg.gamepadConfig);
        } else {
          console.log('   gamepad config not found at', src);
        }
      } catch (e) {
        console.log('   gamepad config deploy failed:', e.message);
      }
    }

    // Display: Spearmint's SDL window can't be repositioned by macOS window APIs (unlike
    // RetroArch), so side-by-side isn't possible. Default to fullscreen (best for splitscreen);
    // the GoldenPie panel lives on another Space (Mission Control / Cmd-Tab). `fullscreen:false`
    // launches a borderless window sized to the area left of the control panel (opens centred;
    // drag it over manually if you want it on the left).
    const geo = this.ctx.windowGeometry;
    if (this.cfg.fullscreen) {
      args.push('+set', 'r_fullscreen', '1', '+set', 'r_mode', '-2'); // desktop-resolution fullscreen
    } else if (geo) {
      args.push(
        '+set', 'r_fullscreen', '0',
        '+set', 'r_mode', '-1',
        '+set', 'r_customwidth', String(geo.width),
        '+set', 'r_customheight', String(geo.height),
        '+set', 'r_noborder', '0', // bordered so it can be dragged (window can't be auto-positioned)
        '+set', 'r_centerWindow', '1'
      );
    }

    if (loadMap) {
      args.push('+map', this.cfg.map);
      (this.cfg.bots || []).forEach(b => args.push('+addbot', ...String(b).split(/\s+/)));
      // Add local splitscreen players 2..N once the map has loaded (wait a beat first).
      if (players > 1) {
        args.push('+wait', String(this.cfg.splitWaitFrames != null ? this.cfg.splitWaitFrames : 200));
        for (let p = 2; p <= players; p++) args.push('+' + p + 'dropin');
      }
    }
    if (Array.isArray(this.cfg.extraArgs)) args.push(...this.cfg.extraArgs);

    const launchDelay = this.cfg.launchDelayMs || 6000;
    if (this.launchViaBundle) {
      // Launch via the .app bundle so macOS applies its permissions (Input Monitoring, etc.).
      const idx = exe.indexOf('.app');
      const bundle = idx !== -1 ? exe.slice(0, idx + 4) : exe;
      console.log('   launching via bundle:', bundle);
      try {
        this.proc = spawn('open', ['-n', bundle, '--args', ...args]);
      } catch (e) {
        this.emit('error', `Failed to launch Spearmint: ${e.message}`);
        return;
      }
      this.proc.on('error', (e) => this.emit('error', `Spearmint launch error: ${e.message}`));
      // `open` returns immediately; watch the real game process to detect exit.
      this.gamePollTimer = setInterval(() => this._pollGameProcess(), 1500);
    } else {
      // Raw-binary launch (stdout frag detection). macOS won't apply the bundle's
      // Input Monitoring grant this way, so controllers may not work.
      try {
        this.proc = spawn(exe, args, { cwd: path.dirname(exe) });
      } catch (e) {
        this.emit('error', `Failed to launch Spearmint: ${e.message}`);
        return;
      }
      this.proc.on('error', (e) => this.emit('error', `Spearmint process error: ${e.message}`));
      this.proc.on('close', () => this.emit('exit'));
      // Only parse stdout when that's the detection method (Windows GUI builds may not
      // pipe to stdout — they use log-file detection instead).
      if (this.detect === 'stdout') {
        if (this.proc.stdout) this.proc.stdout.on('data', (d) => this._ingest('out', d.toString()));
        if (this.proc.stderr) this.proc.stderr.on('data', (d) => this._ingest('err', d.toString()));
      }
    }

    // Give the engine a few seconds to boot the map before we start a session.
    setTimeout(() => this.emit('ready'), launchDelay);
  }

  // Bundle mode: `open` exits immediately, so poll for the real game process and
  // emit 'exit' once it has appeared and then disappeared.
  _pollGameProcess() {
    exec(`pgrep -f "${this.procMatch}"`, (err, stdout) => {
      const running = !err && stdout && stdout.trim().length > 0;
      if (running) {
        this.seenRunning = true;
        const pid = parseInt(stdout.trim().split('\n')[0], 10);
        if (pid) this.gamePid = pid;
      } else if (this.seenRunning) {
        if (this.gamePollTimer) { clearInterval(this.gamePollTimer); this.gamePollTimer = null; }
        this.emit('exit');
      }
    });
  }

  getProcess() {
    if (!this.launchViaBundle) return this.proc;
    // Bundle mode: a stub that kills the real game process (we don't own its handle).
    const self = this;
    if (!this.seenRunning && !this.gamePid && !this.proc) return null;
    return {
      pid: this.gamePid,
      kill() {
        if (self.gamePid) { try { process.kill(self.gamePid, 'SIGKILL'); } catch (_) {} }
        exec(`pkill -f "${self.procMatch}"`, () => {});
      }
    };
  }

  startPolling(onMemoryData) {
    this.onMemoryData = onMemoryData;
    this.frags = [0, 0, 0, 0]; // fresh match

    if (this.detect === 'log') {
      // Start tailing the log file from its current end (ignore prior-match lines).
      this.partial = '';
      try { this.readPos = (this.logPath && fs.existsSync(this.logPath)) ? fs.statSync(this.logPath).size : 0; }
      catch (_) { this.readPos = 0; }
      this.tailTimer = setInterval(() => this._tailTick(), this.cfg.pollMs || 750);
    }

    // Periodic emit so the UI shows live counts even between kills.
    this.emitTimer = setInterval(() => this._emit(), this.cfg.emitMs || 1000);
    this._emit();
  }

  // ---- stdout/stderr detection ----
  _ingest(stream, text) {
    const key = stream === 'err' ? 'errBuf' : 'outBuf';
    this[key] += text;
    const lines = this[key].split('\n');
    this[key] = lines.pop();
    for (const line of lines) this._parseLine(line);
  }

  // ---- log-file detection (fallback) ----
  _tailTick() {
    try {
      if (!this.logPath || !fs.existsSync(this.logPath)) return;
      const size = fs.statSync(this.logPath).size;
      if (size < this.readPos) { // truncated/new match
        if (this.debug) console.log('[SPEARMINT] log truncated — resetting frags');
        this.readPos = 0; this.partial = ''; this.frags = [0, 0, 0, 0];
      }
      if (size > this.readPos) {
        const fd = fs.openSync(this.logPath, 'r');
        const buf = Buffer.alloc(size - this.readPos);
        fs.readSync(fd, buf, 0, buf.length, this.readPos);
        fs.closeSync(fd);
        this.readPos = size;
        const lines = (this.partial + buf.toString('utf8')).split('\n');
        this.partial = lines.pop();
        for (const line of lines) this._parseLine(line);
      }
    } catch (e) {
      if (this.debug) console.log('[SPEARMINT] tail error:', e.message);
    }
  }

  _parseLine(line) {
    if (/InitGame:/.test(line)) {
      if (this.debug) console.log('[SPEARMINT] InitGame — resetting frag counts');
      this.frags = [0, 0, 0, 0];
      this._emit();
      return;
    }
    const m = line.match(/Kill:\s+(\d+)\s+(\d+)\s+(-?\d+):/);
    if (!m) return;
    const killer = parseInt(m[1], 10);
    const victim = parseInt(m[2], 10);
    if (this.debug) console.log(`[SPEARMINT KILL] killer=${killer} victim=${victim} | ${line.trim()}`);
    if (killer === victim) return;             // suicide / world death → no reward
    if (!(killer in this.playerMap)) return;   // bot/world killer → not a local player
    const playerN = this.playerMap[killer];    // 1..4
    if (playerN >= 1 && playerN <= 4) {
      this.frags[playerN - 1] += 1;
      this._emit();
    }
  }

  _emit() {
    if (!this.onMemoryData) return;
    this.onMemoryData({
      player1: this.frags[0], player2: this.frags[1], player3: this.frags[2], player4: this.frags[3],
      player1Headshots: 0, player2Headshots: 0, player3Headshots: 0, player4Headshots: 0,
      player1Deaths: 0, player2Deaths: 0, player3Deaths: 0, player4Deaths: 0
    });
  }

  stopPolling() {
    this.onMemoryData = null;
    if (this.tailTimer) { clearInterval(this.tailTimer); this.tailTimer = null; }
    if (this.emitTimer) { clearInterval(this.emitTimer); this.emitTimer = null; }
    if (this.gamePollTimer) { clearInterval(this.gamePollTimer); this.gamePollTimer = null; }
  }
}

module.exports = { SpearmintLogAdapter };
