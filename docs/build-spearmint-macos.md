# Building Spearmint (Quake III) for Apple Silicon macOS — with working controllers

The Spearmint 1.0.3 release ships an x86_64 build linked against SDL 2.0.8 (2018). On a modern
Apple-Silicon Mac (Sequoia) that build:

- runs under Rosetta (slow, and TCC/permission keying gets confused), and
- **cannot read controllers** — SDL 2.0.8 only had the IOKit HID joystick driver, and on Sequoia a
  wired Xbox/PS pad is exposed *only* through Apple's GameController framework, so the old driver
  sees nothing usable.

This doc reproduces the **native arm64** build we ship in
`~/Applications/spearmint-1.0.3-macosx/Spearmint.app`, linked against Homebrew's modern SDL2
(2.32.x) and patched so controllers enumerate.

## The controller bug (and the real fix)

It is **not** a permissions problem. On macOS Sequoia the wired Xbox pad is surfaced via Apple's
GameController framework, which SDL registers **asynchronously off the CoreFoundation run loop**.
ioquake3/Spearmint enumerates joysticks exactly once, synchronously, at startup — *before* that run
loop has been serviced — so `SDL_NumJoysticks()` returns 0 and the joystick list is empty.
This is libsdl-org/SDL#11742.

Verified empirically with a tiny SDL 2.32 probe on this machine:

| Backend / timing | Sees the wired Xbox pad? |
|---|---|
| Default (MFi/GameController), **no** CF run-loop pump | ❌ 0 |
| `SDL_INIT_JOYSTICK` only, **no** CF pump (what ioq3 does) | ❌ 0 |
| `SDL_INIT_JOYSTICK` only, **with** `CFRunLoopRunInMode` pump | ✅ 1 |
| Force IOKit (`SDL_JOYSTICK_IOKIT=1`, MFi/HIDAPI off) | ❌ 0 (IOKit can't see the dext device) |
| HIDAPI only | ❌ 0 |

So: **pump the CF run loop before enumerating; keep the default MFi backend.** Forcing IOKit (the
generic internet advice) is wrong here — IOKit/HIDAPI see nothing on Sequoia for this pad.

## Prerequisites

```sh
brew install sdl2          # provides /opt/homebrew/{include/SDL2,lib/libSDL2-2.0.0.dylib}
# Xcode command-line tools (clang, install_name_tool, codesign)
```

## Source — build the `release-1.0.3` tag, NOT master

⚠️ **Build the engine from the same version as the game VMs in the `.pk3` (baseq3 1.0.3).** The
downloaded `spearmint-1.0.3-macosx` package ships `spearmint-baseq3-1.0.3.pk3` (the compiled
cgame/game/ui, from `zturtleman/mint-arena`). Building the engine from **master** produces a
`1.1dev` engine whose VM API differs from the 1.0.3 game VMs, which breaks things subtly (we hit
splitscreen joystick routing). Match versions:

```sh
cd /tmp && mkdir spearmint-103 && cd spearmint-103
git init -q && git remote add origin https://github.com/clover-moe/spearmint.git
git fetch --depth 1 origin refs/tags/release-1.0.3
git checkout -q FETCH_HEAD
```

The 1.0.3 source predates Apple Silicon, so beyond the SDL/controller patches it needs three small
build fixes (below) to compile arm64 on a modern toolchain.

## Patches

### 1. `Makefile` — build native arm64 against Homebrew SDL2

In the `ifeq ($(PLATFORM),darwin)` block:

```make
# ~line 466 — link CoreFoundation for the CFRunLoop pump (Cocoa pulls it in transitively,
# but be explicit):
  LIBS = -framework Cocoa -framework CoreFoundation

# In the arm64 SDL section — point at Homebrew instead of the bundled macosx-ub2 libs:
      MACLIBSDIR=/opt/homebrew/lib
      BASE_CFLAGS += -I/opt/homebrew/include/SDL2
```

Two build-mechanics fixes (the release Makefile assumes a fat/universal SDL lib; Homebrew's is
already thin arm64):

```make
# ~line 2304/2306 — the rule does `$(LIPO) -extract $(MACOSX_ARCH) $< -o $@` on the SDL lib.
# A thin arm64 dylib has nothing to extract, so just copy it:
	cp $< $@

# ~line 2308 — Homebrew's copied lib is read-only; make it writable before ranlib:
	chmod u+w $@
	$(RANLIB) $@
```

### 2. `code/sdl/sdl_input.c` — pump the CF run loop before enumerating joysticks

Add the CoreFoundation include near the top:

```c
#ifdef __APPLE__
// macOS Sequoia exposes wired Xbox/PS pads only through Apple's GameController framework,
// which SDL enumerates lazily off the CoreFoundation run loop. We service that run loop
// before counting joysticks (see IN_InitJoystick) — libsdl-org/SDL#11742.
#include <CoreFoundation/CoreFoundation.h>
#endif
```

In `IN_InitJoystick()`, immediately **before** `total = SDL_NumJoysticks();`:

```c
#ifdef __APPLE__
	// Service the CF run loop so the GameController framework registers the pad before we
	// count joysticks. Break as soon as one appears; cap so a controller-less launch isn't
	// penalised.
	{
		int waitedMs = 0;
		while ( SDL_NumJoysticks() == 0 && waitedMs < 1200 )
		{
			CFRunLoopRunInMode( kCFRunLoopDefaultMode, 0.05, false );
			SDL_PumpEvents( );
			waitedMs += 50;
		}
	}
#endif
```

### 3. `code/sdl/sdl_glimp.c` — let the engine position its own window

macOS won't let an external process (System Events / Accessibility) move an SDL window, so the only
reliable way to dock the window beside the control panel is to position it from *inside* the engine.
ioquake3 creates the window with `SDL_WINDOWPOS_UNDEFINED` (or centered); add explicit position cvars.

In `GLimp_SetMode()`, right **after** the `// Center window` block:

```c
	// Explicit window position (the GoldenPie launcher sets these via +set to dock the window
	// left of its control panel). >= 0 overrides centering; -1 (default) = centered/undefined.
	if( !fullscreen )
	{
		cvar_t *wpx = ri.Cvar_Get( "r_windowPosX", "-1", CVAR_LATCH );
		cvar_t *wpy = ri.Cvar_Get( "r_windowPosY", "-1", CVAR_LATCH );
		if( wpx->integer >= 0 ) x = wpx->integer;
		if( wpy->integer >= 0 ) y = wpy->integer;
	}
```

The adapter passes `+set r_windowPosX 0 +set r_windowPosY 0 +set r_centerWindow 0` (see
`adapters/spearmint-log.js`; `getGameWindowSize()` in `main.js` supplies x/y). macOS clamps Y to
just below the menu bar (~66px) — that's expected and matches RetroArch.

### 4. `code/qcommon/q_platform.h` — add arm64 (the 2020 source predates Apple Silicon)

In the macOS (`__APPLE__`) arch block, after the `__x86_64__` case, add:

```c
#elif defined __aarch64__
#define ARCH_STRING "arm64"
#define Q3_LITTLE_ENDIAN
```

Without this the build fails with `"Architecture not supported" / "Endianness not defined"`.

### 5. `Makefile` — no VM JIT on arm64 (1.0.3 has no aarch64 compiled-VM)

In the `ifeq ($(ARCH),arm64)` block added in patch 1, also set `HAVE_VM_COMPILED=false` so the engine
uses the bytecode interpreter (1.0.3's only JIT is x86; without this the link fails with undefined
`_VM_CallCompiled`). The interpreter is plenty fast for Q3.

## Build

```sh
cd /tmp/spearmint-103
make ARCH=arm64 USE_FREETYPE=0 -j4   # USE_FREETYPE=0: bundled FreeType 2.9 won't compile on modern
                                     # clang (undeclared 'Byte'); baseq3 uses bitmap fonts anyway.
# If you changed flags after a prior build, `rm -rf build/release-darwin-arm64` first — make won't
# recompile .c files on a flag-only change, leaving stale objects that fail to link.
# output: build/release-darwin-arm64/{spearmint_arm64, spearmint-server_arm64,
#         spearmint-renderer-opengl1_arm64.dylib, spearmint-renderer-opengl2_arm64.dylib}
```

## Assemble + sign the .app bundle

> **Which source → which binary (important when re-installing after a patch):**
> Spearmint has a modular renderer. **Input** code (`sdl_input.c`) compiles into the main
> `spearmint` binary, but **window/video** code (`sdl_glimp.c`) compiles into the **renderer
> dylibs** (`spearmint-renderer-opengl1/2_arm64.dylib`). So the controller fix needs only the
> main binary recopied, while the **window-position fix needs the renderer dylibs recopied** —
> miss them and the patch silently has no effect (the build log shows `REF_CC code/sdl/sdl_glimp.c`
> then `LD …renderer…dylib`). When in doubt, reinstall all of them.

```sh
APP="$HOME/Applications/spearmint-1.0.3-macosx/Spearmint.app"
MACOS="$APP/Contents/MacOS"
SRC=/tmp/spearmint-103/build/release-darwin-arm64

# Install the client binary (CFBundleExecutable = "spearmint") AND the renderer dylibs.
# Each records the Homebrew SDL abs path, so repoint every one at the bundled dylib.
for f in spearmint:spearmint_arm64 \
         spearmint-renderer-opengl1_arm64.dylib:spearmint-renderer-opengl1_arm64.dylib \
         spearmint-renderer-opengl2_arm64.dylib:spearmint-renderer-opengl2_arm64.dylib; do
  dest="${f%%:*}"; src="${f##*:}"
  cp "$SRC/$src" "$MACOS/$dest"
  install_name_tool -change /opt/homebrew/opt/sdl2/lib/libSDL2-2.0.0.dylib \
    @executable_path/libSDL2-2.0.0.dylib "$MACOS/$dest"
done
# (spearmint-server and the bundled libSDL2-2.0.0.dylib are installed the same way on first assembly.)

# arm64 binaries MUST be (ad-hoc) signed or macOS kills them. Sign the whole bundle:
codesign -f -s - --deep "$APP"
codesign --verify --deep --strict "$APP"   # should be silent / exit 0
```

> Backup of the original x86_64 bundle contents: `~/Applications/spearmint-1.0.3-macosx/MacOS-x86-backup`.

## `Info.plist` — belt-and-suspenders SDL hint (optional)

So the hint applies even on a Finder double-click (the app also gets it from the launcher env):

```sh
PLIST="$APP/Contents/Info.plist"
/usr/libexec/PlistBuddy -c "Add :LSEnvironment dict" "$PLIST" 2>/dev/null
/usr/libexec/PlistBuddy -c "Add :LSEnvironment:SDL_JOYSTICK_HIDAPI string 0" "$PLIST"
codesign -f -s - --deep "$APP"     # any bundle edit invalidates the signature — re-sign
```

`SDL_JOYSTICK_HIDAPI=0` sidesteps HIDAPI's macOS wired-Xbox quirks (Y-axis inversion, duplicate
devices, a spurious Input-Monitoring prompt). MFi + IOKit stay enabled. GoldenPie also sets this in
`adapters/spearmint-log.js` (overridable via `config.games.quake3.spearmint.sdlEnv`).

## Verify

```sh
cd "$MACOS"
SDL_JOYSTICK_HIDAPI=0 ./spearmint +set developer 1 +set in_joystick 1 \
  +set fs_basepath "$HOME/Applications/spearmint-1.0.3-macosx" \
  +set fs_homepath "$HOME/Library/Application Support/Spearmint" \
  +set r_fullscreen 0
# Expect in the console / stdout:
#   1 possible joysticks
#   Joystick 0 opened for player 1
#   Name:       Controller
```

For 4-player splitscreen, plug in 4 controllers — each player grabs the next free joystick. With one
pad connected you'll see "Joystick for player 2 already in use by player 1" (expected).

## Notes

- No **Input Monitoring** (TCC) grant is required: the GameController/MFi path doesn't use it. (The
  IOKit path would, but it sees nothing here anyway.)
- Trade-off of the MFi path: rumble to a *wired* Xbox pad doesn't work on macOS (you can't write HID
  output reports to it). Buttons/axes/sticks all work — which is all the GoldenPie gamepad config uses.
- This is macOS-only. Windows uses the native build (XInput) and needs none of this.

## Splitscreen controllers (not a build step — app-level, but the key gotcha)

Spearmint decides which player a command moves from the **command name**, not the key. Each local
player has its own joystick keycodes (`JOY_*` / `2JOY_*` / `3JOY_*` / `4JOY_*`) AND must bind them to
that player's **prefixed** command: player 1 `+forward`, player 2 `+2forward`, player 3 `+3forward`,
player 4 `+4forward` (the number goes right after the `+`/`-`; plain commands like `weapnext` become
`2weapnext`). Binding player 2's keys to the *unprefixed* `+forward` makes player 2's controller move
**player 1** ("one controller controls both"). GoldenPie generates these per-player prefixed binds in
`adapters/spearmint-log.js` (`buildGamepadBinds`), re-applied after the splitscreen players join, with
the macOS stick-Y inversion folded in. Also set `cl_localPlayers` (bitmask) before `+map` so the local
players actually spawn, and use digital stick mode (`in_joystickUseAnalog 0`) so sticks route via the
per-player keys. Two *identical* controllers work, but enumeration order isn't labelled — player 1 =
first device, player 2 = second.
