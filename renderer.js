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
  resetSettingsPassword: () => ipcRenderer.invoke('reset-settings-password')
};

let gameRunning = false;
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
}

// Listen for memory updates
ipcRenderer.on('memory-update', async (event, data) => {
  const settings = await getRewardSettings();
  const killReward = settings.killReward || 1;
  const headshotReward = settings.headshotReward || 1;

  // Check each player for headshot increases first (priority over regular kills)
  ['player1', 'player2', 'player3', 'player4'].forEach(player => {
    const headshotKey = player + 'Headshots';
    const currentHeadshots = data[headshotKey];
    const previousHeadshotValue = previousHeadshots[player];

    // Check if headshot count increased (but skip the first update where previous is null)
    if (previousHeadshotValue !== null && currentHeadshots > previousHeadshotValue) {
      const newHeadshots = currentHeadshots - previousHeadshotValue;
      console.log(`${player} HEADSHOT detected!`, { current: currentHeadshots, previous: previousHeadshotValue });

      // Add sats for headshots
      playerSatsEarned[player] += newHeadshots * headshotReward;
      updatePlayerSatsDisplay(player);

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

  // Check each player for kill increases
  ['player1', 'player2', 'player3', 'player4'].forEach(player => {
    const currentKills = data[player];
    const previousValue = previousKills[player];

    // Check if kill count increased (but skip the first update where previous is null)
    if (previousValue !== null && currentKills > previousValue) {
      const newKills = currentKills - previousValue;
      console.log(`${player} kill detected!`, { current: currentKills, previous: previousValue });

      // Add sats for kills
      playerSatsEarned[player] += newKills * killReward;
      updatePlayerSatsDisplay(player);

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

    // Add event listeners to player count radio buttons to auto-load when changed or clicked
    document.querySelectorAll('input[name="playerCount"]').forEach(radio => {
      const loadState = () => {
        // Auto-load multiplayer state when player count changes or is clicked
        const selectedPlayers = radio.value;
        const folderPath = `multiplayer/${selectedPlayers}`;

        console.log('Loading multiplayer state for:', selectedPlayers, 'players');
        console.log('Looking in folder:', folderPath);

        ipcRenderer.send('load-state', folderPath);
      };

      // Listen for click events only (handles both new selections and re-clicking same option)
      radio.addEventListener('click', loadState);
    });
  } else {
    stateButtonsContainer.innerHTML = '<p style="color: #999; font-size: 0.9em;">No quick load states configured</p>';
  }
}

// Listen for state loaded confirmation
ipcRenderer.on('state-loaded', (event, stateFile) => {
  console.log('State loaded:', stateFile);
});

// Initialize UI on load
updateUI();
createStateButtons();

// Load saved player sessions
loadSavedPlayerSessions();

// ============================================
// Lightning Authentication (LUD-22)
// ============================================

// Get auth server URL from config
const config = ipcRenderer.sendSync('get-config');
const AUTH_SERVER_URL = config.auth?.serverUrl || 'http://localhost:3000';

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

  console.log(`${playerKey} unlinked`);
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
    openQRModal(data.qrCode, `Spook ${playerNumber}`);

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

async function resetPassword() {
  if (!confirm('⚠️ This will permanently delete your password and all saved API keys. Are you sure?')) {
    return;
  }

  try {
    await window.electronAPI.resetSettingsPassword();

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

function clearAllSettingsFields() {
  // Clear payment provider
  document.getElementById('paymentProvider').value = '';

  // Clear reward settings
  document.getElementById('killReward').value = 1;
  document.getElementById('headshotReward').value = 1;

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

function loadSettings() {
  // Request encrypted settings from main process
  window.electronAPI.getPaymentSettings().then(settings => {
    if (settings) {
      document.getElementById('paymentProvider').value = settings.provider || '';
      document.getElementById('killReward').value = settings.killReward || 1;
      document.getElementById('headshotReward').value = settings.headshotReward || 1;

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
    headshotReward: parseInt(document.getElementById('headshotReward').value) || 1
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
      Spook ${playerNumber} is now linked and ready to receive rewards.
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

    // Sync with main process for payment processing
    syncAuthenticatedPlayers();

    console.log(`Spook ${currentLoginAgent} manually logged in with address: ${lightningAddress}`);

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
        <h3 style="color: #FF0000; margin: 0; font-size: 1.2em;">⚠️ Payment Errors - Spook ${playerNum}</h3>
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
