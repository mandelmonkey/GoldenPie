Quake II — Multiplayer Quick-Deploy save states
================================================

Drop a RetroArch save state into the folder matching the player count:

  States/Multiplayer/QuakeII/2/   -> loaded by "Multiplayer -> 2"
  States/Multiplayer/QuakeII/3/   -> loaded by "Multiplayer -> 3"
  States/Multiplayer/QuakeII/4/   -> loaded by "Multiplayer -> 4"

The file name inside the folder does not matter — the app loads the first
*.state / *.stateN file it finds in the folder.

How to make one:
1. In the app, switch to Quake II mode and press Deploy.
2. In-game, set up the N-player deathmatch you want (get it to the point
   you want players to start from).
3. Press the RetroArch save-state hotkey (default F2). This writes:
      States/Mupen64Plus-Next/Quake II (USA).state
   (If you changed the save slot it will be "...Quake II (USA).state<slot>".)
4. Copy that file into the matching folder above, e.g.:
      States/Multiplayer/QuakeII/2/Quake II (USA).state
5. Back in the app, click Multiplayer -> 2 to jump straight into it.

This mirrors how GoldenEye's states live in States/Multiplayer/2|3|4/.
