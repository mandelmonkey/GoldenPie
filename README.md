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

## Compatibility
N64 emulation with GoldenEye is notorious for being unstable. Note that the Complex map seems to flicker and can cause a crash

### Running the Launcher

1. Open Terminal/Command Prompt in this folder
2. Install dependencies: `npm install` (first time only)
3. Run: `npm start`
4. The launcher window will open
5. Click "Load Game" to start playing
