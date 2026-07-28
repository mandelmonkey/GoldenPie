# GoldenPie - License to Pill ₿🟠

A cross-platform Electron-based launcher for playing classic N64 games using RetroArch with Bitcoin reward animations and live stats tracking. Perfect for Raspberry Pi setups that orange pill gamers with Bitcoin!

## Features

- **Cross-Platform Support** - Works on macOS, Windows, and Linux (including Raspberry Pi)
- **Bitcoin Rewards** - Animated ₿ coins fly across screen on kills and headshots
- **Orange Pill Gaming** - Subtle Bitcoin education through gaming rewards
- Clean UI with game area on the left and controls on the right
- **Live game stats** - Real-time kill count and headshot tracking for all 4 players
- **Custom controls** - Automatic loading of Modern.rmp control scheme
- **Memory reading** - UDP communication with RetroArch's Network Command Interface
- **Smart window positioning** across all platforms
- Automatic N64 core detection and ROM loading
- **Raspberry Pi optimized** - Perfect for Pi 4/5 gaming setups
- **Lightning payouts** - Link a Lightning address for instant per-kill payments, or accumulate a balance and withdraw it via an LNURL-withdraw QR (no address needed)
- **Multiple game modes** - Switch between **GoldenEye 007** (kills + headshots, N64 via RetroArch) and **Quake III Arena** (frags, native splitscreen via the Spearmint engine), each with its own theme, controls and frag detection

## Game Modes

Use the **GoldenEye / Quake III** switcher at the top of the control panel to change modes (only while no game is running — the choice is remembered between launches). Each mode re-themes the UI, renames players, and uses its own way of detecting frags.

| | GoldenEye 007 | Quake III Arena |
|---|---|---|
| Engine | RetroArch (N64) | Spearmint (native) |
| Players | 4 (split-screen) | 4 (split-screen) |
| Reward events | Kills + headshots | Frags only |
| Players called | SPOOK 1-4 | ARENA 1-4 |
| Theme | Orange / gold | Blood-red / rust |
| Frag detection | Emulator RAM over UDP | Tails the engine's `games.log` |

**GoldenEye ROM:** drop the `.z64` into `Roms/Goldeneye/`. The active mode picks the ROM whose path matches the game's `romMatch` value in `config.json`, installs its RetroArch input remap (`remaps/Modern.rmp`), and reads the per-player kill/headshot memory addresses.

**Quake III (Spearmint):** a native macOS build of the Spearmint engine drives 4-player splitscreen with controllers, easy bots, a level select, and a match time limit — see [docs/build-spearmint-macos.md](docs/build-spearmint-macos.md) for the reproducible build and controller notes. Frags are read by tailing the engine's `games.log` (`Kill:` lines), and the map list / bots / time limit live under `games.quake3.spearmint` in `config.json`.


## Platform Support

| Platform | Status | Window Positioning | Notes |
|----------|--------|-------------------|--------|
| **macOS** | ✅ Full | AppleScript | Native support |
| **Windows** | ✅ Full | PowerShell | Requires PowerShell |
| **Raspberry Pi** | Coming soon

## Setup

### Prerequisites

1. **RetroArch** - Install from official sources or package manager
2. **N64 Core** - You need to install Mupen64plus N64 core in RetroArch
3. **Classic N64 ROM** - Place your leaglly obtained ROM file in `./Roms/Goldeneye` folder (.z64, .n64, or .v64 format) only GoldenEye 007 (USA).z64 has been tested

### Installing RetroArch

#### macOS
Download from: https://www.retroarch.com


#### Windows
Download from: https://www.retroarch.com


### Installing the N64 Core

Before you can play, you need to install an N64 emulation core:

1. Open RetroArch
2. Navigate to: **Main Menu** → **Online Updater** → **Core Downloader**
3. Scroll down and find one of these cores:
   - **Nintendo - Nintendo 64 (Mupen64Plus-Next)** (Recommended)
4. Click to download and install
5. Close RetroArch

## Bitcoin Payments & Withdrawals

Configure a payment provider (**ZBD** or **LNBits**) in the in-app settings (⚙️). There are two ways a player gets paid:

1. **Linked players** — a player who links a Lightning address (QR scan or manual entry) is paid **instantly** for each kill and headshot.
2. **Unlinked players** — a player with no Lightning address automatically **accumulates a balance**. A **⚡ Withdraw** button appears on their panel once the balance is above 0; tapping it shows an **LNURL-withdraw** QR they can scan with any Lightning wallet to claim the sats. The balance persists across matches and app restarts, and resets automatically once the withdrawal is claimed.

> **LNBits users:** the withdraw flow uses the LNBits **Withdraw** extension. You must **enable the "Withdraw" extension** on your LNBits instance (from the LNBits extensions page) for unlinked-player withdrawals to work. The Admin key is also required (the same key used for payouts). ZBD works out of the box with no extra setup.

## Compatibility
N64 emulation with GoldenEye is notorious for being unstable. Note that the Complex map seems to flicker and can cause a crash

You may also need to changed the Analogue Sensitivity in Retro Arch->Settings->Input to something lower i.e. 0.7

I also prefer the controller mapping on goldeneye settings to be 1.2 solitaire with inversion disabled

### Running the Launcher

1. Open Terminal/Command Prompt in this folder
2. Install dependencies: `npm install` (first time only)
3. Run: `npm start`
4. The launcher window will open
5. Click "Load Game" to start playing
