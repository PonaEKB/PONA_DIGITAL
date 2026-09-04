async function fetchChannelPosts(rawName) {
  const channel = String(rawName || '').replace(/^@/, '').replace(/^https?:\/\/t\.me\//i, '').trim();
  if (!channel) return { channel: rawName, posts: [], error: 'Пустое имя канала' };

  try {
    const response = await fetch(`https://t.me/s/${channel}`, {
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; PonaDigitalBot/1.0)' }
    });
    if (!response.ok) {
      return { channel, posts: [], error: `Канал недоступен (HTTP ${response.status})` };
    }
    const html = await response.text();
    const matches = [...html.matchAll(/<div class="tgme_widget_message_text[^"]*"[^>]*>([\s\S]*?)<\/div>/g)];
    const posts = matches
      .map(m => m[1]
        .replace(/<br\s*\/?>/gi, '\n')
        .replace(/<[^>]+>/g, '')
        .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#0?39;/g, "'").replace(/&nbsp;/g, ' ')
        .trim())
      .filter(Boolean)
      .slice(-20);

    if (posts.length === 0) {
      return { channel, posts: [], error: 'Канал приватный, пустой или не найден' };
    }
    return { channel, posts, error: null };
  } catch (err) {
    return { channel, posts: [], error: err.message };
  }
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  const { channels } = req.body || {};
  if (!Array.isArray(channels) || channels.length === 0) {
    res.status(400).json({ error: 'channels array required' });
    return;
  }

  const limited = channels.slice(0, 5);
  const results = await Promise.all(limited.map(fetchChannelPosts));
  res.status(200).json({ results });
}
