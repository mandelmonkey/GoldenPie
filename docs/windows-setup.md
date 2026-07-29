# Windows PC setup (GoldenPie + Quake III / Spearmint)

Start-to-finish setup for a fresh Windows machine. Budget ~20 minutes, most of it copying game data.

For what to *test* once it runs, and known platform differences, see
[windows-testing.md](windows-testing.md).

---

## Overview — what you're assembling

Spearmint is a **Quake III engine only**; it ships no game content. So there are three separate
pieces:

| Piece | Where it goes | Where it comes from |
|---|---|---|
| GoldenPie (this app) | anywhere, e.g. `C:\dev\GoldenPie` | this git repo |
| Spearmint engine + its VM paks | `%USERPROFILE%\Downloads\spearmint\` | Spearmint 1.0.3 release zip |
| Retail data `pak0.pk3`…`pak8.pk3` | `…\spearmint\baseq3\` | **your own** copy of Quake III Arena |

**Yes — you need to own Quake III Arena.** The engine is open source, the game data isn't. Copying
the `pak*.pk3` files out of a copy you own into a source port is the normal, documented procedure —
it's what [ioquake3's players guide](https://ioquake3.org/help/players-guide/) says to do, it's what
Spearmint's own readme says to do, and GOG themselves
[recommend it](https://support.gog.com/hc/en-us/articles/360013653713-Quake-3-Source-Ports).

---

## Step 1 — Node.js + the app

Install [Node.js LTS](https://nodejs.org/) (which includes npm), then:

```bash
git clone git@github.com:mandelmonkey/GoldenPie.git
cd GoldenPie
git checkout scores-reset
npm install
```

Run it with:

```bash
npm start
```

(`npm start` is the only command you need — it runs `electron .`. There's no `dev` script, and
`npm run build:win` is only for packaging an installer.)

---

## Step 2 — Spearmint engine

Download **spearmint-1.0.3-windows.zip** (~20 MB):

<https://github.com/clover-moe/spearmint/releases/download/release-1.0.3/spearmint-1.0.3-windows.zip>

(Official site: <https://clover.moe/spearmint/>. Note `spearmint.pw` is dead — ignore any link to it.
1.0.3 is the latest release, and it's the same version used on the Mac.)

Extract it, then **rename the extracted folder to `spearmint`** and place it so you end up with:

```
%USERPROFILE%\Downloads\spearmint\
    spearmint_x86_64.exe
    spearmint-renderer-opengl1_x86_64.dll
    spearmint-renderer-opengl2_x86_64.dll
    SDL264.dll
    baseq3\
        spearmint-baseq3-1.0.0.pk3 … 1.0.3.pk3
```

> ⚠️ The zip extracts to a folder named `spearmint-1.0.3-windows`, but the app's config expects
> `spearmint`. **Rename it** — otherwise the launch fails with "executable not found."

Three things that cause a silent failure to start, so don't cherry-pick files out of the zip:

- **Keep the renderer DLLs** next to the exe. The engine loads its renderer at runtime, so
  `spearmint-renderer-opengl1_x86_64.dll` must be a sibling of the exe.
- **The 64-bit build needs `SDL264.dll`**, *not* `SDL2.dll`. (The zip contains both because it also
  ships a 32-bit `spearmint_x86.exe`; the 64-bit one is what we use.)
- **Leave the `spearmint-baseq3-*.pk3` files in `baseq3\`.** Those are the game-logic VMs and they
  ship with the engine. Engine and VMs must be the same version — a mismatch cost real debugging
  time on the Mac.

### Using a different folder

`Downloads` gets cleaned out, so you may prefer `C:\Games\spearmint`. If you move it, edit
`config.json` → `games.quake3.spearmint.win` and update both paths:

```jsonc
"win": {
  "executablePath": "C:\\Games\\spearmint\\spearmint_x86_64.exe",
  "fs_basepath": "C:\\Games\\spearmint",
  ...
}
```

(Backslashes must be doubled in JSON. `%USERPROFILE%` and `%APPDATA%` are expanded, so either style
works.)

---

## Step 3 — Quake III game data (the part people miss)

You need **nine files**, `pak0.pk3` through `pak8.pk3` (~482 MB total), copied into
`…\spearmint\baseq3\` alongside the `spearmint-baseq3-*.pk3` files already there.

Pick whichever source you have:

**Steam** — Quake III Arena (app 2200). Already includes all nine paks (Steam ships the fully
patched 1.32). Copy from:
```
C:\Program Files (x86)\Steam\steamapps\common\Quake 3 Arena\baseq3\
```
Note the folder is **`Quake 3 Arena`** (numeral 3), not "Quake III Arena". For a non-default Steam
library it's `<SteamLibrary>\steamapps\common\Quake 3 Arena\baseq3\`.

**GOG** — "Quake III Gold". Also already complete. Default location:
```
C:\GOG Games\Quake III\baseq3\
```

**Retail CD** — the disc has `pak0.pk3` only. You'll also need `pak1`–`pak8` from id's 1.32
point-release *data*, which ioquake3 hosts behind id's EULA at
<https://ioquake3.org/extras/patch-data/>. (You never need id's patch *executable* — only the pak
files.)

**From the working Mac** — the Mac install already has all nine verified-genuine paks in
`~/Applications/spearmint-1.0.3-macosx/baseq3/`. They're platform-independent data, so copying them
over the network is the fastest route if that machine is handy.

When you're done, `baseq3\` should contain `pak0.pk3`…`pak8.pk3` **plus** the four
`spearmint-baseq3-*.pk3` files. Nothing goes outside `baseq3\` — we don't use Team Arena
(`missionpack`), so you can ignore it entirely.

> If `pak8.pk3` is missing you'll get **"User Interface is version 3, expected 6"** — that file holds
> the 1.32 game VMs.

---

## Step 4 — Controllers

Plug in up to **4 Xbox controllers before launching** (Windows uses XInput, which caps at 4 — exactly
our max). Wired or the official wireless adapter both work.

Set bot difficulty in the app under **Settings → 🤖 Bots** (this overrides the config default).

Tune controller feel under **Settings → 🎮 Controller (Quake III)** — **Look Sensitivity** (0.5x–2x,
where 1x = 200°/s yaw and 150°/s pitch at full stick deflection) and **Stick Deadzone**. Both
override the `config.json` defaults and apply on the **next launch**, to all four players.

Two things worth knowing before you reach for them:
- There is **no move-sensitivity control** because Quake III caps ground speed in the engine — no cvar
  can scale it. If a stick drifts or creeps with nobody touching it, that's a worn stick: raise
  **Stick Deadzone**. Note it cuts both ways — a bigger deadzone stops the drift, but the stick then
  reaches full turn speed at less physical travel.
- The engine uses **one** deadzone for sticks *and* triggers, so a high deadzone also stiffens the
  trigger pull. Set **Fire Button → Right bumper** if that gets in the way (weapon-switch moves to
  the trigger).

---

## Step 5 — Optional: the Simpsons custom map

The map `.pk3` is ~60 MB so it isn't in the repo. Until you install it, the level select shows
**The Simpsons** greyed out with a ⚠ — clicking it tells you where to put the file. To enable it:

```
%APPDATA%\Spearmint\baseq3\simpsons.pk3
```

Any future custom map works the same way: drop the pk3 there and add
`"requiresPk3": "<file>.pk3"` to its entry in `config.json` → `games.quake3.spearmint.maps`.

---

## Step 6 — Verify

```bash
node scripts/windows-doctor.js
```

This checks everything above: resolved paths, that the exe exists, that the renderer DLLs and
`SDL264.dll` are beside it, whether the retail paks are complete, whether the VM paks are present,
map availability, deployed per-player gamepad binds, bot settings, controller sensitivity (configured
vs resolved vs actually deployed), and the tail of the engine logs.
Its output is safe to paste into a chat — it reports whether payment settings *exist* but never
prints keys, invoices, or balances.

Then `npm start`, switch to **Quake III** mode, and work through the test pass in
[windows-testing.md](windows-testing.md).

---

## Troubleshooting

| Symptom | Cause |
|---|---|
| "executable not found" | `config.json` → `games.quake3.spearmint.win.executablePath` doesn't match where the zip actually extracted. Note the archive nests a same-named folder (`spearmint-1.0.3-windows\spearmint-1.0.3-windows\`); the doctor prints the resolved path it tried. |
| Engine won't start, no window | Missing `SDL264.dll` or the renderer DLLs beside the exe. Re-extract the whole zip. |
| "User Interface is version 3, expected 6" | Missing `pak8.pk3`, or engine/VM version mismatch. |
| "Hunk_Alloc failed" on a big map | Raise `hunkMegs` in `config.json` (already 192). |
| Bots spawn but don't fight | Bot difficulty is on Easy. **Settings → 🤖 Bots → Hard.** The settings value overrides `config.json`. |
| No frags in the panel | The engine may be writing logs to `…\spearmint\settings\baseq3\` (portable mode) instead of `%APPDATA%\Spearmint\baseq3\`. The doctor flags this and compares both. |
| Player 2's pad moves player 1 | Per-player command prefixes didn't deploy — check the doctor's per-player bind counts. |
| Aim too fast or too slow | **Settings → 🎮 Controller → Look Sensitivity.** Applies next launch; the doctor's `=> resolved` line should match its deployed `yaw speed` line. |
| Player turns or creeps with nobody touching the pad | Worn stick drifting past the deadzone. Raise **Settings → 🎮 Controller → Stick Deadzone**. The same deadzone sets the trigger's pull point, so if firing gets stiff, switch **Fire Button** to Right bumper. |
| Trigger fires on a resting finger | Deadzone is shared between sticks and triggers. Raise **Stick Deadzone**, or set **Fire Button → Right bumper** to decouple them. |
