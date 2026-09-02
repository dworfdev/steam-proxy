const express = require('express');
const { HttpsProxyAgent } = require('https-proxy-agent');

const app = express();
const PORT = process.env.PORT || 3000;
const INTERNAL_SECRET = process.env.INTERNAL_PROXY_SECRET;
const PROXY_URL = process.env.RESIDENTIAL_PROXY_URL;
const STEAM_ID_PATTERN = /^\d{5,20}$/;

const agent = PROXY_URL ? new HttpsProxyAgent(PROXY_URL) : null;

const log = (type, message, details = '') => {
  const time = new Date().toISOString();
  console.log(`[${time}] [${type}] ${message}`, details ? JSON.stringify(details) : '');
};

app.get('/health', (req, res) => {
  res.json({ status: 'ok', proxyActive: !!agent });
});

app.get('/inventory/:steamId', async (req, res) => {
  const { steamId } = req.params;
  const startTime = Date.now();

  log('INCOMING', `Inventory request for steamId: ${steamId}`);

  if (INTERNAL_SECRET && req.header('X-Internal-Secret') !== INTERNAL_SECRET) {
    log('WARN', `AUTH FAILED for steamId: ${steamId}`);
    return res.status(401).json({ error: 'Unauthorized' });
  }

  if (!STEAM_ID_PATTERN.test(steamId)) {
    return res.status(400).json({ error: 'Invalid steamId format' });
  }

  const steamUrl = `https://steamcommunity.com/inventory/${steamId}/730/2?l=english`;
  log('OUTGOING', `Fetching directly from Steam via Residential Proxy...`);

  try {
    const steamRes = await fetch(steamUrl, {
      agent,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'application/json, text/plain, */*'
      }
    });

    const duration = Date.now() - startTime;
    log('STEAM_RESPONSE', `Steam replied in ${duration}ms | HTTP Status: ${steamRes.status}`);

    const text = await steamRes.text();

    if (!steamRes.ok) {
      log('ERROR', `Steam returned non-200 code: ${steamRes.status}`, { snippet: text.substring(0, 200) });
      return res.status(steamRes.status).json({ error: `Steam returned status ${steamRes.status}` });
    }

    const data = JSON.parse(text);

    if (data === null) {
      return res.status(200).json({ assets: [], descriptions: [], total_inventory_count: 0 });
    }

    log('SUCCESS', `Successfully fetched inventory for ${steamId}`, {
      assetsCount: data.assets ? data.assets.length : 0
    });

    return res.status(200).json(data);

  } catch (err) {
    const duration = Date.now() - startTime;
    log('ERROR', `Exception after ${duration}ms: ${err.message}`);
    return res.status(502).json({ error: 'Failed to reach Steam servers' });
  }
});

app.listen(PORT, () => {
  log('SYSTEM', `Proxy service running on port ${PORT}. Residential proxy active: ${!!agent}`);
});