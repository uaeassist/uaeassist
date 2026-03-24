// api/chat.js — Vercel Serverless Function
// Proxies AI requests to Groq. Keys are stored in Vercel env vars — never exposed to browser.

const GROQ_KEYS = [
  process.env.GROQ_KEY_1,
  process.env.GROQ_KEY_2,
  process.env.GROQ_KEY_3,
  process.env.GROQ_KEY_4,
  process.env.GROQ_KEY_5,
].filter(Boolean);

// Simple round-robin key rotation using request count
let keyIndex = 0;

function getNextKey() {
  const key = GROQ_KEYS[keyIndex % GROQ_KEYS.length];
  keyIndex++;
  return key;
}

export default async function handler(req, res) {
  // Only allow POST
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  // CORS — allow your Vercel domain
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  const { messages, model, max_tokens } = req.body;

  if (!messages || !Array.isArray(messages)) {
    return res.status(400).json({ error: 'Invalid request body' });
  }

  if (GROQ_KEYS.length === 0) {
    return res.status(500).json({ error: 'No API keys configured' });
  }

  // Try each key with rotation on rate limit
  let lastError = '';
  for (let attempt = 0; attempt < GROQ_KEYS.length; attempt++) {
    const key = getNextKey();

    try {
      const groqRes = await fetch('https://api.groq.com/openai/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${key}`
        },
        body: JSON.stringify({
          model: model || 'llama-3.3-70b-versatile',
          messages,
          max_tokens: max_tokens || 3000,
          temperature: 0.7,
          top_p: 0.9
        })
      });

      if (groqRes.status === 429) {
        // Rate limited — try next key
        lastError = 'Rate limited';
        continue;
      }

      if (!groqRes.ok) {
        const err = await groqRes.json();
        lastError = err.error?.message || `HTTP ${groqRes.status}`;
        if (groqRes.status === 401) continue; // invalid key, try next
        break;
      }

      const data = await groqRes.json();
      return res.status(200).json(data);

    } catch (e) {
      lastError = e.message;
      continue;
    }
  }

  return res.status(500).json({ error: lastError || 'All keys exhausted. Try again tomorrow.' });
}
