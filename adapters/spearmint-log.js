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
 *   executablePath, fs_basepath, fs_homepath, fs_game, logRelPath, logName, gamepadConfig,
 *   botFixPk3, gametype, map, bots[], botCount, botSkill, botPool[], fraglimit, pollMs,
 *   extraArgs, launchDelayMs, detect, lookSensitivity, stickDeadzone, fireButton
 * config.games.quake3.debugLog - log every raw Kill line + parsed attribution.
 */

const { EventEmitter } = require('events');
const { spawn, exec } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');

// Where buildGamepadTuning()'s output is spliced into the deployed gamepad cfg.
const TUNING_MARKER = '// @goldenpie:tuning';

// Look-speed baselines = 1.0x. deg/sec at full stick deflection.
// 200 is the engine default for BOTH analog cvars; we run pitch at 150 (0.75x) on purpose because
// pitch is clamped to ~+/-90 deg while yaw is a full 360, so equal angular speed feels twitchier
// vertically. 150 is therefore OUR 1.0x pitch baseline — do not "restore the engine default" to 200.
// The digital pair are the stock engine values, kept symmetric so 1.0x is identical to stock in the
// in_joystickUseAnalog 0 fallback (which is what a locally built macOS engine may still run).
const LOOK_BASE = { yawAnalog: 200, pitchAnalog: 150, yawDigital: 140, pitchDigital: 140 };

// DO NOT ADD "MOVE SENSITIVITY" CVARS HERE — none exist in this engine.
// CG_KeyMove in the shipped vm/mint-cgame.qvm hardcodes movespeed 127 (run) / 64 (walk) and clamps
// the result into the usercmd's signed-byte forwardmove/rightmove/upmove. No cvar participates
// except cl_run (which only picks 127 vs 64). Verified ABSENT from spearmint_x86_64.exe,
// spearmint_x86.exe, vm/mint-cgame.qvm and vm/mint-game.qvm: j_forward, j_side, j_pitch, j_yaw,
// j_up, cl_yawspeed, cl_pitchspeed, in_joystickSensitivity, cl_movespeedscale. The mouse cvars
// (sensitivity, m_yaw, m_pitch, m_forward, m_side) never see stick input — sticks arrive as virtual
// keys, not mouse deltas. The only knob over how movement RESPONDS is the deadzone below.
const CLAMP = {
  lookPct: [30, 250],     // user-facing percent
  deadPct: [5, 35],       // user-facing percent of axis span; 0 would mean constant drift
  lookSpeed: [30, 600],   // backstop on the resolved deg/sec — never <= 0 (reads as a dead pad)
  deadzoneMax: 0.45       // the cgame rescales by 1/(1-t); t=1 divides by zero, >0.5 throws away half the travel
};

// parseInt-with-default that does NOT turn a legitimate 0 into the default (unlike `parseInt(x) || d`).
function clampInt(value, min, max, dflt) {
  const n = parseInt(value, 10);
  if (!Number.isFinite(n)) return dflt;
  return Math.max(min, Math.min(max, n));
}

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

    // Frag attribution. Client numbers interleave: a dropped-in local player can connect AFTER
    // the bots and get a high client number, while bots take low ones — so we CANNOT assume
    // clients 0..N-1 are the humans. Instead we classify from the log: bots have `\skill\` in
    // their userinfo, humans never do. Humans are mapped to player slots 1..N in the order they
    // first connect. Rebuilt each match (on InitGame) and on startPolling().
    this.botClients = new Set();   // client numbers known to be bots
    this.humanOrder = [];          // human client numbers, first-seen order -> slot index
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

  // Generate per-player gamepad key binds. Each local player has its own joystick key codes
  // (JOY_* = player 1, 2JOY_*/3JOY_*/4JOY_* = players 2-4) AND must bind them to that player's
  // PREFIXED command — Spearmint resolves which player a command moves from the command NAME, not
  // the key (e.g. +forward always moves player 1; player 2 needs +2forward, player 3 +3forward...).
  // The prefix number goes right after a leading +/-, else at the start (weapnext -> 2weapnext).
  // invertY swaps the stick-Y commands for macOS's GameController axes (physical-up = forward/lookup).
  // fireButton 'bumper' swaps +attack onto RIGHTSHOULDER (and weapnext onto the trigger). The engine
  // uses ONE deadzone for sticks and triggers (in_joystickThreshold), so a raised deadzone also
  // firms up the trigger pull; moving fire to a digital button is the only way to decouple them.
  buildGamepadBinds(invertY, fireButton) {
    const bumperFire = fireButton === 'bumper';
    const layout = [
      ['LEFTSTICK_UP',     invertY ? '+back' : '+forward'],
      ['LEFTSTICK_DOWN',   invertY ? '+forward' : '+back'],
      ['LEFTSTICK_LEFT',   '+moveleft'],
      ['LEFTSTICK_RIGHT',  '+moveright'],
      ['RIGHTSTICK_LEFT',  '+left'],
      ['RIGHTSTICK_RIGHT', '+right'],
      ['RIGHTSTICK_UP',    invertY ? '+lookdown' : '+lookup'],
      ['RIGHTSTICK_DOWN',  invertY ? '+lookup' : '+lookdown'],
      ['RIGHTTRIGGER',     bumperFire ? 'weapnext' : '+attack'],
      ['LEFTTRIGGER',      '+zoom'], // hold-to-use; an early activation point is harmless
      ['A',                '+moveup'],
      ['B',                '+movedown'],
      ['RIGHTSHOULDER',    bumperFire ? '+attack' : 'weapnext'],
      ['LEFTSHOULDER',     'weapprev'],
      ['START',            '+scores']
    ];
    const lines = ['// --- per-player gamepad binds (generated; prefixed commands route to each player) ---'];
    for (let p = 0; p < 4; p++) {
      const keyPrefix = p === 0 ? 'JOY_' : `${p + 1}JOY_`;
      const num = p === 0 ? '' : String(p + 1); // command player-prefix number
      lines.push(`// Player ${p + 1}`);
      for (const [suffix, cmd] of layout) {
        // number goes after a leading +/- ("+forward"->"+2forward"); else at the start ("weapnext"->"2weapnext")
        const pcmd = (cmd[0] === '+' || cmd[0] === '-')
          ? cmd[0] + num + cmd.slice(1)
          : num + cmd;
        lines.push(`bind ${keyPrefix}${suffix} "${pcmd}"`);
      }
    }
    return lines.join('\n') + '\n';
  }

  // Resolve the controller "feel" settings once per launch. Precedence mirrors botSkill:
  // settings-page override (ctx.*) -> game config (already platform-merged in the constructor,
  // so a firmer Windows-only default is free later) -> hardcoded literal.
  resolveControllerTuning() {
    const pick = (override, cfgVal, dflt, min, max) => {
      if (override != null) return clampInt(override, min, max, dflt);
      if (cfgVal != null) return clampInt(cfgVal, min, max, dflt);
      return dflt;
    };
    const lookPct = pick(this.ctx.lookSensitivityOverride, this.cfg.lookSensitivity, 100, ...CLAMP.lookPct);
    const deadPct = pick(this.ctx.stickDeadzoneOverride, this.cfg.stickDeadzone, 15, ...CLAMP.deadPct);
    const rawFire = this.ctx.fireButtonOverride != null ? this.ctx.fireButtonOverride : this.cfg.fireButton;
    const fireButton = rawFire === 'bumper' ? 'bumper' : 'trigger'; // whitelist; anything else = default

    const scale = (base) => clampInt(Math.round(base * lookPct / 100), ...CLAMP.lookSpeed, base);
    return {
      lookPct, deadPct, fireButton,
      yawAnalog: scale(LOOK_BASE.yawAnalog),
      pitchAnalog: scale(LOOK_BASE.pitchAnalog),
      yawDigital: scale(LOOK_BASE.yawDigital),
      pitchDigital: scale(LOOK_BASE.pitchDigital),
      deadzone: Math.min(CLAMP.deadzoneMax, deadPct / 100).toFixed(2)
    };
  }

  // Generate the tunable look/deadzone cvars for all four players.
  //
  // Emitted UNCONDITIONALLY on every launch, for every player, even at defaults — this is
  // load-bearing, not defensive. All of these are CVAR_ARCHIVE: the engine writes them to
  // <fs_homepath>/baseq3/config.cfg on quit and execs that file at startup BEFORE our +exec.
  // Omit a line once and a previously lowered sensitivity stays latched forever while the UI
  // shows "Default".
  //
  // Both the analog and digital pairs are written: the analog cvars are ignored entirely under
  // in_joystickUseAnalog 0, so scaling only those would be a silent no-op in the digital fallback.
  //
  // Keep the exact `seta [<n>]<cvar> "<value>"` shape — one per line, double-quoted, no trailing
  // comment. scripts/windows-doctor.js greps for precisely this.
  buildGamepadTuning(t) {
    const lines = ['// --- per-player look speed + stick deadzone (generated from Settings -> Controller) ---'];
    for (let p = 0; p < 4; p++) {
      const num = p === 0 ? '' : String(p + 1); // per-player cvar prefix (2cg_..., 3cg_..., 4cg_...)
      lines.push(`seta ${num}cg_yawspeedanalog "${t.yawAnalog}"`);
      lines.push(`seta ${num}cg_pitchspeedanalog "${t.pitchAnalog}"`);
      lines.push(`seta ${num}cg_yawspeed "${t.yawDigital}"`);
      lines.push(`seta ${num}cg_pitchspeed "${t.pitchDigital}"`);
      lines.push(`seta ${num}in_joystickThreshold "${t.deadzone}"`);
    }
    return lines.join('\n') + '\n';
  }

  // Assemble the cfg that gets written into the Spearmint homepath: the repo cfg body with the
  // generated tuning cvars spliced in, then the generated per-player binds appended.
  //
  // Three splice levels, because a silent miss here is the worst failure available: no cvars deploy,
  // the stale ARCHIVED values in config.cfg keep applying, and the settings page still says "saved".
  // Insert ABOVE in_restart — the cgame re-reads these every frame, but whether the ENGINE latches
  // in_joystickThreshold at SDL device-open is undetermined, so re-opening after is free insurance.
  // Function replacements are used so `$&`-style sequences in the injected text can't expand.
  buildDeployedCfg(raw, invertY, tune) {
    const tuning = this.buildGamepadTuning(tune);
    const name = this.cfg.gamepadConfig;
    let body;
    if (raw.includes(TUNING_MARKER)) {
      body = raw.replace(TUNING_MARKER, () => tuning.trimEnd());
    } else if (/^[ \t]*in_restart[ \t]*$/m.test(raw)) {
      console.log(`   WARN: ${TUNING_MARKER} missing from ${name} — splicing above in_restart`);
      body = raw.replace(/^[ \t]*in_restart[ \t]*$/m, () => `${tuning}\nin_restart`);
    } else {
      console.log(`   WARN: neither ${TUNING_MARKER} nor in_restart found in ${name} — appending both`);
      body = `${raw}\n${tuning}\nin_restart\n`;
    }
    return body + '\n' + this.buildGamepadBinds(invertY, tune.fireButton);
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
    //   { menu: true }   -> boot to the main menu (no map)
    //   { players: N }   -> load the map with N local splitscreen players (via cl_localPlayers).
    // No profile -> config default player count + map (plain Deploy).
    // NOTE: each splitscreen player needs its own controller connected before launch; the
    // gamepad config enables + assigns one per player (in_joystickNo) and binds all 4 (JOY_/2JOY_/…).
    const profile = this.ctx.profile || {};
    // Map: a launch profile can override the configured default (the in-app level select sends
    // profile.map). Falls back to spearmint.map for a plain Deploy.
    const mapName = profile.map || this.cfg.map;
    let players = (typeof this.cfg.defaultPlayers === 'number' ? this.cfg.defaultPlayers : 4);
    let loadMap = !!mapName;
    if (profile.menu) {
      players = 1;
      loadMap = false;
    } else if (typeof profile.players === 'number') {
      players = Math.max(1, Math.min(4, profile.players));
    }
    console.log(`   profile: ${profile.label || (profile.menu ? 'menu' : players + 'p')} (players=${players}, map=${loadMap ? mapName : 'none'})`);

    // Number of local splitscreen players. cl_localPlayers is a BITMASK (bit per player), read at
    // connect — so setting it before +map spawns N real local players, each with its own viewport
    // and input. This is what actually makes player 2+ controllable; the older `Ndropin` approach
    // connected them server-side but not as local viewports, so their input fell through to player 1.
    const localPlayersMask = (1 << players) - 1; // 1p=1, 2p=3, 3p=7, 4p=15

    const args = [
      '+set', 'g_gametype', String(this.cfg.gametype != null ? this.cfg.gametype : 0),
      '+set', 'g_log', String(this.cfg.logName || 'games.log'),
      '+set', 'g_logSync', '1', // 1 = flush every line immediately (required for live tailing)
      '+set', 'fraglimit', String(this.cfg.fraglimit != null ? this.cfg.fraglimit : 0),
      '+set', 'timelimit', String(this.cfg.timelimit != null ? this.cfg.timelimit : 0), // minutes; 0 = no limit
      '+set', 'com_hunkmegs', String(this.cfg.hunkMegs != null ? this.cfg.hunkMegs : 192), // big custom maps need >64

      '+set', 'cl_localPlayers', String(localPlayersMask)
    ];
    // Capture all console output (incl. our auto-map echo markers) to fs_homepath/baseq3/console.log
    // so the controller auto-mapping can be verified after the fact. developer 1 makes the joystick
    // init print "N possible joysticks" / "Joystick N opened for player P" / "already in use" so we
    // can see exactly how each pad got assigned. logfile 2 = flush each line.
    if (this.debug) args.push('+set', 'logfile', '2', '+set', 'developer', '1');
    if (this.cfg.fs_homepath) args.push('+set', 'fs_homepath', this.resolveHomePath());
    if (this.cfg.fs_basepath) args.push('+set', 'fs_basepath', this.expandHome(this.cfg.fs_basepath));
    if (this.cfg.fs_game) args.push('+set', 'fs_game', this.cfg.fs_game);

    // Deploy + exec the gamepad config (per-player joystick cvars) plus the generated per-player
    // key binds. Binds are generated (not hand-written in the .cfg) because each player's keys must
    // map to that player's PREFIXED command — Spearmint picks the player from the command name, not
    // the key, so player 2's keys must run +2forward etc. (unprefixed = moves player 1).
    if (this.cfg.gamepadConfig) {
      try {
        const src = path.join(this.ctx.appDir || process.cwd(), 'spearmint', this.cfg.gamepadConfig);
        const destDir = path.join(this.resolveHomePath(), this.cfg.fs_game || 'baseq3');
        if (fs.existsSync(src)) {
          fs.mkdirSync(destDir, { recursive: true });
          const invertY = (process.platform === 'darwin') && (this.cfg.invertStickYMac !== false);
          const tune = this.resolveControllerTuning();
          const tuning = this.buildGamepadTuning(tune);

          // Splice the generated tuning cvars into the cfg body. Three levels, because a silent miss
          // here is the worst failure available: no cvars deploy, the stale ARCHIVED values in
          // config.cfg keep applying, and the settings page still reports "saved". Insert ABOVE
          // in_restart — the cgame re-reads these every frame, but whether the ENGINE latches
          // in_joystickThreshold at SDL device-open is undetermined, so re-opening after is free
          // insurance. Function replacements avoid `$&`-style expansion in the injected text.
          const cfgText = this.buildDeployedCfg(fs.readFileSync(src, 'utf8'), invertY, tune);
          fs.writeFileSync(path.join(destDir, this.cfg.gamepadConfig), cfgText);
          args.push('+exec', this.cfg.gamepadConfig);
          console.log('   gamepad config:', this.cfg.gamepadConfig, '(per-player prefixed binds' + (invertY ? ', macOS Y-invert)' : ')'));
          console.log(`   controller: look ${tune.lookPct}% (yaw ${tune.yawAnalog} pitch ${tune.pitchAnalog}, digital ${tune.yawDigital}/${tune.pitchDigital}), deadzone ${tune.deadzone}, fire ${tune.fireButton}`);
        } else {
          console.log('   gamepad config not found at', src);
        }
      } catch (e) {
        console.log('   gamepad config deploy failed:', e.message);
      }
    }

    // Deploy the bot-fix pk3. Stock Q3 bot data makes Spearmint's bot setup fail
    // (BotLoadChatFile failed) so no bots ever spawn; this pk3 ships a corrected default_c.c.
    // See spearmint/botfix/README.md. Copied to <fs_homepath>/<fs_game> (install untouched).
    if (this.cfg.botFixPk3) {
      try {
        const src = path.join(this.ctx.appDir || process.cwd(), 'spearmint', this.cfg.botFixPk3);
        const destDir = path.join(this.resolveHomePath(), this.cfg.fs_game || 'baseq3');
        if (fs.existsSync(src)) {
          fs.mkdirSync(destDir, { recursive: true });
          fs.copyFileSync(src, path.join(destDir, this.cfg.botFixPk3));
          console.log('   bot-fix pk3:', this.cfg.botFixPk3);
        } else {
          console.log('   bot-fix pk3 not found at', src);
        }
      } catch (e) {
        console.log('   bot-fix pk3 deploy failed:', e.message);
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
        '+set', 'r_noborder', '0',          // bordered (draggable if the dock position needs nudging)
        '+set', 'r_centerWindow', '0',
        // Dock the window at geo.x/geo.y (top-left, beside the control panel). Honoured by our
        // patched macOS engine (r_windowPosX/Y in sdl_glimp.c); ignored by stock builds, which
        // are positioned another way (Windows: SetWindowPos via main.js).
        '+set', 'r_windowPosX', String(geo.x != null ? geo.x : 0),
        '+set', 'r_windowPosY', String(geo.y != null ? geo.y : 0)
      );
    }

    if (loadMap) {
      args.push('+map', mapName);

      // Bots — give the marines something to frag. Skill 1 = "I Can Win" (easiest) … 5 = Nightmare.
      // Use an explicit list if configured ("name [skill]" entries), else auto-add `botCount` bots
      // from a named pool at `botSkill`. Named bots (vs "addbot random") are used so the skill
      // argument is reliably applied — the bot's userinfo then reports skill\<botSkill>.
      // Settings-page override (ctx.botSkillOverride) wins over the config default.
      const botSkill = (this.ctx.botSkillOverride != null) ? this.ctx.botSkillOverride
        : (this.cfg.botSkill != null ? this.cfg.botSkill : 1);
      const botPool = this.cfg.botPool ||
        ['Crash', 'Sarge', 'Grunt', 'Major', 'Visor', 'Bones', 'Doom', 'Mynx', 'Keel', 'Slash'];
      let botEntries = [];
      if (Array.isArray(this.cfg.bots) && this.cfg.bots.length) {
        botEntries = this.cfg.bots.map(b => {
          const s = String(b).trim();
          return /\s+\d+\s*$/.test(s) ? s : `${s} ${botSkill}`; // append skill if the entry omits it
        });
      } else {
        const n = Math.max(0, this.cfg.botCount != null ? this.cfg.botCount : 0);
        botEntries = Array.from({ length: n }, (_, i) => `${botPool[i % botPool.length]} ${botSkill}`);
      }

      // Local players 1..N already spawn from cl_localPlayers (set above). After the map loads,
      // add the bots. (Bots take client numbers after the humans; _parseLine classifies them by
      // the `\skill\` in their userinfo, so frag attribution doesn't depend on ordering.)
      const waitFrames = this.cfg.splitWaitFrames != null ? this.cfg.splitWaitFrames : 200;
      if (botEntries.length) {
        args.push('+wait', String(waitFrames));
        botEntries.forEach(b => args.push('+addbot', ...b.split(/\s+/)));
        console.log(`   bots: ${botEntries.length} @ skill ${botSkill}`);
      }

      // Re-apply the gamepad config AFTER the splitscreen players have joined, then re-init input.
      // Belt-and-suspenders so players 2-4's per-player binds + device assignment are settled once
      // both controllers have enumerated. Only needed for splitscreen.
      if (players > 1 && this.cfg.gamepadConfig) {
        const reinitFrames = this.cfg.joyReinitFrames != null ? this.cfg.joyReinitFrames : 300;
        args.push('+wait', String(reinitFrames));
        // In debug, bracket the re-exec with echo markers (visible in console + console.log).
        if (this.debug) args.push('+echo', '">>> GoldenPie: re-applying splitscreen controller map..."');
        args.push('+exec', this.cfg.gamepadConfig);
        if (this.debug) args.push('+echo', '">>> GoldenPie: splitscreen controller map applied <<<"');
        console.log(`   scheduled gamepad re-exec after ${reinitFrames} frames (re-apply player 2-4 binds post-join)`);
      }
    }
    if (Array.isArray(this.cfg.extraArgs)) args.push(...this.cfg.extraArgs);

    // SDL controller-backend hints (macOS). On Sequoia a wired Xbox pad is exposed ONLY through
    // Apple's GameController framework (SDL's MFi driver) — the IOKit and HIDAPI paths see nothing
    // (verified by direct SDL 2.32 probe). The actual blocker for an empty joystick list is timing:
    // GameController only enumerates after the CoreFoundation run loop is serviced, which our patched
    // Spearmint build now does before enumerating (libsdl-org/SDL#11742). We additionally disable
    // HIDAPI to avoid its known macOS wired-Xbox problems (Y-axis inversion, duplicate devices,
    // forced re-routing, and a spurious Input-Monitoring prompt); MFi + IOKit stay enabled.
    // Override via spearmint.sdlEnv in config.json. macOS-only — on Windows/Linux these would wrongly
    // disable the native HIDAPI/XInput path.
    const sdlEnv = (process.platform === 'darwin')
      ? Object.assign({ SDL_JOYSTICK_HIDAPI: '0' }, this.cfg.sdlEnv || {})
      : (this.cfg.sdlEnv || {});
    const launchEnv = Object.assign({}, process.env, sdlEnv);

    const launchDelay = this.cfg.launchDelayMs || 6000;
    if (this.launchViaBundle) {
      // Launch via the .app bundle so macOS applies its permissions (Input Monitoring, etc.).
      // `open --args` propagates this process's env to the launched app, so the SDL hints apply.
      const idx = exe.indexOf('.app');
      const bundle = idx !== -1 ? exe.slice(0, idx + 4) : exe;
      console.log('   launching via bundle:', bundle);
      try {
        this.proc = spawn('open', ['-n', bundle, '--args', ...args], { env: launchEnv });
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
        this.proc = spawn(exe, args, { cwd: path.dirname(exe), env: launchEnv });
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
    this.botClients = new Set();
    this.humanOrder = [];

    if (this.detect === 'log') {
      // Players/bots connect during the launch delay (before we tail), so learn who's who from
      // the lines already written, then tail from EOF (ignore prior-match kills).
      this.partial = '';
      this._primeClassification();
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

  // Classify a client from a userinfo line. Spearmint logs both "Client*" and "Player*" prefixes
  // across versions, so match either. Bots carry `\skill\` in their userinfo; humans never do.
  // Returns true if the line was a userinfo line (handled here).
  _classifyLine(line) {
    const mu = line.match(/(?:Player|Client)UserinfoChanged:\s+(\d+)\s+(.*)$/);
    if (!mu) return false;
    const c = parseInt(mu[1], 10);
    const info = mu[2];
    if (/\\skill\\/.test(info)) {
      this.botClients.add(c);
      const i = this.humanOrder.indexOf(c);
      if (i !== -1) this.humanOrder.splice(i, 1); // reclassified as a bot
    } else if (!this.botClients.has(c) && this.humanOrder.indexOf(c) === -1) {
      this.humanOrder.push(c); // a new human → next player slot
      if (this.debug) console.log(`[SPEARMINT] human client ${c} -> player ${this.humanOrder.length}`);
    }
    return true;
  }

  // Build client classification from the current match's already-written log lines. The
  // connect/userinfo lines are written during the launch delay, BEFORE we start tailing from
  // EOF — so without this, humanOrder would be empty and every kill ignored. Classify only
  // (don't count pre-session kills); read from the last InitGame so only the live match counts.
  _primeClassification() {
    try {
      if (!this.logPath || !fs.existsSync(this.logPath)) return;
      const content = fs.readFileSync(this.logPath, 'utf8');
      const idx = content.lastIndexOf('InitGame:');
      const lines = content.slice(idx === -1 ? 0 : idx).split('\n');
      for (const line of lines) this._classifyLine(line);
      if (this.debug) console.log(`[SPEARMINT] primed classification: humans=[${this.humanOrder.join(',')}] bots=[${[...this.botClients].join(',')}]`);
    } catch (_) { /* ignore */ }
  }

  _parseLine(line) {
    if (this._classifyLine(line)) return; // userinfo line → classification only
    if (/InitGame:/.test(line)) {
      if (this.debug) console.log('[SPEARMINT] InitGame — resetting match state');
      this.frags = [0, 0, 0, 0];
      this.botClients = new Set();
      this.humanOrder = [];
      this._emit();
      return;
    }
    const m = line.match(/Kill:\s+(\d+)\s+(\d+)\s+(-?\d+):/);
    if (!m) return;
    const killer = parseInt(m[1], 10);
    const victim = parseInt(m[2], 10);
    const slot = this.humanOrder.indexOf(killer); // 0-based local player index, -1 if bot/world
    if (this.debug) {
      console.log(`[SPEARMINT KILL] killer=${killer} victim=${victim} slot=${slot} bot=${this.botClients.has(killer)} | ${line.trim()}`);
    }
    if (killer === victim) return;   // suicide / world death → no reward
    if (slot === -1) return;         // bot or world killer → not a local player
    if (slot < 4) {
      this.frags[slot] += 1;
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
