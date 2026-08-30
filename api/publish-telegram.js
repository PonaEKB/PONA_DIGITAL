import { createClient } from '@supabase/supabase-js';

const supabase = createClient(process.env.VITE_SUPABASE_URL, process.env.VITE_SUPABASE_ANON_KEY);

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  const { id } = req.body || {};
  if (!id) {
    res.status(400).json({ error: 'id required' });
    return;
  }

  const { data: item, error: fetchError } = await supabase.from('content_items').select('*').eq('id', id).single();
  if (fetchError || !item) {
    res.status(404).json({ error: 'content item not found' });
    return;
  }
  if (item.platform !== 'telegram') {
    res.status(400).json({ error: 'only telegram is supported for auto-publish right now' });
    return;
  }

  const token = process.env.TELEGRAM_BOT_TOKEN;
  const channelId = process.env.TELEGRAM_CHANNEL_ID;
  if (!token || !channelId) {
    res.status(500).json({ error: 'TELEGRAM_BOT_TOKEN or TELEGRAM_CHANNEL_ID not configured' });
    return;
  }

  try {
    const text = item.title ? `${item.title}\n\n${item.body}` : item.body;
    const response = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: channelId, text })
    });
    const data = await response.json();
    if (!data.ok) {
      await supabase.from('content_items').update({ status: 'failed', error: data.description || 'telegram api error' }).eq('id', id);
      res.status(502).json({ error: data.description || 'telegram api error' });
      return;
    }
    await supabase.from('content_items').update({ status: 'published', published_at: new Date().toISOString(), error: null }).eq('id', id);
    res.status(200).json({ ok: true });
  } catch (err) {
    await supabase.from('content_items').update({ status: 'failed', error: err.message }).eq('id', id);
    res.status(500).json({ error: err.message });
  }
}
