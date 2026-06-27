/*
 * GameAdapter contract (documentation).
 *
 * GoldenPie is a multi-game "Bitcoin rewards for games" platform. Each supported game
 * detects frags/kills differently:
 *   - RetroArch games (GoldenEye, Quake II): read emulator RAM over UDP (handled inline
 *     in main.js today — not yet a class; physical extraction is a planned follow-up).
 *   - Quake III / Spearmint: tail the engine's kill log file (see spearmint-log.js).
 *   - Future native games: could mod the game, read stdout, or open a socket.
 *
 * Whatever the source, an adapter's job is to produce a NORMALIZED per-player stats object
 * and feed it to a single callback. Everything downstream (UI, payments, balances, LNURL
 * withdraw, theming) is game-agnostic and lives in main.js behind `handleMemoryData()`.
 *
 * Normalized stats shape (ints; stats a game doesn't track are 0):
 *   {
 *     player1, player2, player3, player4,                       // cumulative kills/frags
 *     player1Headshots, player2Headshots, player3Headshots, player4Headshots,
 *     player1Deaths, player2Deaths, player3Deaths, player4Deaths
 *   }
 *
 * Adapter interface (EventEmitter-based):
 *
 *   new Adapter(ctx)
 *     ctx = { game, config, appDir, mainWindow, ...helpers }
 *       game   - the resolved active game object (config.games[id])
 *       config - full parsed config.json
 *       appDir - __dirname of the app
 *
 *   async launch()
 *     Spawn the underlying game process. Set this.proc. Emit:
 *       'ready' once the game is up and stat production should begin
 *       'exit'  when the process closes (main → stopPolling + 'game-closed')
 *       'error' (msg) on fatal launch/setup failure (main → 'game-error')
 *
 *   getProcess()            -> the ChildProcess (for kill() on close/restart), or null
 *   startPolling(onMemoryData)
 *     Begin producing normalized stats on the adapter's own cadence; call
 *     onMemoryData(memoryData) each tick. Reset internal per-session counters here.
 *   stopPolling()           -> idempotent teardown (clear interval / close tail / socket)
 *
 * main.js owns lifecycle orchestration: the 10s startup cooldown, previous-state reset,
 * and the `handleMemoryData` seam that onMemoryData is wired to.
 */

module.exports = {};
