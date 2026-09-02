const express = require('express');
const axios = require('axios');

const app = express();
const PORT = process.env.PORT || 3000;
const INTERNAL_SECRET = process.env.INTERNAL_PROXY_SECRET;
const PROXY_URL = process.env.RESIDENTIAL_PROXY_URL;
const STEAM_ID_PATTERN = /^\d{5,20}$/;

// Парсим переменные прокси напрямую из строки
let proxyConfig = false;
if (PROXY_URL) {
  try {
    const parsedUrl = new URL(PROXY_URL);
    proxyConfig = {
      protocol: parsedUrl.protocol.replace(':', ''),
      host: parsedUrl.hostname,
      port: parseInt(parsedUrl.port, 10) || 80,
      auth: parsedUrl.username ? {
        username: decodeURIComponent(parsedUrl.username),
        password: decodeURIComponent(parsedUrl.password)
      } : undefined
    };
    console.log('[SYSTEM] Proxy config parsed successfully:', proxyConfig.host);
  } catch (e) {
    console.error('[SYSTEM] Failed to parse PROXY_URL:', e.message);
  }
}

const log = (type, message, details = '') => {
  const time = new Date().toISOString();
  console.log(`[${time}] [${type}] ${message}`, details ? JSON.stringify(details) : '');
};

app.get('/health', (req, res) => {
  res.json({ status: 'ok', proxyActive: !!proxyConfig });
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
  log('OUTGOING', `Fetching directly from Steam via Webshare...`);

  try {
    const axiosOptions = {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'application/json, text/plain, */*',
        'Accept-Language': 'en-US,en;q=0.9'
      },
      timeout: 15000,
      proxy: proxyConfig // Передаем нативный конфиг Axios
    };

    const steamRes = await axios.get(steamUrl, axiosOptions);
    const duration = Date.now() - startTime;

    log('STEAM_RESPONSE', `Steam replied in ${duration}ms | HTTP Status: ${steamRes.status}`);

    if (steamRes.data === null) {
      return res.status(200).json({ assets: [], descriptions: [], total_inventory_count: 0 });
    }

    log('SUCCESS', `Successfully fetched inventory for ${steamId}`, {
      assetsCount: steamRes.data.assets ? steamRes.data.assets.length : 0
    });

    return res.status(200).json(steamRes.data);

  } catch (err) {
    const duration = Date.now() - startTime;
    if (err.response) {
      log('ERROR', `Steam returned status ${err.response.status}`);
      return res.status(err.response.status).json({ error: `Steam returned status ${err.response.status}` });
    }
    log('ERROR', `Exception after ${duration}ms: ${err.message}`);
    return res.status(502).json({ error: `Failed to reach Steam servers: ${err.message}` });
  }
});

app.listen(PORT, () => {
  log('SYSTEM', `Proxy service running on port ${PORT}.`);
});