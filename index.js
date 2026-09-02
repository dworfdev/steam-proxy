const express = require('express');

const app = express();
const PORT = process.env.PORT || 3000;
const INTERNAL_SECRET = process.env.INTERNAL_PROXY_SECRET;
const STEAM_WEB_API_KEY = process.env.STEAM_WEB_API_KEY; // Добавляем переменный ключ API
const STEAM_ID_PATTERN = /^\d{5,20}$/;

// Вспомогательный форматирует логов
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

  // Проверка наличия API-ключа
  const apiKey = STEAM_WEB_API_KEY || 'A6I5L6F6G2JN483T'; // Ключ из переменной или fallback
  const apiUrl = `https://www.steamwebapi.com/steam/api/inventory?key=${apiKey}&steam_id=${steamId}&game=cs2`;

  log('OUTGOING', `Fetching from SteamWebAPI for steamId: ${steamId}`);

  try {
    // 3. Запрос к SteamWebAPI
    const apiRes = await fetch(apiUrl);
    const duration = Date.now() - startTime;
    log('PROXY_RESPONSE', `SteamWebAPI replied in ${duration}ms | HTTP Status: ${apiRes.status}`);

    const text = await apiRes.text();

    if (!apiRes.ok) {
      log('ERROR', `SteamWebAPI returned non-200 code: ${apiRes.status}`, {
        status: apiRes.status,
        bodySnippet: text.substring(0, 300)
      });
      return res.status(apiRes.status).json({
        error: `SteamWebAPI returned status ${apiRes.status}`,
        status: apiRes.status
      });
    }

    // 4. Парсинг JSON
    let data;
    try {
      data = JSON.parse(text);
    } catch (parseErr) {
      log('ERROR', `Failed to parse JSON for steamId: ${steamId}`, {
        error: parseErr.message,
        rawSnippet: text.substring(0, 200)
      });
      return res.status(502).json({ error: 'SteamWebAPI returned non-JSON payload' });
    }

    log('SUCCESS', `Successfully retrieved inventory via SteamWebAPI for steamId: ${steamId}`, {
      itemsCount: Array.isArray(data) ? data.length : 'N/A'
    });

    return res.status(200).json(data);

  } catch (err) {
    const duration = Date.now() - startTime;
    log('ERROR', `Network Exception while reaching SteamWebAPI after ${duration}ms`, {
      message: err.message,
      stack: err.stack
    });
    return res.status(502).json({ error: 'Failed to reach SteamWebAPI servers' });
  }
});

app.listen(PORT, () => {
  log('SYSTEM', `Steam inventory proxy listening on port ${PORT}`);
});