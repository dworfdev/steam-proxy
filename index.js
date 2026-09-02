const express = require('express');

const app = express();
const PORT = process.env.PORT || 3000;

// Simple shared-secret auth so this proxy isn't a public open relay to Steam.
// Your Java backend sends this same value in the X-Internal-Secret header.
// Set INTERNAL_PROXY_SECRET as an env var on both this service and the Java
// backend (same value on both sides).
const INTERNAL_SECRET = process.env.INTERNAL_PROXY_SECRET;

const STEAM_ID_PATTERN = /^\d{5,20}$/;

app.get('/health', (req, res) => {
  res.json({ status: 'ok' });
});

app.get('/inventory/:steamId', async (req, res) => {
  // Auth check — reject anything that doesn't present the shared secret.
  if (INTERNAL_SECRET) {
    const provided = req.header('X-Internal-Secret');
    if (provided !== INTERNAL_SECRET) {
      return res.status(401).json({ error: 'Unauthorized' });
    }
  }

  const { steamId } = req.params;
  if (!STEAM_ID_PATTERN.test(steamId)) {
    return res.status(400).json({ error: 'Invalid steamId format' });
  }

  // NOTE: no count param — Steam returns 400 Bad Request with a high count
  // value for at least some accounts (confirmed via manual testing).
  const steamUrl = `https://steamcommunity.com/inventory/${steamId}/730/2?l=english`;

  try {
    const steamRes = await fetch(steamUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
      }
    });

    const text = await steamRes.text();

    if (!steamRes.ok) {
      console.warn(`Steam returned ${steamRes.status} for steamId ${steamId}`);
      return res.status(steamRes.status).json({ error: `Steam returned ${steamRes.status}` });
    }

    let data;
    try {
      data = JSON.parse(text);
    } catch (parseErr) {
      console.error(`Failed to parse Steam response for steamId ${steamId}:`, parseErr.message);
      return res.status(502).json({ error: 'Steam returned non-JSON response' });
    }

    if (data === null) {
      // Steam's way of saying: private inventory, no CS2 items, or invalid steamId.
      return res.status(200).json({ assets: [], descriptions: [], total_inventory_count: 0 });
    }

    return res.status(200).json(data);
  } catch (err) {
    console.error(`Fetch failed for steamId ${steamId}:`, err.message);
    return res.status(502).json({ error: 'Failed to reach Steam' });
  }
});

app.listen(PORT, () => {
  console.log(`Steam inventory proxy listening on port ${PORT}`);
});
