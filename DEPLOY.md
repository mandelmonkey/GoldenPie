# Deploying to Vercel

This guide will help you deploy the LUD-22 authentication server to Vercel.

## Prerequisites

1. A Vercel account (sign up at https://vercel.com)
2. Vercel CLI installed: `npm install -g vercel`

## Step 1: Set up Redis/KV Storage via Marketplace

The server needs persistent storage for sessions. Vercel now provides KV/Redis through the Marketplace.

1. Go to your Vercel dashboard: https://vercel.com/dashboard
2. Navigate to your project (or create a new one)
3. Go to the **Storage** tab
4. Click **Browse Marketplace** or visit https://vercel.com/marketplace
5. Search for "Redis" or "KV" storage providers
6. Select a provider (e.g., Upstash Redis, which has a free tier)
7. Click **Add Integration**
8. Follow the provider-specific setup:
   - Create a new database instance
   - Connect it to your Vercel project
   - The integration will automatically inject environment variables

**Recommended Provider**: Upstash Redis
- Free tier: 10,000 commands/day
- Works perfectly with our server's KV needs
- Automatic environment variable injection

**Note**: Environment variables (like `KV_REST_API_URL` and `KV_REST_API_TOKEN` for Upstash) are automatically configured when you connect the integration.

**Alternative**: If you can't find KV in marketplace or prefer in-memory storage for testing, the server will automatically fall back to in-memory storage (sessions won't persist between serverless function invocations, but it works for quick testing).

## Step 2: Deploy the Server

From your project directory:

```bash
# Login to Vercel
vercel login

# Deploy (first time will prompt for configuration)
vercel

# Follow the prompts:
# - Set up and deploy? Yes
# - Which scope? (Select your account)
# - Link to existing project? No (for first deployment)
# - What's your project's name? goldeneye-auth
# - In which directory is your code located? ./
# - Want to override settings? No
```

The deployment will:
- Upload your `server.js` and dependencies
- Create a production URL (e.g., `https://goldeneye-auth.vercel.app`)

## Step 3: Update Client Configuration

Once deployed, update your `config.json` to point to your Vercel URL:

```json
{
  "auth": {
    "serverUrl": "https://YOUR-PROJECT.vercel.app"
  },
  ...
}
```

Replace `YOUR-PROJECT` with your actual Vercel deployment URL.

**Important**: Make sure to use `https://` (not `http://`) for LUD-22 to work with Lightning wallets!

## Step 4: Deploy to Production

To deploy updates to production:

```bash
vercel --prod
```

## Testing the Deployment

1. Visit `https://YOUR-PROJECT.vercel.app/health`
2. You should see:
   ```json
   {
     "status": "ok",
     "storage": "vercel-kv",
     "timestamp": "2025-10-30T..."
   }
   ```

3. Restart your Electron app
4. Click "Generate QR Codes"
5. QR codes should now use the Vercel deployment

## Environment Variables

When you connect a Redis provider through the Vercel Marketplace (like Upstash), the following environment variables are automatically injected:

**For Upstash Redis:**
- `KV_REST_API_URL` or `UPSTASH_REDIS_REST_URL`
- `KV_REST_API_TOKEN` or `UPSTASH_REDIS_REST_TOKEN`
- `KV_REST_API_READ_ONLY_TOKEN`

The `@vercel/kv` package automatically detects these variables.

**You don't need to set these manually** - the marketplace integration handles this automatically!

## Custom Domain (Optional)

To use a custom domain:

1. Go to project settings in Vercel
2. Click **Domains**
3. Add your custom domain
4. Update `config.json` with your custom domain

## Troubleshooting

### "KV not available" error or server using in-memory storage
- Make sure you've added a Redis integration from the Vercel Marketplace
- Verify the integration is connected to your project in the Storage tab
- Check that environment variables are set in your project settings
- Redeploy after connecting: `vercel --prod`
- The server will fall back to in-memory storage if KV isn't configured (works but sessions don't persist)

### CORS errors
- The server has CORS enabled for all origins
- If you need to restrict, edit `server.js` and update the cors() configuration

### Callback not working
- Make sure your Vercel URL is using HTTPS (not HTTP)
- LUD-22 requires HTTPS for security
- Check wallet app logs for any errors

## Local Development

The server works with both local in-memory storage and Vercel KV:

```bash
# Local dev (uses in-memory storage)
npm run server

# The app automatically detects if Vercel KV is available
```

## Monitoring

View logs in Vercel dashboard:
1. Go to your project
2. Click **Deployments**
3. Click on a deployment
4. Click **Functions** to see logs

## Cost

**Vercel**: Free for hobby projects

**Upstash Redis** (recommended provider):
- Free tier: 10,000 commands/day, 256 MB storage
- Pay-as-you-go: $0.20/100k commands after free tier

For this auth server, the free tier should be more than sufficient for testing and small-to-medium deployments. Each auth session uses approximately 4-6 commands (create, poll, update).
