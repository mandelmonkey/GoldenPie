# GoldenEye 007 Launcher - Project Context

## Project Overview
An Electron-based launcher for GoldenEye 007 (N64) using RetroArch emulator with live memory reading, custom controls, save state management, and Bitcoin reward animations.

## Key Features

### 1. RetroArch Integration
- Spawns RetroArch as child process with N64 core (Mupen64Plus-Next)
- Auto-detects RetroArch and core locations on macOS
- Loads ROM from `./Roms/` directory (auto-detects .z64, .n64, .v64 files)
- Disables pause on focus loss via temp config file (`.retroarch-temp.cfg`)

### 2. Window Management
- Electron control panel positioned on right side (400px wide, full height)
- RetroArch window automatically positioned on left side using AppleScript
- Split-screen layout: game on left, controls on right

### 3. Live Memory Reading
- UDP communication with RetroArch on port 55355
- Polls memory every 1 second using Network Command Interface
- Tracks kills and headshots for all 4 players
- **Player 1 Kills**: `80079f0c`, **Headshots**: `80079ef4`
- **Player 2 Kills**: `80079F7C`, **Headshots**: `80079f64` (P1 + 0x70)
- **Player 3 Kills**: `80079FEC`, **Headshots**: `80079fd4` (P1 + 0xE0)
- **Player 4 Kills**: `8007A05C`, **Headshots**: `8007a044` (P1 + 0x150)
- Real-time stats display in control panel for all players

### 4. Custom Controls
- Bundled control scheme in `./remaps/Modern.rmp`
- Automatically copied to RetroArch's game-specific remap directory on launch
- Copies to: `~/Library/Application Support/RetroArch/config/remaps/Mupen64Plus-Next/goldeneye.rmp`

### 5. Save State System
- Save states stored in `./states/` with folder structure (e.g., `./states/dam/GoldenEye 007 (U).state0`)
- Auto-loads state on game start (configurable in `config.json`)
- Quick load buttons dynamically generated from config
- Uses RetroArch's slot 0 for all state operations
- ROM name auto-detection: scans existing state files or uses "GoldenEye 007 (U)" as fallback

#### Multiplayer State Management
- Supports player count selection (2, 3, or 4 players)
- Radio buttons appear when clicking "Multiplayer" button
- States organized in subfolders: `./states/multiplayer/2/`, `./states/multiplayer/3/`, `./states/multiplayer/4/`
- Each folder contains `GoldenEye 007 (U).state0` for that player count
- UI dynamically shows "AGENT COUNT" selector with radio buttons

### 6. Bitcoin Kill Rewards

#### Regular Kill Animation
- Detects kill count increases and triggers reward animations
- Spawns 5 Bitcoin symbols (₿) per kill
- Coins fly from bottom to top of screen with rotation and scaling
- Plays custom ka-ching sound from `./sounds/kaching.mp3`
- Gold glowing effect with text-shadow

#### Headshot Animation (Special)
- Detects headshot count increases separately
- Spawns 10 Bitcoin symbols (₿) - double the regular kills!
- **Explodes outward** from center of screen in radial burst pattern
- Bigger coins (3.5em vs 2.5em) with **red color** (#FF0000)
- More dramatic rotation (up to 720 degrees)
- Plays `./sounds/headshot.mp3` (70% volume)
- Red and gold glow effect for emphasis
- Faster animation (1.5s vs 2s)
- Priority: headshot animations take precedence over regular kill animations

### 7. GoldenEye-Themed UI
- Black background with gold accents (#D4AF37)
- Monospace font (Courier New) for tactical/classified feel
- Angular borders using CSS clip-path
- Tactical terminology: "Deploy Mission", "Intel Report", "Agent Eliminations"
- Status indicators with pulse animations
- **4-Player Grid Display**: 2x2 grid showing kills and headshots for all 4 players
- **Player-Specific Colors**:
  - Agent 1: Gold (#D4AF37)
  - Agent 2: Cyan (#00CED1)
  - Agent 3: Orange (#FF4500)
  - Agent 4: Purple (#9370DB)
  - Headshots: Orange (#FF4500) for all players

## File Structure

```
Goldeneye/
├── main.js                      # Electron main process
├── renderer.js                  # UI logic and IPC handlers
├── index.html                   # UI layout and styling
├── config.json                  # Configuration file
├── package.json                 # Node dependencies
├── .retroarch-temp.cfg          # Generated temp config for RetroArch
├── PROJECT_CONTEXT.md           # This documentation file
├── Roms/
│   └── goldeneye.z64           # GoldenEye ROM
├── remaps/
│   └── Modern.rmp              # Custom control scheme
├── states/
│   ├── dam/
│   │   └── GoldenEye 007 (U).state0  # Single player state
│   └── multiplayer/
│       ├── 2/
│       │   └── GoldenEye 007 (U).state0  # 2-player state
│       ├── 3/
│       │   └── GoldenEye 007 (U).state0  # 3-player state
│       └── 4/
│           └── GoldenEye 007 (U).state0  # 4-player state
└── sounds/
    ├── kaching.mp3             # Kill reward sound effect
    └── headshot.mp3            # Headshot reward sound effect
```

## Configuration (config.json)

```json
{
  "retroarch": {
    "remapFile": "Modern.rmp",
    "autoLoadState": "dam/GoldenEye 007 (U).state0"
  },
  "rom": {
    "path": "./Roms/goldeneye.z64"
  },
  "states": [
    {
      "label": "Dam Mission",
      "file": "dam/GoldenEye 007 (U).state0",
      "type": "single"
    },
    {
      "label": "Multiplayer",
      "file": "multiplayer",
      "type": "multiplayer"
    }
  ],
  "memoryAddresses": {
    "player1": "80079f0c",
    "player2": "80079F7C",
    "player3": "80079FEC",
    "player4": "8007A05C",
    "player1Headshots": "80079ef4",
    "player2Headshots": "80079f64",
    "player3Headshots": "80079fd4",
    "player4Headshots": "8007a044"
  }
}
```

**State Configuration:**
- `type: "single"` - Standard state, loads directly
- `type: "multiplayer"` - Shows player count selector, loads from `multiplayer/[2|3|4]/` subfolders

## Key Technical Decisions

### Memory Reading
- Uses RetroArch's Network Command Interface (UDP)
- Command format: `READ_CORE_MEMORY <address> <size>`
- Automatically enables `network_cmd_enable = "true"` in RetroArch config
- Response format: `READ_CORE_MEMORY <address> <value>`

### State File Naming
- RetroArch uses ROM's internal name for state files, not filename
- Example: "GoldenEye 007 (U).state0" (from ROM header)
- Auto-detection: scans `~/Library/Application Support/RetroArch/states/` for existing files
- State files are copied to slot 0 and loaded via `LOAD_STATE_SLOT 0` command

### Window Positioning
- Uses AppleScript to position RetroArch window:
  ```applescript
  tell application "System Events"
    tell process "RetroArch"
      set position of window 1 to {0, 0}
      set size of window 1 to {width, height}
    end tell
  end tell
  ```
- 2-second delay before positioning to ensure RetroArch window exists

### Pause Prevention
- Creates temporary config file with `pause_nonactive = "false"`
- Passed to RetroArch with `--appendconfig` flag
- Allows seamless interaction with control panel without pausing game

## IPC Communication

### Main Process → Renderer
- `game-started`: Game launched successfully
- `game-closed`: Game terminated
- `game-error`: Error occurred (with message)
- `memory-update`: Memory read results (player1-4 kills and headshots)
  - Data structure: `{ player1, player2, player3, player4, player1Headshots, player2Headshots, player3Headshots, player4Headshots }`
- `state-loaded`: Save state loaded (with filename)

### Renderer → Main Process
- `load-game`: Start game
- `restart-game`: Restart game
- `close-game`: Stop game
- `load-state`: Load specific save state
- `get-config`: Get configuration (synchronous)

## Animation System

### Kill Reward Animation
1. Tracks `previousKills` for all 4 players (starts as null)
2. On memory update, checks if `currentKills > previousKills` for each player
3. If true and `previousKills !== null`, triggers reward
4. Spawns 5 gold coins staggered by 100ms
5. Each coin: random X position, starts at bottom, flies to top over 2 seconds
6. Plays `./sounds/kaching.mp3`

### Headshot Reward Animation (Priority)
1. Tracks `previousHeadshots` for all 4 players (starts as null)
2. Checked **before** regular kills for priority
3. On memory update, checks if `currentHeadshots > previousHeadshots` for each player
4. If true and `previousHeadshots !== null`, triggers special headshot reward
5. Spawns 10 **red** coins (double the normal amount) staggered by 50ms
6. Coins explode outward from center in radial burst pattern (300-500px radius)
7. Bigger coins (3.5em), more rotation (720 degrees), faster animation (1.5s)
8. Plays `./sounds/headshot.mp3` at 70% volume

### CSS Animations
```css
/* Regular Kill Animation */
@keyframes coinFly {
  0% { translateY(0) scale(0.5) rotate(0deg); opacity: 0; }
  10% { translateY(-50px) scale(1) rotate(36deg); opacity: 1; }
  50% { translateY(-50vh) scale(1.2) rotate(180deg); opacity: 1; }
  100% { translateY(-100vh) scale(0.8) rotate(360deg); opacity: 0; }
}

/* Headshot Explosion Animation */
@keyframes coinExplode {
  0% { translate(0, 0) scale(0.3) rotate(0deg); opacity: 0; }
  10% { translate(0, 0) scale(1.5) rotate(var(--rotate-offset)); opacity: 1; }
  100% { translate(var(--target-x), var(--target-y)) scale(0.5) rotate(var(--rotate-offset)); opacity: 0; }
}
```

## Color Palette
- **Gold**: #D4AF37 (primary accent, Agent 1)
- **Black**: #000000 (background)
- **Dark Gray**: #0a0a0a, #1a1a1a (gradients)
- **Bronze**: #8B7355 (secondary accent)
- **Bright Gold**: #FFD700 (regular kill Bitcoin coins)
- **Red**: #FF0000 (headshot Bitcoin coins)
- **Cyan**: #00CED1 (Agent 2)
- **Orange**: #FF4500 (Agent 3, all headshots)
- **Purple**: #9370DB (Agent 4)

## Common Issues & Solutions

### State Files Not Loading
- Ensure state file was created from same ROM version
- Check ROM internal name matches state file naming
- State files in `./states/` are copied to RetroArch's states directory as slot 0

### Memory Reading Not Working
- Verify `network_cmd_enable = "true"` in RetroArch config
- Check RetroArch is listening on UDP port 55355
- Memory addresses are N64-specific (may differ per ROM version)

### RetroArch Not Positioning
- AppleScript requires Accessibility permissions on macOS
- Check System Preferences → Security & Privacy → Accessibility
- Grant Terminal or Electron app access

### Sound Not Playing
- Ensure `./sounds/kaching.mp3` exists
- Check console for "Failed to play sound" errors
- MP3 format required (browser audio support)

## Future Enhancement Ideas
- Actually send Bitcoin/Lightning payments on kills
- Add more memory addresses (health, ammo, mission objectives)
- Multiplayer kill tracking (player 1 vs player 2)
- Leaderboard/stats persistence
- Screenshot capture on kills
- Additional save state slots
- Cheat code support
- Video recording integration

## Dependencies
- **Electron**: ^28.0.0
- **Node.js built-ins**: fs, path, child_process, dgram

## Platform Support
- **macOS**: Fully supported (AppleScript for window positioning)
- **Windows**: Core features work, window positioning would need different approach
- **Linux**: Core features work, window positioning would need X11/Wayland tools

## Recent Changes

### 2025-10-28 - 4-Player Tracking & Headshot System
- **Multi-Player Memory Tracking**: Now tracks kills and headshots for all 4 players simultaneously
- **Discovered Headshot Addresses**: Found P1 headshot address (`80079ef4`) and calculated offsets for P2-P4
  - P2 = P1 + 0x70, P3 = P1 + 0xE0, P4 = P1 + 0x150
- **Updated UI**: Redesigned "Agent Eliminations" panel with 2x2 grid showing all 4 players
  - Each player has unique color (Gold, Cyan, Orange, Purple)
  - Shows both kills and headshots per player
- **Headshot Animation System**: Created dramatic explosion animation for headshots
  - 10 red Bitcoin symbols burst outward from center
  - Radial explosion pattern with bigger, faster, more dramatic coins
  - Separate sound effect (`headshot.mp3`)
  - Priority system: headshots detected first, take precedence over regular kills
- **Code Cleanup**: Removed candidate testing code after finding correct addresses
- **Performance**: Added command line switch to suppress CoreText warnings on macOS

### 2025-10-28 - Multiplayer Player Count Selection
- Added player count selector UI (radio buttons for 2, 3, 4 players)
- Organized multiplayer states in subfolders: `states/multiplayer/2/`, `states/multiplayer/3/`, `states/multiplayer/4/`
- Player selector appears when clicking "Multiplayer" quick load button
- Updated config.json to support `type: "multiplayer"` for states
- Added styled radio buttons matching GoldenEye theme

## Memory Address Discovery Process
When finding new memory addresses for game stats:
1. Add candidate addresses to `config.json` in `headshotCandidates` section
2. Update `main.js` to poll and log candidate values with filtering (e.g., `value > 0 && value < 4`)
3. Play the game and trigger the event (e.g., get headshots)
4. Watch console logs to see which candidate increases
5. Once found, update `memoryAddresses` with correct addresses
6. Calculate offsets for other players (typically consistent spacing)
7. Remove candidate testing code for cleaner console output

## Last Updated
2025-10-28

---
*This document serves as context for future development sessions. Read this file to understand the complete project state.*
