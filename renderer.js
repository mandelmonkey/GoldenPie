const { ipcRenderer } = require('electron');

// Create electronAPI for payment settings and player updates
window.electronAPI = {
  getPaymentSettings: () => ipcRenderer.invoke('get-payment-settings'),
  savePaymentSettings: (settings) => ipcRenderer.invoke('save-payment-settings', settings),
  updateAuthenticatedPlayers: (players) => ipcRenderer.invoke('update-authenticated-players', players),
  savePlayerSessions: (sessions) => ipcRenderer.invoke('save-player-sessions', sessions),
  loadPlayerSessions: () => ipcRenderer.invoke('load-player-sessions'),
  getPaymentErrors: (player) => ipcRenderer.invoke('get-payment-errors', player),
  clearPaymentErrors: (player) => ipcRenderer.invoke('clear-payment-errors', player),
  hasSettingsPassword: () => ipcRenderer.invoke('has-settings-password'),
  setSettingsPassword: (password) => ipcRenderer.invoke('set-settings-password', password),
  verifySettingsPassword: (password) => ipcRenderer.invoke('verify-settings-password', password),
  resetSettingsPassword: () => ipcRenderer.invoke('reset-settings-password'),
  getPlayerBalances: () => ipcRenderer.invoke('get-player-balances'),
  createWithdraw: (player) => ipcRenderer.invoke('create-withdraw', player),
  checkWithdraw: (player) => ipcRenderer.invoke('check-withdraw', player),
  // Pot / stakes mode
  potInit: (opts) => ipcRenderer.invoke('pot-init', opts),
  potCreatePayin: (slot) => ipcRenderer.invoke('pot-create-payin', slot),
  potCheckPayin: (slot) => ipcRenderer.invoke('pot-check-payin', slot),
  potStatus: () => ipcRenderer.invoke('pot-status'),
  potStart: () => ipcRenderer.invoke('pot-start'),
  potSettle: (scores) => ipcRenderer.invoke('pot-settle', scores),
  potAbort: () => ipcRenderer.invoke('pot-abort'),
  potClear: () => ipcRenderer.invoke('pot-clear'),
  updateRewardConfig: (partial) => ipcRenderer.invoke('update-reward-config', partial),
  setPanelWide: (wide) => ipcRenderer.invoke('set-panel-wide', wide)
};

// Listen for balance updates from main (authoritative for unlinked players)
ipcRenderer.on('balance-update', (event, data) => {
  const { player, balance } = data;
  playerSatsEarned[player] = balance;
  updatePlayerSatsDisplay(player);
});

let gameRunning = false;

// ---- Pot / stakes mode state ----
let lastKnownScores = { player1: 0, player2: 0, player3: 0, player4: 0 }; // final-standings snapshot
let pendingPotLaunch = null;   // the launch action to fire once all buy-ins are collected
let payinPollTimers = {};      // per-slot buy-in poll intervals
let potInProgress = false;     // a paid match is underway / awaiting settlement

let previousKills = {
  player1: null,
  player2: null,
  player3: null,
  player4: null
}; // Start as null to detect first update

let previousHeadshots = {
  player1: null,
  player2: null,
  player3: null,
  player4: null
}; // Start as null to detect first update

// Track payment errors per player
let playerPaymentErrors = {
  player1: [],
  player2: [],
  player3: [],
  player4: []
};

// Listen for payment errors from main process
ipcRenderer.on('payment-error', (event, data) => {
  const { player, error } = data;
  playerPaymentErrors[player].push(error);
  updateErrorIcon(player);
});

// Toast notification system
function showToast(message, type = 'info') {
  // Remove any existing toast
  const existingToast = document.getElementById('toast-notification');
  if (existingToast) {
    existingToast.remove();
  }

  // Determine colors based on type
  let backgroundColor, borderColor, textColor;
  switch (type) {
    case 'success':
      backgroundColor = 'rgba(0, 170, 0, 0.95)';
      borderColor = '#00FF00';
      textColor = '#FFFFFF';
      break;
    case 'error':
      backgroundColor = 'rgba(170, 0, 0, 0.95)';
      borderColor = '#FF0000';
      textColor = '#FFFFFF';
      break;
    case 'warning':
      backgroundColor = 'rgba(255, 140, 0, 0.95)';
      borderColor = '#FFD700';
      textColor = '#000000';
      break;
    default: // info
      backgroundColor = 'rgba(26, 26, 26, 0.95)';
      borderColor = '#FF8C00';
      textColor = '#FF8C00';
  }

  // Create toast element
  const toast = document.createElement('div');
  toast.id = 'toast-notification';
  toast.style.cssText = `
    position: fixed;
    top: 20px;
    right: 20px;
    background: ${backgroundColor};
    color: ${textColor};
    padding: 15px 20px;
    border: 2px solid ${borderColor};
    border-radius: 5px;
    font-family: 'Courier New', monospace;
    font-size: 0.9em;
    z-index: 10000;
    box-shadow: 0 4px 6px rgba(0, 0, 0, 0.3);
    animation: slideIn 0.3s ease-out;
    max-width: 400px;
    word-wrap: break-word;
  `;
  toast.textContent = message;

  // Add animation
  const style = document.createElement('style');
  style.textContent = `
    @keyframes slideIn {
      from {
        transform: translateX(400px);
        opacity: 0;
      }
      to {
        transform: translateX(0);
        opacity: 1;
      }
    }
    @keyframes slideOut {
      from {
        transform: translateX(0);
        opacity: 1;
      }
      to {
        transform: translateX(400px);
        opacity: 0;
      }
    }
  `;
  if (!document.getElementById('toast-styles')) {
    style.id = 'toast-styles';
    document.head.appendChild(style);
  }

  document.body.appendChild(toast);

  // Auto-remove after 3 seconds
  setTimeout(() => {
    toast.style.animation = 'slideOut 0.3s ease-in';
    setTimeout(() => {
      if (toast.parentNode) {
        toast.remove();
      }
    }, 300);
  }, 3000);
}

// UI Elements
const loadBtn = document.getElementById('loadBtn');
const restartBtn = document.getElementById('restartBtn');
const closeBtn = document.getElementById('closeBtn');
const statusText = document.getElementById('statusText');
const statusIndicator = document.getElementById('statusIndicator');
const player1KillsElement = document.getElementById('player1Kills');
const player2KillsElement = document.getElementById('player2Kills');
const player3KillsElement = document.getElementById('player3Kills');
const player4KillsElement = document.getElementById('player4Kills');
const player1HeadshotsElement = document.getElementById('player1Headshots');
const player2HeadshotsElement = document.getElementById('player2Headshots');
const player3HeadshotsElement = document.getElementById('player3Headshots');
const player4HeadshotsElement = document.getElementById('player4Headshots');
const player1SatsElement = document.getElementById('player1Sats');
const player2SatsElement = document.getElementById('player2Sats');
const player3SatsElement = document.getElementById('player3Sats');
const player4SatsElement = document.getElementById('player4Sats');

// Track sats earned per player
let playerSatsEarned = {
  player1: 0,
  player2: 0,
  player3: 0,
  player4: 0
};

// Button click handlers
function loadGame() {
  ipcRenderer.send('load-game');
}

function restartGame() {
  ipcRenderer.send('restart-game');
}

function closeGame() {
  ipcRenderer.send('close-game');
}

// Listen for game status updates from main process
ipcRenderer.on('game-started', () => {
  gameRunning = true;
  updateUI();
  if (statusText) statusText.textContent = 'MISSION ACTIVE';
});

ipcRenderer.on('game-restarting', () => {
  // Don't change gameRunning state, just update UI
  updateRestartingUI();
});

ipcRenderer.on('game-closed', () => {
  gameRunning = false;
  updateUI();
  if (statusText) statusText.textContent = 'MISSION TERMINATED';

  // Reset stats
  previousKills = { player1: null, player2: null, player3: null, player4: null };
  previousHeadshots = { player1: null, player2: null, player3: null, player4: null };
  playerSatsEarned = { player1: 0, player2: 0, player3: 0, player4: 0 };
  player1KillsElement.textContent = '--';
  player2KillsElement.textContent = '--';
  player3KillsElement.textContent = '--';
  player4KillsElement.textContent = '--';
  player1HeadshotsElement.textContent = '--';
  player2HeadshotsElement.textContent = '--';
  player3HeadshotsElement.textContent = '--';
  player4HeadshotsElement.textContent = '--';
  player1SatsElement.textContent = '₿0';
  player2SatsElement.textContent = '₿0';
  player3SatsElement.textContent = '₿0';
  player4SatsElement.textContent = '₿0';

  // Persisted withdrawable balances survive the game ending — restore them
  refreshBalances();
});

ipcRenderer.on('game-error', (event, errorMessage) => {
  gameRunning = false;
  updateUI();
  if (statusText) statusText.textContent = 'Error: ' + errorMessage;
});

// Function to play ka-ching sound from MP3 file
function playKachingSound() {
  const audio = new Audio('./sounds/kaching.mp3');
  audio.volume = 0.5; // 50% volume
  audio.play().catch(err => {
    console.error('Failed to play sound:', err);
  });
}

// Function to play headshot sound from MP3 file
function playHeadshotSound() {
  const audio = new Audio('./sounds/headshot.mp3');
  audio.volume = 0.7; // 70% volume for emphasis
  audio.play().catch(err => {
    console.error('Failed to play headshot sound:', err);
  });
}

// Function to spawn coin animation (spawn multiple coins from bottom to top)
function spawnCoinAnimation() {
  const numCoins = 5; // Spawn 5 coins per kill

  for (let i = 0; i < numCoins; i++) {
    setTimeout(() => {
      const coin = document.createElement('div');
      coin.className = 'coin';
      coin.textContent = '₿';

      // Get window dimensions
      const windowHeight = window.innerHeight;
      const windowWidth = window.innerWidth;

      // Random horizontal position across the electron window
      const randomX = Math.random() * (windowWidth - 100) + 50;

      // Start from bottom of screen
      coin.style.left = randomX + 'px';
      coin.style.top = windowHeight + 'px';

      // Add random rotation for variety
      coin.style.setProperty('--rotate-offset', Math.random() * 360 + 'deg');

      document.body.appendChild(coin);

      // Remove coin after animation completes
      setTimeout(() => {
        coin.remove();
      }, 2000);
    }, i * 100); // Stagger coins by 100ms
  }
}

// Function to spawn headshot coin animation (more dramatic, exploding outward)
function spawnHeadshotCoinAnimation() {
  const numCoins = 10; // Spawn 10 coins for headshot - double the regular!

  for (let i = 0; i < numCoins; i++) {
    setTimeout(() => {
      const coin = document.createElement('div');
      coin.className = 'coin-headshot';
      coin.textContent = '₿';

      // Get window dimensions
      const windowHeight = window.innerHeight;
      const windowWidth = window.innerWidth;

      // Start from center of screen
      const centerX = windowWidth / 2;
      const centerY = windowHeight / 2;

      coin.style.left = centerX + 'px';
      coin.style.top = centerY + 'px';

      // Calculate explosion angle (radial burst)
      const angle = (i / numCoins) * Math.PI * 2;
      const distance = 300 + Math.random() * 200; // 300-500px explosion radius
      const targetX = Math.cos(angle) * distance;
      const targetY = Math.sin(angle) * distance;

      coin.style.setProperty('--target-x', targetX + 'px');
      coin.style.setProperty('--target-y', targetY + 'px');
      coin.style.setProperty('--rotate-offset', Math.random() * 720 + 'deg'); // More rotation

      document.body.appendChild(coin);

      // Remove coin after animation completes
      setTimeout(() => {
        coin.remove();
      }, 1500);
    }, i * 50); // Faster stagger for more dramatic effect
  }
}

// Get reward amounts from settings (cached)
let cachedRewardSettings = null;

async function getRewardSettings() {
  if (!cachedRewardSettings) {
    try {
      cachedRewardSettings = await window.electronAPI.getPaymentSettings();
      if (!cachedRewardSettings) {
        cachedRewardSettings = { killReward: 1, headshotReward: 1 };
      }
    } catch (error) {
      cachedRewardSettings = { killReward: 1, headshotReward: 1 };
    }
  }
  return cachedRewardSettings;
}

// Update sats display for a player
function updatePlayerSatsDisplay(player) {
  const satsElement = document.getElementById(`${player}Sats`);
  if (satsElement) {
    satsElement.textContent = `₿${playerSatsEarned[player]}`;
  }
  updateWithdrawButton(player);
}

// True if the player has linked a Lightning address (instant-payout mode)
function isPlayerLinked(player) {
  const session = playerSessions[player];
  return !!(session && session.lightningAddress);
}

// Show the Withdraw button only for unlinked players who have a balance to claim
function updateWithdrawButton(player) {
  const btn = document.getElementById(`${player}WithdrawBtn`);
  if (!btn) return;
  const balance = playerSatsEarned[player] || 0;
  btn.style.display = (!isPlayerLinked(player) && balance > 0) ? 'inline-block' : 'none';
}

// Pull authoritative balances from main and refresh displays (used on startup
// and after a game ends, since the live display resets but balances persist)
async function refreshBalances() {
  try {
    const balances = await window.electronAPI.getPlayerBalances();
    if (!balances) return;
    ['player1', 'player2', 'player3', 'player4'].forEach(player => {
      if (!isPlayerLinked(player) && typeof balances[player] === 'number') {
        playerSatsEarned[player] = balances[player];
        updatePlayerSatsDisplay(player);
      }
    });
  } catch (error) {
    console.error('Failed to refresh balances:', error);
  }
}

// Listen for memory updates
ipcRenderer.on('memory-update', async (event, data) => {
  const settings = await getRewardSettings();
  const killReward = settings.killReward || 1;
  const headshotReward = settings.headshotReward || 1;

  // Check each player for headshot increases and resets first (priority over regular kills)
  ['player1', 'player2', 'player3', 'player4'].forEach(player => {
    const headshotKey = player + 'Headshots';
    const currentHeadshots = data[headshotKey];
    const previousHeadshotValue = previousHeadshots[player];

    // Check if headshot count reset to zero (but don't reset bitcoin here since kills will handle it)
    if (previousHeadshotValue !== null && currentHeadshots === 0 && previousHeadshotValue > 0) {
      console.log(`${player} headshot count reset to zero`);
    }
    // Check if headshot count increased (but skip the first update where previous is null)
    else if (previousHeadshotValue !== null && currentHeadshots > previousHeadshotValue) {
      const newHeadshots = currentHeadshots - previousHeadshotValue;
      console.log(`${player} HEADSHOT detected!`, { current: currentHeadshots, previous: previousHeadshotValue });

      // Add sats for headshots (faucet mode only — pot mode pays out at match end)
      if (settings.rewardMode !== 'pot') {
        playerSatsEarned[player] += newHeadshots * headshotReward;
        updatePlayerSatsDisplay(player);
      }

      // Play headshot sound and show special animation
      try {
        playHeadshotSound();
        spawnHeadshotCoinAnimation();
      } catch (error) {
        console.error('Headshot animation error:', error);
      }
    }

    // Update previous headshot value
    previousHeadshots[player] = currentHeadshots;
  });

  // Check each player for kill increases and resets
  ['player1', 'player2', 'player3', 'player4'].forEach(player => {
    const currentKills = data[player];
    const previousValue = previousKills[player];

    // Check if kill count reset to zero (reset bitcoin earnings)
    if (previousValue !== null && currentKills === 0 && previousValue > 0) {
      // Linked players are paid instantly, so the session counter can reset.
      // Unlinked players hold a real withdrawable balance (authoritative in main),
      // so leave it intact across match restarts.
      if (isPlayerLinked(player)) {
        console.log(`${player} kill count reset to zero - resetting bitcoin earnings`);
        playerSatsEarned[player] = 0;
        updatePlayerSatsDisplay(player);
      }
    }
    // Check if kill count increased (but skip the first update where previous is null)
    else if (previousValue !== null && currentKills > previousValue) {
      const newKills = currentKills - previousValue;
      console.log(`${player} kill detected!`, { current: currentKills, previous: previousValue });

      // Add sats for kills (faucet mode only — pot mode pays out at match end)
      if (settings.rewardMode !== 'pot') {
        playerSatsEarned[player] += newKills * killReward;
        updatePlayerSatsDisplay(player);
      }

      // Play sound and show animation for regular kills (not headshots)
      try {
        playKachingSound();
        spawnCoinAnimation();
      } catch (error) {
        console.error('Animation error:', error);
      }
    }

    // Update previous value
    previousKills[player] = currentKills;
  });

  // Update UI
  player1KillsElement.textContent = data.player1;
  player2KillsElement.textContent = data.player2;
  player3KillsElement.textContent = data.player3;
  player4KillsElement.textContent = data.player4;
  player1HeadshotsElement.textContent = data.player1Headshots;
  player2HeadshotsElement.textContent = data.player2Headshots;
  player3HeadshotsElement.textContent = data.player3Headshots;
  player4HeadshotsElement.textContent = data.player4Headshots;

  // Keep the latest per-player scores so pot mode can snapshot final standings at "End Match".
  lastKnownScores = {
    player1: data.player1 || 0, player2: data.player2 || 0,
    player3: data.player3 || 0, player4: data.player4 || 0
  };
});

function updateUI() {
  if (gameRunning) {
    loadBtn.disabled = true;
    restartBtn.disabled = false;
    restartBtn.textContent = '↻ Restart';
    closeBtn.disabled = false;
    if (statusIndicator) statusIndicator.className = 'status-indicator status-running';
  } else {
    loadBtn.disabled = false;
    restartBtn.disabled = true;
    restartBtn.textContent = '↻ Restart';
    closeBtn.disabled = true;
    if (statusIndicator) statusIndicator.className = 'status-indicator status-stopped';
  }
  // Can't switch game mode while a game is running
  document.querySelectorAll('#modeSwitch .mode-btn').forEach(btn => {
    btn.disabled = gameRunning;
  });
}

function updateRestartingUI() {
  // Show restarting state
  loadBtn.disabled = true;
  restartBtn.disabled = true;
  restartBtn.textContent = '↻ Restarting...';
  closeBtn.disabled = false; // Allow close during restart
  if (statusIndicator) statusIndicator.className = 'status-indicator status-running';
  if (statusText) statusText.textContent = 'RESTARTING MISSION';
}

// Create state buttons from config
function createStateButtons() {
  const config = ipcRenderer.sendSync('get-config');
  const stateButtonsContainer = document.getElementById('stateButtons');
  const playerSelector = document.getElementById('playerSelector');

  // Launch profiles (adapter-driven games like Quake III via Spearmint): each button
  // launches the game with a different configuration (main menu / N-player splitscreen),
  // rather than loading a RetroArch save state into a running game.
  const launchProfiles = config && config.game && config.game.launchProfiles;
  if (launchProfiles && launchProfiles.length > 0) {
    if (playerSelector) playerSelector.style.display = 'none';
    // Optional level list (Quake III via Spearmint). When present, picking a player-count
    // profile shows a level select before launching; "Main Menu" launches straight away.
    const maps = (config.game.spearmint && config.game.spearmint.maps) || [];

    const mkBtn = (label, onClick) => {
      const b = document.createElement('button');
      b.textContent = label;
      b.className = 'btn-secondary';
      b.style.padding = '8px 12px';
      b.style.fontSize = '0.8em';
      b.onclick = onClick;
      return b;
    };
    const spanFull = (el) => { el.style.gridColumn = '1 / -1'; return el; };

    const launch = async (profile, map) => {
      const payload = map
        ? Object.assign({}, profile, { map: map.id, label: `${profile.label} · ${map.label}` })
        : profile;
      const doLaunch = () => {
        console.log('Launching profile:', payload.label);
        ipcRenderer.send('launch-game-profile', payload);
      };
      // Pot mode: collect buy-ins before launching a multi-player match (menus launch free).
      if (!profile.menu && profile.players >= 2 && await isPotMode()) {
        beginPotBuyIn(profile.players, doLaunch);
      } else {
        doLaunch();
      }
    };

    const showProfiles = () => {
      stateButtonsContainer.innerHTML = '';
      launchProfiles.forEach((profile) => {
        stateButtonsContainer.appendChild(mkBtn(profile.label, () => {
          // Menu (no map), an explicit profile.map, or no level list -> launch directly.
          if (profile.menu || profile.map || maps.length === 0) launch(profile);
          else showMaps(profile);
        }));
      });
    };

    const showMaps = (profile) => {
      stateButtonsContainer.innerHTML = '';
      const header = spanFull(document.createElement('div'));
      header.textContent = `SELECT LEVEL — ${profile.label}`;
      header.style.fontSize = '0.78em';
      header.style.color = 'var(--c-accent)';
      header.style.textAlign = 'center';
      header.style.marginBottom = '2px';
      stateButtonsContainer.appendChild(header);
      maps.forEach((map) => stateButtonsContainer.appendChild(mkBtn(map.label, () => launch(profile, map))));
      const back = spanFull(mkBtn('← Back', showProfiles));
      back.style.opacity = '0.8';
      stateButtonsContainer.appendChild(back);
    };

    showProfiles();
    return;
  }

  if (config && config.states && config.states.length > 0) {
    config.states.forEach(state => {
      const button = document.createElement('button');
      button.textContent = state.label;
      button.className = 'btn-secondary';
      button.style.padding = '8px 12px';
      button.style.fontSize = '0.8em';
      button.style.whiteSpace = 'nowrap';
      button.style.overflow = 'hidden';
      button.style.textOverflow = 'ellipsis';

      button.onclick = () => {
        if (state.type === 'multiplayer') {
          // Just show player selector, don't load anything yet
          playerSelector.style.display = 'block';
          console.log('Multiplayer button clicked - showing player selector');
        } else {
          // Hide player selector for single player states
          playerSelector.style.display = 'none';

          // Just send the folder name, let main process find the state file
          console.log('Loading single player state from folder:', state.file);

          ipcRenderer.send('load-state', state.file);
        }
      };

      stateButtonsContainer.appendChild(button);
    });

    // Base folder for multiplayer states is game-specific (e.g. GoldenEye = "multiplayer",
    // Quake II = "Multiplayer/QuakeII"), taken from the active game's multiplayer state entry.
    const mpState = config.states.find(s => s.type === 'multiplayer');
    const mpBase = (mpState && mpState.file) ? mpState.file : 'multiplayer';

    // Add event listeners to player count radio buttons to auto-load when changed or clicked
    document.querySelectorAll('input[name="playerCount"]').forEach(radio => {
      const loadState = async () => {
        // Auto-load multiplayer state when player count changes or is clicked
        const selectedPlayers = parseInt(radio.value);
        const folderPath = `${mpBase}/${selectedPlayers}`;
        const doLoad = () => {
          console.log('Loading multiplayer state for:', selectedPlayers, 'players');
          console.log('Looking in folder:', folderPath);
          ipcRenderer.send('load-state', folderPath);
        };
        // Pot mode: collect buy-ins before loading a multi-player match.
        if (selectedPlayers >= 2 && await isPotMode()) {
          beginPotBuyIn(selectedPlayers, doLoad);
        } else {
          doLoad();
        }
      };

      // Listen for click events only (handles both new selections and re-clicking same option)
      radio.addEventListener('click', loadState);
    });
  } else {
    stateButtonsContainer.innerHTML = '<p style="color: #999; font-size: 0.9em;">No quick load states configured</p>';
  }
}

// ============================================
// Pot / stakes mode flow (buy-in → play → settle)
// ============================================

// Fresh read of reward mode (settings cache is invalidated on save).
async function isPotMode() {
  try {
    const s = await getRewardSettings();
    return !!(s && s.rewardMode === 'pot');
  } catch (_) { return false; }
}

// ---- Main-screen reward mode quick toggle (faucet <-> pot) ----
async function refreshRewardModeUI() {
  const faucetBtn = document.getElementById('modeFaucetBtn');
  const potBtn = document.getElementById('modePotBtn');
  if (!faucetBtn || !potBtn) return;
  const s = await getRewardSettings();
  const mode = (s && s.rewardMode === 'pot') ? 'pot' : 'faucet';
  faucetBtn.className = (mode === 'faucet') ? 'btn-primary' : 'btn-secondary';
  potBtn.className = (mode === 'pot') ? 'btn-primary' : 'btn-secondary';
  const buyinBar = document.getElementById('potBuyinBar');
  if (buyinBar) buyinBar.style.display = (mode === 'pot') ? 'flex' : 'none';
  const feeInput = document.getElementById('quickEntryFee');
  if (feeInput && document.activeElement !== feeInput) feeInput.value = (s && s.entryFeeSats) || 1000;
}

async function setRewardModeQuick(mode) {
  const res = await window.electronAPI.updateRewardConfig({ rewardMode: mode });
  if (!res || !res.success) {
    showToast((res && res.error) || 'Could not change reward mode', 'error');
    await refreshRewardModeUI(); // snap UI back to the real state
    return;
  }
  cachedRewardSettings = null; // re-read so the launch gate / isPotMode see the new mode at once
  await refreshRewardModeUI();
  showToast(mode === 'pot' ? '🏆 Pot mode — players pay a buy-in' : '⚡ Faucet mode — free to play, earn sats', 'success');
}

async function saveQuickEntryFee() {
  const feeInput = document.getElementById('quickEntryFee');
  const fee = parseInt(feeInput.value) || 0;
  if (fee < 1) { feeInput.value = 1000; return; }
  const res = await window.electronAPI.updateRewardConfig({ entryFeeSats: fee });
  if (!res || !res.success) { showToast((res && res.error) || 'Could not save buy-in', 'error'); return; }
  cachedRewardSettings = null;
}

function clearPayinTimers() {
  Object.keys(payinPollTimers).forEach(slot => {
    if (payinPollTimers[slot]) clearInterval(payinPollTimers[slot]);
    payinPollTimers[slot] = null;
  });
}

function updateEndMatchButton() {
  const btn = document.getElementById('endMatchBtn');
  if (btn) btn.style.display = potInProgress ? 'block' : 'none';
}

// Open the buy-in for `count` players; `launchFn` fires once everyone has paid.
async function beginPotBuyIn(count, launchFn) {
  const settings = await getRewardSettings();
  const res = await window.electronAPI.potInit({ players: count, entryFeeSats: settings && settings.entryFeeSats });
  if (!res || !res.success) {
    showToast((res && res.error) || 'Could not start the pot', 'error');
    return;
  }
  pendingPotLaunch = launchFn;
  renderPayInModal(count, res.pot);
}

function renderPayInModal(count, pot) {
  const modal = document.getElementById('payinModal');
  const content = modal.querySelector('.qr-modal-content');
  const slotsEl = document.getElementById('payinSlots');
  const startBtn = document.getElementById('payinStartBtn');
  const statusEl = document.getElementById('payinStatus');
  const subtitle = document.getElementById('payinSubtitle');

  clearPayinTimers();
  slotsEl.innerHTML = '';
  startBtn.disabled = true;
  statusEl.textContent = '';
  statusEl.style.color = 'var(--c-accent)';
  subtitle.textContent = `Buy-in ₿${pot.entryFeeSats} sats each · pot ₿${pot.entryFeeSats * count} sats · scan ONLY your own colour-matched code. The match starts once everyone has paid.`;

  // Full-screen, maximally-spread layout so nobody accidentally scans a neighbour's QR.
  content.style.maxWidth = 'none';
  content.style.maxHeight = 'none';
  content.style.width = '100vw';
  content.style.height = '100vh';
  content.style.boxSizing = 'border-box';
  content.style.padding = '14px';
  content.style.display = 'flex';
  content.style.flexDirection = 'column';
  content.style.position = 'relative';

  // Controls (status + Start/Cancel) go in the empty middle — obvious, and uses the dead space.
  const center = document.getElementById('payinCenter');
  if (center) center.style.cssText = 'position:absolute; top:50%; left:50%; transform:translate(-50%,-50%); display:flex; flex-direction:column; align-items:center; gap:14px; max-width:360px; text-align:center; z-index:2;';

  slotsEl.style.flex = '1';
  slotsEl.style.display = 'grid';
  slotsEl.style.gap = '20px';
  slotsEl.style.width = '100%';
  slotsEl.style.margin = '8px 0';
  if (count <= 3) {
    slotsEl.style.gridTemplateColumns = `repeat(${count}, 1fr)`;
    slotsEl.style.gridTemplateRows = '1fr';
  } else {
    slotsEl.style.gridTemplateColumns = '1fr 1fr';
    slotsEl.style.gridTemplateRows = '1fr 1fr';
  }

  // Per-player accent colour + push each card to its extreme so the codes sit far apart.
  const colors = ['#FF3131', '#2E86FF', '#22C55E', '#F5A623']; // P1 red · P2 blue · P3 green · P4 amber
  const align = (count <= 3)
    ? ['start center', 'center center', 'end center']              // left · centre · right
    : ['start start', 'end start', 'start end', 'end end'];        // four corners

  for (let p = 1; p <= count; p++) {
    const slot = 'player' + p;
    const color = colors[p - 1] || '#FF3131';
    const [js, as] = (align[p - 1] || 'center center').split(' ');
    const card = document.createElement('div');
    card.id = 'payin-' + slot;
    card.style.cssText = `border:4px solid ${color}; border-radius:10px; padding:16px; box-sizing:border-box; text-align:center; background:rgba(0,0,0,0.55); display:flex; flex-direction:column; align-items:center; justify-content:center; justify-self:${js}; align-self:${as};`;
    card.innerHTML =
      `<div style="font-weight:bold; font-size:1.6em; color:${color}; margin-bottom:10px; letter-spacing:3px;">PLAYER ${p}</div>` +
      `<img alt="buy-in QR" style="width:min(32vw,340px); height:min(32vw,340px); display:none; background:#fff; padding:8px; border:none; margin:0;" />` +
      `<div class="payin-state" style="font-size:1.05em; color:${color}; margin-top:10px; font-weight:bold;">Generating…</div>`;
    slotsEl.appendChild(card);
    startPayinForSlot(slot, card);
  }
  refreshPayinStartButton(); // seed the "0 / N paid" status
  modal.classList.add('active');
  window.electronAPI.setPanelWide(true); // maximise the window so the codes can spread out

  // ESC closes/cancels the buy-in (registered once).
  if (!window._payinEscHandler) {
    window._payinEscHandler = (e) => {
      if (e.key === 'Escape' && document.getElementById('payinModal').classList.contains('active')) cancelPotMatch();
    };
    document.addEventListener('keydown', window._payinEscHandler);
  }
}

async function startPayinForSlot(slot, card) {
  const img = card.querySelector('img');
  const state = card.querySelector('.payin-state');
  try {
    const res = await window.electronAPI.potCreatePayin(slot);
    if (res && res.alreadyPaid) { markSlotPaid(card); refreshPayinStartButton(); return; }
    if (!res || !res.success) {
      state.textContent = (res && res.error) || 'Error creating invoice';
      state.style.color = '#FF4500';
      return;
    }
    img.src = res.qr;
    img.style.display = '';
    state.textContent = `Scan to pay ₿${res.amount}`;
    if (payinPollTimers[slot]) clearInterval(payinPollTimers[slot]);
    payinPollTimers[slot] = setInterval(async () => {
      try {
        const chk = await window.electronAPI.potCheckPayin(slot);
        if (chk && chk.paid) {
          clearInterval(payinPollTimers[slot]); payinPollTimers[slot] = null;
          markSlotPaid(card);
          refreshPayinStartButton();
        } else if (chk && chk.checkError) {
          state.textContent = '⚠️ ' + chk.checkError;
          state.style.color = '#FF4500';
        }
      } catch (err) { console.error('pay-in poll error:', err); }
    }, 2500);
  } catch (err) {
    console.error('startPayinForSlot error:', err);
    state.textContent = 'Error';
    state.style.color = '#FF4500';
  }
}

function markSlotPaid(card) {
  const img = card.querySelector('img');
  const state = card.querySelector('.payin-state');
  if (img) img.style.display = 'none';
  if (state) { state.textContent = '✅ Paid'; state.style.color = '#00FF00'; }
}

async function refreshPayinStartButton() {
  const pot = await window.electronAPI.potStatus();
  if (!pot) return;
  const players = Object.values(pot.players);
  const paid = players.filter(p => p.paid).length;
  const all = paid === players.length && players.length > 0;
  const startBtn = document.getElementById('payinStartBtn');
  const statusEl = document.getElementById('payinStatus');
  if (all) {
    if (startBtn) startBtn.disabled = false;
    statusEl.textContent = `✅ All ${players.length} paid — start the match!`;
    statusEl.style.color = '#00FF00';
  } else {
    if (startBtn) startBtn.disabled = true;
    statusEl.textContent = `Waiting for buy-ins… ${paid} / ${players.length} paid`;
    statusEl.style.color = 'var(--c-accent)';
  }
}

async function startPotMatch() {
  clearPayinTimers();
  document.getElementById('payinModal').classList.remove('active');
  window.electronAPI.setPanelWide(false); // restore the panel to its docked width
  await window.electronAPI.potStart();
  potInProgress = true;
  updateEndMatchButton();
  if (pendingPotLaunch) { const fn = pendingPotLaunch; pendingPotLaunch = null; fn(); }
}

async function cancelPotMatch() {
  clearPayinTimers();
  document.getElementById('payinModal').classList.remove('active');
  window.electronAPI.setPanelWide(false); // restore the panel to its docked width
  pendingPotLaunch = null;
  const res = await window.electronAPI.potAbort();
  potInProgress = false;
  updateEndMatchButton();
  if (res && res.refunds && res.refunds.length) {
    showToast(`Refunded ${res.refunds.length} buy-in(s) — claim via Withdraw`, 'info');
    refreshBalances();
  }
}

async function endPotMatch() {
  const pot = await window.electronAPI.potStatus();
  if (!pot) { showToast('No active pot to settle', 'warning'); potInProgress = false; updateEndMatchButton(); return; }
  const scores = { ...lastKnownScores };
  const paidSlots = Object.keys(pot.players).filter(s => pot.players[s].paid);
  const ranked = paidSlots.map(s => ({ slot: s, score: scores[s] || 0 })).sort((a, b) => b.score - a.score);
  const standings = ranked.map((r, i) => `${i + 1}. Player ${r.slot.replace('player', '')} — ${r.score} frags`).join('\n');
  if (!confirm(`End the match and pay out the pot?\n\nFinal standings:\n${standings}\n\n(Last place gets nothing.)`)) return;

  const btn = document.getElementById('endMatchBtn');
  if (btn) { btn.disabled = true; btn.textContent = '⏳ Paying out…'; }
  try {
    const res = await window.electronAPI.potSettle(scores);
    if (!res || !res.success) {
      showToast((res && res.error) || 'Settlement failed', 'error');
      return;
    }
    potInProgress = (res.state !== 'settled'); // keep the button for retry if a payout failed
    updateEndMatchButton();
    showResultsModal(res);
    refreshBalances();
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = '🏆 End Match & Pay Out'; }
  }
}

function showResultsModal(res) {
  const modal = document.getElementById('resultsModal');
  const summary = document.getElementById('resultsSummary');
  const rows = document.getElementById('resultsRows');
  const status = document.getElementById('resultsStatus');

  summary.textContent = res.rake
    ? `Pot ₿${res.grossPot} · rake ${res.rake}% · net ₿${res.netPot}`
    : `Pot ₿${res.grossPot} sats`;
  rows.innerHTML = '';
  (res.results || []).forEach((r, i) => {
    const pnum = r.slot.replace('player', '');
    let payText;
    if (r.share <= 0) payText = '— (no payout)';
    else if (r.method === 'sent' && r.success) payText = `₿${r.share} sent → ${r.address}`;
    else if (r.method === 'balance') payText = `₿${r.share} → balance (claim via Withdraw)`;
    else if (r.method === 'already') payText = `₿${r.share} (already paid)`;
    else if (r.method === 'needs_review') payText = `₿${r.share} — ⚠️ needs manual check: ${r.error || ''}`;
    else if (!r.success) payText = `₿${r.share} — FAILED: ${r.error || 'unknown'}`;
    else payText = `₿${r.share}`;
    const div = document.createElement('div');
    div.style.cssText = 'padding:8px 0; border-bottom:1px solid rgba(255,255,255,0.12);';
    div.innerHTML = `<strong>${i + 1}. Player ${pnum}</strong> — ${r.score} frags<br>` +
      `<span style="font-size:0.85em; color:var(--c-accent);">${payText}</span>`;
    rows.appendChild(div);
  });
  const settled = res.state === 'settled';
  const anyFail = (res.results || []).some(r => r.share > 0 && !r.success);
  const anyBalance = (res.results || []).some(r => r.share > 0 && r.method === 'balance');
  status.textContent = anyFail
    ? '⚠️ Some payouts could not be confirmed. Verify them in your wallet and pay manually if needed — GoldenPie will NOT re-send. Then Clear Pot.'
    : (anyBalance ? 'Unlinked winners: use their Withdraw button to claim their share.' : '✅ Pot paid out!');
  status.style.color = anyFail ? '#FF4500' : '#00FF00';
  // A non-settled pot still holds unresolved money — offer an explicit Clear once handled.
  const clearBtn = document.getElementById('resultsClearBtn');
  if (clearBtn) clearBtn.style.display = settled ? 'none' : 'inline-block';
  modal.classList.add('active');
}

function closeResultsModal() {
  const modal = document.getElementById('resultsModal');
  if (modal) modal.classList.remove('active');
}

async function clearPotAndClose() {
  if (!confirm('Clear this pot? Only do this once you have manually settled any unconfirmed payouts — this cannot be undone.')) return;
  await window.electronAPI.potClear();
  potInProgress = false;
  updateEndMatchButton();
  closeResultsModal();
}

// Recover an unfinished pot after an app restart (crash / forgot to settle).
async function recoverPotOnStartup() {
  try {
    const pot = await window.electronAPI.potStatus();
    if (!pot) return;
    if (['collecting', 'ready'].includes(pot.state)) {
      // Never actually started (buy-ins collected but match not launched) — refund safely.
      const res = await window.electronAPI.potAbort();
      if (res && res.refunds && res.refunds.length) {
        showToast(`Recovered an unstarted pot — refunded ${res.refunds.length} buy-in(s) to balance`, 'info');
        refreshBalances();
      }
    } else if (['in_progress', 'settling', 'partial'].includes(pot.state)) {
      // The match ran — let the operator settle by final standings.
      potInProgress = true;
      updateEndMatchButton();
      showToast('Unfinished pot recovered — click End Match to pay out', 'warning');
    }
  } catch (_) { /* ignore */ }
}

document.getElementById('payinModal')?.addEventListener('click', (e) => {
  // Don't allow click-outside to dismiss the buy-in (money in flight) — require Cancel.
  if (e.target.id === 'payinModal') { /* intentionally no-op */ }
});
document.getElementById('resultsModal')?.addEventListener('click', (e) => {
  if (e.target.id === 'resultsModal') closeResultsModal();
});

// Listen for state loaded confirmation
ipcRenderer.on('state-loaded', (event, stateFile) => {
  console.log('State loaded:', stateFile);
});

// Initialize UI on load
updateUI();
createStateButtons();

// Load saved player sessions
loadSavedPlayerSessions();

// Recover any unfinished pot from a previous run
recoverPotOnStartup();

// Reflect the saved reward mode (faucet/pot) on the main-screen toggle
refreshRewardModeUI();

// ============================================
// Lightning Authentication (LUD-22)
// ============================================

// Get auth server URL from config
const config = ipcRenderer.sendSync('get-config');
const AUTH_SERVER_URL = config.auth?.serverUrl || 'http://localhost:3000';

// ---- Game mode (GoldenEye / Quake III) ----
const activeGameId = config.activeGameId || 'goldeneye';

// The active game's word for a competitor, title-cased for UI copy
// (GoldenEye → "Spook", Quake III → "Player").
function playerLabel() {
  const w = (config.game && config.game.labels && config.game.labels.player) || 'Player';
  return w.charAt(0).toUpperCase() + w.slice(1).toLowerCase();
}

// Apply the active game's theme, title and per-player labels to the UI
function applyGameUI() {
  const game = config.game;
  if (!game) return;
  const labels = game.labels || {};

  // Theme palette
  document.body.classList.toggle('theme-quake', game.theme === 'quake');

  // Title / subtitle / window title
  const titleEl = document.getElementById('appTitle');
  if (titleEl && labels.title) titleEl.textContent = labels.title;
  const subEl = document.getElementById('appSubtitle');
  if (subEl && labels.subtitle) subEl.textContent = labels.subtitle;
  if (game.shortLabel) document.title = game.shortLabel;

  // Roster heading + per-player labels
  const playerWord = labels.player || 'PLAYER';
  const roster = document.getElementById('rosterTitle');
  if (roster) roster.textContent = `[ ${playerWord}S ]`;
  for (let i = 1; i <= 4; i++) {
    const el = document.getElementById(`player${i}Label`);
    if (el) el.textContent = `${playerWord} ${i}`;
  }

  // Footer flavour lines
  const info1 = document.getElementById('infoLine1');
  if (info1 && labels.infoLine1) info1.textContent = labels.infoLine1;
  const info2 = document.getElementById('infoLine2');
  if (info2 && labels.infoLine2) info2.textContent = labels.infoLine2;

  // Stat row labels
  document.querySelectorAll('.kills-label').forEach(el => { el.textContent = `${labels.kills || 'KILLS'}:`; });
  document.querySelectorAll('.heads-label').forEach(el => { el.textContent = `${labels.headshots || 'HEADS'}:`; });

  // Hide the headshot row entirely for games that don't reward headshots (e.g. Quake III)
  const showHeads = !!(game.rewards && game.rewards.headshots);
  document.querySelectorAll('.heads-label').forEach(el => {
    if (el.parentElement) el.parentElement.style.display = showHeads ? 'flex' : 'none';
  });

  // Hide player panels beyond the game's max player count
  const maxPlayers = game.maxPlayers || 4;
  for (let i = 1; i <= 4; i++) {
    const panel = document.getElementById(`player${i}Panel`);
    if (panel) panel.style.display = (i <= maxPlayers) ? '' : 'none';
  }

  // Mode switch active state
  document.querySelectorAll('#modeSwitch .mode-btn').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.game === activeGameId);
  });
}

// Switch game mode: persist the choice in main, then reload so the whole UI re-themes
async function switchGame(gameId) {
  if (gameId === activeGameId) return;
  try {
    const result = await ipcRenderer.invoke('set-active-game', gameId);
    if (result && result.success) {
      location.reload();
    } else {
      showToast((result && result.error) || 'Could not switch game', 'error');
    }
  } catch (err) {
    console.error('switchGame failed:', err);
    showToast('Could not switch game', 'error');
  }
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', applyGameUI);
} else {
  applyGameUI();
}

const playerSessions = {
  player1: null,
  player2: null,
  player3: null,
  player4: null
};

const pollingIntervals = {
  player1: null,
  player2: null,
  player3: null,
  player4: null
};

// Toggle link/unlink for a player
function togglePlayerLink(playerNumber) {
  const playerKey = `player${playerNumber}`;
  const session = playerSessions[playerKey];

  // Check if player is already linked
  if (session && session.lightningAddress) {
    // Player is linked - unlink them
    unlinkPlayer(playerNumber);
  } else {
    // Player is not linked - show link screen
    showLoginQR(playerNumber);
  }
}

// Unlink a player
async function unlinkPlayer(playerNumber) {
  const playerKey = `player${playerNumber}`;
  const addressDiv = document.getElementById(`${playerKey}Address`);
  const linkButton = document.getElementById(`${playerKey}LinkBtn`);

  // Clear the session
  playerSessions[playerKey] = null;

  // Reset bitcoin earnings for this player
  playerSatsEarned[playerKey] = 0;
  updatePlayerSatsDisplay(playerKey);

  // Update UI
  if (addressDiv) {
    addressDiv.textContent = 'Not logged in';
    addressDiv.style.color = '#8B7355';
    addressDiv.style.fontWeight = 'normal';
  }

  if (linkButton) {
    linkButton.textContent = 'Link';
  }

  // Stop any polling
  if (pollingIntervals[playerKey]) {
    clearInterval(pollingIntervals[playerKey]);
    pollingIntervals[playerKey] = null;
  }

  // Sync with main process
  syncAuthenticatedPlayers();

  // Now unlinked → restore any accumulated withdrawable balance from main
  refreshBalances();

  console.log(`${playerKey} unlinked - bitcoin earnings reset to 0`);
}

// Update link button text based on link status
function updateLinkButton(playerNumber) {
  const playerKey = `player${playerNumber}`;
  const linkButton = document.getElementById(`${playerKey}LinkBtn`);
  const session = playerSessions[playerKey];

  if (linkButton) {
    if (session && session.lightningAddress) {
      linkButton.textContent = 'Unlink';
    } else {
      linkButton.textContent = 'Link';
    }
  }
}

// Show login QR code for a specific player
async function showLoginQR(playerNumber) {
  const playerKey = `player${playerNumber}`;
  const addressDiv = document.getElementById(`${playerKey}Address`);

  // Set current login agent for manual entry
  currentLoginAgent = playerNumber;

  // IMMEDIATELY reset the input field state before doing anything else
  const manualInput = document.getElementById('manualLightningAddress');
  const loginButton = document.querySelector('.manual-login button');

  if (manualInput) {
    console.log('Reset input - disabled:', manualInput.disabled, 'readOnly:', manualInput.readOnly);

    // Force a reflow by reading a layout property before making changes
    const _ = manualInput.offsetHeight;

    manualInput.value = '';
    manualInput.disabled = false;
    manualInput.readOnly = false;
    manualInput.removeAttribute('disabled');
    manualInput.removeAttribute('readonly');

    // Force another reflow after changes
    manualInput.offsetHeight;

    console.log('After reset - disabled:', manualInput.disabled, 'readOnly:', manualInput.readOnly);
  }

  if (loginButton) {
    loginButton.textContent = 'LINK';
    loginButton.disabled = false;
    loginButton.removeAttribute('disabled');
  }

  // Clear any error messages
  clearLightningAddressError();

  try {
    // Show generating state
    addressDiv.textContent = 'Generating...';
    addressDiv.style.color = '#8B7355';

    // Request auth session from server
    const response = await fetch(`${AUTH_SERVER_URL}/auth/session`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ playerNumber })
    });

    if (!response.ok) {
      throw new Error('Failed to create auth session');
    }

    const data = await response.json();

    // Store session ID
    playerSessions[playerKey] = {
      sessionId: data.sessionId,
      k1: data.k1
    };

    // Immediately open modal with QR code
    openQRModal(data.qrCode, `${playerLabel()} ${playerNumber}`);

    // Update status
    addressDiv.textContent = 'Waiting for scan...';

    // Start polling for authentication
    startPollingForPlayer(playerKey, data.sessionId);

    console.log(`QR code generated for ${playerKey}:`, data.sessionId);
  } catch (error) {
    console.error(`Error generating QR for ${playerKey}:`, error);
    addressDiv.textContent = 'Error - Try again';
    addressDiv.style.color = '#FF0000';
  }
}

// Start polling to check if player has authenticated
function startPollingForPlayer(playerKey, sessionId) {
  // Clear any existing interval
  if (pollingIntervals[playerKey]) {
    clearInterval(pollingIntervals[playerKey]);
  }

  // Poll every 2 seconds
  pollingIntervals[playerKey] = setInterval(async () => {
    try {
      const response = await fetch(`${AUTH_SERVER_URL}/auth/status/${sessionId}`);

      if (!response.ok) {
        console.error(`Failed to check status for ${playerKey}`);
        return;
      }

      const data = await response.json();

      if (data.authenticated && data.lightningAddress) {
        // Authentication successful!
        const addressDiv = document.getElementById(`${playerKey}Address`);

        // Show Lightning address
        addressDiv.textContent = data.lightningAddress;
        addressDiv.style.color = '#00FF00'; // Green for success
        addressDiv.style.fontWeight = 'bold';

        // Store Lightning address in session
        playerSessions[playerKey].lightningAddress = data.lightningAddress;

        // Update link button
        updateLinkButton(parseInt(playerKey.replace('player', '')));

        // Now linked → hide the Withdraw button (switches to instant payouts)
        updateWithdrawButton(playerKey);

        // Sync with main process for payment processing
        syncAuthenticatedPlayers();

        // Stop polling
        clearInterval(pollingIntervals[playerKey]);
        pollingIntervals[playerKey] = null;

        console.log(`${playerKey} authenticated:`, data.lightningAddress);

        // Show success message in modal (don't auto-close)
        const playerNumber = parseInt(playerKey.replace('player', ''));
        showLinkSuccess(playerNumber);
      }
    } catch (error) {
      console.error(`Error polling ${playerKey}:`, error);
    }
  }, 2000);
}

// Get authenticated players' Lightning addresses
function getAuthenticatedPlayers() {
  const authenticated = {};
  for (const [player, session] of Object.entries(playerSessions)) {
    if (session && session.lightningAddress) {
      authenticated[player] = session.lightningAddress;
    }
  }
  return authenticated;
}

// Sync authenticated players with main process for payment processing
async function syncAuthenticatedPlayers() {
  const authenticatedPlayers = getAuthenticatedPlayers();
  window.electronAPI.updateAuthenticatedPlayers(authenticatedPlayers);

  // Save player sessions to persistent storage
  await window.electronAPI.savePlayerSessions(playerSessions);

  console.log('Synced authenticated players:', authenticatedPlayers);
}

// Load saved player sessions on app startup
async function loadSavedPlayerSessions() {
  try {
    const savedSessions = await window.electronAPI.loadPlayerSessions();
    console.log('Loading saved player sessions:', savedSessions);

    // Restore player sessions
    Object.assign(playerSessions, savedSessions);

    // Update UI for authenticated players
    ['player1', 'player2', 'player3', 'player4'].forEach((playerKey, index) => {
      const session = playerSessions[playerKey];
      if (session && session.lightningAddress) {
        const addressElement = document.getElementById(`${playerKey}Address`);
        if (addressElement) {
          addressElement.textContent = session.lightningAddress;
          addressElement.style.color = '#00FF00'; // Green color for authenticated
          addressElement.style.fontWeight = 'bold';
        }
        // Update link button
        updateLinkButton(index + 1);
      }
    });

    // Sync with main process for payment processing
    if (Object.keys(getAuthenticatedPlayers()).length > 0) {
      syncAuthenticatedPlayers();
    }

    // Restore any accumulated withdrawable balances for unlinked players
    await refreshBalances();

  } catch (error) {
    console.error('Failed to load saved player sessions:', error);
  }
}

// Check server health on load
async function checkServerHealth() {
  try {
    const response = await fetch(`${AUTH_SERVER_URL}/health`);
    if (response.ok) {
      console.log('Auth server is running');
    }
  } catch (error) {
    console.warn('Auth server is not running. Start it with: npm run server');
  }
}

// Check server on load
checkServerHealth();

// ============================================
// QR Code Modal Functions
// ============================================

function openQRModal(qrCodeDataUrl, title) {
  const modal = document.getElementById('qrModal');
  const modalImage = document.getElementById('qrModalImage');
  const modalTitle = document.getElementById('qrModalTitle');

  modalImage.src = qrCodeDataUrl;
  modalTitle.textContent = title;
  modal.classList.add('active');

  // Completely recreate the input field to force a full reset
  setTimeout(() => {
    const manualInput = document.getElementById('manualLightningAddress');
    console.log('Modal shown - input disabled:', manualInput?.disabled, 'readOnly:', manualInput?.readOnly);

    if (manualInput) {
      const parent = manualInput.parentElement;
      const oldInput = manualInput;

      // Clone the input and replace it
      const newInput = oldInput.cloneNode(true);
      newInput.value = '';
      newInput.disabled = false;
      newInput.readOnly = false;
      newInput.removeAttribute('disabled');
      newInput.removeAttribute('readonly');

      // Replace the old input with the new one
      parent.replaceChild(newInput, oldInput);

      console.log('Recreated input - disabled:', newInput.disabled, 'readOnly:', newInput.readOnly);

      // Re-attach event listeners
      newInput.addEventListener('keypress', function (e) {
        if (e.key === 'Enter') {
          submitManualAddress();
        }
      });

      newInput.addEventListener('focus', clearLightningAddressError);
      newInput.addEventListener('input', clearLightningAddressError);

      // Try to focus
      newInput.focus();
    }
  }, 100);
}

function closeQRModal() {
  const modal = document.getElementById('qrModal');
  modal.classList.remove('active');

  // Reset all modal elements
  const manualInput = document.getElementById('manualLightningAddress');
  const loginButton = document.querySelector('.manual-login button');
  const qrImage = document.getElementById('qrModalImage');
  const qrText = document.querySelector('.qr-modal-content > p');
  const manualLabel = document.querySelector('.manual-login > p');

  // Show QR elements
  if (qrImage) {
    qrImage.style.display = '';
  }
  if (qrText) {
    qrText.style.display = '';
  }
  if (manualLabel) {
    manualLabel.style.display = '';
  }

  // Reset input form
  if (manualInput) {
    manualInput.value = '';
    manualInput.disabled = false;
    manualInput.removeAttribute('disabled');
    manualInput.style.display = '';
  }

  if (loginButton) {
    loginButton.textContent = 'LINK';
    loginButton.disabled = false;
    loginButton.removeAttribute('disabled');
    loginButton.style.display = '';
  }

  // Clear any error and success messages
  clearLightningAddressError();
  const successMsg = document.querySelector('.link-success-message');
  if (successMsg) {
    successMsg.remove();
  }

  // Reset close button
  const closeButton = document.querySelector('.qr-modal-close');
  if (closeButton) {
    closeButton.textContent = 'Close';
    closeButton.style.background = '';
    closeButton.style.borderColor = '';
  }
}

// ============================================
// Withdraw Modal Functions (LNURL-withdraw)
// ============================================

let withdrawPollInterval = null;
let withdrawCurrentPlayer = null;

// Open the withdraw flow for a player: ask main to mint an LNURL-withdraw,
// show the QR, then poll until the funds are claimed.
async function showWithdrawQR(playerNumber) {
  const playerKey = `player${playerNumber}`;
  const modal = document.getElementById('withdrawModal');
  const titleEl = document.getElementById('withdrawModalTitle');
  const amountEl = document.getElementById('withdrawAmount');
  const imageEl = document.getElementById('withdrawQrImage');
  const statusEl = document.getElementById('withdrawStatus');

  withdrawCurrentPlayer = playerKey;

  titleEl.textContent = `${playerLabel()} ${playerNumber} Withdraw`;
  amountEl.textContent = '';
  imageEl.style.display = 'none';
  imageEl.src = '';
  statusEl.textContent = 'Generating withdraw code...';
  statusEl.style.color = '#CC7722';
  modal.classList.add('active');

  try {
    const result = await window.electronAPI.createWithdraw(playerKey);
    if (!result || !result.success) {
      statusEl.textContent = (result && result.error) || 'Failed to create withdraw code';
      statusEl.style.color = '#FF4500';
      return;
    }

    amountEl.textContent = `₿${result.amount} sats`;
    imageEl.src = result.qr;
    imageEl.style.display = '';
    statusEl.textContent = 'Scan with any Lightning wallet to claim your sats';
    statusEl.style.color = '#CC7722';

    // Poll for completion every 2.5s
    if (withdrawPollInterval) clearInterval(withdrawPollInterval);
    withdrawPollInterval = setInterval(async () => {
      try {
        const check = await window.electronAPI.checkWithdraw(playerKey);
        if (check && check.completed) {
          clearInterval(withdrawPollInterval);
          withdrawPollInterval = null;
          statusEl.textContent = '✅ Withdrawal complete!';
          statusEl.style.color = '#00FF00';
          imageEl.style.display = 'none';
          showToast(`${playerLabel()} ${playerNumber} withdrawal complete!`, 'success');
          // Balance reset arrives via the balance-update event from main
          setTimeout(closeWithdrawModal, 2500);
        } else if (check && check.expired) {
          clearInterval(withdrawPollInterval);
          withdrawPollInterval = null;
          statusEl.textContent = '⌛ Withdraw code expired — close and try again';
          statusEl.style.color = '#FF4500';
          imageEl.style.display = 'none';
        }
      } catch (err) {
        console.error('Withdraw poll error:', err);
      }
    }, 2500);
  } catch (error) {
    console.error('showWithdrawQR error:', error);
    statusEl.textContent = 'Error generating withdraw code';
    statusEl.style.color = '#FF4500';
  }
}

function closeWithdrawModal() {
  const modal = document.getElementById('withdrawModal');
  if (modal) modal.classList.remove('active');
  if (withdrawPollInterval) {
    clearInterval(withdrawPollInterval);
    withdrawPollInterval = null;
  }
  withdrawCurrentPlayer = null;
}

document.getElementById('withdrawModal')?.addEventListener('click', (e) => {
  if (e.target.id === 'withdrawModal') {
    closeWithdrawModal();
  }
});

// Close modal when clicking outside the content
document.getElementById('qrModal')?.addEventListener('click', (e) => {
  if (e.target.id === 'qrModal') {
    closeQRModal();
  }
});

// Close modal with Escape key
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    closeQRModal();
    closeWithdrawModal();
    closeSettings();
  }
});

// Settings Modal Functions
async function openSettings() {
  const hasPassword = await window.electronAPI.hasSettingsPassword();

  if (!hasPassword) {
    // First time - show password setup
    const setupModal = document.getElementById('passwordSetupModal');
    setupModal.style.display = 'block';
  } else {
    // Show password entry
    const entryModal = document.getElementById('passwordEntryModal');
    entryModal.style.display = 'block';
    // Clear previous values
    document.getElementById('entryPassword').value = '';
    document.getElementById('passwordError').style.display = 'none';
  }
}

function closeSettings() {
  const modal = document.getElementById('settingsModal');
  modal.style.display = 'none';
}

function closePasswordEntry() {
  const modal = document.getElementById('passwordEntryModal');
  modal.style.display = 'none';
}

async function createPassword() {
  const newPassword = document.getElementById('newPassword').value;
  const confirmPassword = document.getElementById('confirmPassword').value;

  if (!newPassword || newPassword.length < 4) {
    showToast('Password must be at least 4 characters long', 'error');
    return;
  }

  if (newPassword !== confirmPassword) {
    showToast('Passwords do not match', 'error');
    return;
  }

  try {
    await window.electronAPI.setSettingsPassword(newPassword);

    // Close setup modal and open settings
    document.getElementById('passwordSetupModal').style.display = 'none';
    document.getElementById('newPassword').value = '';
    document.getElementById('confirmPassword').value = '';

    const settingsModal = document.getElementById('settingsModal');
    settingsModal.style.display = 'block';
    loadSettings();

    showToast('Password created successfully', 'success');
  } catch (error) {
    showToast('Failed to create password', 'error');
  }
}

async function verifyPassword() {
  const password = document.getElementById('entryPassword').value;
  const errorDiv = document.getElementById('passwordError');

  if (!password) {
    errorDiv.textContent = 'Please enter your password';
    errorDiv.style.display = 'block';
    return;
  }

  try {
    const isValid = await window.electronAPI.verifySettingsPassword(password);

    if (isValid) {
      // Close entry modal and open settings
      document.getElementById('passwordEntryModal').style.display = 'none';
      const settingsModal = document.getElementById('settingsModal');
      settingsModal.style.display = 'block';
      loadSettings();
    } else {
      errorDiv.textContent = 'Incorrect password';
      errorDiv.style.display = 'block';
      document.getElementById('entryPassword').value = '';
    }
  } catch (error) {
    errorDiv.textContent = 'Failed to verify password';
    errorDiv.style.display = 'block';
  }
}

function resetPassword() {
  showConfirmation(
    '⚠️ Reset Password & Clear Data',
    'This will permanently delete your password and all saved API keys (ZBD, LNbits). Are you sure?',
    async () => {
      try {
        await window.electronAPI.resetSettingsPassword();
        cachedRewardSettings = null; // provider/mode are gone now — don't keep serving stale pot mode
        refreshRewardModeUI(); // snap the main-screen toggle back to faucet

        // Close entry modal and show setup
        document.getElementById('passwordEntryModal').style.display = 'none';
        document.getElementById('passwordSetupModal').style.display = 'block';

        // Clear password form fields
        document.getElementById('newPassword').value = '';
        document.getElementById('confirmPassword').value = '';

        // Clear ALL settings form fields to prevent cached values
        clearAllSettingsFields();

        showToast('Password and API keys cleared successfully', 'success');
      } catch (error) {
        showToast('Failed to reset password', 'error');
      }
    }
  );
}

function clearAllSettingsFields() {
  // Clear payment provider
  document.getElementById('paymentProvider').value = '';

  // Clear reward settings
  document.getElementById('killReward').value = 1;
  document.getElementById('headshotReward').value = 1;
  document.getElementById('rewardMode').value = 'faucet';
  document.getElementById('entryFeeSats').value = 1000;
  document.getElementById('rake').value = 0;
  toggleRewardMode();

  // Clear ZBD settings
  const zbdApiKeyField = document.getElementById('zbdApiKey');
  zbdApiKeyField.value = '';
  zbdApiKeyField.removeAttribute('data-has-value');

  // Clear LNbits settings
  document.getElementById('lnbitsUrl').value = '';
  const lnbitsApiKeyField = document.getElementById('lnbitsApiKey');
  lnbitsApiKeyField.value = '';
  lnbitsApiKeyField.removeAttribute('data-has-value');

  // Hide all provider settings
  document.getElementById('zbdSettings').style.display = 'none';
  document.getElementById('lnbitsSettings').style.display = 'none';
}

// Confirmation modal functions
let confirmationCallback = null;

function showConfirmation(title, message, onConfirm) {
  document.getElementById('confirmationTitle').textContent = title;
  document.getElementById('confirmationMessage').textContent = message;
  confirmationCallback = onConfirm;
  document.getElementById('confirmationModal').style.display = 'block';
}

function confirmAction() {
  document.getElementById('confirmationModal').style.display = 'none';
  if (confirmationCallback) {
    confirmationCallback();
    confirmationCallback = null;
  }
}

function cancelConfirmation() {
  document.getElementById('confirmationModal').style.display = 'none';
  confirmationCallback = null;
}

// Add keyboard event handlers for password modals
document.addEventListener('DOMContentLoaded', function() {
  // Password setup modal - Enter key handling
  document.getElementById('newPassword').addEventListener('keypress', function(e) {
    if (e.key === 'Enter') {
      document.getElementById('confirmPassword').focus();
    }
  });

  document.getElementById('confirmPassword').addEventListener('keypress', function(e) {
    if (e.key === 'Enter') {
      createPassword();
    }
  });

  // Password entry modal - Enter key handling
  document.getElementById('entryPassword').addEventListener('keypress', function(e) {
    if (e.key === 'Enter') {
      verifyPassword();
    }
  });

  // Confirmation modal - Escape and Enter key handling
  document.addEventListener('keydown', function(e) {
    const confirmationModal = document.getElementById('confirmationModal');
    if (confirmationModal.style.display === 'block') {
      if (e.key === 'Escape') {
        e.preventDefault();
        cancelConfirmation();
      } else if (e.key === 'Enter') {
        e.preventDefault();
        confirmAction();
      }
    }
  });
});

function toggleProviderSettings() {
  const provider = document.getElementById('paymentProvider').value;
  const zbdSettings = document.getElementById('zbdSettings');
  const lnbitsSettings = document.getElementById('lnbitsSettings');

  if (provider === 'zbd') {
    zbdSettings.style.display = 'block';
    lnbitsSettings.style.display = 'none';
  } else if (provider === 'lnbits') {
    zbdSettings.style.display = 'none';
    lnbitsSettings.style.display = 'block';
  } else {
    zbdSettings.style.display = 'none';
    lnbitsSettings.style.display = 'none';
  }
}

// Show faucet vs pot reward fields based on the selected reward mode.
function toggleRewardMode() {
  const mode = document.getElementById('rewardMode').value;
  const faucet = document.getElementById('faucetSettings');
  const pot = document.getElementById('potSettings');
  if (faucet) faucet.style.display = (mode === 'pot') ? 'none' : 'block';
  if (pot) pot.style.display = (mode === 'pot') ? 'block' : 'none';
}

function loadSettings() {
  // Request encrypted settings from main process
  window.electronAPI.getPaymentSettings().then(settings => {
    if (settings) {
      document.getElementById('paymentProvider').value = settings.provider || '';
      document.getElementById('killReward').value = settings.killReward || 1;
      document.getElementById('headshotReward').value = settings.headshotReward || 1;
      document.getElementById('rewardMode').value = settings.rewardMode || 'faucet';
      document.getElementById('entryFeeSats').value = settings.entryFeeSats || 1000;
      document.getElementById('rake').value = settings.rake != null ? settings.rake : 0;
      toggleRewardMode();

      // Clear API key fields first
      document.getElementById('zbdApiKey').value = '';
      document.getElementById('zbdApiKey').removeAttribute('data-has-value');
      document.getElementById('lnbitsApiKey').value = '';
      document.getElementById('lnbitsApiKey').removeAttribute('data-has-value');

      if (settings.provider === 'zbd' && settings.zbdApiKey) {
        document.getElementById('zbdApiKey').value = '********'; // Masked
        document.getElementById('zbdApiKey').dataset.hasValue = 'true';
      }

      if (settings.provider === 'lnbits') {
        document.getElementById('lnbitsUrl').value = settings.lnbitsUrl || '';
        if (settings.lnbitsApiKey) {
          document.getElementById('lnbitsApiKey').value = '********'; // Masked
          document.getElementById('lnbitsApiKey').dataset.hasValue = 'true';
        }
      }

      toggleProviderSettings();
    } else {
      // No settings exist (e.g., after reset) - clear all fields
      clearAllSettingsFields();
    }
  }).catch(console.error);
}

function saveSettings() {
  const provider = document.getElementById('paymentProvider').value;
  if (!provider) {
    showToast('Please select a payment provider', 'warning');
    return;
  }

  const settings = {
    provider: provider,
    killReward: parseInt(document.getElementById('killReward').value) || 1,
    headshotReward: parseInt(document.getElementById('headshotReward').value) || 1,
    rewardMode: document.getElementById('rewardMode').value || 'faucet',
    entryFeeSats: parseInt(document.getElementById('entryFeeSats').value) || 1000,
    rake: parseFloat(document.getElementById('rake').value) || 0
  };

  if (provider === 'zbd') {
    const zbdApiKey = document.getElementById('zbdApiKey').value;
    if (!zbdApiKey || zbdApiKey === '********') {
      if (!document.getElementById('zbdApiKey').dataset.hasValue) {
        showToast('Please enter your ZBD API key', 'warning');
        return;
      }
      // Keep existing key if user didn't change it
      settings.keepExistingZbdKey = true;
    } else {
      settings.zbdApiKey = zbdApiKey;
    }
  } else if (provider === 'lnbits') {
    const lnbitsUrl = document.getElementById('lnbitsUrl').value;
    const lnbitsApiKey = document.getElementById('lnbitsApiKey').value;

    if (!lnbitsUrl) {
      showToast('Please enter your LNbits URL', 'warning');
      return;
    }

    if (!lnbitsApiKey || lnbitsApiKey === '********') {
      if (!document.getElementById('lnbitsApiKey').dataset.hasValue) {
        showToast('Please enter your LNbits API key', 'warning');
        return;
      }
      settings.keepExistingLnbitsKey = true;
    } else {
      settings.lnbitsApiKey = lnbitsApiKey;
    }

    settings.lnbitsUrl = lnbitsUrl;
  }

  // Save encrypted settings
  window.electronAPI.savePaymentSettings(settings).then(success => {
    if (success) {
      cachedRewardSettings = null; // reload on next use so mode/reward changes apply immediately
      refreshRewardModeUI(); // keep the main-screen toggle in sync with Settings
      showToast('✅ Settings saved successfully!', 'success');
      closeSettings();
    } else {
      showToast('❌ Failed to save settings', 'error');
    }
  }).catch(error => {
    console.error('Settings save error:', error);
    showToast('❌ Error saving settings', 'error');
  });
}

// Close settings modal when clicking outside
document.getElementById('settingsModal')?.addEventListener('click', (e) => {
  if (e.target.id === 'settingsModal') {
    closeSettings();
  }
});

// Manual Lightning Address Entry
let currentLoginAgent = null;

// Validate Lightning address by checking .well-known endpoint
async function validateLightningAddress(address) {
  if (!address.includes('@') || !address.includes('.')) {
    return { valid: false, error: 'Invalid format. Use format: user@domain.com' };
  }

  const [username, domain] = address.split('@');
  if (!username || !domain) {
    return { valid: false, error: 'Invalid format. Use format: user@domain.com' };
  }

  try {
    const wellKnownUrl = `https://${domain}/.well-known/lnurlp/${username}`;
    const response = await fetch(wellKnownUrl);

    if (!response.ok) {
      return { valid: false, error: `Domain ${domain} does not support Lightning addresses` };
    }

    const data = await response.json();
    if (!data || !data.callback) {
      return { valid: false, error: `Invalid Lightning address configuration at ${domain}` };
    }

    return { valid: true };
  } catch (error) {
    return { valid: false, error: `Cannot verify Lightning address: ${error.message}` };
  }
}

// Show error message in the modal
function showLightningAddressError(message) {
  // Remove any existing error
  const existingError = document.querySelector('.lightning-address-error');
  if (existingError) {
    existingError.remove();
  }

  // Create error element
  const errorDiv = document.createElement('div');
  errorDiv.className = 'lightning-address-error';
  errorDiv.style.cssText = `
    color: #FF4500;
    font-size: 0.8em;
    margin-top: 5px;
    padding: 5px;
    background: rgba(255, 69, 0, 0.1);
    border: 1px solid #FF4500;
    border-radius: 3px;
  `;
  errorDiv.textContent = message;

  // Insert after the manual login div
  const manualLogin = document.querySelector('.manual-login');
  manualLogin.appendChild(errorDiv);
}

// Clear error message
function clearLightningAddressError() {
  const existingError = document.querySelector('.lightning-address-error');
  if (existingError) {
    existingError.remove();
  }
}

// Show success message in modal
function showLinkSuccess(playerNumber) {
  const manualLogin = document.querySelector('.manual-login');
  const loginButton = document.querySelector('.manual-login button');
  const manualInput = document.getElementById('manualLightningAddress');
  const qrImage = document.getElementById('qrModalImage');
  const qrText = document.querySelector('.qr-modal-content > p');

  // Hide the QR code and instruction text
  if (qrImage) {
    qrImage.style.display = 'none';
  }
  if (qrText) {
    qrText.style.display = 'none';
  }

  // Hide the input form
  if (manualInput) {
    manualInput.style.display = 'none';
  }
  if (loginButton) {
    loginButton.style.display = 'none';
  }

  // Hide the manual login label
  const manualLabel = document.querySelector('.manual-login > p');
  if (manualLabel) {
    manualLabel.style.display = 'none';
  }

  // Clear any existing messages
  const existingMsg = document.querySelector('.link-success-message');
  if (existingMsg) {
    existingMsg.remove();
  }

  // Create success message
  const successDiv = document.createElement('div');
  successDiv.className = 'link-success-message';
  successDiv.style.cssText = `
    padding: 20px;
    background: rgba(0, 255, 0, 0.1);
    border: 2px solid #00FF00;
    border-radius: 5px;
    margin-top: 20px;
    text-align: center;
  `;
  successDiv.innerHTML = `
    <p style="color: #00FF00; font-weight: bold; font-size: 1.3em; margin-bottom: 15px;">
      ✅ Successfully Linked!
    </p>
    <p style="color: #00FF00; font-size: 1em;">
      ${playerLabel()} ${playerNumber} is now linked and ready to receive rewards.
    </p>
  `;

  manualLogin.appendChild(successDiv);

  // Update the close button text
  const closeButton = document.querySelector('.qr-modal-close');
  if (closeButton) {
    closeButton.textContent = 'Done';
    closeButton.style.background = '#00AA00';
    closeButton.style.borderColor = '#00FF00';
  }

  // Auto-close modal after 2 seconds
  setTimeout(() => {
    closeQRModal();
  }, 2000);
}

function appendWalletOfSatoshi() {
  const manualInput = document.getElementById('manualLightningAddress');
  const currentValue = manualInput.value.trim();

  // If the field is empty or only contains whitespace, just add @walletofsatoshi.com
  if (!currentValue) {
    manualInput.value = '@walletofsatoshi.com';
    manualInput.focus();
    return;
  }

  // If the field already ends with @walletofsatoshi.com, don't add it again
  if (currentValue.endsWith('@walletofsatoshi.com')) {
    return;
  }

  // If the field already contains an @ symbol, don't append
  if (currentValue.includes('@')) {
    return;
  }

  // Append @walletofsatoshi.com to the current username
  manualInput.value = currentValue + '@walletofsatoshi.com';
  manualInput.focus();
}

async function submitManualAddress() {
  const manualInput = document.getElementById('manualLightningAddress');
  const lightningAddress = manualInput.value.trim();
  const loginButton = document.querySelector('.manual-login button');

  if (!lightningAddress) {
    showLightningAddressError('Please enter a Lightning address');
    return;
  }

  // Clear any existing errors
  clearLightningAddressError();

  // Show validating state
  loginButton.textContent = 'VALIDATING...';
  loginButton.disabled = true;
  manualInput.disabled = true;

  // Validate Lightning address
  const validation = await validateLightningAddress(lightningAddress);

  if (!validation.valid) {
    showLightningAddressError(validation.error);
    loginButton.textContent = 'LINK';
    loginButton.disabled = false;
    manualInput.disabled = false;
    return;
  }

  // Validation successful - proceed with login
  if (currentLoginAgent) {
    const playerKey = `player${currentLoginAgent}`;

    // Update the agent's Lightning address display
    const addressElement = document.getElementById(`${playerKey}Address`);
    if (addressElement) {
      addressElement.textContent = lightningAddress;
      addressElement.style.color = '#00FF00'; // Green color when logged in
      addressElement.style.fontWeight = 'bold';
    }

    // Store the Lightning address in the existing playerSessions structure
    if (typeof playerSessions === 'undefined') {
      window.playerSessions = {};
    }

    // Create or update the player session
    if (!playerSessions[playerKey]) {
      playerSessions[playerKey] = {};
    }
    playerSessions[playerKey].lightningAddress = lightningAddress;

    // Update link button
    updateLinkButton(currentLoginAgent);

    // Now linked → hide the Withdraw button (switches to instant payouts)
    updateWithdrawButton(playerKey);

    // Sync with main process for payment processing
    syncAuthenticatedPlayers();

    console.log(`${playerLabel()} ${currentLoginAgent} manually logged in with address: ${lightningAddress}`);

    // Show success message in the modal instead of alert
    showLinkSuccess(currentLoginAgent);
  }
}

// Controls Window Function
function showControls() {
  const { ipcRenderer } = require('electron');
  ipcRenderer.send('show-controls-window');
}

// Update error icon visibility based on payment errors
function updateErrorIcon(player) {
  const errorIcon = document.getElementById(`${player}ErrorIcon`);
  if (errorIcon) {
    const hasErrors = playerPaymentErrors[player] && playerPaymentErrors[player].length > 0;
    errorIcon.style.display = hasErrors ? 'inline' : 'none';
  }
}

// Show payment errors modal
async function showPaymentErrors(player) {
  const errors = playerPaymentErrors[player] || [];
  const playerNum = player.replace('player', '');

  if (errors.length === 0) {
    return; // No errors to show
  }

  // Create modal HTML
  let errorListHTML = errors.map((error, index) => {
    const date = new Date(error.timestamp);
    const timeStr = date.toLocaleTimeString();
    const dateStr = date.toLocaleDateString();
    const errorMessage = error.error || 'Unknown error';

    return `
      <div style="background: rgba(255, 0, 0, 0.1); border: 1px solid #FF0000; border-radius: 3px; padding: 12px; margin-bottom: 10px;">
        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px;">
          <span style="color: #FF8C00; font-weight: bold; font-size: 0.9em;">${error.type === 'kill' ? '🎯 Kill Reward' : '🎯💥 Headshot Bonus'}</span>
          <span style="color: #CC7722; font-size: 0.75em;">${timeStr} ${dateStr}</span>
        </div>
        <div style="background: rgba(0, 0, 0, 0.3); padding: 8px; border-radius: 3px; margin-bottom: 8px;">
          <div style="color: #FF0000; font-size: 0.85em; font-weight: bold; margin-bottom: 4px;">
            ❌ Error Message:
          </div>
          <div style="color: #FFB6C1; font-size: 0.85em; line-height: 1.4; word-break: break-word; white-space: pre-wrap;">
            ${errorMessage}
          </div>
        </div>
        <div style="display: flex; justify-content: space-between; margin-top: 8px;">
          <div style="color: #CC7722; font-size: 0.8em;">
            <strong>Amount:</strong> ${error.amount} sats
          </div>
          <div style="color: #CC7722; font-size: 0.8em; text-align: right; max-width: 60%; word-break: break-all;">
            <strong>To:</strong> ${error.recipient}
          </div>
        </div>
      </div>
    `;
  }).join('');

  // Create modal
  const modal = document.createElement('div');
  modal.id = 'errorModal';
  modal.style.cssText = `
    position: fixed;
    top: 0;
    left: 0;
    width: 100%;
    height: 100%;
    background: rgba(0, 0, 0, 0.8);
    display: flex;
    justify-content: center;
    align-items: center;
    z-index: 9999;
  `;

  modal.innerHTML = `
    <div style="background: #1a1a1a; border: 2px solid; border-image: linear-gradient(135deg, #FF0000 0%, #FF8C00 100%) 1; border-radius: 5px; padding: 20px; max-width: 600px; max-height: 80vh; overflow-y: auto; width: 90%;">
      <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 15px;">
        <h3 style="color: #FF0000; margin: 0; font-size: 1.2em;">⚠️ Payment Errors - ${playerLabel()} ${playerNum}</h3>
        <button onclick="closeErrorModal()" style="background: transparent; border: none; color: #FF8C00; font-size: 1.5em; cursor: pointer; padding: 0; width: 30px; height: 30px;">×</button>
      </div>
      <div style="color: #CC7722; margin-bottom: 15px; font-size: 0.9em;">
        ${errors.length} payment${errors.length > 1 ? 's' : ''} failed:
      </div>
      <div>
        ${errorListHTML}
      </div>
      <div style="display: flex; gap: 10px; margin-top: 15px;">
        <button onclick="clearPlayerErrors('${player}')" style="flex: 1; padding: 10px; background: #FF8C00; border: 1px solid #FFD700; color: #000; cursor: pointer; font-family: 'Courier New', monospace; font-weight: bold; border-radius: 3px;">
          Clear Errors
        </button>
        <button onclick="closeErrorModal()" style="flex: 1; padding: 10px; background: transparent; border: 1px solid #FF8C00; color: #FF8C00; cursor: pointer; font-family: 'Courier New', monospace; border-radius: 3px;">
          Close
        </button>
      </div>
    </div>
  `;

  document.body.appendChild(modal);

  // Close on background click
  modal.addEventListener('click', (e) => {
    if (e.target === modal) {
      closeErrorModal();
    }
  });
}

// Close error modal
function closeErrorModal() {
  const modal = document.getElementById('errorModal');
  if (modal) {
    modal.remove();
  }
}

// Clear errors for a player
async function clearPlayerErrors(player) {
  playerPaymentErrors[player] = [];
  await window.electronAPI.clearPaymentErrors(player);
  updateErrorIcon(player);
  closeErrorModal();
}

// Add Enter key support and clear errors on focus for manual address input
document.addEventListener('DOMContentLoaded', function () {
  const manualInput = document.getElementById('manualLightningAddress');
  if (manualInput) {
    manualInput.addEventListener('keypress', function (e) {
      if (e.key === 'Enter') {
        submitManualAddress();
      }
    });

    // Clear errors when user starts typing
    manualInput.addEventListener('focus', clearLightningAddressError);
    manualInput.addEventListener('input', clearLightningAddressError);
  }
});
