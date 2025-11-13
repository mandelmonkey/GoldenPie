const express = require('express');
const crypto = require('crypto');
const { v4: uuidv4 } = require('uuid');
const QRCode = require('qrcode');
const cors = require('cors');

const app = express();
const PORT = 3000;

// Middleware
app.use(cors());
app.use(express.json());

// Storage setup - Try Redis, then Vercel KV, then in-memory
let redisClient;
let kv;
let storageType = 'in-memory';

// Try standard Redis first (REDIS_URL from marketplace)
if (process.env.REDIS_URL) {
    try {
        const Redis = require('ioredis');
        redisClient = new Redis(process.env.REDIS_URL, {
            maxRetriesPerRequest: 3,
            retryStrategy: (times) => {
                if (times > 3) return null;
                return Math.min(times * 50, 2000);
            }
        });

        redisClient.on('connect', () => {
            console.log('✓ Connected to Redis');
            storageType = 'redis';
        });

        redisClient.on('error', (err) => {
            console.error('Redis error:', err.message);
            storageType = 'in-memory';
            redisClient = null;
        });

        storageType = 'redis';
        console.log('Using Redis for session storage');
    } catch (e) {
        console.log('Redis client error:', e.message);
    }
}

// Try Vercel KV as fallback (Upstash REST API)
if (!redisClient && process.env.KV_REST_API_URL && process.env.KV_REST_API_TOKEN) {
    try {
        kv = require('@vercel/kv').kv;
        storageType = 'vercel-kv';
        console.log('Using Vercel KV for session storage');
    } catch (e) {
        console.log('Vercel KV error:', e.message);
    }
}

// In-memory storage fallback
if (!redisClient && !kv) {
    console.log('Using in-memory storage (sessions will not persist)');
}

const sessions = new Map();
const k1ToSession = new Map();

// Storage abstraction layer
const storage = {
    async setSession(sessionId, data) {
        if (redisClient && storageType === 'redis') {
            await redisClient.setex(`session:${sessionId}`, 3600, JSON.stringify(data));
        } else if (kv) {
            await kv.set(`session:${sessionId}`, JSON.stringify(data), { ex: 3600 });
        } else {
            sessions.set(sessionId, data);
        }
    },

    async getSession(sessionId) {
        if (redisClient && storageType === 'redis') {
            const data = await redisClient.get(`session:${sessionId}`);
            return data ? JSON.parse(data) : null;
        } else if (kv) {
            const data = await kv.get(`session:${sessionId}`);
            return data ? JSON.parse(data) : null;
        } else {
            return sessions.get(sessionId) || null;
        }
    },

    async setK1Mapping(k1, sessionId) {
        if (redisClient && storageType === 'redis') {
            await redisClient.setex(`k1:${k1}`, 3600, sessionId);
        } else if (kv) {
            await kv.set(`k1:${k1}`, sessionId, { ex: 3600 });
        } else {
            k1ToSession.set(k1, sessionId);
        }
    },

    async getSessionIdByK1(k1) {
        if (redisClient && storageType === 'redis') {
            return await redisClient.get(`k1:${k1}`);
        } else if (kv) {
            return await kv.get(`k1:${k1}`);
        } else {
            return k1ToSession.get(k1);
        }
    },

    async deleteK1Mapping(k1) {
        if (redisClient && storageType === 'redis') {
            await redisClient.del(`k1:${k1}`);
        } else if (kv) {
            await kv.del(`k1:${k1}`);
        } else {
            k1ToSession.delete(k1);
        }
    }
};

// Cleanup old sessions (only for in-memory storage)
if (storageType === 'in-memory') {
    setInterval(() => {
        const oneHourAgo = Date.now() - 60 * 60 * 1000;
        for (const [sessionId, session] of sessions.entries()) {
            if (session.createdAt < oneHourAgo) {
                k1ToSession.delete(session.k1);
                sessions.delete(sessionId);
            }
        }
    }, 5 * 60 * 1000); // Run every 5 minutes
}

// Get base URL dynamically
function getBaseUrl(req) {
    // Check request host first (includes production domain)
    if (req.headers.host && !req.headers.host.includes('localhost')) {
        return `https://${req.headers.host}`;
    }
    // Check if running on Vercel (fallback to deployment URL)
    if (process.env.VERCEL_URL) {
        return `https://${process.env.VERCEL_URL}`;
    }
    // Local development
    return `http://localhost:${PORT}`;
}

// Create a new auth session for a player
app.post('/auth/session', async (req, res) => {
    try {
        const { playerNumber } = req.body;

        // Generate unique session ID and k1 value
        const sessionId = uuidv4();
        const k1 = crypto.randomBytes(32).toString('hex');

        // Store session
        await storage.setSession(sessionId, {
            k1,
            playerNumber,
            lightningAddress: null,
            createdAt: Date.now()
        });
        await storage.setK1Mapping(k1, sessionId);

        // Create LUD-22 URL with dynamic base URL
        const baseUrl = getBaseUrl(req);
        const callbackUrl = `${baseUrl}/auth/callback`;
        const metadata = `Login as Player ${playerNumber} - GoldenEye Launcher`;
        const lnurlAddress = `${callbackUrl}?tag=addressRequest&k1=${k1}&metadata=${encodeURIComponent(metadata)}`;

        // Generate QR code
        const qrCodeDataUrl = await QRCode.toDataURL(lnurlAddress);

        res.json({
            sessionId,
            lnurlAddress,
            qrCode: qrCodeDataUrl,
            k1
        });
    } catch (error) {
        console.error('Error creating session:', error);
        res.status(500).json({ error: 'Failed to create session' });
    }
});

// LUD-22 Callback endpoint - GET request returns request details
app.get('/auth/callback', async (req, res) => {
    try {
        const { k1, tag } = req.query;

        if (tag !== 'addressRequest') {
            return res.status(400).json({
                status: 'ERROR',
                reason: 'Invalid tag'
            });
        }

        if (!k1) {
            return res.status(400).json({
                status: 'ERROR',
                reason: 'Missing k1'
            });
        }

        // Verify k1 exists
        const sessionId = await storage.getSessionIdByK1(k1);
        if (!sessionId) {
            return res.status(400).json({
                status: 'ERROR',
                reason: 'Invalid or expired k1'
            });
        }

        const session = await storage.getSession(sessionId);
        if (!session) {
            return res.status(400).json({
                status: 'ERROR',
                reason: 'Session not found'
            });
        }

        // Return LUD-22 addressRequest details
        const baseUrl = getBaseUrl(req);
        res.json({
            tag: 'addressRequest',
            callback: `${baseUrl}/auth/callback`,
            k1: k1,
            metadata: `Login as Player ${session.playerNumber} - GoldenEye Launcher`
        });
    } catch (error) {
        console.error('Error in GET callback:', error);
        res.status(500).json({
            status: 'ERROR',
            reason: 'Internal server error'
        });
    }
});

// LUD-22 Callback endpoint - POST receives Lightning address from wallet
app.post('/auth/callback', async (req, res) => {
    try {
        const { k1, address } = req.body;

        if (!k1 || !address) {
            return res.status(400).json({
                status: 'ERROR',
                reason: 'Missing k1 or address'
            });
        }

        // Find session by k1
        const sessionId = await storage.getSessionIdByK1(k1);
        if (!sessionId) {
            return res.status(400).json({
                status: 'ERROR',
                reason: 'Invalid or expired k1'
            });
        }

        // Get session and update with Lightning address
        const session = await storage.getSession(sessionId);
        if (!session) {
            return res.status(400).json({
                status: 'ERROR',
                reason: 'Session not found'
            });
        }

        // Validate Lightning address format (basic check)
        if (!address.includes('@')) {
            return res.status(400).json({
                status: 'ERROR',
                reason: 'Invalid Lightning address format'
            });
        }

        // Update session with Lightning address
        session.lightningAddress = address;
        await storage.setSession(sessionId, session);

        console.log(`Player ${session.playerNumber} authenticated: ${address}`);

        // LUD-22 success response
        res.json({ status: 'OK' });

        // Remove k1 to prevent reuse
        await storage.deleteK1Mapping(k1);

    } catch (error) {
        console.error('Error in callback:', error);
        res.status(500).json({
            status: 'ERROR',
            reason: 'Internal server error'
        });
    }
});

// Poll endpoint - client checks if Lightning address has been received
app.get('/auth/status/:sessionId', async (req, res) => {
    try {
        const { sessionId } = req.params;

        const session = await storage.getSession(sessionId);
        if (!session) {
            return res.status(404).json({
                error: 'Session not found',
                authenticated: false
            });
        }

        res.json({
            authenticated: !!session.lightningAddress,
            lightningAddress: session.lightningAddress,
            playerNumber: session.playerNumber
        });
    } catch (error) {
        console.error('Error checking status:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// Health check
app.get('/health', (req, res) => {
    res.json({
        status: 'ok',
        storage: storageType,
        timestamp: new Date().toISOString()
    });
});

// Export for Vercel serverless
module.exports = app;

// Start server if running locally
if (require.main === module) {
    app.listen(PORT, () => {
        console.log(`LUD-22 Auth Server running on http://localhost:${PORT}`);
        console.log(`Callback URL: http://localhost:${PORT}/auth/callback`);
        console.log(`Storage: ${storageType}`);
    });
}
