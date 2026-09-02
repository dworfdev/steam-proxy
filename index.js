const express = require('express');
const axios = require('axios');

const app = express();
const PORT = process.env.PORT || 3000;
const INTERNAL_SECRET = process.env.INTERNAL_PROXY_SECRET;
const PROXY_URL = process.env.RESIDENTIAL_PROXY_URL;
const STEAM_ID_PATTERN = /^\d{5,20}$/;

let HttpsProxyAgentModule = null;

// Динамически загружаем ESM модуль https-proxy-agent
if (PROXY_URL) {
  import('https-proxy-agent')
      .then((module) => {
        HttpsProxyAgentModule = module.HttpsProxyAgent;
        console.log('[SYSTEM] HttpsProxyAgent module loaded successfully');
      })
      .catch((err) => {
        console.error('[SYSTEM] Failed to load HttpsProxyAgent:', err.message);
      });
}

const log = (type, message, details = '') => {
  const time = new Date().toISOString();
  console.log(`[${time}] [${type}] ${message}`, details ? JSON.stringify(details) : '');
};

app.get('/health', (req, res) => {
  res.json({ status: 'ok', proxyActive: !!HttpsProxyAgentModule });
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
    const axiosConfig = {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'application/json, text/plain, */*'
      },
      timeout: 10000
    };

    if (PROXY_URL && HttpsProxyAgentModule) {
      const agent = new HttpsProxyAgentModule(PROXY_URL);
      axiosConfig.httpsAgent = agent;
      axiosConfig.httpAgent = agent;
    }

    const steamRes = await axios.get(steamUrl, axiosConfig);

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
    return res.status(502).json({ error: 'Failed to reach Steam servers' });
  }
});

app.listen(PORT, () => {
  log('SYSTEM', `Proxy service running on port ${PORT}.`);
});