# Windows bring-up & testing (Quake III / Spearmint)

**Setting up a fresh PC? Start with [windows-setup.md](windows-setup.md).**

Handoff notes for testing GoldenPie on a Windows PC. Everything here was developed and verified on
macOS; the items under **Untested on Windows** are the ones that actually need eyes.

Start every debugging session with:

```bash
node scripts/windows-doctor.js
```

It prints resolved paths, installed `.pk3`s, map availability, the deployed gamepad binds, bot
settings, controller sensitivity (configured vs resolved vs deployed), and the tail of the engine
logs. It contains **no API keys, invoices, or balances**, so the output is safe to paste into a chat
session.

---

## 1. Prerequisites

| Thing | Where it must be | Notes |
|---|---|---|
| Spearmint engine (Windows build) | `%USERPROFILE%\Downloads\spearmint\spearmint_x86_64.exe` | Path comes from `config.json` → `games.quake3.spearmint.win.executablePath`. Change it there if you install elsewhere. |
| Retail Quake III data | `<install>\baseq3\pak0.pk3` (…`pak8.pk3`) | The doctor warns if `pak0.pk3` is missing. Without it the engine won't start. |
| Spearmint VM paks | `<install>\baseq3\spearmint-baseq3-1.0.3.pk3` | **Engine and VMs must be the same version.** A mismatch was a real bug on macOS — the engine had to be rebuilt from the `release-1.0.3` tag to match the 1.0.3 VMs. |
| Node deps | `npm install` in the repo | |
| Controllers | up to 4 Xbox pads | Windows uses XInput, which caps at 4 — exactly our max. |

The app writes user data to `%APPDATA%\Spearmint\` (`fs_homepath`) and reads game content from the
install dir (`fs_basepath`). Both are valid `.pk3` load paths.

### Custom maps

The Simpsons map is **not in the repo** (the `.pk3` is ~60 MB). The level select detects this and
greys the map out with a ⚠ rather than failing the launch — click it and a toast shows the exact
path. To enable it, copy `simpsons.pk3` into:

```
%APPDATA%\Spearmint\baseq3\
```

Any future custom map works the same way: add `"requiresPk3": "<file>.pk3"` to its entry in
`config.json` → `games.quake3.spearmint.maps`.

---

## 2. Untested on Windows — check these first

1. **Stick Y polarity (highest risk).** The macOS Y-inversion is gated on
   `process.platform === 'darwin'` (`adapters/spearmint-log.js`, `buildGamepadBinds(invertY)`), so on
   Windows the binds are *not* inverted. That was correct in digital mode, but the sticks were
   recently switched to **analog** (`in_joystickUseAnalog 1`). Analog *should* behave identically —
   the engine applies the axis magnitude to the same bound command — but it is unverified on both
   platforms. **Test: push forward → move forward; push right stick up → look up.** If inverted,
   flip via `invertStickYMac`-style handling for Windows (needs a new flag; don't reuse the mac one).
2. **Per-player controls.** Spearmint picks the player from the *command name*, not the key
   (`+forward` = P1, `+2forward` = P2 …). This was the hardest bug on macOS. **Test: player 2's pad
   must move only player 2.** The doctor prints per-player bind counts to confirm the prefixed binds
   deployed.
3. **Game window placement.** macOS can't move an SDL window externally, so the engine self-positions
   via patched `r_windowPosX/Y` cvars. Windows instead uses `fillGameArea: true` → `SetWindowPos`
   (`positionRetroArchWindow` in `main.js`). Stock Windows builds ignore `r_windowPos*` harmlessly.
4. **Control-panel maximize during buy-in.** Uses Electron `workArea`, which should respect the
   taskbar. Verify the QR codes land in the screen corners and the panel restores to 400 px after.

---

## 3. Test pass (in order)

**Basics**
- [ ] `npm start` → panel opens; switch to **Quake III** mode.
- [ ] Footer reads `QUAKE III ARENA :: FRAG OR BE FRAGGED` (not the GoldenEye/MI6 text).
- [ ] Roster reads **PLAYER 1–4** (no "SPOOK", no "ARENA").
- [ ] **🎮 Controls** opens the Xbox controller diagram (not the GoldenEye image).
- [ ] Level select shows 11 stock maps; **The Simpsons is greyed with ⚠** until the pk3 is copied.

**Gameplay**
- [ ] Launch **2 Player** → splitscreen with two viewports.
- [ ] Each pad controls **only** its own player (see §2.2).
- [ ] Forward/look directions correct (see §2.1).
- [ ] Bots spawn and **attack**. Difficulty comes from **Settings → 🤖 Bots**, which *overrides* the
      `config.json` default — check the doctor's `settings botSkill` line if bots feel passive.
- [ ] Look speed feels right and no player drifts with hands off the pad. Tune in **Settings → 🎮
      Controller (Quake III)** (applies on the *next* launch). If a change seems not to have taken,
      compare the doctor's `=> resolved` line against its deployed `yaw speed` / `deadzone` lines —
      four players should appear on each. **Rule out §2.1 first:** analog stick mode is still
      unverified, so an inverted or mis-scaled axis is the competing explanation for "too sensitive".
- [ ] Frags appear live in the panel per player.
- [ ] Match ends at the 10-minute `timelimit`.

**Faucet mode (free-to-play, earn sats)**
- [ ] Settings → provider + API key; main screen shows **⚡ Faucet** selected.
- [ ] A frag pays the linked address, or accrues a withdrawable balance if unlinked.

**Pot mode (buy-in → winner takes most)** — real sats; test small (e.g. 10 sats).
- [ ] Main screen **🏆 Pot** toggle + buy-in field.
- [ ] Launch a 2+ player match → window maximizes, buy-in QRs in screen corners, colour-coded per
      player, live "X / N paid" counter, centred Start/Cancel, **ESC** closes.
- [ ] Invoice memo names the player (`GoldenPie buy-in - Player 1`).
- [ ] **Start Match** only enables when everyone has paid; window restores.
- [ ] **🏆 End Match & Pay Out** → results ranked, last place gets nothing, payouts sent.
- [ ] A second pot match can start afterwards (the pot must clear on full settlement).
- [ ] **Cancel & Refund** refunds buy-ins.

> ⚠ **ZBD `/v0/charges` is still unverified against a real key.** The app has only ever *sent* via
> ZBD, so its charge (pay-in) scope is untested. Smoke-test one small buy-in before a real match.
> LNBits is lower-risk — incoming invoices need only the weaker invoice key.

---

## 4. Debugging reference

**Logs** (all under `%APPDATA%\Spearmint\baseq3\`):
- `games.log` — authoritative frag feed; the adapter tails this. `Kill:` lines drive payments.
- `console.log` — engine/VM output: bot loading, missing files, cvar errors.

**Frag detection:** `adapters/spearmint-log.js` tails `games.log`, classifies bots vs humans by the
`\skill\` field in `PlayerUserinfoChanged`, and maps kills to player slots by first-seen human order.
Set `games.quake3.debugLog: true` in `config.json` for verbose parsing output.

**Local state** (repo root in dev, `%APPDATA%\GoldenPie\` when packaged):
`.bitcoin-settings.enc` (payment settings), `.player-sessions.enc` (linked addresses),
`.player-balances.json`, `.current-pot.json` (in-flight pot), `.gameplay-settings.json` (bot skill,
controller look speed + deadzone + fire button).
All are gitignored. If a pot is stuck, settle or cancel it in-app rather than deleting the file —
deleting it discards the record of who paid.

**Known non-bugs**
- **Fire sometimes "runs on."** The right trigger registers at only ~15% pull and the machinegun is a
  continuous-fire weapon, so a resting finger sprays. One shared deadzone (`in_joystickThreshold`)
  covers sticks *and* triggers — it is registered by the *engine*, which is why it gates the trigger's
  key event as well as stick travel. Both halves are now adjustable in **Settings → 🎮 Controller
  (Quake III)**: raise **Stick Deadzone** to firm the trigger up (it also firms the sticks), or set
  **Fire Button → Right bumper** to move `+attack` onto a digital button and decouple the two
  entirely (weapon-switch takes the trigger).
- **Vertical look feels twitchier than horizontal.** Pitch is clamped to ~±90° while yaw is a full
  360°, so equal angular speed covers the useful vertical range faster. That is why GoldenPie runs
  pitch at 150°/s against yaw's 200°/s. Tune with **Settings → 🎮 Controller → Look Sensitivity**,
  which scales yaw and pitch together on that deliberate 200:150 ratio. Do *not* hand-edit
  `spearmint/goldenpie-gamepad.cfg` — the adapter regenerates those cvars into the deployed copy on
  every launch, so edits there are discarded. For an instant mid-match A/B, open the in-game console
  (`` ` ``) and type e.g. `cg_yawspeedanalog 300`; the cgame picks it up the same frame.
- **No "move sensitivity" setting exists, by design.** Quake III caps ground speed in the engine
  (`CG_KeyMove` hardcodes 127 running / 64 walking and clamps into a signed byte), so no cvar can
  scale stick movement — a slider for it would be a placebo. The deadzone is the only real control
  over how the movement axis responds, which is also the fix for a worn stick that drifts.
