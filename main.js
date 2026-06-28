const { app, BrowserWindow, ipcMain, dialog } = require('electron');
const path = require('path');
const { spawn } = require('child_process');
const fs = require('fs');
const dgram = require('dgram');
const crypto = require('crypto');
const QRCode = require('qrcode');
const { SpearmintLogAdapter } = require('./adapters/spearmint-log');

// Suppress annoying CoreText warnings on macOS
app.commandLine.appendSwitch('disable-features', 'CalculateNativeWinOcclusion');
app.commandLine.appendSwitch('disable-logging');

let mainWindow;
let controlsWindow = null;
let retroarchProcess = null;
let memoryClient = null;
let memoryPollingInterval = null;
let activeAdapter = null; // non-RetroArch game integration (e.g. Spearmint/Quake III)
let config = null;
let isGameShuttingDown = false;

// Load configuration
try {
  const configPath = path.join(__dirname, 'config.json');
  config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
} catch (error) {
  console.error('Failed to load config.json:', error);
}

const RETROARCH_CMD_PORT = 55355;

// ---- Active game (GoldenEye / Quake II) resolution ----
let activeGameId = (config && config.activeGame) || 'goldeneye';
let activeGame = null;
let MEMORY_ADDRESSES = {};

function getGame(id) {
  return (config && config.games && config.games[id]) ? config.games[id] : null;
}

function applyActiveGame(id) {
  if (id) activeGameId = id;
  activeGame = getGame(activeGameId) || getGame('goldeneye') || null;
  // Fall back to legacy flat config / GoldenEye defaults if games map is missing
  MEMORY_ADDRESSES = (activeGame && activeGame.memoryAddresses)
    ? activeGame.memoryAddresses
    : (config && config.memoryAddresses) || {
        player1: '80079f0c', player2: '80079F7C', player3: '80079FEC', player4: '8007A05C'
      };
  console.log(`🎮 Active game: ${activeGame ? activeGame.label : activeGameId}`);
}

applyActiveGame();

function createControlsWindow() {
  // Don't create multiple controls windows
  if (controlsWindow) {
    controlsWindow.focus();
    return;
  }

  const { screen } = require('electron');
  const primaryDisplay = screen.getPrimaryDisplay();
  const { width: screenWidth, height: screenHeight } = primaryDisplay.workAreaSize;

  // Create a large window for the controls image
  const windowWidth = Math.min(1200, screenWidth * 0.8);
  const windowHeight = Math.min(800, screenHeight * 0.8);

  controlsWindow = new BrowserWindow({
    width: windowWidth,
    height: windowHeight,
    title: '🎮 GoldenPie Controls',
    icon: process.platform === 'darwin'
      ? path.join(__dirname, 'assets', 'icons', 'icon.icns')
      : process.platform === 'win32'
        ? path.join(__dirname, 'assets', 'icons', 'icon.ico')
        : path.join(__dirname, 'assets', 'icons', 'icon.png'),
    resizable: true,
    minimizable: true,
    maximizable: true,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true
    }
  });

  // Create a temporary HTML file for the controls
  const controlsHtmlPath = path.join(__dirname, 'controls-temp.html');
  const controlsHTML = `<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <title>🎮 GoldenPie Controls</title>
  <style>
    body {
      margin: 0;
      padding: 20px;
      background: #000000;
      color: #D4AF37;
      font-family: 'Courier New', monospace;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      min-height: 100vh;
      box-sizing: border-box;
    }
    h1 {
      text-align: center;
      color: #D4AF37;
      text-shadow: 0 0 10px rgba(212, 175, 55, 0.5);
      margin-bottom: 20px;
      text-transform: uppercase;
      letter-spacing: 3px;
    }
    img {
      max-width: 100%;
      max-height: calc(100vh - 120px);
      width: auto;
      height: auto;
      border: 3px solid #D4AF37;
      box-shadow: 0 0 20px rgba(212, 175, 55, 0.3);
      background: #111;
    }
    p {
      text-align: center;
      margin-top: 20px;
      color: #8B7355;
      font-style: italic;
      letter-spacing: 1px;
    }
  </style>
</head>
<body>
  <h1>🎮 GOLDENPIE CONTROLS</h1>
  <img src="./controls.png" alt="Game Controls" onerror="this.style.display='none'; document.getElementById('error').style.display='block';">
  <div id="error" style="display: none; color: #FF6B35; text-align: center;">
    <p>⚠️ Controls image not found!</p>
    <p>Please make sure 'controls.png' exists in the application directory.</p>
  </div>
  <p>Master these controls to dominate the mission, Agent 007!</p>
</body>
</html>`;

  // Write the HTML file
  fs.writeFileSync(controlsHtmlPath, controlsHTML);

  // Load the HTML file
  controlsWindow.loadFile(controlsHtmlPath);

  // Handle window closed
  controlsWindow.on('closed', () => {
    controlsWindow = null;
    // Clean up temporary HTML file
    try {
      if (fs.existsSync(controlsHtmlPath)) {
        fs.unlinkSync(controlsHtmlPath);
      }
    } catch (error) {
      console.log('Could not clean up controls temp file:', error.message);
    }
  });

  controlsWindow.focus();
}

function createWindow() {
  const { screen } = require('electron');
  const primaryDisplay = screen.getPrimaryDisplay();
  const { width: screenWidth, height: screenHeight } = primaryDisplay.workAreaSize;

  console.log('Screen dimensions:', { screenWidth, screenHeight });

  // Position Electron window on the right side with fallbacks
  const electronWidth = 400;
  const electronHeight = screenHeight; // Full screen height
  let electronX = screenWidth - electronWidth;
  let electronY = 0;

  // Fallback positioning if window would be off-screen
  if (electronX < 0 || screenWidth < 500) {
    electronX = Math.max(0, (screenWidth - electronWidth) / 2); // Center horizontally
    electronY = 0; // Keep at top when centered
  }

  console.log('Window position:', { electronX, electronY, electronWidth, electronHeight });

  const iconPath = process.platform === 'darwin'
    ? path.join(__dirname, 'assets', 'icons', 'icon.icns')
    : process.platform === 'win32'
      ? path.join(__dirname, 'assets', 'icons', 'icon.ico')
      : path.join(__dirname, 'assets', 'icons', 'icon.png');

  console.log('Window icon path:', iconPath);
  console.log('Icon exists:', fs.existsSync(iconPath));

  mainWindow = new BrowserWindow({
    width: electronWidth,
    height: electronHeight,
    x: electronX,
    y: electronY,
    icon: iconPath, // App icon
    show: false, // Don't show until ready
    resizable: true,
    minimizable: true,
    maximizable: true,
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false
    }
  });

  mainWindow.loadFile('index.html');
  // mainWindow.webContents.openDevTools(); // Uncomment for debugging

  // Show window when ready
  mainWindow.once('ready-to-show', () => {
    console.log('Window ready to show');
    mainWindow.show();
    mainWindow.focus(); // Bring to front
  });

  // Fallback - force show after 2 seconds if not shown
  setTimeout(() => {
    if (mainWindow && !mainWindow.isVisible()) {
      console.log('Force showing window');
      mainWindow.show();
      mainWindow.center(); // Center on screen as fallback
      mainWindow.focus();
    }
  }, 2000);

  mainWindow.on('closed', function () {
    stopMemoryPolling();
    if (retroarchProcess) {
      retroarchProcess.kill();
    }
    if (activeAdapter) {
      const proc = activeAdapter.getProcess && activeAdapter.getProcess();
      try { if (proc) proc.kill(); } catch (_) {}
      activeAdapter = null;
    }
    mainWindow = null;
  });
}

app.whenReady().then(() => {
  // Restore the previously selected game mode (GoldenEye / Quake II)
  loadPersistedGameSelection();

  // Set dock icon on macOS
  if (process.platform === 'darwin') {
    // Try PNG first as fallback, then ICNS
    const pngIconPath = path.join(__dirname, 'assets', 'icons', 'icon.png');
    const icnsIconPath = path.join(__dirname, 'assets', 'icons', 'icon.icns');

    let iconPath = null;
    if (fs.existsSync(pngIconPath)) {
      iconPath = pngIconPath;
    } else if (fs.existsSync(icnsIconPath)) {
      iconPath = icnsIconPath;
    }

    if (iconPath) {
      console.log('Setting dock icon:', iconPath);
      try {
        app.dock.setIcon(iconPath);
      } catch (error) {
        console.error('Failed to set dock icon:', error.message);
      }
    } else {
      console.log('No icon file found');
    }
  }

  createWindow();

  app.on('activate', function () {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', function () {
  stopMemoryPolling();
  if (retroarchProcess) {
    retroarchProcess.kill();
  }
  if (activeAdapter) {
    const proc = activeAdapter.getProcess && activeAdapter.getProcess();
    try { if (proc) proc.kill(); } catch (_) {}
    activeAdapter = null;
  }
  app.quit();
});

// IPC handlers
ipcMain.on('load-game', (event) => {
  loadGame();
});

ipcMain.on('restart-game', (event) => {
  restartGame();
});

ipcMain.on('close-game', (event) => {
  closeGame();
});

// Launch an adapter game (e.g. Quake III) with a specific profile (player count / main menu)
ipcMain.on('launch-game-profile', (event, profile) => {
  loadGameWithAdapter(profile);
});

ipcMain.on('load-state', (event, stateFile) => {
  loadState(stateFile);
});

ipcMain.on('get-config', (event) => {
  // Return base config enriched with the resolved active game so the renderer
  // can read config.states / config.game without knowing the games map shape.
  event.returnValue = Object.assign({}, config, {
    activeGameId,
    game: activeGame,
    states: (activeGame && activeGame.states) || config.states || []
  });
});

// ---- Persisted game selection (GoldenEye / Quake II) ----
function getSelectedGamePath() {
  return getUserFilePath('.selected-game.json');
}

function loadPersistedGameSelection() {
  try {
    const p = getSelectedGamePath();
    if (fs.existsSync(p)) {
      const saved = JSON.parse(fs.readFileSync(p, 'utf8'));
      if (saved && saved.activeGame && getGame(saved.activeGame)) {
        applyActiveGame(saved.activeGame);
      }
    }
  } catch (err) {
    console.error('Failed to load persisted game selection:', err);
  }
}

ipcMain.on('get-active-game', (event) => {
  event.returnValue = activeGameId;
});

ipcMain.handle('set-active-game', async (event, gameId) => {
  if (!getGame(gameId)) {
    return { success: false, error: `Unknown game: ${gameId}` };
  }
  if (isGameRunning()) {
    return { success: false, error: 'Stop the running game before switching modes' };
  }
  applyActiveGame(gameId);
  try {
    fs.writeFileSync(getSelectedGamePath(), JSON.stringify({ activeGame: gameId }), 'utf8');
  } catch (err) {
    console.error('Failed to persist game selection:', err);
  }
  return { success: true, activeGameId };
});

// Collect every ROM file under Roms/ (recursively)
function findAllRoms(dir) {
  const found = [];
  if (!fs.existsSync(dir)) return found;
  for (const item of fs.readdirSync(dir)) {
    const itemPath = path.join(dir, item);
    let stat;
    try { stat = fs.statSync(itemPath); } catch (e) { continue; }
    if (stat.isDirectory()) {
      found.push(...findAllRoms(itemPath));
    } else if (/\.(z64|n64|v64)$/i.test(item)) {
      found.push(itemPath);
    }
  }
  return found;
}

// Find the ROM for the active game using its romMatch substring; falls back to
// the first ROM found so a single-game setup still works.
function findActiveRom() {
  const romsDir = path.join(__dirname, 'Roms');
  const roms = findAllRoms(romsDir);
  if (roms.length === 0) return null;
  const match = (activeGame && activeGame.romMatch) ? activeGame.romMatch.toLowerCase() : null;
  if (match) {
    const hit = roms.find(r => r.toLowerCase().includes(match));
    if (hit) return hit;
    console.warn(`No ROM matched "${match}" for ${activeGameId}; falling back to first ROM`);
  }
  return roms[0];
}

ipcMain.on('get-rom-basename', (event) => {
  const romPath = findActiveRom();
  if (romPath) {
    const baseName = path.basename(romPath, path.extname(romPath));
    console.log('Auto-detected ROM base name:', baseName);
    event.returnValue = baseName;
    return;
  }

  // Fallback
  console.log('No ROM found, using default base name');
  event.returnValue = 'GoldenEye 007 (U)';
});

// Payment settings encryption
const ENCRYPTION_KEY = 'GoldenPie-Bitcoin-Settings-Key-2024-v1'; // 32 bytes
// Helper function to get user file path - uses project directory in dev, userData in built app
function getUserFilePath(filename) {
  if (app.isPackaged) {
    return path.join(app.getPath('userData'), filename);
  } else {
    return path.join(__dirname, filename);
  }
}

const SETTINGS_FILE = getUserFilePath('.bitcoin-settings.enc');
const PLAYER_SESSIONS_FILE = getUserFilePath('.player-sessions.enc');
const PLAYER_BALANCES_FILE = getUserFilePath('.player-balances.json');

function encrypt(text) {
  const key = crypto.createHash('sha256').update(ENCRYPTION_KEY).digest();
  const iv = crypto.randomBytes(16);
  const cipher = crypto.createCipher('aes-256-cbc', key);
  let encrypted = cipher.update(text, 'utf8', 'hex');
  encrypted += cipher.final('hex');
  return iv.toString('hex') + ':' + encrypted;
}

function decrypt(encryptedData) {
  try {
    const key = crypto.createHash('sha256').update(ENCRYPTION_KEY).digest();
    const textParts = encryptedData.split(':');
    const iv = Buffer.from(textParts.shift(), 'hex');
    const encryptedText = textParts.join(':');
    const decipher = crypto.createDecipher('aes-256-cbc', key);
    let decrypted = decipher.update(encryptedText, 'hex', 'utf8');
    decrypted += decipher.final('utf8');
    return decrypted;
  } catch (error) {
    console.error('Decryption failed:', error);
    return null;
  }
}

// IPC handlers for payment settings
ipcMain.handle('get-payment-settings', async () => {
  try {
    if (fs.existsSync(SETTINGS_FILE)) {
      const encryptedData = fs.readFileSync(SETTINGS_FILE, 'utf8');
      const decryptedData = decrypt(encryptedData);
      if (decryptedData) {
        return JSON.parse(decryptedData);
      }
    }
    return null;
  } catch (error) {
    console.error('Failed to load payment settings:', error);
    return null;
  }
});

ipcMain.handle('save-payment-settings', async (event, settings) => {
  try {
    // Handle keeping existing keys
    let finalSettings = { ...settings };

    if (settings.keepExistingZbdKey || settings.keepExistingLnbitsKey) {
      // Load existing settings to preserve keys
      const existing = await loadPaymentSettings();
      if (existing) {
        if (settings.keepExistingZbdKey && existing.zbdApiKey) {
          finalSettings.zbdApiKey = existing.zbdApiKey;
        }
        if (settings.keepExistingLnbitsKey && existing.lnbitsApiKey) {
          finalSettings.lnbitsApiKey = existing.lnbitsApiKey;
        }
      }
    }

    // Remove the keep flags
    delete finalSettings.keepExistingZbdKey;
    delete finalSettings.keepExistingLnbitsKey;

    const dataToEncrypt = JSON.stringify(finalSettings);
    const encryptedData = encrypt(dataToEncrypt);
    fs.writeFileSync(SETTINGS_FILE, encryptedData, 'utf8');
    console.log('Payment settings saved successfully');
    return true;
  } catch (error) {
    console.error('Failed to save payment settings:', error);
    return false;
  }
});

async function loadPaymentSettings() {
  try {
    if (fs.existsSync(SETTINGS_FILE)) {
      const encryptedData = fs.readFileSync(SETTINGS_FILE, 'utf8');
      const decryptedData = decrypt(encryptedData);
      if (decryptedData) {
        return JSON.parse(decryptedData);
      }
    }
    return null;
  } catch (error) {
    console.error('Failed to load payment settings:', error);
    return null;
  }
}

// Player sessions save/load functions
async function savePlayerSessions(sessions) {
  try {
    const dataToEncrypt = JSON.stringify(sessions);
    const encryptedData = encrypt(dataToEncrypt);
    fs.writeFileSync(PLAYER_SESSIONS_FILE, encryptedData, 'utf8');
    console.log('Player sessions saved successfully');
    return true;
  } catch (error) {
    console.error('Failed to save player sessions:', error);
    return false;
  }
}

async function loadPlayerSessions() {
  try {
    if (fs.existsSync(PLAYER_SESSIONS_FILE)) {
      const encryptedData = fs.readFileSync(PLAYER_SESSIONS_FILE, 'utf8');
      const decryptedData = decrypt(encryptedData);
      if (decryptedData) {
        return JSON.parse(decryptedData);
      }
    }
    return {};
  } catch (error) {
    console.error('Failed to load player sessions:', error);
    return {};
  }
}

// IPC handlers for player sessions
ipcMain.handle('save-player-sessions', async (event, sessions) => {
  return await savePlayerSessions(sessions);
});

ipcMain.handle('load-player-sessions', async () => {
  return await loadPlayerSessions();
});

// ============================================
// Local player balances (LNURL-withdraw mode)
// ============================================
// Players who have NOT linked a Lightning address accumulate their kill/headshot
// rewards into a local balance instead of receiving instant payments. They can
// later pull the balance with any wallet via an LNURL-withdraw QR code.
let playerBalances = { player1: 0, player2: 0, player3: 0, player4: 0 };
// Track an in-flight withdrawal per player so polling can reset the right amount.
let activeWithdrawals = { player1: null, player2: null, player3: null, player4: null };

function loadPlayerBalances() {
  try {
    if (fs.existsSync(PLAYER_BALANCES_FILE)) {
      const data = JSON.parse(fs.readFileSync(PLAYER_BALANCES_FILE, 'utf8'));
      playerBalances = { player1: 0, player2: 0, player3: 0, player4: 0, ...data };
    }
  } catch (error) {
    console.error('Failed to load player balances:', error);
  }
  return playerBalances;
}

function savePlayerBalances() {
  try {
    fs.writeFileSync(PLAYER_BALANCES_FILE, JSON.stringify(playerBalances), 'utf8');
  } catch (error) {
    console.error('Failed to save player balances:', error);
  }
}

function addPlayerBalance(player, amount) {
  playerBalances[player] = (playerBalances[player] || 0) + amount;
  savePlayerBalances();
  if (mainWindow) {
    mainWindow.webContents.send('balance-update', { player, balance: playerBalances[player] });
  }
  return playerBalances[player];
}

// Load persisted balances at startup
loadPlayerBalances();

ipcMain.handle('get-player-balances', async () => {
  return playerBalances;
});

// IPC handler for showing controls window
ipcMain.on('show-controls-window', () => {
  createControlsWindow();
});

// LNBits Lightning Address Payment Function
async function sendLNBitsPayment(lightningAddress, amount, comment = '', playerId = null) {
  try {
    const settings = await loadPaymentSettings();
    if (!settings || settings.provider !== 'lnbits' || !settings.lnbitsApiKey || !settings.lnbitsUrl) {
      console.error('LNBits settings not configured');
      return { success: false, error: 'LNBits settings not configured' };
    }

    // Step 1: Resolve Lightning address to LNURL-pay
    const [username, domain] = lightningAddress.split('@');
    if (!username || !domain) {
      console.error('Invalid Lightning address format');
      return { success: false, error: 'Invalid Lightning address format' };
    }

    console.log(`Resolving Lightning address ${lightningAddress}...`);
    const wellKnownUrl = `https://${domain}/.well-known/lnurlp/${username}`;

    const lnurlResponse = await fetch(wellKnownUrl);
    if (!lnurlResponse.ok) {
      console.error('Failed to resolve Lightning address');
      return { success: false, error: 'Failed to resolve Lightning address' };
    }

    const lnurlData = await lnurlResponse.json();
    if (!lnurlData.callback) {
      console.error('Invalid LNURL-pay response');
      return { success: false, error: 'Invalid LNURL-pay response' };
    }

    // Step 2: Get payment request from LNURL callback
    const amountMsat = amount * 1000; // Convert sats to millisats
    const callbackUrl = `${lnurlData.callback}?amount=${amountMsat}&comment=${encodeURIComponent(comment)}`;

    const payRequestResponse = await fetch(callbackUrl);
    if (!payRequestResponse.ok) {
      console.error('Failed to get payment request');
      return { success: false, error: 'Failed to get payment request' };
    }

    const payRequestData = await payRequestResponse.json();
    if (!payRequestData.pr) {
      console.error('No payment request in response');
      return { success: false, error: 'No payment request in response' };
    }

    console.log(`Sending ${amount} sats to ${lightningAddress} via LNBits...`);

    // Step 3: Pay the invoice via LNBits API
    const lnbitsUrl = settings.lnbitsUrl.replace(/\/$/, ''); // Remove trailing slash

    const response = await fetch(`${lnbitsUrl}/api/v1/payments`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Api-Key': settings.lnbitsApiKey
      },
      body: JSON.stringify({
        out: true,
        bolt11: payRequestData.pr
      })
    });

    const result = await response.json();

    if (response.ok && result.payment_hash) {
      console.log(`✅ Payment successful: ${amount} sats sent to ${lightningAddress}`);
      return {
        success: true,
        transactionId: result.payment_hash,
        amount: amount,
        recipient: lightningAddress
      };
    } else {
      // Provide specific error messages for common issues
      let errorMessage = result.detail || result.message || result.error || 'Payment failed';

      // Add helpful context based on status code and error content
      if (response.status === 401 || response.status === 403) {
        errorMessage = `Authentication failed: ${errorMessage}. Make sure you are using the Admin key (not Invoice/Read key) from your LNBits wallet.`;
      } else if (response.status === 400) {
        errorMessage = `Invalid request: ${errorMessage}`;
      } else if (response.status >= 500) {
        errorMessage = `LNBits server error (${response.status}): ${errorMessage}`;
      }

      // Add suggestion for "Only internal invoices" regardless of status code
      if (result.detail && result.detail.includes('Only internal invoices')) {
        errorMessage += '\n💡 Suggestion: This error often means you need to use an Admin key instead of Invoice/Read key, or enable external payments in your LNBits settings.';
      }

      console.error('❌ LNBits payment failed:', {
        status: response.status,
        error: errorMessage,
        details: result
      });

      return {
        success: false,
        error: errorMessage,
        details: result
      };
    }

  } catch (error) {
    console.error('❌ LNBits payment error:', error);
    return { success: false, error: error.message };
  }
}

// ZBD Lightning Address Payment Function
async function sendZBDPayment(lightningAddress, amount, comment = '', playerId = null) {
  try {
    const settings = await loadPaymentSettings();
    if (!settings || settings.provider !== 'zbd' || !settings.zbdApiKey) {
      console.error('ZBD API key not configured');
      return { success: false, error: 'ZBD API key not configured' };
    }

    const paymentData = {
      lnAddress: lightningAddress,
      amount: (amount * 1000).toString(), // Convert sats to millisats (ZBD API requirement)
      comment: comment,
      internalId: playerId ? `goldenpie-${playerId}-${Date.now()}` : `goldenpie-${Date.now()}`
    };

    console.log(`Sending ${amount} sats to ${lightningAddress} via ZBD...`);

    const response = await fetch('https://api.zebedee.io/v0/ln-address/send-payment', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'apikey': settings.zbdApiKey
      },
      body: JSON.stringify(paymentData)
    });

    const result = await response.json();

    if (response.ok && result.success) {
      console.log(`✅ Payment successful: ${amount} sats sent to ${lightningAddress}`);
      return {
        success: true,
        transactionId: result.data?.id,
        amount: amount,
        recipient: lightningAddress
      };
    } else {
      console.error('❌ ZBD payment failed:', result);
      return {
        success: false,
        error: result.message || 'Payment failed',
        details: result
      };
    }

  } catch (error) {
    console.error('❌ ZBD payment error:', error);
    return { success: false, error: error.message };
  }
}

// ============================================
// LNURL-withdraw generation (for players without a Lightning address)
// ============================================

// Create an LNURL-withdraw via the ZBD Withdrawal Requests API
async function createZBDWithdraw(amountSats, description) {
  const settings = await loadPaymentSettings();
  if (!settings || !settings.zbdApiKey) {
    return { success: false, error: 'ZBD API key not configured' };
  }
  const response = await fetch('https://api.zebedee.io/v0/withdrawal-requests', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'apikey': settings.zbdApiKey },
    body: JSON.stringify({
      amount: (amountSats * 1000).toString(), // millisats
      description: description || 'GoldenPie withdrawal',
      expiresIn: 600
    })
  });
  const result = await response.json();
  console.log('ZBD withdrawal-request response:', JSON.stringify(result));
  if (!response.ok || result.success === false) {
    return { success: false, error: (result && (result.message || result.error)) || `ZBD error ${response.status}` };
  }
  const data = result.data || result;
  // ZBD nests the LNURL inside data.invoice — .uri is the lightning:-prefixed form
  const invoice = data.invoice || {};
  const lnurl = invoice.uri || invoice.request;
  if (!lnurl) {
    return { success: false, error: 'ZBD did not return an LNURL' };
  }
  return { success: true, provider: 'zbd', id: data.id, lnurl };
}

async function checkZBDWithdraw(id) {
  const settings = await loadPaymentSettings();
  const response = await fetch(`https://api.zebedee.io/v0/withdrawal-requests/${id}`, {
    headers: { 'apikey': settings.zbdApiKey }
  });
  const result = await response.json();
  const data = (result && result.data) || result;
  const status = String((data && data.status) || '').toLowerCase();
  return { completed: status === 'completed', expired: status === 'expired', status };
}

// Create an LNURL-withdraw via the LNBits withdraw extension
async function createLNBitsWithdraw(amountSats, description) {
  const settings = await loadPaymentSettings();
  if (!settings || !settings.lnbitsApiKey || !settings.lnbitsUrl) {
    return { success: false, error: 'LNBits settings not configured' };
  }
  const lnbitsUrl = settings.lnbitsUrl.replace(/\/$/, '');
  const response = await fetch(`${lnbitsUrl}/withdraw/api/v1/links`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Api-Key': settings.lnbitsApiKey },
    body: JSON.stringify({
      title: description || 'GoldenPie withdrawal',
      min_withdrawable: amountSats,
      max_withdrawable: amountSats,
      uses: 1,
      wait_time: 1
    })
  });
  const result = await response.json();
  console.log('LNBits withdraw-link response:', JSON.stringify(result));
  if (!response.ok || !result.lnurl) {
    let error = (result && result.detail) || `LNBits error ${response.status}`;
    if (response.status === 404) {
      error = 'LNBits withdraw extension not found — enable the "Withdraw" extension on your LNBits instance.';
    }
    return { success: false, error };
  }
  return { success: true, provider: 'lnbits', id: result.id, lnurl: result.lnurl };
}

async function checkLNBitsWithdraw(id) {
  const settings = await loadPaymentSettings();
  const lnbitsUrl = settings.lnbitsUrl.replace(/\/$/, '');
  const response = await fetch(`${lnbitsUrl}/withdraw/api/v1/links/${id}`, {
    headers: { 'X-Api-Key': settings.lnbitsApiKey }
  });
  const result = await response.json();
  const used = (result && result.used) || 0;
  return { completed: used > 0, expired: false, status: used > 0 ? 'completed' : 'pending' };
}

// IPC: create a withdraw QR for a player's accumulated balance
ipcMain.handle('create-withdraw', async (event, player) => {
  try {
    const balance = playerBalances[player] || 0;
    if (balance <= 0) {
      return { success: false, error: 'No balance to withdraw' };
    }
    const settings = await loadPaymentSettings();
    if (!settings || !settings.provider) {
      return { success: false, error: 'No payment provider configured' };
    }
    const description = `GoldenPie balance - ${player}`;
    let result;
    if (settings.provider === 'zbd') {
      result = await createZBDWithdraw(balance, description);
    } else if (settings.provider === 'lnbits') {
      result = await createLNBitsWithdraw(balance, description);
    } else {
      return { success: false, error: `Unknown provider: ${settings.provider}` };
    }
    if (!result.success || !result.lnurl) {
      console.error('Withdraw creation failed:', result);
      return { success: false, error: result.error || 'Failed to create withdraw link' };
    }
    // Remember the in-flight withdrawal so polling resets the right amount
    activeWithdrawals[player] = { id: result.id, provider: result.provider, amount: balance };
    const lnurlStr = String(result.lnurl);
    const qr = await QRCode.toDataURL(lnurlStr, { errorCorrectionLevel: 'M', margin: 2, width: 320 });
    return { success: true, lnurl: lnurlStr, qr, amount: balance, id: result.id, provider: result.provider };
  } catch (error) {
    console.error('create-withdraw error:', error);
    return { success: false, error: error.message };
  }
});

// IPC: poll whether a player's withdraw has been claimed; reset balance when done
ipcMain.handle('check-withdraw', async (event, player) => {
  try {
    const active = activeWithdrawals[player];
    if (!active) {
      return { success: false, error: 'No active withdrawal' };
    }
    let result;
    if (active.provider === 'zbd') {
      result = await checkZBDWithdraw(active.id);
    } else if (active.provider === 'lnbits') {
      result = await checkLNBitsWithdraw(active.id);
    } else {
      return { success: false, error: 'Unknown provider' };
    }
    if (result && result.completed) {
      // Deduct only the withdrawn amount in case the balance grew since the QR was made
      playerBalances[player] = Math.max(0, (playerBalances[player] || 0) - active.amount);
      savePlayerBalances();
      activeWithdrawals[player] = null;
      if (mainWindow) {
        mainWindow.webContents.send('balance-update', { player, balance: playerBalances[player] });
      }
      console.log(`✅ Withdrawal claimed for ${player} (${active.amount} sats). New balance: ${playerBalances[player]}`);
      return { success: true, completed: true, balance: playerBalances[player] };
    }
    if (result && result.expired) {
      activeWithdrawals[player] = null;
      return { success: true, completed: false, expired: true, status: 'expired' };
    }
    return { success: true, completed: false, status: result ? result.status : 'pending' };
  } catch (error) {
    console.error('check-withdraw error:', error);
    return { success: false, error: error.message };
  }
});

// Store authenticated players for payment processing
let authenticatedPlayers = {};

// Store payment errors per player
let paymentErrors = {
  player1: [],
  player2: [],
  player3: [],
  player4: []
};

// Add cooldown tracking for game startup
let gameStartTime = null;
const GAME_STARTUP_COOLDOWN = 10000; // 10 seconds in milliseconds

// Track state loading for auto-menu functionality
let hasManuallyLoadedState = false;
let menuAutoLoadTimer = null;

// Store previous values to prevent duplicate payments
let previousGameState = {
  player1Kills: 0,
  player2Kills: 0,
  player3Kills: 0,
  player4Kills: 0,
  player1Headshots: 0,
  player2Headshots: 0,
  player3Headshots: 0,
  player4Headshots: 0
};

// Store previous values for event logging (separate from payment state)
let previousLogState = {
  player1Kills: 0,
  player2Kills: 0,
  player3Kills: 0,
  player4Kills: 0,
  player1Headshots: 0,
  player2Headshots: 0,
  player3Headshots: 0,
  player4Headshots: 0
};

// IPC handler to receive authenticated players from renderer
ipcMain.handle('update-authenticated-players', async (event, players) => {
  authenticatedPlayers = players;
  console.log('Updated authenticated players:', Object.keys(players));
});

// IPC handler to get payment errors for a player
ipcMain.handle('get-payment-errors', async (event, player) => {
  return paymentErrors[player] || [];
});

// IPC handler to clear payment errors for a player
ipcMain.handle('clear-payment-errors', async (event, player) => {
  paymentErrors[player] = [];
  return true;
});

// Password protection for settings
const PASSWORD_FILE = path.join(__dirname, 'settings-password.json');

ipcMain.handle('has-settings-password', async () => {
  return fs.existsSync(PASSWORD_FILE);
});

ipcMain.handle('set-settings-password', async (event, password) => {
  try {
    const salt = crypto.randomBytes(16).toString('hex');
    const hash = crypto.scryptSync(password, salt, 64).toString('hex');
    const passwordData = { salt, hash };

    fs.writeFileSync(PASSWORD_FILE, JSON.stringify(passwordData));
    return true;
  } catch (error) {
    console.error('Failed to set settings password:', error);
    throw error;
  }
});

ipcMain.handle('verify-settings-password', async (event, password) => {
  try {
    if (!fs.existsSync(PASSWORD_FILE)) {
      return false;
    }

    const passwordData = JSON.parse(fs.readFileSync(PASSWORD_FILE, 'utf8'));
    const { salt, hash: storedHash } = passwordData;
    const testHash = crypto.scryptSync(password, salt, 64).toString('hex');

    return testHash === storedHash;
  } catch (error) {
    console.error('Failed to verify settings password:', error);
    return false;
  }
});

ipcMain.handle('reset-settings-password', async () => {
  try {
    // Delete password file
    if (fs.existsSync(PASSWORD_FILE)) {
      fs.unlinkSync(PASSWORD_FILE);
    }

    // Delete settings file (which contains API keys)
    if (fs.existsSync(SETTINGS_FILE)) {
      fs.unlinkSync(SETTINGS_FILE);
    }

    return true;
  } catch (error) {
    console.error('Failed to reset settings password:', error);
    throw error;
  }
});

// Log game events (kills/headshots) to console
function logGameEvents(currentData) {
  // Check if we're still in cooldown period
  const now = Date.now();
  if (gameStartTime && (now - gameStartTime) < GAME_STARTUP_COOLDOWN) {
    const remainingCooldown = Math.ceil((GAME_STARTUP_COOLDOWN - (now - gameStartTime)) / 1000);
    console.log(`⏳ Game startup cooldown active (${remainingCooldown}s remaining) - ignoring kill/headshot detection`);
    return;
  }

  const timestamp = new Date().toLocaleTimeString();

  // Check each player for kill/headshot changes
  ['player1', 'player2', 'player3', 'player4'].forEach((player, index) => {
    const playerNum = index + 1;
    const currentKills = currentData[player] || 0;
    const currentHeadshots = currentData[player + 'Headshots'] || 0;
    const previousKills = previousLogState[player + 'Kills'];
    const previousHeadshots = previousLogState[player + 'Headshots'];

    // Log kill increases (ignore large jumps of 10 or more)
    if (currentKills > previousKills) {
      const newKills = currentKills - previousKills;

      if (newKills >= 10) {
        console.log(`⚠️ [${timestamp}] Large kill jump detected for Spook ${playerNum}: +${newKills} (ignoring - likely false positive)`);
      } else {
        console.log(`\n🎯 [${timestamp}] KILL DETECTED!`);
        console.log(`   Player: Spook ${playerNum}`);
        console.log(`   Kills: ${previousKills} → ${currentKills} (+${newKills})`);
        console.log(`   Lightning: ${authenticatedPlayers[player] ? '⚡ ' + authenticatedPlayers[player] : '❌ Not logged in'}`);
      }
    }

    // Log headshot increases (ignore large jumps of 10 or more)
    if (currentHeadshots > previousHeadshots) {
      const newHeadshots = currentHeadshots - previousHeadshots;

      if (newHeadshots >= 10) {
        console.log(`⚠️ [${timestamp}] Large headshot jump detected for Spook ${playerNum}: +${newHeadshots} (ignoring - likely false positive)`);
      } else {
        console.log(`\n🎯💥 [${timestamp}] HEADSHOT DETECTED!`);
        console.log(`   Player: Spook ${playerNum}`);
        console.log(`   Headshots: ${previousHeadshots} → ${currentHeadshots} (+${newHeadshots})`);
        console.log(`   Lightning: ${authenticatedPlayers[player] ? '⚡ ' + authenticatedPlayers[player] : '❌ Not logged in'}`);
      }
    }

    // Update previous values for next comparison
    previousLogState[player + 'Kills'] = currentKills;
    previousLogState[player + 'Headshots'] = currentHeadshots;
  });
}

// Accumulate kill/headshot rewards into a local balance for an unlinked player
// (one with no Lightning address). Mirrors the same anti-false-positive guards
// used for instant payments. The balance can later be withdrawn via LNURL-withdraw.
function accumulateUnlinkedBalance(player, playerNum, currentData, killReward, headshotReward) {
  const currentKills = currentData[player] || 0;
  const currentHeadshots = currentData[player + 'Headshots'] || 0;
  const prevKills = previousGameState[player + 'Kills'];
  const prevHeadshots = previousGameState[player + 'Headshots'];

  if (currentKills > prevKills) {
    const newKills = currentKills - prevKills;
    previousGameState[player + 'Kills'] = currentKills; // update state regardless
    if (newKills < 10) {
      const added = newKills * killReward;
      addPlayerBalance(player, added);
      console.log(`💰 Spook ${playerNum} (no address) +${added} sats from ${newKills} kill(s) → balance ${playerBalances[player]}`);
    } else {
      console.log(`⚠️ Large kill jump (+${newKills}) for unlinked Spook ${playerNum} - skipping`);
    }
  }

  if (currentHeadshots > prevHeadshots) {
    const newHeadshots = currentHeadshots - prevHeadshots;
    previousGameState[player + 'Headshots'] = currentHeadshots; // update state regardless
    if (newHeadshots < 10) {
      const added = newHeadshots * headshotReward;
      addPlayerBalance(player, added);
      console.log(`💰 Spook ${playerNum} (no address) +${added} sats from ${newHeadshots} headshot(s) → balance ${playerBalances[player]}`);
    } else {
      console.log(`⚠️ Large headshot jump (+${newHeadshots}) for unlinked Spook ${playerNum} - skipping`);
    }
  }
}

// Process payments for kills/headshots
async function processGamePayments(currentData) {
  // Check if we're still in cooldown period
  const now = Date.now();
  if (gameStartTime && (now - gameStartTime) < GAME_STARTUP_COOLDOWN) {
    return; // Skip payment processing during cooldown
  }

  const settings = await loadPaymentSettings();
  if (!settings || !settings.provider) {
    return; // No payment provider configured
  }

  // Ensure we have the right settings for the selected provider
  if (settings.provider === 'zbd' && !settings.zbdApiKey) {
    return; // ZBD selected but no API key
  }
  if (settings.provider === 'lnbits' && (!settings.lnbitsApiKey || !settings.lnbitsUrl)) {
    return; // LNBits selected but missing API key or URL
  }

  const killReward = settings.killReward || 1;
  const headshotReward = settings.headshotReward || 1;

  // Process payments for each player
  for (const [index, player] of ['player1', 'player2', 'player3', 'player4'].entries()) {
    try {
      const playerNum = index + 1;
      const lightningAddress = authenticatedPlayers[player];

      if (!lightningAddress) {
        // No Lightning address linked: accumulate a withdrawable balance instead
        accumulateUnlinkedBalance(player, playerNum, currentData, killReward, headshotReward);
        continue;
      }

      // Get current and previous values
      const currentKills = currentData[player] || 0;
      const currentHeadshots = currentData[player + 'Headshots'] || 0;
      const previousKills = previousGameState[player + 'Kills'];
      const previousHeadshots = previousGameState[player + 'Headshots'];

      // Process kill rewards - only if there's an increase AND it's not a large jump
      if (currentKills > previousKills) {
        const newKills = currentKills - previousKills;

        if (newKills >= 10) {
          console.log(`⚠️ Large kill jump (+${newKills}) for Spook ${playerNum} - skipping payment (likely false positive)`);
          // Still update state to prevent future false detections
          previousGameState[player + 'Kills'] = currentKills;
        } else {
          console.log(`🎯 Processing ${newKills} kill reward(s) for Spook ${playerNum}`);

          // Update state immediately to prevent duplicate processing
          previousGameState[player + 'Kills'] = currentKills;

          for (let i = 0; i < newKills; i++) {
            let result;
            if (settings.provider === 'zbd') {
              result = await sendZBDPayment(
                lightningAddress,
                killReward,
                `🎯 GoldenPie Kill Reward - Spook ${playerNum}`,
                player
              );
            } else if (settings.provider === 'lnbits') {
              result = await sendLNBitsPayment(
                lightningAddress,
                killReward,
                `🎯 GoldenPie Kill Reward - Spook ${playerNum}`,
                player
              );
            }

            if (!result.success) {
              console.error(`❌ Failed to send kill reward to Spook ${playerNum}:`, result.error);

              // Store error for UI display
              const errorEntry = {
                timestamp: new Date().toISOString(),
                type: 'kill',
                amount: killReward,
                error: result.error,
                recipient: lightningAddress
              };
              paymentErrors[player].push(errorEntry);

              // Notify renderer of new error
              if (mainWindow) {
                mainWindow.webContents.send('payment-error', { player, error: errorEntry });
              }
            }
          }
        }
      }

      // Process headshot rewards - only if there's an increase AND it's not a large jump
      if (currentHeadshots > previousHeadshots) {
        const newHeadshots = currentHeadshots - previousHeadshots;

        if (newHeadshots >= 10) {
          console.log(`⚠️ Large headshot jump (+${newHeadshots}) for Spook ${playerNum} - skipping payment (likely false positive)`);
          // Still update state to prevent future false detections
          previousGameState[player + 'Headshots'] = currentHeadshots;
        } else {
          console.log(`🎯💥 Processing ${newHeadshots} headshot bonus(es) for Spook ${playerNum}`);

          // Update state immediately to prevent duplicate processing
          previousGameState[player + 'Headshots'] = currentHeadshots;

          for (let i = 0; i < newHeadshots; i++) {
            let result;
            if (settings.provider === 'zbd') {
              result = await sendZBDPayment(
                lightningAddress,
                headshotReward,
                `🎯💥 GoldenPie Headshot Bonus - Spook ${playerNum}`,
                player
              );
            } else if (settings.provider === 'lnbits') {
              result = await sendLNBitsPayment(
                lightningAddress,
                headshotReward,
                `🎯💥 GoldenPie Headshot Bonus - Spook ${playerNum}`,
                player
              );
            }

            if (!result.success) {
              console.error(`❌ Failed to send headshot bonus to Spook ${playerNum}:`, result.error);

              // Store error for UI display
              const errorEntry = {
                timestamp: new Date().toISOString(),
                type: 'headshot',
                amount: headshotReward,
                error: result.error,
                recipient: lightningAddress
              };
              paymentErrors[player].push(errorEntry);

              // Notify renderer of new error
              if (mainWindow) {
                mainWindow.webContents.send('payment-error', { player, error: errorEntry });
              }
            }
          }
        }
      }

      // State is now updated immediately after detection, not after payment processing

    } catch (error) {
      console.error(`❌ Error processing payments for ${player}:`, error);
    }
  }
}

function findRetroArch() {
  let possiblePaths = [];

  if (process.platform === 'darwin') {
    possiblePaths = [
      '/Applications/RetroArch.app/Contents/MacOS/RetroArch',
      path.join(process.env.HOME, 'Applications/RetroArch.app/Contents/MacOS/RetroArch')
    ];

    // Only add __dirname path in development, not in built app
    if (!app.isPackaged) {
      possiblePaths.push(path.join(__dirname, 'RetroArch.app/Contents/MacOS/RetroArch'));
    }
  } else if (process.platform === 'win32') {
    const programFiles = process.env.ProgramFiles || 'C:\\Program Files';
    const programFilesX86 = process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)';
    possiblePaths = [
      'retroarch.exe',
      'C:\\RetroArch-Win64\\retroarch.exe',
      path.join(programFiles, 'RetroArch', 'retroarch.exe'),
      path.join(programFilesX86, 'RetroArch', 'retroarch.exe'),
      path.join(process.env.LOCALAPPDATA || '', 'RetroArch', 'retroarch.exe')
    ];

    // Only add __dirname path in development, not in built app
    if (!app.isPackaged) {
      possiblePaths.splice(1, 0, path.join(__dirname, 'retroarch.exe'));
    }
  } else {
    // Linux and others
    const homeDir = process.env.HOME || '';
    possiblePaths = [
      '/usr/bin/retroarch',
      '/usr/local/bin/retroarch',
      '/opt/retroarch/bin/retroarch',
      path.join(homeDir, '.local/bin/retroarch'),
      path.join(homeDir, 'bin/retroarch'),
      // Flatpak
      '/var/lib/flatpak/exports/bin/org.libretro.RetroArch',
      path.join(homeDir, '.local/share/flatpak/exports/bin/org.libretro.RetroArch'),
      // AppImage (common locations)
      path.join(homeDir, 'Applications/RetroArch.AppImage'),
      path.join(homeDir, 'Desktop/RetroArch.AppImage')
    ];

    // Only add __dirname path in development, not in built app
    if (!app.isPackaged) {
      possiblePaths.splice(5, 0, path.join(__dirname, 'retroarch'));
    }
  }

  for (const retroarchPath of possiblePaths) {
    if (fs.existsSync(retroarchPath)) {
      console.log('Found RetroArch:', retroarchPath);
      return retroarchPath;
    }
  }

  return null;
}

function findCore() {
  const homeDir = process.env.HOME || '';
  let possibleCores = [];
  let coreNames = ['mupen64plus_next_libretro', 'parallel_n64_libretro'];

  if (process.platform === 'darwin') {
    for (const coreName of coreNames) {
      possibleCores.push(
        `/Applications/RetroArch.app/Contents/Resources/cores/${coreName}.dylib`,
        path.join(homeDir, `Library/Application Support/RetroArch/cores/${coreName}.dylib`)
      );

      // Only add __dirname path in development, not in built app
      if (!app.isPackaged) {
        possibleCores.push(path.join(__dirname, `RetroArch.app/Contents/Resources/cores/${coreName}.dylib`));
      }
    }
  } else if (process.platform === 'win32') {
    const appData = process.env.APPDATA || '';
    const localAppData = process.env.LOCALAPPDATA || '';
    const programFiles = process.env.ProgramFiles || 'C:\\Program Files';

    for (const coreName of coreNames) {
      possibleCores.push(
        path.join(appData, 'RetroArch', 'cores', `${coreName}.dll`),
        path.join(localAppData, 'RetroArch', 'cores', `${coreName}.dll`),
        path.join(programFiles, 'RetroArch', 'cores', `${coreName}.dll`),
        `C:\\RetroArch-Win64\\cores\\${coreName}.dll`
      );

      // Only add __dirname path in development, not in built app
      if (!app.isPackaged) {
        possibleCores.push(path.join(__dirname, 'cores', `${coreName}.dll`));
      }
    }
  } else {
    // Linux and others
    const configDir = process.env.XDG_CONFIG_HOME || path.join(homeDir, '.config');
    const dataDir = process.env.XDG_DATA_HOME || path.join(homeDir, '.local/share');

    for (const coreName of coreNames) {
      possibleCores.push(
        `/usr/lib/libretro/${coreName}.so`,
        `/usr/lib/x86_64-linux-gnu/libretro/${coreName}.so`,
        `/usr/lib/aarch64-linux-gnu/libretro/${coreName}.so`,
        `/usr/local/lib/libretro/${coreName}.so`,
        path.join(configDir, 'retroarch/cores', `${coreName}.so`),
        path.join(dataDir, 'libretro/cores', `${coreName}.so`),
        path.join(homeDir, '.retroarch/cores', `${coreName}.so`),
        // Flatpak paths
        path.join(homeDir, '.var/app/org.libretro.RetroArch/config/retroarch/cores', `${coreName}.so`)
      );

      // Only add __dirname path in development, not in built app
      if (!app.isPackaged) {
        possibleCores.push(path.join(__dirname, 'cores', `${coreName}.so`));
      }
    }
  }

  for (const corePath of possibleCores) {
    if (fs.existsSync(corePath)) {
      console.log('Found core:', corePath);
      return corePath;
    }
  }

  return null;
}

function getRetroArchConfigDir(retroarchPath = null) {
  const homeDir = process.env.HOME || '';

  if (process.platform === 'darwin') {
    return path.join(homeDir, 'Library/Application Support/RetroArch');
  } else if (process.platform === 'win32') {
    // Check for portable installation first (config in same directory as executable)
    if (retroarchPath && fs.existsSync(retroarchPath)) {
      const portableConfigDir = path.dirname(retroarchPath);
      const portableConfigFile = path.join(portableConfigDir, 'retroarch.cfg');

      // If retroarch.cfg exists in the same directory, it's a portable installation
      if (fs.existsSync(portableConfigFile)) {
        console.log('Detected portable RetroArch installation at:', portableConfigDir);
        return portableConfigDir;
      }
    }

    // Fall back to AppData for installed version
    const appData = process.env.APPDATA || '';
    const appDataPath = path.join(appData, 'RetroArch');
    console.log('Using AppData RetroArch config directory:', appDataPath);
    return appDataPath;
  } else {
    // Linux and others
    const configDir = process.env.XDG_CONFIG_HOME || path.join(homeDir, '.config');

    // Check for Flatpak first
    const flatpakConfig = path.join(homeDir, '.var/app/org.libretro.RetroArch/config/retroarch');
    if (fs.existsSync(flatpakConfig)) {
      return flatpakConfig;
    }

    // Standard Linux config directory
    return path.join(configDir, 'retroarch');
  }
}

// Size of the area left of the control panel (same geometry RetroArch is positioned into).
function getGameWindowSize() {
  try {
    const { screen } = require('electron');
    const { width, height } = screen.getPrimaryDisplay().workAreaSize;
    // x/y = top-left so the game docks against the left edge, filling the area beside the
    // control panel (which sits on the right). The Spearmint adapter passes these as
    // r_windowPosX/Y so our patched engine self-positions the SDL window on macOS.
    return { x: 0, y: 0, width: Math.max(640, width - 400), height: Math.max(480, height) };
  } catch (_) {
    return { x: 0, y: 0, width: 1280, height: 800 };
  }
}

function positionRetroArchWindow(processName = 'RetroArch', titleMatch = 'RetroArch') {
  const { screen } = require('electron');
  const { exec } = require('child_process');
  const primaryDisplay = screen.getPrimaryDisplay();
  const { width: screenWidth, height: screenHeight } = primaryDisplay.workAreaSize;

  // Calculate game window dimensions (left side, leaving room for control panel)
  const retroarchWidth = screenWidth - 400; // Leave 400px for Electron control panel
  const retroarchHeight = screenHeight;

  if (process.platform === 'darwin') {
    // macOS: Use AppleScript
    const script = `
      tell application "System Events"
        tell process "${processName}"
          set position of window 1 to {0, 0}
          set size of window 1 to {${retroarchWidth}, ${retroarchHeight}}
        end tell
      end tell
    `;

    exec(`osascript -e '${script}'`, (error) => {
      if (error) {
        console.log('Could not position RetroArch window:', error.message);
      } else {
        console.log('Positioned RetroArch window on left side');
      }
    });
  } else if (process.platform === 'win32') {
    // Windows: Use PowerShell with Windows API via temp file
    console.log('Attempting to position RetroArch window on Windows...');
    console.log(`Target dimensions: ${retroarchWidth}x${retroarchHeight} at position (0, 0)`);

    const powershellScript = `Add-Type @"
using System;
using System.Runtime.InteropServices;
using System.Text;
public class Win32 {
  public delegate bool EnumWindowsProc(IntPtr hWnd, IntPtr lParam);
  [DllImport("user32.dll")]
  public static extern bool EnumWindows(EnumWindowsProc enumProc, IntPtr lParam);
  [DllImport("user32.dll")]
  public static extern int GetWindowText(IntPtr hWnd, StringBuilder lpString, int nMaxCount);
  [DllImport("user32.dll")]
  public static extern bool IsWindowVisible(IntPtr hWnd);
  [DllImport("user32.dll")]
  public static extern bool SetWindowPos(IntPtr hWnd, IntPtr hWndInsertAfter, int X, int Y, int cx, int cy, uint uFlags);
}
"@

Write-Host "Searching for RetroArch window..."
$foundWindow = [IntPtr]::Zero
$foundTitle = ""
[Win32]::EnumWindows({
  param($hwnd, $lParam)
  if ([Win32]::IsWindowVisible($hwnd)) {
    $sb = New-Object System.Text.StringBuilder 256
    [void][Win32]::GetWindowText($hwnd, $sb, $sb.Capacity)
    $title = $sb.ToString()
    if ($title -like "*${titleMatch}*") {
      $script:foundWindow = $hwnd
      $script:foundTitle = $title
      Write-Host "Found window: $title"
      return $false
    }
  }
  return $true
}, [IntPtr]::Zero)

if ($foundWindow -ne [IntPtr]::Zero) {
  Write-Host "Positioning window '$foundTitle'..."
  $result = [Win32]::SetWindowPos($foundWindow, [IntPtr]::Zero, 0, 0, ${retroarchWidth}, ${retroarchHeight}, 0x0040)
  if ($result) {
    Write-Host "SUCCESS: Window positioned"
  } else {
    Write-Host "FAILED: SetWindowPos returned false"
  }
} else {
  Write-Host "ERROR: No RetroArch window found"
}
`;

    // Write script to temp file
    const tempScriptPath = path.join(require('os').tmpdir(), 'retroarch-position.ps1');
    fs.writeFileSync(tempScriptPath, powershellScript, 'utf8');

    exec(`powershell -NoProfile -ExecutionPolicy Bypass -File "${tempScriptPath}"`, {
      timeout: 5000
    }, (error, stdout, stderr) => {
      // Clean up temp file
      try {
        fs.unlinkSync(tempScriptPath);
      } catch (e) {
        // Ignore cleanup errors
      }

      if (error) {
        console.log('PowerShell error:', error.message);
      }
      if (stderr) {
        console.log('PowerShell stderr:', stderr);
      }
      if (stdout) {
        console.log('PowerShell output:', stdout.trim());
      }
    });
  } else {
    // Linux: Use wmctrl or xdotool
    exec('which wmctrl', (error) => {
      if (!error) {
        // Use wmctrl if available
        exec(`wmctrl -r "${titleMatch}" -e 0,0,0,${retroarchWidth},${retroarchHeight}`, (error) => {
          if (error) {
            console.log('Could not position RetroArch window with wmctrl:', error.message);
          } else {
            console.log('Positioned RetroArch window on left side');
          }
        });
      } else {
        // Try xdotool as fallback
        exec('which xdotool', (error) => {
          if (!error) {
            exec(`xdotool search --name "${titleMatch}" windowmove 0 0 windowsize ${retroarchWidth} ${retroarchHeight}`, (error) => {
              if (error) {
                console.log('Could not position RetroArch window with xdotool:', error.message);
              } else {
                console.log('Positioned RetroArch window on left side');
              }
            });
          } else {
            console.log('Neither wmctrl nor xdotool found. Window positioning not available on this system.');
          }
        });
      }
    });
  }
}

function sendCommand(command) {
  return new Promise((resolve, reject) => {
    if (!memoryClient) {
      memoryClient = dgram.createSocket('udp4');
    }

    const timeout = setTimeout(() => {
      reject(new Error('Command timeout'));
    }, 2000);

    memoryClient.once('message', (msg) => {
      clearTimeout(timeout);
      resolve(msg.toString().trim());
    });

    memoryClient.send(command, RETROARCH_CMD_PORT, '127.0.0.1', (err) => {
      if (err) {
        clearTimeout(timeout);
        reject(err);
      }
    });
  });
}

function readMemory(address, size = 1) {
  return new Promise((resolve, reject) => {
    if (!memoryClient) {
      memoryClient = dgram.createSocket('udp4');
      memoryClient.on('error', (err) => {
        console.error('UDP socket error:', err);
      });
    }

    const command = `READ_CORE_MEMORY ${address} ${size}`;
    const timeout = setTimeout(() => {
      reject(new Error(`Memory read timeout for address ${address}`));
    }, 3000);

    memoryClient.once('message', (msg) => {
      clearTimeout(timeout);
      const response = msg.toString().trim();
      // Response format: "READ_CORE_MEMORY <address> <value>"
      const parts = response.split(' ');
      if (parts.length >= 3) {
        const value = parseInt(parts[2], 16);
        resolve(value);
      } else {
        resolve(0);
      }
    });

    memoryClient.send(command, RETROARCH_CMD_PORT, '127.0.0.1', (err) => {
      if (err) {
        clearTimeout(timeout);
        reject(err);
      }
    });
  });
}

// Read `count` consecutive bytes in one READ_CORE_MEMORY call; returns an array of ints.
// Used only for memory diagnostics (finding the right frag byte).
function readMemoryRange(address, count) {
  return new Promise((resolve) => {
    if (!memoryClient) {
      memoryClient = dgram.createSocket('udp4');
      memoryClient.on('error', (err) => console.error('UDP socket error:', err));
    }
    const command = `READ_CORE_MEMORY ${address} ${count}`;
    const timeout = setTimeout(() => resolve([]), 3000);
    memoryClient.once('message', (msg) => {
      clearTimeout(timeout);
      const parts = msg.toString().trim().split(/\s+/);
      // Response: "READ_CORE_MEMORY <addr> <b0> <b1> ..."
      resolve(parts.slice(2).map(h => parseInt(h, 16)));
    });
    memoryClient.send(command, RETROARCH_CMD_PORT, '127.0.0.1', (err) => {
      if (err) { clearTimeout(timeout); resolve([]); }
    });
  });
}

// ---- Game-agnostic stats seam ----
// Every game integration (RetroArch memory polling, Spearmint log tailing, ...) funnels
// a normalized per-player stats object through here. Everything downstream — UI updates,
// event logging, Bitcoin payments/balances/withdraw — is game-independent.
//   memoryData = { player1..4, player1..4Headshots, player1..4Deaths }  (ints; absent = 0)
async function handleMemoryData(memoryData) {
  if (!mainWindow) return;

  // Only send UI updates after the startup cooldown to prevent false animations
  const now = Date.now();
  if (!gameStartTime || (now - gameStartTime) >= GAME_STARTUP_COOLDOWN) {
    mainWindow.webContents.send('memory-update', memoryData);
  }

  // Log kill/headshot changes
  logGameEvents(memoryData);

  // Process Bitcoin payments / balance accrual for each player
  await processGamePayments(memoryData);
}

function startMemoryPolling() {
  if (memoryPollingInterval) return;

  console.log('Starting memory polling...');
  console.log(`Connecting to RetroArch on port ${RETROARCH_CMD_PORT}...`);

  // Set game start time for cooldown tracking
  gameStartTime = Date.now();
  console.log(`🕒 Game startup cooldown activated for ${GAME_STARTUP_COOLDOWN/1000} seconds`);

  let firstSuccessfulRead = false;
  let lastDbgLine = ''; // throttle memory-debug logging to value changes

  // Reset shutdown flag when starting new session
  isGameShuttingDown = false;

  // Reset previous game state when starting a new session
  previousGameState = {
    player1Kills: 0,
    player2Kills: 0,
    player3Kills: 0,
    player4Kills: 0,
    player1Headshots: 0,
    player2Headshots: 0,
    player3Headshots: 0,
    player4Headshots: 0
  };

  // Reset previous log state when starting a new session
  previousLogState = {
    player1Kills: 0,
    player2Kills: 0,
    player3Kills: 0,
    player4Kills: 0,
    player1Headshots: 0,
    player2Headshots: 0,
    player3Headshots: 0,
    player4Headshots: 0
  };

  memoryPollingInterval = setInterval(async () => {
    // Skip memory reading if game is shutting down
    if (isGameShuttingDown || !retroarchProcess) {
      return;
    }

    try {
      const rewards = (activeGame && activeGame.rewards) || { kills: true, headshots: true };
      const trackHeadshots = rewards.headshots && MEMORY_ADDRESSES.player1Headshots;
      const trackDeaths = !!MEMORY_ADDRESSES.player1Deaths;
      const debugMemory = !!(activeGame && activeGame.debugMemory);

      // For games that only track stats in multiplayer (e.g. Quake II), make sure
      // we're actually in a deathmatch before trusting the frag counters.
      let mpFlag = null;
      if (activeGame && activeGame.multiplayerFlag && activeGame.multiplayerFlag.address) {
        mpFlag = await readMemory(activeGame.multiplayerFlag.address);
        if (!firstSuccessfulRead) {
          console.log('✅ Successfully connected to RetroArch memory interface!');
          firstSuccessfulRead = true;
        }
        const want = (typeof activeGame.multiplayerFlag.activeValue === 'number')
          ? activeGame.multiplayerFlag.activeValue : 1;
        // While debugging memory we never block, so we can observe raw values.
        if (mpFlag !== want && !debugMemory) {
          return; // not in multiplayer yet — skip this cycle
        }
      }

      const player1Kills = await readMemory(MEMORY_ADDRESSES.player1);

      if (!firstSuccessfulRead) {
        console.log('✅ Successfully connected to RetroArch memory interface!');
        firstSuccessfulRead = true;
      }

      const player2Kills = await readMemory(MEMORY_ADDRESSES.player2);
      const player3Kills = await readMemory(MEMORY_ADDRESSES.player3);
      const player4Kills = await readMemory(MEMORY_ADDRESSES.player4);

      // Memory diagnostics: log the multiplayer flag + candidate frag addresses whenever
      // they change, so we can confirm/correct the addresses against live gameplay.
      if (debugMemory) {
        let line = `flag@${activeGame.multiplayerFlag ? activeGame.multiplayerFlag.address : '-'}=${mpFlag} | ` +
          `P1@${MEMORY_ADDRESSES.player1}=${player1Kills} P2@${MEMORY_ADDRESSES.player2}=${player2Kills} ` +
          `P3@${MEMORY_ADDRESSES.player3}=${player3Kills} P4@${MEMORY_ADDRESSES.player4}=${player4Kills}`;

        // Optional byte-range dump: shows every byte in a window so we can see which
        // one increments by 1 on a frag (the real frag address).
        if (activeGame.debugRange && activeGame.debugRange.start) {
          const start = parseInt(activeGame.debugRange.start, 16);
          const count = activeGame.debugRange.count || 16;
          const bytes = await readMemoryRange(activeGame.debugRange.start, count);
          const dump = bytes.map((b, i) => `${(start + i).toString(16).toUpperCase()}=${b}`).join(' ');
          line += `\n           range[${activeGame.debugRange.start}+${count}]: ${dump}`;
        }

        if (line !== lastDbgLine) {
          console.log(`[QUAKE MEM] ${line}`);
          lastDbgLine = line;
        }
      }

      const player1Headshots = trackHeadshots ? await readMemory(MEMORY_ADDRESSES.player1Headshots) : 0;
      const player2Headshots = trackHeadshots ? await readMemory(MEMORY_ADDRESSES.player2Headshots) : 0;
      const player3Headshots = trackHeadshots ? await readMemory(MEMORY_ADDRESSES.player3Headshots) : 0;
      const player4Headshots = trackHeadshots ? await readMemory(MEMORY_ADDRESSES.player4Headshots) : 0;

      const player1Deaths = trackDeaths ? await readMemory(MEMORY_ADDRESSES.player1Deaths) : 0;
      const player2Deaths = trackDeaths ? await readMemory(MEMORY_ADDRESSES.player2Deaths) : 0;
      const player3Deaths = trackDeaths ? await readMemory(MEMORY_ADDRESSES.player3Deaths) : 0;
      const player4Deaths = trackDeaths ? await readMemory(MEMORY_ADDRESSES.player4Deaths) : 0;

      const memoryData = {
        player1: player1Kills,
        player2: player2Kills,
        player3: player3Kills,
        player4: player4Kills,
        player1Headshots: player1Headshots,
        player2Headshots: player2Headshots,
        player3Headshots: player3Headshots,
        player4Headshots: player4Headshots,
        player1Deaths: player1Deaths,
        player2Deaths: player2Deaths,
        player3Deaths: player3Deaths,
        player4Deaths: player4Deaths
      };

      // Feed the game-agnostic stats seam (shared with non-RetroArch adapters)
      await handleMemoryData(memoryData);
    } catch (error) {
      // Silently fail - RetroArch might not be ready yet
      console.log('Memory read error:', error.message);
    }
  }, 1000); // Poll every second
}

function stopMemoryPolling() {
  isGameShuttingDown = true;

  // Stop any adapter-driven stat polling (e.g. Spearmint log tailing)
  if (activeAdapter && activeAdapter.stopPolling) {
    try { activeAdapter.stopPolling(); } catch (e) { console.log('Adapter stopPolling error:', e.message); }
  }

  // Clear menu auto-load timer when game stops
  if (menuAutoLoadTimer) {
    clearTimeout(menuAutoLoadTimer);
    menuAutoLoadTimer = null;
    console.log('🚫 Cancelled auto-menu load timer due to game shutdown');
  }

  if (memoryPollingInterval) {
    clearInterval(memoryPollingInterval);
    memoryPollingInterval = null;
    console.log('Memory polling stopped');
  }
  if (memoryClient) {
    try {
      memoryClient.close();
      memoryClient = null;
      console.log('Memory client socket closed');
    } catch (error) {
      console.log('Error closing memory client socket:', error.message);
      memoryClient = null;
    }
  }
}

// Helper function to get states directory - uses project directory in dev, userData in built app
function getUserStatesDir() {
  const { app } = require('electron');

  // Check if we're in development (unpacked) or production (packed)
  if (app.isPackaged) {
    // In built app, use userData directory
    const userDataPath = app.getPath('userData');
    const userStatesDir = path.join(userDataPath, 'states');

    // Ensure the directory exists
    if (!fs.existsSync(userStatesDir)) {
      fs.mkdirSync(userStatesDir, { recursive: true });

      // Copy states from app bundle if they exist (for first run)
      const bundledStatesDir = path.join(__dirname, 'States');
      if (fs.existsSync(bundledStatesDir)) {
        try {
          // Copy all state files/folders
          const items = fs.readdirSync(bundledStatesDir);
          for (const item of items) {
            const srcPath = path.join(bundledStatesDir, item);
            const destPath = path.join(userStatesDir, item);

            if (fs.statSync(srcPath).isDirectory()) {
              fs.mkdirSync(destPath, { recursive: true });
              const subItems = fs.readdirSync(srcPath);
              for (const subItem of subItems) {
                fs.copyFileSync(path.join(srcPath, subItem), path.join(destPath, subItem));
              }
            } else {
              fs.copyFileSync(srcPath, destPath);
            }
          }
          console.log('Copied bundled states to userData on first run');
        } catch (error) {
          console.error('Error copying bundled states:', error);
        }
      }
    }

    return userStatesDir;
  } else {
    // In development, use project directory
    return path.join(__dirname, 'States');
  }
}

function createTempConfig() {
  // Create a temporary config file to override pause settings and set custom savestate directory
  const tempConfigPath = getUserFilePath('.retroarch-temp.cfg');

  // Use user data directory for states instead of app directory (which is read-only in built apps)
  const projectStatesDir = getUserStatesDir();

  // Ensure the project states directory exists
  if (!fs.existsSync(projectStatesDir)) {
    fs.mkdirSync(projectStatesDir, { recursive: true });
    console.log('Created project states directory:', projectStatesDir);
  }

  const configContent = `pause_nonactive = "false"
network_cmd_enable = "true"
network_cmd_port = "55355"
stdin_cmd_enable = "false"
savestate_directory = "${projectStatesDir}"`;

  try {
    fs.writeFileSync(tempConfigPath, configContent);
    console.log('Created temporary RetroArch config with custom savestate directory:', tempConfigPath);
    console.log('States will be saved to:', projectStatesDir);
    return tempConfigPath;
  } catch (error) {
    console.error('Failed to create temp config:', error);
    return null;
  }
}

// True if any game (RetroArch or an adapter-driven game) is currently running.
function isGameRunning() {
  return !!retroarchProcess || !!(activeAdapter && activeAdapter.getProcess && activeAdapter.getProcess());
}

// Begin a stat session for an adapter-driven game: reset the cooldown + previous-state,
// then route the adapter's normalized stats through the shared seam.
function beginAdapterSession() {
  // If the game process already died (e.g. missing data files), don't start a session.
  if (!activeAdapter) return;
  gameStartTime = Date.now();
  isGameShuttingDown = false;
  previousGameState = {
    player1Kills: 0, player2Kills: 0, player3Kills: 0, player4Kills: 0,
    player1Headshots: 0, player2Headshots: 0, player3Headshots: 0, player4Headshots: 0
  };
  previousLogState = { ...previousGameState };
  console.log(`🕒 Game startup cooldown activated for ${GAME_STARTUP_COOLDOWN / 1000} seconds`);
  if (!activeAdapter) return;
  activeAdapter.startPolling(async (memoryData) => {
    if (isGameShuttingDown) return;
    try { await handleMemoryData(memoryData); }
    catch (e) { console.log('Adapter stats error:', e.message); }
  });
}

// Launch a non-RetroArch, adapter-driven game (currently Spearmint/Quake III).
// `profile` (optional) selects a launch configuration, e.g. { players: 2 } or { menu: true }.
function loadGameWithAdapter(profile) {
  // If an adapter game is already running, restart it with the (possibly new) profile.
  if (isGameRunning()) {
    if (!activeAdapter) { console.log('Another game is already running'); return; }
    console.log('Restarting adapter game with new profile:', profile && (profile.label || JSON.stringify(profile)));
    const proc = activeAdapter.getProcess && activeAdapter.getProcess();
    stopMemoryPolling();
    try { if (proc) proc.kill('SIGKILL'); } catch (_) {}
    activeAdapter = null;
    if (mainWindow) mainWindow.webContents.send('game-restarting');
    setTimeout(() => loadGameWithAdapter(profile), 1200);
    return;
  }

  const kind = activeGame && activeGame.adapter;
  if (kind === 'spearmint-log') {
    activeAdapter = new SpearmintLogAdapter({ game: activeGame, config, appDir: __dirname, mainWindow, profile, windowGeometry: getGameWindowSize() });
  } else {
    if (mainWindow) mainWindow.webContents.send('game-error', `Unknown game adapter: ${kind}`);
    return;
  }

  activeAdapter.on('error', (msg) => {
    console.error('Adapter error:', msg);
    if (mainWindow) mainWindow.webContents.send('game-error', String(msg));
    activeAdapter = null;
  });
  activeAdapter.on('exit', () => {
    console.log('Adapter game process exited');
    stopMemoryPolling();
    activeAdapter = null;
    if (mainWindow) mainWindow.webContents.send('game-closed');
  });
  activeAdapter.on('ready', () => {
    beginAdapterSession();
    // Position the game window on the left (like RetroArch). macOS can't move an SDL window
    // from outside the process, so there the patched engine self-positions via r_windowPosX/Y
    // (passed by the adapter) and this AX path stays off (mac fillGameArea:false). On Windows
    // SetWindowPos works, so fillGameArea:true triggers it here.
    // Apply the same platform overlay the adapter uses (spearmint.win / .mac).
    const baseSp = (activeGame && activeGame.spearmint) || {};
    const spPlatKey = process.platform === 'win32' ? 'win' : (process.platform === 'darwin' ? 'mac' : 'linux');
    const sp = Object.assign({}, baseSp, baseSp[spPlatKey] || {});
    if (sp.fillGameArea === true && !sp.fullscreen) {
      const proc = sp.windowProcess || 'spearmint';
      const title = sp.windowTitle || 'Spearmint';
      setTimeout(() => positionRetroArchWindow(proc, title), 500);
      setTimeout(() => positionRetroArchWindow(proc, title), 2500);
    }
  });

  activeAdapter.launch();
  if (mainWindow) mainWindow.webContents.send('game-started');
}

function loadGame() {
  // Route non-RetroArch games to their adapter
  if (activeGame && activeGame.adapter && activeGame.adapter !== 'retroarch-memory') {
    return loadGameWithAdapter();
  }

  if (retroarchProcess) {
    console.log('Game is already running');
    return;
  }

  // Get RetroArch path from config or auto-detect
  let retroarchPath = null;
  if (config && config.retroarch && config.retroarch.appPath !== 'auto') {
    retroarchPath = config.retroarch.appPath;
    if (!fs.existsSync(retroarchPath)) {
      console.log('Configured RetroArch path not found, falling back to auto-detection');
      retroarchPath = null;
    }
  }

  if (!retroarchPath) {
    retroarchPath = findRetroArch();
  }
  // Pick the ROM for the active game (GoldenEye / Quake II)
  let romPath = findActiveRom();
  if (romPath) {
    console.log(`Found ROM for ${activeGameId}:`, path.relative(__dirname, romPath));
  }

  if (!retroarchPath) {
    showRetroArchInstallHelp();
    if (mainWindow) {
      mainWindow.webContents.send('game-error', 'RetroArch not found');
    }
    return;
  }

  if (!romPath || !fs.existsSync(romPath)) {
    showRomInstallHelp();
    if (mainWindow) {
      mainWindow.webContents.send('game-error', 'ROM not found');
    }
    return;
  }

  // Get core path from config or auto-detect
  let corePath = null;
  if (config && config.retroarch && config.retroarch.corePath !== 'auto') {
    corePath = config.retroarch.corePath;
    if (!fs.existsSync(corePath)) {
      console.log('Configured core path not found, falling back to auto-detection');
      corePath = null;
    }
  }

  if (!corePath) {
    corePath = findCore();
  }

  if (!corePath) {
    showCoreInstallHelp();
    if (mainWindow) {
      mainWindow.webContents.send('game-error', 'Core not found');
    }
    return;
  }

  console.log('Launching RetroArch with network commands enabled...');

  const homeDir = process.env.HOME;

  // Load custom remap file for game-specific controls from local directory
  const remapFileName = (activeGame && activeGame.remapFile)
    ? activeGame.remapFile
    : ((config && config.retroarch && config.retroarch.remapFile)
        ? config.retroarch.remapFile
        : 'Modern.rmp');

  // Source: local remaps folder in the app directory (for distribution)
  const localRemapsDir = path.join(__dirname, 'remaps');
  const localRmapPath = path.join(localRemapsDir, remapFileName);

  // Destination: RetroArch's remaps folder.
  // Each game installs to its OWN remap file so they never clobber each other.
  // GoldenEye keeps its existing 'goldeneye.rmp' (matched as the content-directory
  // remap for Roms/Goldeneye on case-insensitive macOS) — left byte-for-byte unchanged.
  // Other games install a per-content (game) remap named after their ROM basename,
  // e.g. "Quake II (USA).rmp", which RetroArch loads only when that ROM is the content.
  const retroarchConfigDir = getRetroArchConfigDir(retroarchPath);
  const retroarchRemapsDir = path.join(retroarchConfigDir, 'config/remaps/Mupen64Plus-Next');
  let remapDestName = 'goldeneye.rmp';
  if (activeGameId !== 'goldeneye') {
    remapDestName = romPath
      ? path.basename(romPath, path.extname(romPath)) + '.rmp'
      : (activeGameId + '.rmp');
  }
  const gameRmapPath = path.join(retroarchRemapsDir, remapDestName);

  console.log('RetroArch config directory:', retroarchConfigDir);
  console.log('Remaps directory:', retroarchRemapsDir);
  console.log('Local remap path:', localRmapPath);
  console.log('Game remap path:', gameRmapPath);

  try {
    // Ensure RetroArch remaps directory exists
    if (!fs.existsSync(retroarchRemapsDir)) {
      fs.mkdirSync(retroarchRemapsDir, { recursive: true });
      console.log('Created RetroArch remaps directory');
    }

    // Copy from local remaps folder to RetroArch
    if (fs.existsSync(localRmapPath)) {
      fs.copyFileSync(localRmapPath, gameRmapPath);
      console.log(`Loaded ${remapFileName} controls from bundled remaps folder`);
    } else {
      console.log(`${remapFileName} not found in ./remaps, using default controls`);
    }
  } catch (error) {
    console.error(`Could not load ${remapFileName}:`, error);
  }

  // Enable network commands in RetroArch config
  const retroarchConfigPath = path.join(retroarchConfigDir, 'retroarch.cfg');
  console.log('RetroArch config file path:', retroarchConfigPath);

  try {
    if (fs.existsSync(retroarchConfigPath)) {
      let config = fs.readFileSync(retroarchConfigPath, 'utf8');
      let modified = false;

      // Enable network commands if not already enabled
      if (!config.includes('network_cmd_enable = "true"')) {
        config = config.replace(/network_cmd_enable = "false"/, 'network_cmd_enable = "true"');

        // If the setting doesn't exist, add it
        if (!config.includes('network_cmd_enable')) {
          config += '\nnetwork_cmd_enable = "true"\n';
        }
        modified = true;
      }

      // Disable pause when window loses focus
      if (config.includes('pause_nonactive = "true"')) {
        config = config.replace(/pause_nonactive = "true"/, 'pause_nonactive = "false"');
        modified = true;
      } else if (!config.includes('pause_nonactive')) {
        config += '\npause_nonactive = "false"\n';
        modified = true;
      }

      // Set savestate directory to user data states folder
      const projectStatesDir = getUserStatesDir();

      // Ensure the project states directory exists
      if (!fs.existsSync(projectStatesDir)) {
        fs.mkdirSync(projectStatesDir, { recursive: true });
        console.log('Created project states directory:', projectStatesDir);
      }

      // Update or add savestate_directory setting
      const savestateDirectoryPattern = /^savestate_directory\s*=\s*"?[^"\n]+"?/m;
      const newSavestateDirectory = `savestate_directory = "${projectStatesDir}"`;

      if (config.match(savestateDirectoryPattern)) {
        config = config.replace(savestateDirectoryPattern, newSavestateDirectory);
        modified = true;
        console.log('Updated savestate directory to:', projectStatesDir);
      } else {
        config += '\n' + newSavestateDirectory + '\n';
        modified = true;
        console.log('Added savestate directory setting:', projectStatesDir);
      }

      if (modified) {
        fs.writeFileSync(retroarchConfigPath, config);
        console.log('Updated RetroArch config: enabled network commands, disabled pause on focus loss, and set custom savestate directory');
      }
    }
  } catch (error) {
    console.error('Could not modify RetroArch config:', error);
  }

  // Auto-load removed - states only load via Quick Deploy buttons

  // Build RetroArch arguments
  const tempConfigPath = createTempConfig();
  const retroarchArgs = [
    '-L', corePath
  ];

  // Add custom config if created successfully
  if (tempConfigPath) {
    retroarchArgs.push('--appendconfig', tempConfigPath);
  }

  retroarchArgs.push(romPath);

  // Launch RetroArch
  console.log('Launching RetroArch with args:', retroarchArgs);
  retroarchProcess = spawn(retroarchPath, retroarchArgs);

  retroarchProcess.stdout.on('data', (data) => {
    console.log(`RetroArch: ${data}`);
  });

  retroarchProcess.stderr.on('data', (data) => {
    console.error(`RetroArch Error: ${data}`);
  });

  retroarchProcess.on('close', (code) => {
    console.log(`RetroArch process exited with code ${code}`);
    retroarchProcess = null;
    stopMemoryPolling();
    if (mainWindow) {
      mainWindow.webContents.send('game-closed');
    }
  });

  retroarchProcess.on('error', (error) => {
    console.error('Failed to start RetroArch:', error);
    retroarchProcess = null;
    if (mainWindow) {
      mainWindow.webContents.send('game-error', error.message);
    }
  });

  if (mainWindow) {
    mainWindow.webContents.send('game-started');
  }

  // Position RetroArch window after a short delay (longer on Windows)
  const positionDelay = process.platform === 'win32' ? 3000 : 2000;
  setTimeout(() => {
    positionRetroArchWindow();

    // Retry on Windows after additional delays
    if (process.platform === 'win32') {
      setTimeout(() => {
        console.log('Retrying window positioning (attempt 2)...');
        positionRetroArchWindow();
      }, 2000);

      setTimeout(() => {
        console.log('Retrying window positioning (attempt 3)...');
        positionRetroArchWindow();
      }, 4000);
    }
  }, positionDelay);

  // Start memory polling after a delay to let RetroArch initialize
  const memoryPollingDelay = process.platform === 'win32' ? 8000 : 4000;
  setTimeout(async () => {
    console.log('Starting memory polling...');

    // Test network connection first
    try {
      console.log('Testing RetroArch network connection...');
      await sendCommand('VERSION');
      console.log('Network connection successful!');
    } catch (error) {
      console.error('Network connection test failed:', error.message);
      console.error('Make sure RetroArch network commands are enabled in Settings > Network');
    }

    startMemoryPolling();

    // Reset state loading tracking for new game session
    hasManuallyLoadedState = false;
    if (menuAutoLoadTimer) {
      clearTimeout(menuAutoLoadTimer);
      menuAutoLoadTimer = null;
    }

    // Auto-load startup state if it exists (for controller setup, etc.)
    const userStatesDir = getUserStatesDir();
    const startupStateDir = path.join(userStatesDir, 'start');
    if (fs.existsSync(startupStateDir)) {
      console.log('Auto-loading startup state for controller configuration...');
      try {
        await loadState('start', true); // Mark as auto-load
      } catch (error) {
        console.error('Failed to auto-load startup state:', error);
      }
    }

    // Set 30-second timer to auto-load menu state if no manual state is loaded
    menuAutoLoadTimer = setTimeout(async () => {
      if (!hasManuallyLoadedState && retroarchProcess) {
        const menuStateDir = path.join(userStatesDir, 'menu');
        if (fs.existsSync(menuStateDir)) {
          console.log('🍔 Auto-loading menu state after 40 seconds of no manual state selection...');
          try {
            await loadState('menu', true); // Mark as auto-load
          } catch (error) {
            console.error('Failed to auto-load menu state:', error);
          }
        } else {
          console.log('🍔 Menu state folder not found - skipping auto-menu load');
        }
      }
      menuAutoLoadTimer = null;
    }, 40000); // 40 seconds

  }, memoryPollingDelay); // Wait for RetroArch to initialize network interface
}

function getRomBaseName() {
  // Use the ACTIVE game's ROM (matches loadGame), so save-state filenames line up
  // with the ROM RetroArch is actually running (e.g. "Quake II (USA)" in Quake mode).
  const romPath = findActiveRom();
  if (romPath) {
    const baseName = path.basename(romPath, path.extname(romPath));
    console.log('Using actual ROM file base name:', baseName);
    return baseName;
  }

  // Default fallback - what RetroArch typically uses for this ROM
  console.log('Using default ROM base name: GoldenEye 007 (U)');
  return 'GoldenEye 007 (U)';
}

async function loadState(stateFile, isAutoLoad = false) {
  if (!retroarchProcess) {
    console.log('Game is not running, cannot load state');
    if (!isAutoLoad) {
      dialog.showMessageBox(mainWindow, {
        type: 'warning',
        message: 'Please press Deploy first',
        detail: 'You need to deploy the game before loading a Quick Deploy state.'
      });
    }
    return;
  }

  const localStatesDir = getUserStatesDir();
  let localStatePath = path.join(localStatesDir, stateFile);
  let actualStateFile = stateFile;

  // Check if stateFile is actually a folder (like "dam")
  if (fs.existsSync(localStatePath) && fs.statSync(localStatePath).isDirectory()) {
    console.log(`Looking for state file in folder: ${stateFile}`);

    // Find any .state file in the directory
    const files = fs.readdirSync(localStatePath);
    const stateFileInDir = files.find(file => /\.state\d*$/i.test(file));

    if (stateFileInDir) {
      localStatePath = path.join(localStatePath, stateFileInDir);
      actualStateFile = `${stateFile}/${stateFileInDir}`;
      console.log(`Found state file: ${actualStateFile}`);
    } else {
      console.error(`No state file found in folder: ${stateFile}`);
      dialog.showErrorBox('Error', `No state file found in "${stateFile}" folder`);
      return;
    }
  }

  if (!fs.existsSync(localStatePath)) {
    console.error(`State file ${actualStateFile} not found`);
    dialog.showErrorBox('Error', `State file "${actualStateFile}" not found in states folder`);
    return;
  }

  // Use project's states directory (which we've configured RetroArch to use)
  const projectStatesDir = getUserStatesDir();
  const romBaseName = getRomBaseName();

  try {
    // Extract state file extension from the actual state filename found
    const filename = path.basename(localStatePath);
    const stateMatch = filename.match(/\.state(\d*)$/);
    const stateExtension = stateMatch ? stateMatch[0] : '.state';

    // Since RetroArch is now configured to use our project states directory,
    // we need to use the core-specific subfolder that RetroArch creates
    const coreStatesDir = path.join(projectStatesDir, 'Mupen64Plus-Next');

    // Ensure both the project states directory and core subfolder exist
    if (!fs.existsSync(projectStatesDir)) {
      fs.mkdirSync(projectStatesDir, { recursive: true });
      console.log(`Created project states directory: ${projectStatesDir}`);
    }

    if (!fs.existsSync(coreStatesDir)) {
      fs.mkdirSync(coreStatesDir, { recursive: true });
      console.log(`Created core states directory: ${coreStatesDir}`);
    }

    // Copy to the core-specific RetroArch states directory with the correct extension
    const retroarchStatePath = path.join(coreStatesDir, `${romBaseName}${stateExtension}`);

    // Copy state file to the correct location with matching extension
    fs.copyFileSync(localStatePath, retroarchStatePath);
    console.log(`Copied ${stateFile} to RetroArch at: ${retroarchStatePath}`);

    // Load the state via network command
    // For .state files (no slot), use LOAD_STATE; for .state0, .state1, etc., use LOAD_STATE_SLOT
    if (stateExtension === '.state') {
      await sendCommand('LOAD_STATE');
      console.log(`Loaded state: ${stateFile} (using LOAD_STATE command)`);
    } else {
      const slotNumber = stateExtension.replace('.state', '');
      await sendCommand(`LOAD_STATE_SLOT ${slotNumber}`);
      console.log(`Loaded state: ${stateFile} (slot ${slotNumber})`);
    }

    // Track manual state loading to cancel auto-menu timer
    if (!isAutoLoad && stateFile !== 'start') {
      hasManuallyLoadedState = true;
      if (menuAutoLoadTimer) {
        clearTimeout(menuAutoLoadTimer);
        menuAutoLoadTimer = null;
        console.log('🚫 Cancelled auto-menu load due to manual state selection');
      }
    }

    if (mainWindow) {
      mainWindow.webContents.send('state-loaded', stateFile);
    }
  } catch (error) {
    console.error('Failed to load state:', error);
    if (!isAutoLoad) {
      dialog.showErrorBox('Error', `Failed to load state: ${error.message}`);
    }
  }
}

function restartGame() {
  console.log('Restarting game...');

  // Send restarting event to UI
  if (mainWindow) {
    mainWindow.webContents.send('game-restarting');
  }

  // Adapter-driven game (e.g. Spearmint/Quake III): kill, then relaunch
  if (activeAdapter) {
    stopMemoryPolling();
    const proc = activeAdapter.getProcess && activeAdapter.getProcess();
    try { if (proc) proc.kill('SIGKILL'); } catch (e) { console.log('Adapter kill error:', e.message); }
    activeAdapter = null;
    setTimeout(() => loadGame(), 1000);
    return;
  }

  if (retroarchProcess) {
    console.log('Terminating existing RetroArch process...');
    stopMemoryPolling();

    // Kill the process more forcefully
    retroarchProcess.kill('SIGTERM');

    // Wait for process to actually terminate
    retroarchProcess.on('close', (code) => {
      console.log(`RetroArch process terminated with code ${code}`);
      retroarchProcess = null;

      // Start new game after process fully terminates
      setTimeout(() => {
        console.log('Starting new game instance...');
        loadGame();
      }, 1000);
    });

    // Force kill if it doesn't terminate gracefully
    setTimeout(() => {
      if (retroarchProcess) {
        console.log('Force killing RetroArch process...');
        retroarchProcess.kill('SIGKILL');
        retroarchProcess = null;
        setTimeout(() => {
          loadGame();
        }, 500);
      }
    }, 3000);

  } else {
    // No existing process, just start new game
    loadGame();
  }
}

function closeGame() {
  console.log('Closing game...');
  stopMemoryPolling();

  // Adapter-driven game (e.g. Spearmint/Quake III)
  if (activeAdapter) {
    const proc = activeAdapter.getProcess && activeAdapter.getProcess();
    try { if (proc) proc.kill('SIGKILL'); } catch (e) { console.log('Adapter kill error:', e.message); }
    activeAdapter = null;
    if (mainWindow) mainWindow.webContents.send('game-closed');
    return;
  }

  if (retroarchProcess) {
    console.log('Terminating RetroArch process...');

    // Store reference to avoid race conditions
    const processToKill = retroarchProcess;
    const originalPid = processToKill.pid;
    let isProcessClosed = false;

    // Set up close handler before killing
    processToKill.on('close', (code, signal) => {
      console.log(`RetroArch process (PID: ${originalPid}) closed with code ${code}, signal: ${signal}`);
      isProcessClosed = true;
      retroarchProcess = null;
      if (mainWindow) {
        mainWindow.webContents.send('game-closed');
      }
    });

    // Handle process errors
    processToKill.on('error', (error) => {
      console.error('RetroArch process error:', error);
      isProcessClosed = true;
      retroarchProcess = null;
      if (mainWindow) {
        mainWindow.webContents.send('game-closed');
      }
    });

    // Try SIGKILL immediately - RetroArch doesn't always respond to SIGTERM
    console.log(`Sending SIGKILL to RetroArch process (PID: ${originalPid})...`);
    processToKill.kill('SIGKILL');

    // Fallback timeout - if process still hasn't closed after 5 seconds, force UI update
    setTimeout(() => {
      if (!isProcessClosed) {
        console.log('RetroArch process did not close properly, forcing UI update...');
        retroarchProcess = null;
        if (mainWindow) {
          mainWindow.webContents.send('game-closed');
        }
      }
    }, 5000);

  } else {
    console.log('No RetroArch process to close');
    if (mainWindow) {
      mainWindow.webContents.send('game-closed');
    }
  }
}

// Helper functions for installation instructions
function showRetroArchInstallHelp() {
  let instructions = '';

  if (process.platform === 'darwin') {
    instructions = `RetroArch not found! Please install RetroArch:

🍺 Option 1 - Homebrew (Recommended):
Open Terminal and run:
brew install --cask retroarch

🌐 Option 2 - Download:
Visit https://www.retroarch.com
Download RetroArch for macOS
Install the .dmg file

After installation, restart GoldenPie.`;
  } else if (process.platform === 'win32') {
    instructions = `RetroArch not found! Please install RetroArch:

📦 Option 1 - winget (Recommended):
Open Command Prompt and run:
winget install libretro.RetroArch

🌐 Option 2 - Download:
Visit https://www.retroarch.com
Download RetroArch for Windows
Run the installer

After installation, restart GoldenPie.`;
  } else {
    instructions = `RetroArch not found! Please install RetroArch:

📦 Option 1 - Package Manager:
Ubuntu/Debian: sudo apt install retroarch
Arch: sudo pacman -S retroarch
Fedora: sudo dnf install retroarch

📱 Option 2 - Flatpak:
flatpak install flathub org.libretro.RetroArch

🌐 Option 3 - Download:
Visit https://www.retroarch.com

After installation, restart GoldenPie.`;
  }

  dialog.showMessageBox(mainWindow, {
    type: 'info',
    title: 'RetroArch Installation Required',
    message: instructions,
    buttons: ['OK']
  });
}

function showCoreInstallHelp() {
  const instructions = `N64 Core not found! Please install the Mupen64Plus-Next core:

🎮 Steps to install:
1. Open RetroArch
2. Go to: Main Menu → Online Updater → Core Downloader
3. Scroll down and find:
   • Nintendo - Nintendo 64 (Mupen64Plus-Next)
   • Nintendo - Nintendo 64 (ParaLLEl N64)
4. Click to download and install
5. Close RetroArch
6. Restart GoldenPie

📝 Note: The core will be automatically detected once installed.`;

  dialog.showMessageBox(mainWindow, {
    type: 'info',
    title: 'N64 Core Installation Required',
    message: instructions,
    buttons: ['OK']
  });
}

function showRomInstallHelp() {
  const instructions = `ROM file not found! Please add your ROM:

📁 Steps to add ROM:
1. Legally obtain GoldenEye 007 (USA).z64
2. Place the ROM file in the "./Roms/Goldeneye" folder
3. Supported formats: .z64, .n64, .v64
4. Restart GoldenPie

⚖️ Legal Notice:
You must own an original copy of the game to legally use ROM files.
ROM files are not provided with this software.

📂 Expected location:
${path.join(__dirname, 'Roms', 'goldeneye.z64')}`;

  dialog.showMessageBox(mainWindow, {
    type: 'info',
    title: 'ROM File Required',
    message: instructions,
    buttons: ['OK']
  });
}
