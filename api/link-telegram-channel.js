import { createClient } from '@supabase/supabase-js';

const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const supabase = createClient(process.env.VITE_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }
  const { project_id, channel } = req.body || {};
  if (!project_id || !channel) {
    res.status(400).json({ error: 'project_id and channel are required' });
    return;
  }

  try {
    const chatIdParam = channel.startsWith('@') || channel.startsWith('-') || /^\d+$/.test(channel) ? channel : `@${channel}`;
    const r = await fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/getChat?chat_id=${encodeURIComponent(chatIdParam)}`);
    const data = await r.json();
    if (!data.ok) throw new Error(data.description || 'Не удалось найти канал — проверьте, что бот добавлен туда админом');

    const chat = data.result;
    const { error: updErr } = await supabase
      .from('projects')
      .update({ telegram_channel_id: String(chat.id) })
      .eq('id', project_id);
    if (updErr) throw new Error(updErr.message);

    res.status(200).json({ ok: true, id: chat.id, title: chat.title, username: chat.username });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}
