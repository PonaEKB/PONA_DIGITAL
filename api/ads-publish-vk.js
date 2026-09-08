import { createClient } from '@supabase/supabase-js';

const supabase = createClient(process.env.VITE_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

async function saveResult(ad_id, fields) {
  await supabase
    .from('classified_ad_publications')
    .upsert({ ad_id, platform: 'vk', ...fields }, { onConflict: 'ad_id,platform' });
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }
  const { ad_id } = req.body || {};
  if (!ad_id) {
    res.status(400).json({ error: 'ad_id is required' });
    return;
  }

  const groupToken = process.env.VK_GROUP_ACCESS_TOKEN;
  const userToken = process.env.VK_ACCESS_TOKEN;
  const groupId = process.env.VK_GROUP_ID;

  try {
    const { data: ad, error: fetchErr } = await supabase.from('classified_ads').select('*').eq('id', ad_id).single();
    if (fetchErr || !ad) throw new Error('Объявление не найдено');

    // market.getCategories не работает с групповым токеном ("method is unavailable with group auth") — читаем через пользовательский
    const catRes = await fetch(`https://api.vk.com/method/market.getCategories?count=1000&access_token=${userToken}&v=5.199`);
    const catData = await catRes.json();
    if (catData.error) throw new Error(`VK (категории): ${catData.error.error_msg}`);
    const categories = catData.response?.items || [];
    const category = categories.find(c => c.name?.toLowerCase().includes('услуг')) || categories[0];
    if (!category) throw new Error('VK не вернул ни одной категории Товаров');

    const params = new URLSearchParams({
      owner_id: `-${groupId}`,
      name: ad.title.slice(0, 100),
      description: ad.description.slice(0, 8000),
      category_id: String(category.id),
      price: String(ad.price || 0),
      access_token: groupToken,
      v: '5.199'
    });

    const addRes = await fetch(`https://api.vk.com/method/market.add?${params.toString()}`, { method: 'POST' });
    const addData = await addRes.json();
    if (addData.error) throw new Error(`VK: ${addData.error.error_msg}`);

    const marketId = addData.response?.market_item_id;
    const externalUrl = marketId ? `https://vk.com/market-${groupId}?w=product-${groupId}_${marketId}` : null;

    await saveResult(ad_id, {
      status: 'published',
      external_id: marketId != null ? String(marketId) : null,
      external_url: externalUrl,
      published_at: new Date().toISOString(),
      error_message: null
    });

    res.status(200).json({ ok: true, external_url: externalUrl });
  } catch (err) {
    await saveResult(ad_id, { status: 'failed', error_message: err.message });
    res.status(500).json({ error: err.message });
  }
}
