import { createClient } from '@supabase/supabase-js';

const YOUTUBE_API_KEY = process.env.YOUTUBE_API_KEY;
const VK_ACCESS_TOKEN = process.env.VK_ACCESS_TOKEN;
const VK_API_VERSION = '5.199';

const supabase = createClient(process.env.VITE_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

function parseIsoDuration(iso) {
  if (!iso) return null;
  const m = iso.match(/PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/);
  if (!m) return null;
  const h = parseInt(m[1] || 0, 10), min = parseInt(m[2] || 0, 10), s = parseInt(m[3] || 0, 10);
  return h * 3600 + min * 60 + s;
}

async function searchYouTube(query) {
  if (!YOUTUBE_API_KEY) return { error: 'YOUTUBE_API_KEY не настроен', results: [] };
  try {
    const searchUrl = `https://www.googleapis.com/youtube/v3/search?part=snippet&type=video&videoDuration=short&order=viewCount&maxResults=15&q=${encodeURIComponent(query)}&key=${YOUTUBE_API_KEY}`;
    const searchRes = await fetch(searchUrl);
    const searchData = await searchRes.json();
    if (!searchRes.ok) return { error: searchData.error?.message || 'YouTube search failed', results: [] };
    const ids = (searchData.items || []).map(i => i.id.videoId).filter(Boolean);
    if (ids.length === 0) return { results: [] };

    const statsUrl = `https://www.googleapis.com/youtube/v3/videos?part=statistics,snippet,contentDetails&id=${ids.join(',')}&key=${YOUTUBE_API_KEY}`;
    const statsRes = await fetch(statsUrl);
    const statsData = await statsRes.json();
    if (!statsRes.ok) return { error: statsData.error?.message || 'YouTube stats failed', results: [] };

    return {
      results: (statsData.items || []).map(v => ({
        platform: 'youtube',
        external_id: v.id,
        url: `https://www.youtube.com/watch?v=${v.id}`,
        title: v.snippet?.title || null,
        channel_name: v.snippet?.channelTitle || null,
        published_at: v.snippet?.publishedAt || null,
        views: Number(v.statistics?.viewCount || 0),
        likes: Number(v.statistics?.likeCount || 0),
        comments: Number(v.statistics?.commentCount || 0),
        duration_seconds: parseIsoDuration(v.contentDetails?.duration)
      }))
    };
  } catch (err) {
    return { error: err.message, results: [] };
  }
}

async function searchVK(query) {
  if (!VK_ACCESS_TOKEN) return { error: 'VK_ACCESS_TOKEN не настроен', results: [] };
  try {
    const url = `https://api.vk.com/method/video.search?q=${encodeURIComponent(query)}&sort=2&count=15&access_token=${VK_ACCESS_TOKEN}&v=${VK_API_VERSION}`;
    const res = await fetch(url);
    const data = await res.json();
    if (data.error) return { error: data.error.error_msg, results: [] };
    return {
      results: (data.response?.items || []).map(v => ({
        platform: 'vk',
        external_id: `${v.owner_id}_${v.id}`,
        url: `https://vk.com/video${v.owner_id}_${v.id}`,
        title: v.title || null,
        channel_name: v.owner_id ? String(v.owner_id) : null,
        published_at: v.date ? new Date(v.date * 1000).toISOString() : null,
        views: v.views || 0,
        likes: v.likes?.count || 0,
        comments: v.comments || 0,
        duration_seconds: v.duration || null
      }))
    };
  } catch (err) {
    return { error: err.message, results: [] };
  }
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }
  const { query, platforms = ['youtube', 'vk'], project_id } = req.body || {};
  if (!query) {
    res.status(400).json({ error: 'query is required' });
    return;
  }

  try {
    const errors = [];
    let allResults = [];

    if (platforms.includes('youtube')) {
      const yt = await searchYouTube(query);
      if (yt.error) errors.push(`YouTube: ${yt.error}`);
      allResults = allResults.concat(yt.results);
    }
    if (platforms.includes('vk')) {
      const vk = await searchVK(query);
      if (vk.error) errors.push(`VK: ${vk.error}`);
      allResults = allResults.concat(vk.results);
    }

    const rows = allResults.map(r => ({ ...r, niche: query, project_id: project_id || null }));

    let saved = [];
    if (rows.length > 0) {
      const { data, error } = await supabase
        .from('trend_videos')
        .upsert(rows, { onConflict: 'platform,external_id' })
        .select('*');
      if (error) throw new Error(error.message);
      saved = data || [];
    }

    res.status(200).json({ found: saved.length, results: saved, errors });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}
