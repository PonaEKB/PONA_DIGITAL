const ROUTER_BASE_URL = process.env.ROUTER_AI_BASE_URL;
const ROUTER_KEY = process.env.ROUTER_AI_KEY;
const MODEL = 'anthropic/claude-opus-5';

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  const { messages } = req.body || {};
  if (!Array.isArray(messages)) {
    res.status(400).json({ error: 'messages array required' });
    return;
  }

  try {
    const routerResponse = await fetch(`${ROUTER_BASE_URL}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${ROUTER_KEY}`
      },
      body: JSON.stringify({ model: MODEL, max_tokens: 4096, messages })
    });

    const data = await routerResponse.json();

    if (!routerResponse.ok) {
      res.status(routerResponse.status).json({ error: { message: data.error?.message || JSON.stringify(data) } });
      return;
    }

    res.status(200).json(data);
  } catch (err) {
    res.status(500).json({ error: { message: err.message } });
  }
}
