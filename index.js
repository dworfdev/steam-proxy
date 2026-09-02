const express = require('express');
const axios = require('axios');

const app = express();
const PORT = process.env.PORT || 3000;
const INTERNAL_SECRET = process.env.INTERNAL_PROXY_SECRET;
const PROXY_URL = process.env.RESIDENTIAL_PROXY_URL;
const STEAM_ID_PATTERN = /^\d{5,20}$/;

let proxyConfig = false;

if (PROXY_URL) {
  try {
    // Очищаем протокол, если он передан
    const cleanProxy = PROXY_URL.replace(/^https?:\/\//, '');

    // Вытаскиваем логин, пароль, хост и порт через регулярку (чтобы @ в пароле не ломал парсер)
    const lastAtIdx = cleanProxy.lastIndexOf('@');

    if (lastAtIdx !== -1) {
      const authPart = cleanProxy.substring(0, lastAtIdx);
      const hostPart = cleanProxy.substring(lastAtIdx + 1);

      const [username, ...passParts] = authPart.split(':');
      const password = passParts.join(':'); // на случай : в пароле

      const [host, port] = hostPart.split(':');

      proxyConfig = {
        protocol: 'http',
        host: host,
        port: parseInt(port, 10) || 80,
        auth: {
          username: username,
          password: password
        }
      };
      console.log(`[SYSTEM] Proxy configured for host: ${host}:${port} | User: ${username}`);
    } else {
      console.error('[SYSTEM] Invalid PROXY_URL format. Missing auth credentials or @ separator.');
    }
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
      timeout: 15000
    };

    if (proxyConfig) {
      axiosOptions.proxy = proxyConfig;
    }

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