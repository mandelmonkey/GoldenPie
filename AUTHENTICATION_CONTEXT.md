# GoldenEye Launcher - Lightning Authentication System

## Project Overview

This is an Electron-based launcher for GoldenEye 007 (N64) via RetroArch with integrated Lightning Network authentication using LUD-22 protocol. Players authenticate with their Lightning wallets to link their Lightning addresses to their in-game player slots.

## Architecture

### Client (Electron App)
- **Main App**: `main.js`, `index.html`, `renderer.js`
- **Authentication UI**: Agent Authentication section with 4 player slots
- **Features**:
  - Click "Login" button for any player to generate QR code
  - QR code opens in fullscreen modal for easy scanning
  - Polls server to detect when wallet authenticates
  - Displays Lightning address in player slot when authenticated
  - Modal auto-closes on successful authentication

### Server (Node.js/Express)
- **Location**: `server.js`
- **Deployed at**: https://lnshare-server.vercel.app
- **Storage**: Upstash Redis (via Vercel Marketplace integration)
- **Endpoints**:
  - `POST /auth/session` - Creates auth session, returns QR code data URL
  - `GET /auth/callback` - Wallet fetches request details (LUD-22)
  - `POST /auth/callback` - Wallet submits Lightning address (LUD-22)
  - `GET /auth/status/:sessionId` - Client polls for authentication status
  - `GET /health` - Health check (shows storage type)

## LUD-22 Authentication Flow

1. **User clicks "Login"** for a player (Agent 1-4)
2. **Client requests session** from server: `POST /auth/session`
3. **Server generates**:
   - Unique `sessionId` (UUID)
   - Random `k1` value (32 bytes hex)
   - LUD-22 URL: `https://lnshare-server.vercel.app/auth/callback?tag=addressRequest&k1=...&metadata=...`
   - QR code as data URL
4. **Client opens QR modal** fullscreen with the QR code
5. **User scans** with Lightning wallet (e.g., Alby)
6. **Wallet makes GET request** to callback URL to fetch details
7. **Wallet prompts user** to share Lightning address
8. **Wallet POSTs** Lightning address to callback URL
9. **Server stores** address in Redis: `session:sessionId` → `{k1, playerNumber, lightningAddress, createdAt}`
10. **Client polls** `/auth/status/:sessionId` every 2 seconds
11. **When authenticated**, client displays address in green and closes modal

## Key Files

### Client Files
- **`index.html`**: UI layout including Agent Authentication section with 4 player slots and fullscreen QR modal
- **`renderer.js`**:
  - `showLoginQR(playerNumber)` - Generates QR and opens modal
  - `startPollingForPlayer()` - Polls for authentication status
  - `openQRModal()` / `closeQRModal()` - Modal management
  - `playerSessions` object stores session data
- **`config.json`**:
  ```json
  {
    "auth": {
      "serverUrl": "https://lnshare-server.vercel.app"
    }
  }
  ```

### Server Files
- **`server.js`**: Express server with LUD-22 endpoints and Redis storage abstraction
- **`vercel.json`**: Vercel deployment configuration
- **`.vercelignore`**: Excludes Electron files from deployment

## Environment Variables (Vercel)

Set automatically by Upstash Redis Marketplace integration:
- `REDIS_URL` - Redis connection string (used by ioredis)
- `KV_REST_API_URL` - Upstash REST API URL (for @vercel/kv)
- `KV_REST_API_TOKEN` - Upstash REST API token
- `KV_URL` - Alternative Redis URL

Server auto-detects which is available and uses appropriate client.

## Storage Abstraction

The server supports three storage modes (tries in order):
1. **Redis** (via `REDIS_URL` + ioredis) - Standard Redis connection
2. **Vercel KV** (via `KV_REST_API_*` + @vercel/kv) - REST API connection
3. **In-memory** - Fallback for local dev (sessions don't persist)

Current production setup uses **Redis** mode via Upstash.

## Session Data Structure

```javascript
{
  k1: "hex_string",           // 32-byte random value
  playerNumber: 1,            // 1-4
  lightningAddress: null,     // null until authenticated
  createdAt: 1234567890       // timestamp
}
```

Stored in Redis with 1-hour expiry:
- `session:{sessionId}` → session data (JSON)
- `k1:{k1}` → sessionId mapping (for callback lookup)

## UI Components

### Agent Authentication Section
- 2x2 grid showing 4 player slots
- Each slot shows:
  - Agent name with color (Agent 1-4)
  - Lightning address or "Not logged in"
  - "Login" button
- On click, generates QR and opens modal immediately

### QR Code Modal
- Fullscreen overlay (dark background)
- Large QR code (500x500px max)
- Title: "Agent {N}"
- Instructions: "Scan with your Lightning wallet to login"
- Close button
- Can also close by:
  - Clicking outside modal
  - Pressing Escape key
  - Auto-closes when authentication succeeds

## Running Locally

### Start Electron App
```bash
npm start
```

### Start Auth Server (for local testing)
```bash
npm run server
```

Update `config.json` to use localhost:
```json
{
  "auth": {
    "serverUrl": "http://localhost:3000"
  }
}
```

## Deployment

### Deploy Server to Vercel
```bash
vercel --prod
```

Server automatically:
- Uses production domain (lnshare-server.vercel.app)
- Connects to Upstash Redis
- Generates correct callback URLs

### Setup Upstash Redis (Vercel Marketplace)
1. Go to Vercel Dashboard → Project → Storage
2. Browse Marketplace → Search "Upstash Redis"
3. Add Integration
4. Environment variables auto-configured
5. Redeploy

## Dependencies

### Client (Electron)
- `electron` v28
- `express` v5
- `qrcode` v1.5.4
- `uuid` v9 (CommonJS compatible)
- `ioredis` (for Redis connection)
- `@vercel/kv` (for Vercel KV REST API)
- `cors` (for CORS support)

### Notable Package Choices
- **uuid v9**: Downgraded from v13 because v13 is ES Module only, incompatible with Vercel serverless CommonJS
- **ioredis**: Standard Redis client for TCP connections
- **@vercel/kv**: REST-based Redis client for serverless environments

## Current State (Working Features)

✅ **Authentication Flow**
- QR code generation works
- LUD-22 protocol fully implemented
- Wallet scanning and Lightning address submission working
- Client polling and status updates working
- Modal auto-close on authentication success

✅ **Server**
- Deployed at https://lnshare-server.vercel.app
- Redis storage working (Upstash)
- Health check available: `/health`
- Correct callback URLs with production domain

✅ **UI/UX**
- Clean 4-player authentication grid
- One-click login per player
- Fullscreen QR modal
- Auto-close on success
- Green text for authenticated Lightning addresses

## Future Enhancements (Not Yet Implemented)

❌ **Payment Logic**
- Detect kills in-game
- Send sats to authenticated Lightning addresses
- Amount per kill configuration
- Payment confirmation/feedback

❌ **Session Persistence**
- Remember authenticated players across app restarts
- Re-authenticate flow if session expired

❌ **Additional Features**
- Logout button per player
- Payment history/stats
- Configurable sat amounts
- Test payment button

## Testing with Alby

1. Install Alby browser extension or mobile app
2. Click "Login" for a player
3. Scan QR code with Alby
4. Approve Lightning address sharing
5. Watch address appear in app automatically

## Important Notes

- **HTTPS Required**: LUD-22 requires HTTPS for callback URLs (wallets reject HTTP)
- **Production Domain**: Server uses `req.headers.host` to generate correct callback URL
- **Session Expiry**: Sessions expire after 1 hour in Redis
- **K1 One-Time Use**: Each k1 value is deleted after successful authentication to prevent reuse
- **Polling Interval**: Client polls every 2 seconds for status updates

## Git Ignore

Important files NOT to commit:
- `.env` (if you add environment variables)
- `node_modules/`
- `.DS_Store`
- `.retroarch-temp.cfg`
- RetroArch.app (if bundled)
- Roms/ (copyright)

## Support & Documentation

- LUD-22 Protocol: https://github.com/mandelmonkey/luds/blob/luds/22.md
- Vercel Docs: https://vercel.com/docs
- Upstash Redis: https://upstash.com/docs/redis
- Electron Docs: https://www.electronjs.org/docs

---

**Last Updated**: October 30, 2025
**Status**: Authentication system fully functional, payment logic pending
