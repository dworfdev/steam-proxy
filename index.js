const express = require('express');

const app = express();
const PORT = process.env.PORT || 3000;
const INTERNAL_SECRET = process.env.INTERNAL_PROXY_SECRET;
const STEAM_ID_PATTERN = /^\d{5,20}$/;

// Вспомогательный форматир логов
const log = (type, message, details = '') => {
  const time = new Date().toISOString();
  console.log(`[${time}] [${type}] ${message}`, details ? JSON.stringify(details) : '');
};

app.get('/health', (req, res) => {
  log('INFO', 'Health check requested');
  res.json({ status: 'ok' });
});

app.get('/inventory/:steamId', async (req, res) => {
  const { steamId } = req.params;
  const startTime = Date.now();

  log('INCOMING', `New inventory request for steamId: ${steamId}`);

  // 1. Проверка авторизации
  if (INTERNAL_SECRET) {
    const provided = req.header('X-Internal-Secret');
    if (provided !== INTERNAL_SECRET) {
      log('WARN', `AUTH FAILED for steamId: ${steamId}. Provided secret: "${provided || 'NONE'}"`);
      return res.status(401).json({ error: 'Unauthorized: Shared secret mismatch or missing' });
    }
    log('INFO', `AUTH SUCCESS for steamId: ${steamId}`);
  } else {
    log('WARN', 'INTERNAL_PROXY_SECRET is not set on proxy server! Skipping secret verification.');
  }

  // 2. Валидация SteamID
  if (!STEAM_ID_PATTERN.test(steamId)) {
    log('WARN', `INVALID STEAMID FORMAT: ${steamId}`);
    return res.status(400).json({ error: 'Invalid steamId format' });
  }

  const steamUrl = `https://steamcommunity.com/inventory/${steamId}/730/2?l=english`;
  log('OUTGOING', `Fetching from Steam: ${steamUrl}`);

  try {
    // 3. Запрос в Steam
    const steamRes = await fetch(steamUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'application/json, text/plain, */*'
      }
    });

    const duration = Date.now() - startTime;
    log('STEAM_RESPONSE', `Steam replied in ${duration}ms | HTTP Status: ${steamRes.status}`);

    const text = await steamRes.text();

    // 4. Проверка статуса ответа Steam
    if (!steamRes.ok) {
      log('ERROR', `Steam returned non-200 code: ${steamRes.status} for steamId: ${steamId}`, {
        status: steamRes.status,
        bodySnippet: text.substring(0, 300)
      });
      return res.status(steamRes.status).json({
        error: `Steam returned status ${steamRes.status}`,
        steamStatus: steamRes.status
      });
    }

    // 5. Парсинг JSON
    let data;
    try {
      data = JSON.parse(text);
    } catch (parseErr) {
      log('ERROR', `Failed to parse Steam JSON for steamId: ${steamId}`, {
        error: parseErr.message,
        rawSnippet: text.substring(0, 200)
      });
      return res.status(502).json({ error: 'Steam returned non-JSON payload' });
    }

    if (data === null) {
      log('INFO', `Steam returned null body for steamId: ${steamId} (Private profile or empty)`);
      return res.status(200).json({ assets: [], descriptions: [], total_inventory_count: 0 });
    }

    const assetsCount = data.assets ? data.assets.length : 0;
    const descCount = data.descriptions ? data.descriptions.length : 0;

    log('SUCCESS', `Successfully retrieved inventory for steamId: ${steamId}`, {
      assetsCount,
      descCount,
      totalCount: data.total_inventory_count
    });

    return res.status(200).json(data);

  } catch (err) {
    const duration = Date.now() - startTime;
    log('ERROR', `Network Exception while reaching Steam after ${duration}ms`, {
      message: err.message,
      stack: err.stack
    });
    return res.status(502).json({ error: 'Failed to reach Steam servers' });
  }
});

app.listen(PORT, () => {
  log('SYSTEM', `Steam inventory proxy listening on port ${PORT}`);
});