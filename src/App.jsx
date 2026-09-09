import React, { useState, useEffect, useRef } from 'react';
import { supabase } from './supabaseClient';
import './App.css';

function SubscriberChart({ snapshots }) {
  const width = 720;
  const height = 220;
  const padding = { top: 16, right: 16, bottom: 28, left: 44 };
  const plotW = width - padding.left - padding.right;
  const plotH = height - padding.top - padding.bottom;

  const values = snapshots.map(s => s.subscriber_count);
  const times = snapshots.map(s => new Date(s.captured_at).getTime());
  const minV = Math.min(...values);
  const maxV = Math.max(...values);
  const rangeV = (maxV - minV) || 1;
  const minT = Math.min(...times);
  const maxT = Math.max(...times);
  const rangeT = (maxT - minT) || 1;

  const points = snapshots.map(s => {
    const t = new Date(s.captured_at).getTime();
    const x = padding.left + ((t - minT) / rangeT) * plotW;
    const y = padding.top + plotH - ((s.subscriber_count - minV) / rangeV) * plotH;
    return { x, y, v: s.subscriber_count, date: new Date(s.captured_at) };
  });

  const linePath = points.map((p, i) => `${i === 0 ? 'M' : 'L'}${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ');
  const gridLines = [0, 0.5, 1].map(f => padding.top + plotH * f);
  const gridLabels = [maxV, Math.round((maxV + minV) / 2), minV];

  return (
    <div className="chart-wrap">
      <svg viewBox={`0 0 ${width} ${height}`} className="chart-svg" role="img" aria-label="График числа подписчиков за 30 дней">
        {gridLines.map((y, i) => (
          <g key={i}>
            <line x1={padding.left} y1={y} x2={width - padding.right} y2={y} className="chart-grid-line" />
            <text x={padding.left - 8} y={y + 4} className="chart-axis-label" textAnchor="end">{gridLabels[i]}</text>
          </g>
        ))}
        <path d={linePath} className="chart-line" fill="none" />
        {points.map((p, i) => (
          <circle key={i} cx={p.x} cy={p.y} r="4" className="chart-dot">
            <title>{p.date.toLocaleString('ru-RU', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}: {p.v} подписчиков</title>
          </circle>
        ))}
        <text x={padding.left} y={height - 6} className="chart-axis-label">{points[0]?.date.toLocaleDateString('ru-RU')}</text>
        <text x={width - padding.right} y={height - 6} className="chart-axis-label" textAnchor="end">{points[points.length - 1]?.date.toLocaleDateString('ru-RU')}</text>
      </svg>
    </div>
  );
}

function App() {
  const [projects, setProjects] = useState([]);
  const [allTasks, setAllTasks] = useState([]);
  const [finances, setFinances] = useState([]);
  const [financeTab, setFinanceTab] = useState('expenses');
  const [financeAccounts, setFinanceAccounts] = useState([]);
  const [ads, setAds] = useState([]);
  const [musicTracks, setMusicTracks] = useState([]);
  const [selectedTrack, setSelectedTrack] = useState(null);
  const [lyricsTheme, setLyricsTheme] = useState('');
  const [musicBusy, setMusicBusy] = useState(null);
  const [adForm, setAdForm] = useState({ title: '', description: '', category: '', price: '', contact_name: '', contact_phone: '' });
  const [adPublishing, setAdPublishing] = useState(null);
  const [pendingApprovalCount, setPendingApprovalCount] = useState(0);
  const [reminders, setReminders] = useState([]);
  const [reminderForm, setReminderForm] = useState({ title: '', when: '' });
  const [selectedProject, setSelectedProject] = useState(null);
  const [activeTab, setActiveTab] = useState('dashboard');
  const [projectTab, setProjectTab] = useState('idea');
  const [projectContent, setProjectContent] = useState([]);
  const [contentLoading, setContentLoading] = useState(false);
  const [contentFilter, setContentFilter] = useState('all');
  const [contentSearch, setContentSearch] = useState('');
  const [statsSnapshots, setStatsSnapshots] = useState([]);
  const [statsEvents, setStatsEvents] = useState([]);
  const [statsLoading, setStatsLoading] = useState(false);
  const [previewItem, setPreviewItem] = useState(null);
  const [trendQuery, setTrendQuery] = useState('');
  const [trendResults, setTrendResults] = useState([]);
  const [trendLoading, setTrendLoading] = useState(false);
  const [trendErrors, setTrendErrors] = useState([]);
  const [trendScripts, setTrendScripts] = useState([]);
  const [analyzingTrendId, setAnalyzingTrendId] = useState(null);
  const [loading, setLoading] = useState(true);
  const [user, setUser] = useState(null);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [isRegister, setIsRegister] = useState(false);
  const [showAiChat, setShowAiChat] = useState(false);
  const [aiMessages, setAiMessages] = useState([
    { role: 'ai', text: 'Привет! Я AI-ассистент PONA DIGITAL. Чем могу помочь?' }
  ]);
  const [aiInput, setAiInput] = useState('');
  const [aiLoading, setAiLoading] = useState(false);
  const [ideaPrompt, setIdeaPrompt] = useState('');
  const [analysisPrompt, setAnalysisPrompt] = useState('');
  const [competitorChannels, setCompetitorChannels] = useState('');
  const [ideaResult, setIdeaResult] = useState('');
  const [analysisResult, setAnalysisResult] = useState('');
  const [planResult, setPlanResult] = useState('');
  const [planPrompt, setPlanPrompt] = useState('');
  const abortControllerRef = useRef(null);

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      setUser(session?.user ?? null);
      if (session?.user) loadAllData();
      setLoading(false);
    });
  }, []);

  async function loadAllData() {
    const { data: projectsData } = await supabase.from('projects').select('*').order('created_at', { ascending: false });
    const { data: tasksData } = await supabase.from('tasks').select('*').order('created_at', { ascending: false });
    const { data: financesData } = await supabase.from('finances').select('*').order('date', { ascending: false });
    const { count: draftCount } = await supabase.from('content_items').select('id', { count: 'exact', head: true }).eq('status', 'draft');
    const { data: remindersData } = await supabase.from('reminders').select('*').order('remind_at', { ascending: true });
    setProjects(projectsData || []);
    setAllTasks(tasksData || []);
    setFinances(financesData || []);
    setPendingApprovalCount(draftCount || 0);
    setReminders(remindersData || []);
  }

  async function completeReminder(id) {
    await supabase.from('reminders').update({ status: 'done' }).eq('id', id);
    loadAllData();
  }

  async function createReminder() {
    if (!reminderForm.title.trim() || !reminderForm.when) {
      alert('Укажите текст напоминания и дату/время');
      return;
    }
    await supabase.from('reminders').insert({
      title: reminderForm.title.trim(),
      remind_at: new Date(reminderForm.when).toISOString()
    });
    setReminderForm({ title: '', when: '' });
    loadAllData();
  }

  async function deleteReminder(id) {
    if (!confirm('Удалить напоминание?')) return;
    await supabase.from('reminders').delete().eq('id', id);
    loadAllData();
  }

  const PLATFORMS = [
    { id: 'telegram', label: 'Telegram', icon: '✈️', live: true },
    { id: 'zen', label: 'Дзен', icon: '📰', live: false },
    { id: 'vk', label: 'VK', icon: '🔵', live: false },
    { id: 'instagram', label: 'Instagram', icon: '📸', live: false },
    { id: 'max', label: 'MAX', icon: '💬', live: false }
  ];

  function getPlatformInfo(id) {
    return PLATFORMS.find(p => p.id === id) || { id, label: id, icon: '📄', live: false };
  }

  function getContentStatusLabel(status) {
    switch (status) {
      case 'draft': return '📝 Черновик';
      case 'scheduled': return '⏳ В очереди';
      case 'publishing': return '📤 Публикуется...';
      case 'published': return '✅ Опубликован';
      case 'failed': return '❌ Ошибка';
      default: return status;
    }
  }

  async function loadProjectContent(projectId) {
    setContentLoading(true);
    const { data } = await supabase.from('content_items').select('*').eq('project_id', projectId).order('created_at', { ascending: false });
    setProjectContent(data || []);
    setContentLoading(false);
  }

  async function createContentItem() {
    if (!selectedProject) return;
    const platformInput = prompt(`Площадка (${PLATFORMS.map(p => p.id).join(', ')}):`, 'telegram');
    if (!platformInput) return;
    const platform = platformInput.trim().toLowerCase();
    if (!PLATFORMS.some(p => p.id === platform)) {
      alert('Неизвестная площадка. Доступно: ' + PLATFORMS.map(p => p.id).join(', '));
      return;
    }
    const title = prompt('Заголовок / тема поста:');
    if (!title) return;
    const body = prompt('Текст поста:');
    if (!body) return;
    const scheduleInput = prompt('Запланировать на (ГГГГ-ММ-ДД ЧЧ:ММ), оставь пустым для черновика:');
    let status = 'draft';
    let scheduled_at = null;
    if (scheduleInput && scheduleInput.trim()) {
      const parsed = new Date(scheduleInput.trim().replace(' ', 'T'));
      if (isNaN(parsed.getTime())) {
        alert('Не удалось распознать дату, сохранено как черновик');
      } else {
        scheduled_at = parsed.toISOString();
        status = 'scheduled';
      }
    }
    await supabase.from('content_items').insert({ project_id: selectedProject.id, platform, title, body, status, scheduled_at });
    loadProjectContent(selectedProject.id);
  }

  async function loadProjectStats(projectId) {
    setStatsLoading(true);
    const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
    const [{ data: snapshots }, { data: events }] = await Promise.all([
      supabase.from('channel_stats_snapshots').select('*').eq('project_id', projectId).gte('captured_at', since).order('captured_at', { ascending: true }),
      supabase.from('channel_member_events').select('*').eq('project_id', projectId).gte('occurred_at', since).order('occurred_at', { ascending: true })
    ]);
    setStatsSnapshots(snapshots || []);
    setStatsEvents(events || []);
    setStatsLoading(false);
  }

  async function loadTrendsTab(projectId) {
    const [{ data: videos }, { data: scripts }] = await Promise.all([
      supabase.from('trend_videos').select('*').eq('project_id', projectId).order('views', { ascending: false }),
      supabase.from('trend_scripts').select('*').eq('project_id', projectId).order('created_at', { ascending: false })
    ]);
    setTrendResults(videos || []);
    setTrendScripts(scripts || []);
  }

  async function searchTrends() {
    if (!trendQuery.trim() || !selectedProject) return;
    setTrendLoading(true);
    setTrendErrors([]);
    try {
      const response = await fetch('/api/trends-search', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query: trendQuery.trim(), platforms: ['youtube', 'vk'], project_id: selectedProject.id })
      });
      const data = await response.json();
      if (!response.ok) {
        setTrendErrors([data.error || 'Ошибка поиска']);
      } else {
        setTrendErrors(data.errors || []);
        await loadTrendsTab(selectedProject.id);
      }
    } catch (err) {
      setTrendErrors([err.message]);
    }
    setTrendLoading(false);
  }

  async function analyzeTrend(id) {
    setAnalyzingTrendId(id);
    try {
      const response = await fetch('/api/trends-analyze', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id })
      });
      const data = await response.json();
      if (!response.ok) alert('Ошибка анализа: ' + data.error);
      else await loadTrendsTab(selectedProject.id);
    } catch (err) {
      alert('Ошибка: ' + err.message);
    }
    setAnalyzingTrendId(null);
  }

  async function adaptTrend(id) {
    const niche = prompt('Ниша/тема бренда:', selectedProject?.name || '');
    if (niche === null) return;
    const tone = prompt('Tone of voice (например: дружелюбно, экспертно, с юмором):', '') || '';
    const product = prompt('Продукт/что рекламируем:', '') || '';
    try {
      const response = await fetch('/api/trends-adapt', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ trend_video_id: id, project_id: selectedProject.id, brief: { niche, tone_of_voice: tone, product } })
      });
      const data = await response.json();
      if (!response.ok) alert('Ошибка адаптации: ' + data.error);
      else {
        alert('✅ Сценарий готов:\n\n' + data.script_text);
        await loadTrendsTab(selectedProject.id);
      }
    } catch (err) {
      alert('Ошибка: ' + err.message);
    }
  }

  async function updateTrendScriptStatus(scriptId, status) {
    await supabase.from('trend_scripts').update({ status }).eq('id', scriptId);
    await loadTrendsTab(selectedProject.id);
  }

  async function rateContentItem(item, rating) {
    const next = item.rating === rating ? null : rating;
    await supabase.from('content_items').update({ rating: next }).eq('id', item.id);
    loadProjectContent(item.project_id);
  }

  function matchesContentSearch(item, query) {
    if (!query.trim()) return true;
    const q = query.trim().toLowerCase();
    return (item.body || '').toLowerCase().includes(q) || (item.topic || '').toLowerCase().includes(q);
  }

  async function deleteContentItem(id) {
    if (!confirm('Удалить пост?')) return;
    await supabase.from('content_items').delete().eq('id', id);
    loadProjectContent(selectedProject.id);
  }

  async function scheduleContentItem(item) {
    const scheduleInput = prompt('Запланировать на (ГГГГ-ММ-ДД ЧЧ:ММ):');
    if (!scheduleInput) return;
    const parsed = new Date(scheduleInput.trim().replace(' ', 'T'));
    if (isNaN(parsed.getTime())) {
      alert('Не удалось распознать дату');
      return;
    }
    await supabase.from('content_items').update({ status: 'scheduled', scheduled_at: parsed.toISOString() }).eq('id', item.id);
    loadProjectContent(selectedProject.id);
  }

  async function publishNow(item) {
    if (item.platform !== 'telegram') {
      alert('Автопубликация пока подключена только для Telegram. Остальные площадки — публикация вручную.');
      return;
    }
    try {
      const response = await fetch('/api/publish-telegram', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: item.id })
      });
      const data = await response.json();
      if (!response.ok) alert('Ошибка публикации: ' + (data.error || 'неизвестно'));
    } catch (err) {
      alert('Ошибка публикации: ' + err.message);
    }
    loadProjectContent(selectedProject.id);
  }

  async function handleAuth() {
    if (isRegister) {
      await supabase.auth.signUp({ email, password });
    } else {
      await supabase.auth.signInWithPassword({ email, password });
    }
    const { data: { session } } = await supabase.auth.getSession();
    setUser(session?.user ?? null);
    if (session?.user) loadAllData();
  }

  async function handleLogout() {
    await supabase.auth.signOut();
    setUser(null);
    setProjects([]);
    setAllTasks([]);
    setFinances([]);
    setSelectedProject(null);
    setActiveTab('dashboard');
  }

  async function createProject() {
    const name = prompt('Название проекта:');
    if (!name) return;
    const description = prompt('Описание проекта:');
    await supabase.from('projects').insert({ name, description: description || null });
    loadAllData();
  }

  async function renameProject() {
    if (!selectedProject) return;
    const name = prompt('Новое название проекта:', selectedProject.name);
    if (!name || name === selectedProject.name) return;
    await supabase.from('projects').update({ name }).eq('id', selectedProject.id);
    setSelectedProject({ ...selectedProject, name });
    loadAllData();
  }

  async function linkTelegramChannel() {
    if (!selectedProject) return;
    const channel = prompt('Username канала (например @МузыкAI) или его numeric ID. Бот должен быть добавлен туда админом с правом постить:', selectedProject.telegram_channel_id || '');
    if (!channel) return;
    try {
      const res = await fetch('/api/link-telegram-channel', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ project_id: selectedProject.id, channel: channel.trim() })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Ошибка');
      alert(`Привязан канал: ${data.title}${data.username ? ' (@' + data.username + ')' : ''}`);
      await loadAllData();
      setSelectedProject(prev => prev && { ...prev, telegram_channel_id: String(data.id) });
    } catch (err) {
      alert('Не удалось привязать канал: ' + err.message);
    }
  }

  async function deleteProject(id) {
    if (!confirm('Удалить проект?')) return;
    await supabase.from('projects').delete().eq('id', id);
    setSelectedProject(null);
    loadAllData();
  }

  async function createFinance(type) {
    const amount = prompt('Сумма:');
    if (!amount) return;
    const description = prompt('Описание:');
    if (!description) return;
    await supabase.from('finances').insert({ type, amount: parseFloat(amount), description });
    loadAllData();
  }

  async function loadFinanceAccounts() {
    const { data } = await supabase.from('finance_accounts').select('*').order('created_at', { ascending: true });
    setFinanceAccounts(data || []);
  }

  async function addFinanceAccount(category) {
    const name = prompt('Название кабинета (например: Яндекс.Директ):');
    if (!name) return;
    const url = prompt('Ссылка на кабинет:');
    if (!url) return;
    await supabase.from('finance_accounts').insert({ category, name, url });
    loadFinanceAccounts();
  }

  async function deleteFinanceAccount(id) {
    if (!confirm('Удалить кабинет из списка?')) return;
    await supabase.from('finance_accounts').delete().eq('id', id);
    loadFinanceAccounts();
  }

  const AD_PLATFORMS = [
    { key: 'vk', label: 'VK Объявления', icon: '🔵', mode: 'auto' },
    { key: 'avito', label: 'Avito', icon: '🟢', mode: 'manual' },
    { key: 'kwork', label: 'Kwork', icon: '🟣', mode: 'manual' },
    { key: 'youdo', label: 'YouDo', icon: '🟠', mode: 'manual' }
  ];

  async function loadAds() {
    const { data } = await supabase
      .from('classified_ads')
      .select('*, classified_ad_publications(*)')
      .order('created_at', { ascending: false });
    setAds(data || []);
  }

  async function createAd() {
    if (!adForm.title.trim() || !adForm.description.trim()) {
      alert('Заполните заголовок и описание объявления');
      return;
    }
    await supabase.from('classified_ads').insert({
      title: adForm.title.trim(),
      description: adForm.description.trim(),
      category: adForm.category.trim() || null,
      price: adForm.price ? parseFloat(adForm.price) : null,
      contact_name: adForm.contact_name.trim() || null,
      contact_phone: adForm.contact_phone.trim() || null,
      status: 'ready'
    });
    setAdForm({ title: '', description: '', category: '', price: '', contact_name: '', contact_phone: '' });
    loadAds();
  }

  async function deleteAd(id) {
    if (!confirm('Удалить объявление и все его публикации?')) return;
    await supabase.from('classified_ads').delete().eq('id', id);
    loadAds();
  }

  function pubUrl(ad, platform) {
    return (ad.classified_ad_publications || []).find(p => p.platform === platform)?.external_url || null;
  }

  function formatAdText(ad) {
    const price = ad.price ? `${ad.price} ₽` : 'Цена договорная';
    const contact = [ad.contact_name, ad.contact_phone].filter(Boolean).join(', ');
    return `${ad.title}\n\n${ad.description}\n\nЦена: ${price}${contact ? `\nКонтакты: ${contact}` : ''}`;
  }

  async function copyAdText(ad) {
    try {
      await navigator.clipboard.writeText(formatAdText(ad));
      alert('Текст объявления скопирован — вставьте его на площадке вручную.');
    } catch (_) {
      prompt('Скопируйте текст объявления:', formatAdText(ad));
    }
  }

  async function markAdManualPublished(adId, platform) {
    await supabase.from('classified_ad_publications').upsert(
      { ad_id: adId, platform, status: 'manual', published_at: new Date().toISOString() },
      { onConflict: 'ad_id,platform' }
    );
    loadAds();
  }

  async function publishAdToVk(adId) {
    setAdPublishing(adId);
    try {
      const res = await fetch('/api/ads-publish-vk', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ad_id: adId })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Ошибка публикации в VK');
    } catch (err) {
      alert('Не удалось опубликовать в VK: ' + err.message);
    } finally {
      setAdPublishing(null);
      loadAds();
    }
  }

  async function loadMusicTracks() {
    const { data } = await supabase.from('music_tracks').select('*').order('created_at', { ascending: false });
    setMusicTracks(data || []);
  }

  async function createMusicTrack() {
    const title = prompt('Название трека:');
    if (!title) return;
    const musicProject = projects.find(p => p.name === 'МузыкAI');
    const { data } = await supabase.from('music_tracks').insert({ title: title.trim(), project_id: musicProject?.id || null }).select('*').single();
    await loadMusicTracks();
    if (data) setSelectedTrack(data);
  }

  async function scheduleTrackPublish(track) {
    if (!track.project_id) {
      alert('У трека не задан проект — не могу поставить в очередь на публикацию.');
      return;
    }
    const dateStr = prompt('Дата и время публикации (ГГГГ-ММ-ДД ЧЧ:ММ), по местному времени:', '');
    if (!dateStr) return;
    const when = new Date(dateStr.replace(' ', 'T'));
    if (isNaN(when.getTime())) {
      alert('Не удалось распознать дату/время');
      return;
    }
    const { data: item, error } = await supabase.from('content_items').insert({
      project_id: track.project_id,
      platform: 'telegram',
      title: track.title,
      body: `${track.title}\n\n${track.suno_prompt || ''}`.trim(),
      media_url: track.audio_url,
      media_type: 'audio',
      status: 'draft',
      scheduled_at: when.toISOString()
    }).select('*').single();
    if (error) {
      alert('Ошибка: ' + error.message);
      return;
    }
    await supabase.from('music_tracks').update({ content_item_id: item.id }).eq('id', track.id);
    alert('Трек поставлен в очередь на утверждение — придёт в бота на подтверждение перед публикацией.');
    await loadMusicTracks();
    setSelectedTrack(prev => prev && { ...prev, content_item_id: item.id });
  }

  async function deleteMusicTrack(id) {
    if (!confirm('Удалить трек?')) return;
    await supabase.from('music_tracks').delete().eq('id', id);
    setSelectedTrack(null);
    loadMusicTracks();
  }

  async function uploadMusicFile(file, folder) {
    const path = `${folder}/${crypto.randomUUID()}.${file.name.split('.').pop() || 'mp3'}`;
    const { error } = await supabase.storage.from('music-tracks').upload(path, file);
    if (error) throw new Error(error.message);
    const { data } = supabase.storage.from('music-tracks').getPublicUrl(path);
    return data.publicUrl;
  }

  async function handleReferenceUpload(e, track) {
    const file = e.target.files?.[0];
    if (!file) return;
    setMusicBusy(track.id);
    try {
      const url = await uploadMusicFile(file, 'reference');
      await supabase.from('music_tracks').update({ reference_url: url }).eq('id', track.id);
      await loadMusicTracks();
      setSelectedTrack(prev => prev && { ...prev, reference_url: url });
    } catch (err) {
      alert('Ошибка загрузки: ' + err.message);
    } finally {
      setMusicBusy(null);
    }
  }

  async function handleFinalUpload(e, track) {
    const file = e.target.files?.[0];
    if (!file) return;
    setMusicBusy(track.id);
    try {
      const url = await uploadMusicFile(file, 'final');
      await supabase.from('music_tracks').update({ audio_url: url, status: 'generated' }).eq('id', track.id);
      await loadMusicTracks();
      setSelectedTrack(prev => prev && { ...prev, audio_url: url, status: 'generated' });
    } catch (err) {
      alert('Ошибка загрузки: ' + err.message);
    } finally {
      setMusicBusy(null);
    }
  }

  async function runMusicStep(endpoint, body, trackId) {
    setMusicBusy(trackId);
    try {
      const res = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Ошибка');
      await loadMusicTracks();
      setSelectedTrack(data);
    } catch (err) {
      alert('Ошибка: ' + err.message);
    } finally {
      setMusicBusy(null);
    }
  }

  async function copySunoPrompt(track) {
    const text = `${track.suno_prompt || ''}\n\n${track.lyrics || ''}`;
    try {
      await navigator.clipboard.writeText(text);
      alert('Промпт и текст песни скопированы — вставьте в Suno.');
    } catch (_) {
      prompt('Скопируйте промпт и текст:', text);
    }
  }

  function getTaskDeadlineStatus(deadline) {
    if (!deadline) return null;
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const taskDate = new Date(deadline);
    const diffDays = Math.ceil((taskDate - today) / (1000 * 60 * 60 * 24));
    if (diffDays < 0) return 'overdue';
    if (diffDays <= 2) return 'soon';
    return 'normal';
  }

  function getStatusLabel(status) {
    switch (status) {
      case 'idea': return '💡 Идея';
      case 'analysis': return '🔍 Анализ';
      case 'structure': return '🏗️ Структура';
      case 'testing': return '🧪 Тестирование';
      case 'launched': return '🚀 Запущен';
      case 'paused': return '⏸️ Пауза';
      case 'completed': return '✅ Завершён';
      default: return status;
    }
  }

  async function askAI(messages, signal) {
    try {
      const response = await fetch('/api/ai', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ messages }),
        signal
      });
      const data = await response.json();
      if (data.choices && data.choices[0]) {
        return data.choices[0].message.content;
      }
      if (data.error) {
        return 'Ошибка: ' + (data.error.message || data.error);
      }
      return 'Ошибка: неизвестный ответ от API';
    } catch (err) {
      if (err.name === 'AbortError') throw err;
      return 'Ошибка при запросе: ' + err.message;
    }
  }

  function cancelGeneration() {
    abortControllerRef.current?.abort();
  }

  async function fetchCompetitorPosts(signal) {
    const channels = competitorChannels.split(/[\n,]/).map(c => c.trim()).filter(Boolean);
    if (channels.length === 0) return { context: '', errors: [] };

    const response = await fetch('/api/telegram-competitors', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ channels }),
      signal
    });
    const data = await response.json();

    let context = '';
    const errors = [];
    for (const r of (data.results || [])) {
      if (r.error) {
        errors.push(`${r.channel}: ${r.error}`);
        continue;
      }
      context += `\n\nКанал @${r.channel}, последние посты:\n` + r.posts.map((p, i) => `${i + 1}. ${p.slice(0, 300)}`).join('\n');
    }
    return { context, errors };
  }

  async function sendAiMessage() {
    if (!aiInput.trim() || aiLoading) return;
    const userMsg = { role: 'user', text: aiInput };
    setAiMessages(prev => [...prev, userMsg]);
    setAiInput('');
    setAiLoading(true);

    const history = aiMessages.map(m => ({
      role: m.role === 'ai' ? 'assistant' : 'user',
      content: m.text
    }));
    history.push({ role: 'user', content: userMsg.text });

    const answer = await askAI([
      { role: 'system', content: 'Ты — AI-ассистент PONA DIGITAL. Отвечай на русском. Помогай с проектами, контентом, анализом.' },
      ...history
    ]);

    setAiMessages(prev => [...prev, { role: 'ai', text: answer }]);
    setAiLoading(false);
  }

  async function generateIdea() {
    if (!selectedProject) return;
    setAiLoading(true);
    const controller = new AbortController();
    abortControllerRef.current = controller;
    const extra = ideaPrompt.trim() ? `\n\nДополнительные пожелания от пользователя: ${ideaPrompt.trim()}` : '';
    try {
      const answer = await askAI([
        { role: 'system', content: 'Ты — бизнес-эксперт. Отвечай на русском.' },
        { role: 'user', content: `Разработай подробную концепцию проекта "${selectedProject.name}"${selectedProject.description ? ': ' + selectedProject.description : ''}.${extra} Опиши: идею, стратегию, монетизацию, целевую аудиторию.` }
      ], controller.signal);
      setIdeaResult(answer);
    } catch (err) {
      if (err.name !== 'AbortError') throw err;
    } finally {
      abortControllerRef.current = null;
      setAiLoading(false);
    }
  }

  async function generateAnalysis() {
    if (!selectedProject) return;
    setAiLoading(true);
    const controller = new AbortController();
    abortControllerRef.current = controller;
    try {
      const { context: competitorContext, errors } = await fetchCompetitorPosts(controller.signal);
      const extra = analysisPrompt.trim() ? `\n\nДополнительные пожелания от пользователя: ${analysisPrompt.trim()}` : '';
      const competitorBlock = competitorContext
        ? `\n\nДанные из открытых Telegram-каналов конкурентов (последние посты):${competitorContext}\n\nНа основе этих постов сделай выводы: что сейчас в тренде, какие форматы заходят лучше всего, что можно предложить и как вести канал.`
        : '';
      const answer = await askAI([
        { role: 'system', content: 'Ты — аналитик. Отвечай на русском.' },
        { role: 'user', content: `Сделай анализ ниши для проекта "${selectedProject.name}".${extra}${competitorBlock} Опиши: тренды, конкурентов, фишки, монетизацию.` }
      ], controller.signal);
      const errorNote = errors.length ? `\n\n⚠️ Не удалось получить данные по каналам: ${errors.join('; ')}` : '';
      setAnalysisResult(answer + errorNote);
    } catch (err) {
      if (err.name !== 'AbortError') throw err;
    } finally {
      abortControllerRef.current = null;
      setAiLoading(false);
    }
  }

  async function generatePlan() {
    if (!selectedProject) return;
    setAiLoading(true);
    const controller = new AbortController();
    abortControllerRef.current = controller;
    try {
      const extra = planPrompt.trim() ? `\n\nДополнительные пожелания от пользователя: ${planPrompt.trim()}` : '';
      const contextBlock = (ideaResult || analysisResult)
        ? `\n\nКонтекст по проекту, уже собранный ранее:${ideaResult ? `\n\nИдея и концепция:\n${ideaResult}` : ''}${analysisResult ? `\n\nАнализ ниши и конкурентов:\n${analysisResult}` : ''}`
        : '';
      const answer = await askAI([
        { role: 'system', content: 'Ты — контент-стратег и эксперт по развитию Telegram-каналов. Отвечай на русском.' },
        { role: 'user', content: `Составь полную стратегию развития Telegram-канала для проекта "${selectedProject.name}", опираясь на идею и анализ ниши/конкурентов.${extra}${contextBlock} Опиши подробно: 1) стратегию развития канала; 2) варианты монетизации — на чём конкретно можно зарабатывать; 3) как привлекать и приглашать подписчиков, откуда брать первую аудиторию; 4) контент-план на месяц по неделям — темы, форматы, площадки.` }
      ], controller.signal);
      setPlanResult(answer);
    } catch (err) {
      if (err.name !== 'AbortError') throw err;
    } finally {
      abortControllerRef.current = null;
      setAiLoading(false);
    }
  }

  async function generateChain() {
    if (!selectedProject) return;
    setAiLoading(true);
    const controller = new AbortController();
    abortControllerRef.current = controller;
    try {
      const ideaExtra = ideaPrompt.trim() ? `\n\nДополнительные пожелания от пользователя: ${ideaPrompt.trim()}` : '';
      const ideaAnswer = await askAI([
        { role: 'system', content: 'Ты — бизнес-эксперт. Отвечай на русском.' },
        { role: 'user', content: `Разработай подробную концепцию проекта "${selectedProject.name}"${selectedProject.description ? ': ' + selectedProject.description : ''}.${ideaExtra} Опиши: идею, стратегию, монетизацию, целевую аудиторию.` }
      ], controller.signal);
      setIdeaResult(ideaAnswer);

      const { context: competitorContext } = await fetchCompetitorPosts(controller.signal);
      const analysisExtra = analysisPrompt.trim() ? `\n\nДополнительные пожелания от пользователя: ${analysisPrompt.trim()}` : '';
      const competitorBlock = competitorContext
        ? `\n\nДанные из открытых Telegram-каналов конкурентов (последние посты):${competitorContext}\n\nНа основе этих постов сделай выводы: что сейчас в тренде, какие форматы заходят лучше всего, что можно предложить и как вести канал.`
        : '';
      const analysisAnswer = await askAI([
        { role: 'system', content: 'Ты — аналитик. Отвечай на русском.' },
        { role: 'user', content: `Вот концепция проекта "${selectedProject.name}":\n\n${ideaAnswer}\n\nНа основе этой концепции сделай анализ ниши.${analysisExtra}${competitorBlock} Опиши: тренды, конкурентов, фишки, монетизацию.` }
      ], controller.signal);
      setAnalysisResult(analysisAnswer);

      const planExtra = planPrompt.trim() ? `\n\nДополнительные пожелания от пользователя: ${planPrompt.trim()}` : '';
      const planAnswer = await askAI([
        { role: 'system', content: 'Ты — контент-стратег и эксперт по развитию Telegram-каналов. Отвечай на русском.' },
        { role: 'user', content: `Вот концепция проекта:\n\n${ideaAnswer}\n\nИ анализ ниши/конкурентов:\n\n${analysisAnswer}\n\nНа основе этого составь полную стратегию развития Telegram-канала для проекта "${selectedProject.name}".${planExtra} Опиши подробно: 1) стратегию развития канала; 2) варианты монетизации — на чём конкретно можно зарабатывать; 3) как привлекать и приглашать подписчиков, откуда брать первую аудиторию; 4) контент-план на месяц по неделям — темы, форматы, площадки.` }
      ], controller.signal);
      setPlanResult(planAnswer);
    } catch (err) {
      if (err.name !== 'AbortError') throw err;
    } finally {
      abortControllerRef.current = null;
      setAiLoading(false);
    }
  }

  async function generateContentBatch() {
    if (!selectedProject) return;
    setAiLoading(true);
    const controller = new AbortController();
    abortControllerRef.current = controller;
    try {
      const context = [
        ideaResult ? `Идея и концепция:\n${ideaResult}` : '',
        analysisResult ? `Анализ ниши и конкурентов:\n${analysisResult}` : '',
        planResult ? `Стратегия и контент-план:\n${planResult}` : ''
      ].filter(Boolean).join('\n\n');

      const response = await fetch('/api/generate-content', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ projectId: selectedProject.id, projectName: selectedProject.name, context, days: 3, postsPerDay: 4 }),
        signal: controller.signal
      });
      const data = await response.json();
      if (!response.ok) {
        alert('Ошибка генерации: ' + (data.error || 'неизвестная ошибка'));
      } else {
        let msg = `✅ Создано постов: ${data.inserted} из ${data.totalRequested}`;
        if (data.failed && data.failed.length) msg += `\n\n⚠️ Не удалось сгенерировать часть постов:\n${data.failed.join('\n')}`;
        alert(msg);
        await loadProjectContent(selectedProject.id);
      }
    } catch (err) {
      if (err.name !== 'AbortError') alert('Ошибка: ' + err.message);
    } finally {
      abortControllerRef.current = null;
      setAiLoading(false);
    }
  }

  if (loading) return <div className="loading">Загрузка...</div>;

  if (!user) {
    return (
      <div className="auth-screen">
        <div className="auth-card">
          <h1 className="auth-logo">PONA DIGITAL</h1>
          <p className="auth-subtitle">Вход в систему</p>
          <input type="email" placeholder="Email" value={email} onChange={(e) => setEmail(e.target.value)} className="auth-input" />
          <input type="password" placeholder="Пароль" value={password} onChange={(e) => setPassword(e.target.value)} className="auth-input" />
          <button onClick={handleAuth} className="auth-btn">{isRegister ? 'Зарегистрироваться' : 'Войти'}</button>
          <button onClick={() => setIsRegister(!isRegister)} className="auth-link">{isRegister ? 'Уже есть аккаунт? Войти' : 'Нет аккаунта? Зарегистрироваться'}</button>
        </div>
      </div>
    );
  }

  const todoCount = allTasks.filter(t => t.status === 'todo').length;
  const inProgressCount = allTasks.filter(t => t.status === 'in_progress').length;
  const doneCount = allTasks.filter(t => t.status === 'done').length;
  const totalTasks = allTasks.length;
  const completionRate = totalTasks > 0 ? Math.round((doneCount / totalTasks) * 100) : 0;
  const overdueCount = allTasks.filter(t => getTaskDeadlineStatus(t.deadline) === 'overdue' && t.status !== 'done').length;

  const income = finances.filter(f => f.type === 'income').reduce((sum, f) => sum + f.amount, 0);
  const expenses = finances.filter(f => f.type === 'expense').reduce((sum, f) => sum + f.amount, 0);
  const balance = income - expenses;

  const projectTabs = [
    { id: 'idea', label: 'Идея', icon: '💡' },
    { id: 'analysis', label: 'Анализ', icon: '🔍' },
    { id: 'plan', label: 'Контент-План', icon: '📋' },
    { id: 'content', label: 'Контент', icon: '🎨' },
    { id: 'trends', label: 'Тренды', icon: '🔥' },
    { id: 'posting', label: 'Постинг', icon: '📤' },
    { id: 'stats', label: 'Статистика', icon: '📊' },
    { id: 'finance', label: 'Финансы', icon: '💰' }
  ];

  return (
    <div className="app">
      <header className="header">
        <div className="header-brand">
          <span className="brand-title">PONA DIGITAL</span>
          <img src="/logo.jpg" alt="" className="brand-logo" />
        </div>
        <div className="header-nav-row">
          <nav className="nav">
            <button className={`nav-btn ${activeTab === 'dashboard' ? 'active' : ''}`} onClick={() => setActiveTab('dashboard')}>
              <span className="nav-emoji">📊</span> Dashboard
            </button>
            <button className={`nav-btn ${activeTab === 'projects' ? 'active' : ''}`} onClick={() => setActiveTab('projects')}>
              <span className="nav-emoji">📁</span> Проекты
            </button>
            <button className={`nav-btn ${activeTab === 'analytics' ? 'active' : ''}`} onClick={() => setActiveTab('analytics')}>
              <span className="nav-emoji">📈</span> Аналитика
            </button>
            <button className={`nav-btn ${activeTab === 'finance' ? 'active' : ''}`} onClick={() => { setActiveTab('finance'); loadFinanceAccounts(); }}>
              <span className="nav-emoji">💰</span> Финансы
            </button>
            <button className={`nav-btn ${activeTab === 'ads' ? 'active' : ''}`} onClick={() => { setActiveTab('ads'); loadAds(); }}>
              <span className="nav-emoji">📋</span> Доски объявлений
            </button>
            <button className={`nav-btn ${activeTab === 'music' ? 'active' : ''}`} onClick={() => { setActiveTab('music'); setSelectedTrack(null); loadMusicTracks(); }}>
              <span className="nav-emoji">🎵</span> Музыка
            </button>
          </nav>
          <button onClick={handleLogout} className="logout-btn"><span className="nav-emoji">🚪</span> Выйти</button>
        </div>
      </header>

      {activeTab === 'dashboard' ? (
        <div className="dashboard">
          <h1 className="dashboard-title">Общая картина</h1>
          {pendingApprovalCount > 0 && (
            <div className="approval-banner">
              📝 Ждут вашего утверждения: <strong>{pendingApprovalCount}</strong> {pendingApprovalCount === 1 ? 'пост' : 'постов'} — проверьте личные сообщения бота или раздел «Контент» нужного проекта.
            </div>
          )}
          {reminders.filter(r => new Date(r.remind_at) <= new Date()).map(r => (
            <div key={r.id} className="approval-banner" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12 }}>
              <span>🔔 {r.title}</span>
              <button className="section-btn" onClick={() => completeReminder(r.id)}>✅ Готово</button>
            </div>
          ))}
          <div className="stats-grid">
            <div className="stat-card"><img src="/icon/projects.png" alt="" className="stat-icon-img" /><span className="stat-value">{projects.length}</span><span className="stat-label">Проектов</span></div>
            <div className="stat-card"><img src="/icon/tasks.png" alt="" className="stat-icon-img" /><span className="stat-value">{totalTasks}</span><span className="stat-label">Всего задач</span></div>
            <div className="stat-card"><img src="/icon/todo.png" alt="" className="stat-icon-img" /><span className="stat-value">{todoCount}</span><span className="stat-label">Сделать</span></div>
            <div className="stat-card"><img src="/icon/progress.png" alt="" className="stat-icon-img" /><span className="stat-value">{inProgressCount}</span><span className="stat-label">В работе</span></div>
            <div className="stat-card"><img src="/icon/overdue.png" alt="" className="stat-icon-img" /><span className="stat-value">{overdueCount}</span><span className="stat-label">Просрочено</span></div>
            <div className="stat-card"><img src="/icon/done.png" alt="" className="stat-icon-img" /><span className="stat-value">{doneCount}</span><span className="stat-label">Готово</span></div>
            <div className="stat-card"><img src="/icon/chart.png" alt="" className="stat-icon-img" /><span className="stat-value">{completionRate}%</span><span className="stat-label">Выполнение</span></div>
            <div className="stat-card"><img src="/icon/money.png" alt="" className="stat-icon-img" /><span className="stat-value">{balance} ₽</span><span className="stat-label">Баланс</span></div>
            <div className="stat-card" style={{ cursor: 'pointer' }} onClick={() => setActiveTab('reminders')}>
              <span className="stat-icon-img" style={{ fontSize: 32, lineHeight: 1 }}>🔔</span>
              <span className="stat-value">{reminders.filter(r => r.status === 'pending').length}</span>
              <span className="stat-label">Напоминания</span>
            </div>
          </div>

          <div className="ai-dashboard-block" onClick={() => setShowAiChat(true)}>
            <img src="/icon/AI.png" alt="AI" className="ai-dashboard-img" />
            <div className="ai-dashboard-text">
              <h3>AI-ассистент</h3>
              <p>Нажми, чтобы задать вопрос</p>
            </div>
            <span className="ai-dashboard-arrow">↓</span>
          </div>
        </div>
      ) : activeTab === 'analytics' ? (
        <div className="analytics">
          <h1 className="dashboard-title">Аналитика по проектам</h1>
          <div className="project-analytics">
            {projects.length === 0 && <p className="empty">Нет проектов для анализа</p>}
            {projects.map((project) => {
              const projectTasks = allTasks.filter(t => t.project_id === project.id);
              const projectDone = projectTasks.filter(t => t.status === 'done').length;
              const progress = projectTasks.length > 0 ? Math.round((projectDone / projectTasks.length) * 100) : 0;
              return (
                <div key={project.id} className="project-analytics-card">
                  <div className="project-analytics-header">
                    <span className="project-color" style={{ background: project.color || '#667eea' }}></span>
                    <span className="project-analytics-name">{project.name}</span>
                    <span className="project-analytics-percent">{progress}%</span>
                  </div>
                  <div className="progress-bar">
                    <div className="progress-fill" style={{ width: progress + '%', background: project.color || '#38bdf8' }}></div>
                  </div>
                  <div className="project-analytics-stats">
                    <span>Всего: {projectTasks.length}</span>
                    <span>Готово: {projectDone}</span>
                    <span>В работе: {projectTasks.filter(t => t.status === 'in_progress').length}</span>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      ) : activeTab === 'finance' ? (
        <div className="finance">
          <h1 className="dashboard-title">Финансы</h1>
          <div className="finance-summary">
            <div className="finance-card income-card">
              <span className="finance-label">💰 Доходы</span>
              <span className="finance-value">+{income} ₽</span>
            </div>
            <div className="finance-card expense-card">
              <span className="finance-label">💸 Расходы</span>
              <span className="finance-value">-{expenses} ₽</span>
            </div>
            <div className="finance-card balance-card">
              <span className="finance-label">💎 Баланс</span>
              <span className="finance-value">{balance} ₽</span>
            </div>
          </div>

          <div className="project-tabs" style={{ justifyContent: 'center', marginBottom: 20 }}>
            <button className={`project-tab-btn ${financeTab === 'expenses' ? 'active' : ''}`} onClick={() => setFinanceTab('expenses')}><span>💸</span> Расходы</button>
            <button className={`project-tab-btn ${financeTab === 'income' ? 'active' : ''}`} onClick={() => setFinanceTab('income')}><span>💰</span> Доходы</button>
            <button className={`project-tab-btn ${financeTab === 'ad_accounts' ? 'active' : ''}`} onClick={() => setFinanceTab('ad_accounts')}><span>📣</span> Рекламные кабинеты</button>
          </div>

          {financeTab === 'expenses' && (
            <div style={{ maxWidth: 1100, margin: '0 auto', display: 'flex', gap: 20, flexWrap: 'wrap' }}>
              <div style={{ flex: '1 1 280px' }}>
                <h3 style={{ color: '#fff', fontWeight: 400, marginBottom: 10 }}>🧠 Кабинеты AI-сервисов</h3>
                <div className="content-list">
                  {financeAccounts.filter(a => a.category === 'ai_service').map((a) => (
                    <div key={a.id} className="content-item">
                      <div className="content-body">
                        <a href={a.url} target="_blank" rel="noreferrer" className="content-title" style={{ color: '#38bdf8', textDecoration: 'none' }}>{a.name}</a>
                        {a.balance_provider === 'router_ai' && <span className="content-text">💳 Баланс: {a.last_balance != null ? `${a.last_balance} ₽` : 'проверяется автоматически'}</span>}
                        {!a.balance_provider && <span className="content-text">🔔 Напоминание: {a.reminder_schedule === 'weekly' ? 'раз в неделю' : 'вручную'}</span>}
                      </div>
                      <button className="content-action-btn delete" onClick={() => deleteFinanceAccount(a.id)}>🗑️</button>
                    </div>
                  ))}
                  <button className="section-btn" onClick={() => addFinanceAccount('ai_service')} style={{ marginTop: 8 }}>➕ Добавить кабинет</button>
                </div>
              </div>
              <div style={{ flex: '2 1 400px' }}>
                <div className="finance-actions" style={{ justifyContent: 'flex-start', marginBottom: 12 }}>
                  <button onClick={() => createFinance('expense')} className="finance-btn expense-btn">➖ Добавить расход</button>
                </div>
                <div className="finance-list">
                  {finances.filter(f => f.type === 'expense').length === 0 && <p className="empty">Нет расходов</p>}
                  {finances.filter(f => f.type === 'expense').map((f) => (
                    <div key={f.id} className="finance-item">
                      <span className="finance-type expense">💸</span>
                      <span className="finance-desc">{f.description}</span>
                      <span className="finance-amount expense">−{f.amount} ₽</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}

          {financeTab === 'income' && (
            <div style={{ maxWidth: 800, margin: '0 auto' }}>
              <div className="finance-actions">
                <button onClick={() => createFinance('income')} className="finance-btn income-btn">➕ Добавить доход</button>
              </div>
              <div className="finance-list">
                {finances.filter(f => f.type === 'income').length === 0 && <p className="empty">Нет доходов</p>}
                {finances.filter(f => f.type === 'income').map((f) => (
                  <div key={f.id} className="finance-item">
                    <span className="finance-type income">💰</span>
                    <span className="finance-desc">{f.description}</span>
                    <span className="finance-amount income">+{f.amount} ₽</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {financeTab === 'ad_accounts' && (
            <div style={{ maxWidth: 800, margin: '0 auto' }}>
              <p className="section-hint">👉 Ссылки на ваши рекламные кабинеты (Яндекс.Директ, VK Реклама и т.д.) — держите здесь для быстрого доступа к статистике доходов от рекламы.</p>
              <div className="finance-actions">
                <button className="finance-btn income-btn" onClick={() => addFinanceAccount('ad_account')}>➕ Добавить кабинет</button>
              </div>
              <div className="content-list">
                {financeAccounts.filter(a => a.category === 'ad_account').length === 0 && <p className="empty">Пока нет добавленных рекламных кабинетов</p>}
                {financeAccounts.filter(a => a.category === 'ad_account').map((a) => (
                  <div key={a.id} className="content-item">
                    <div className="content-body">
                      <a href={a.url} target="_blank" rel="noreferrer" className="content-title" style={{ color: '#38bdf8', textDecoration: 'none' }}>{a.name}</a>
                    </div>
                    <button className="content-action-btn delete" onClick={() => deleteFinanceAccount(a.id)}>🗑️</button>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      ) : activeTab === 'reminders' ? (
        <div className="reminders">
          <h1 className="dashboard-title">Напоминания</h1>

          <div style={{ maxWidth: 600, margin: '0 auto 32px', display: 'flex', flexDirection: 'column', gap: 10 }}>
            <input className="idea-input" placeholder="Текст напоминания" value={reminderForm.title} onChange={e => setReminderForm({ ...reminderForm, title: e.target.value })} />
            <input className="idea-input" type="datetime-local" value={reminderForm.when} onChange={e => setReminderForm({ ...reminderForm, when: e.target.value })} />
            <button className="section-btn" onClick={createReminder}>➕ Добавить напоминание</button>
          </div>

          <div style={{ maxWidth: 700, margin: '0 auto', display: 'flex', flexDirection: 'column', gap: 10 }}>
            {reminders.length === 0 && <p className="empty">Пока нет напоминаний</p>}
            {reminders.map((r) => (
              <div key={r.id} className="content-item">
                <div className="content-body">
                  <span className="content-title" style={{ textDecoration: r.status === 'done' ? 'line-through' : 'none', opacity: r.status === 'done' ? 0.5 : 1 }}>{r.title}</span>
                  <span className="content-text">🕐 {new Date(r.remind_at).toLocaleString('ru-RU', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' })}{r.status === 'done' ? ' · выполнено' : ''}</span>
                </div>
                {r.status !== 'done' && <button className="content-action-btn" onClick={() => completeReminder(r.id)}>✅</button>}
                <button className="content-action-btn delete" onClick={() => deleteReminder(r.id)}>🗑️</button>
              </div>
            ))}
          </div>
        </div>
      ) : activeTab === 'music' ? (
        <div className="music">
          <h1 className="dashboard-title">Музыка</h1>

          {!selectedTrack ? (
            <>
              <div style={{ maxWidth: 700, margin: '0 auto 24px', textAlign: 'center' }}>
                <button className="section-btn" onClick={createMusicTrack}>➕ Новый трек</button>
              </div>
              <div style={{ maxWidth: 700, margin: '0 auto', display: 'flex', flexDirection: 'column', gap: 10 }}>
                {musicTracks.length === 0 && <p className="empty">Пока нет треков</p>}
                {musicTracks.map((t) => (
                  <div key={t.id} className="content-item" style={{ cursor: 'pointer' }} onClick={() => setSelectedTrack(t)}>
                    <div className="content-body">
                      <span className="content-title">🎵 {t.title}</span>
                      <span className="content-text">{{
                        draft: 'Черновик — нужен референс',
                        analyzed: 'Референс проанализирован',
                        lyrics_ready: 'Текст готов',
                        prompt_ready: 'Промпт для Suno готов',
                        generated: '✅ Готовый трек загружен'
                      }[t.status]}</span>
                    </div>
                    <button className="content-action-btn delete" onClick={(e) => { e.stopPropagation(); deleteMusicTrack(t.id); }}>🗑️</button>
                  </div>
                ))}
              </div>
            </>
          ) : (
            <div style={{ maxWidth: 700, margin: '0 auto' }}>
              <button className="section-btn" onClick={() => setSelectedTrack(null)} style={{ marginBottom: 16 }}>← Ко всем трекам</button>
              <h2 style={{ color: '#fff', fontWeight: 400 }}>🎵 {selectedTrack.title}</h2>

              <div className="content-item" style={{ flexDirection: 'column', alignItems: 'stretch', marginTop: 16 }}>
                <span className="content-title">1. Референс-трек</span>
                {selectedTrack.reference_url ? (
                  <audio controls src={selectedTrack.reference_url} style={{ width: '100%', marginTop: 8 }} />
                ) : (
                  <p className="content-text">Загрузите mp3 трендового трека, который хотите использовать как ориентир по звучанию.</p>
                )}
                <input type="file" accept="audio/*" onChange={(e) => handleReferenceUpload(e, selectedTrack)} style={{ marginTop: 8 }} />
                {selectedTrack.reference_url && (
                  <button className="section-btn" style={{ marginTop: 8 }} disabled={musicBusy === selectedTrack.id} onClick={() => runMusicStep('/api/music-analyze', { track_id: selectedTrack.id }, selectedTrack.id)}>
                    {musicBusy === selectedTrack.id ? '⏳ Анализирую...' : '🔍 Проанализировать референс'}
                  </button>
                )}
                {selectedTrack.analysis && (
                  <div className="content-text" style={{ marginTop: 8 }}>
                    🎧 Жанр: {selectedTrack.analysis.genre_guess} · Вокал: {selectedTrack.analysis.vocal} · Темп: {selectedTrack.analysis.tempo_feel} · Энергия: {selectedTrack.analysis.energy}<br />
                    Настроение: {selectedTrack.analysis.mood} · Инструменты: {selectedTrack.analysis.instrumentation} · Стиль/эпоха: {selectedTrack.analysis.era_style}
                  </div>
                )}
              </div>

              <div className="content-item" style={{ flexDirection: 'column', alignItems: 'stretch', marginTop: 16 }}>
                <span className="content-title">2. Текст песни</span>
                <input className="idea-input" placeholder="Тема / настроение песни" value={lyricsTheme} onChange={e => setLyricsTheme(e.target.value)} style={{ marginTop: 8 }} />
                <button className="section-btn" style={{ marginTop: 8 }} disabled={musicBusy === selectedTrack.id || !lyricsTheme.trim()} onClick={() => runMusicStep('/api/music-lyrics', { track_id: selectedTrack.id, theme: lyricsTheme }, selectedTrack.id)}>
                  {musicBusy === selectedTrack.id ? '⏳ Пишу текст...' : '✍️ Сгенерировать текст'}
                </button>
                {selectedTrack.lyrics && <pre className="content-text" style={{ whiteSpace: 'pre-wrap', marginTop: 8 }}>{selectedTrack.lyrics}</pre>}
              </div>

              <div className="content-item" style={{ flexDirection: 'column', alignItems: 'stretch', marginTop: 16 }}>
                <span className="content-title">3. Промпт для Suno</span>
                <button className="section-btn" style={{ marginTop: 8 }} disabled={musicBusy === selectedTrack.id || !selectedTrack.lyrics} onClick={() => runMusicStep('/api/music-prompt', { track_id: selectedTrack.id }, selectedTrack.id)}>
                  {musicBusy === selectedTrack.id ? '⏳ Собираю промпт...' : '🎼 Собрать промпт'}
                </button>
                {selectedTrack.suno_prompt && (
                  <>
                    <p className="content-text" style={{ marginTop: 8 }}>{selectedTrack.suno_prompt}</p>
                    <button className="section-btn" onClick={() => copySunoPrompt(selectedTrack)}>📋 Скопировать промпт + текст для Suno</button>
                  </>
                )}
              </div>

              <div className="content-item" style={{ flexDirection: 'column', alignItems: 'stretch', marginTop: 16 }}>
                <span className="content-title">4. Готовый трек</span>
                <p className="content-text">Сгенерируйте трек в Suno вручную (промпт + текст выше), скачайте mp3 и загрузите сюда как готовый продукт.</p>
                {selectedTrack.audio_url && <audio controls src={selectedTrack.audio_url} style={{ width: '100%', marginTop: 8 }} />}
                <input type="file" accept="audio/*" onChange={(e) => handleFinalUpload(e, selectedTrack)} style={{ marginTop: 8 }} />
                {selectedTrack.audio_url && (
                  selectedTrack.content_item_id ? (
                    <p className="content-text" style={{ marginTop: 8 }}>📤 Уже поставлен в очередь на публикацию/утверждение.</p>
                  ) : (
                    <button className="section-btn" style={{ marginTop: 8 }} onClick={() => scheduleTrackPublish(selectedTrack)}>📤 Запланировать публикацию в канал</button>
                  )
                )}
              </div>
            </div>
          )}
        </div>
      ) : activeTab === 'ads' ? (
        <div className="ads">
          <h1 className="dashboard-title">Доски объявлений</h1>
          <p className="section-hint">Создайте одно универсальное объявление и разместите его на нескольких площадках. VK публикуется автоматически по API; Avito, Kwork и YouDo не дают публичного API для этого — CRM готовит текст под копирование, а отметку «опубликовано» вы ставите вручную.</p>

          <div style={{ maxWidth: 700, margin: '0 auto 32px', display: 'flex', flexDirection: 'column', gap: 10 }}>
            <input className="idea-input" placeholder="Заголовок объявления" value={adForm.title} onChange={e => setAdForm({ ...adForm, title: e.target.value })} />
            <textarea className="idea-input" placeholder="Описание услуги" rows={4} value={adForm.description} onChange={e => setAdForm({ ...adForm, description: e.target.value })} />
            <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
              <input className="idea-input" style={{ flex: '1 1 160px' }} placeholder="Категория" value={adForm.category} onChange={e => setAdForm({ ...adForm, category: e.target.value })} />
              <input className="idea-input" style={{ flex: '1 1 120px' }} placeholder="Цена, ₽" type="number" value={adForm.price} onChange={e => setAdForm({ ...adForm, price: e.target.value })} />
            </div>
            <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
              <input className="idea-input" style={{ flex: '1 1 160px' }} placeholder="Имя для связи" value={adForm.contact_name} onChange={e => setAdForm({ ...adForm, contact_name: e.target.value })} />
              <input className="idea-input" style={{ flex: '1 1 160px' }} placeholder="Телефон" value={adForm.contact_phone} onChange={e => setAdForm({ ...adForm, contact_phone: e.target.value })} />
            </div>
            <button className="section-btn" onClick={createAd}>➕ Создать объявление</button>
          </div>

          <div style={{ maxWidth: 900, margin: '0 auto', display: 'flex', flexDirection: 'column', gap: 16 }}>
            {ads.length === 0 && <p className="empty">Пока нет объявлений</p>}
            {ads.map((ad) => (
              <div key={ad.id} className="content-item" style={{ flexDirection: 'column', alignItems: 'stretch' }}>
                <div className="content-body">
                  <span className="content-title">{ad.title}</span>
                  <span className="content-text">{ad.description}</span>
                  <span className="content-text">{ad.price ? `${ad.price} ₽` : 'Цена договорная'}{ad.category ? ` · ${ad.category}` : ''}</span>
                </div>
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 10 }}>
                  {AD_PLATFORMS.map((platform) => {
                    const pub = (ad.classified_ad_publications || []).find(p => p.platform === platform.key);
                    const status = pub?.status;
                    if (platform.mode === 'auto') {
                      return (
                        <button
                          key={platform.key}
                          className="section-btn"
                          disabled={adPublishing === ad.id}
                          onClick={() => publishAdToVk(ad.id)}
                          title={pub?.error_message || ''}
                        >
                          {platform.icon} {platform.label}: {status === 'published' ? '✅ опубликовано' : status === 'failed' ? '❌ ошибка (повторить)' : adPublishing === ad.id ? '⏳...' : 'опубликовать'}
                        </button>
                      );
                    }
                    return (
                      <React.Fragment key={platform.key}>
                        <button className="section-btn" onClick={() => copyAdText(ad)}>{platform.icon} {platform.label}: скопировать текст</button>
                        {status !== 'manual' ? (
                          <button className="section-btn" onClick={() => markAdManualPublished(ad.id, platform.key)}>отметить как опубликовано</button>
                        ) : (
                          <span className="content-text">✅ отмечено вручную</span>
                        )}
                      </React.Fragment>
                    );
                  })}
                  {pubUrl(ad, 'vk') && <a href={pubUrl(ad, 'vk')} target="_blank" rel="noreferrer" className="content-text" style={{ color: '#38bdf8' }}>Открыть в VK →</a>}
                </div>
                <button className="content-action-btn delete" style={{ alignSelf: 'flex-end', marginTop: 8 }} onClick={() => deleteAd(ad.id)}>🗑️ Удалить объявление</button>
              </div>
            ))}
          </div>
        </div>
      ) : (
        <div className="main">
          <aside className="sidebar">
            <div className="sidebar-header">
              <h2>Проекты</h2>
              <button onClick={createProject} className="add-btn">➕</button>
            </div>
            <div className="project-list">
              {projects.map((project) => (
                <div key={project.id} className={`project-item ${selectedProject?.id === project.id ? 'active' : ''}`} onClick={() => { setSelectedProject(project); setProjectTab('idea'); loadProjectContent(project.id); setIdeaResult(''); setAnalysisResult(''); setPlanResult(''); }}>
                  <span className="project-color" style={{ background: project.color || '#667eea' }}></span>
                  <span className="project-name">{project.name}</span>
                  <span className="project-status">{getStatusLabel(project.status)}</span>
                </div>
              ))}
              {projects.length === 0 && <p className="empty">Нет проектов</p>}
            </div>
          </aside>
          <main className="content">
            {selectedProject ? (
              <>
                <div className="project-header">
                  <h1>{selectedProject.name}</h1>
                  <button onClick={renameProject} className="rename-btn">✏️</button>
                  <button onClick={linkTelegramChannel} className="rename-btn" title={selectedProject.telegram_channel_id ? `Канал привязан: ${selectedProject.telegram_channel_id}` : 'Канал не привязан'}>
                    {selectedProject.telegram_channel_id ? '🔗' : '⛓️‍💥'}
                  </button>
                  <button onClick={() => deleteProject(selectedProject.id)} className="delete-btn">🗑️</button>
                </div>
                {selectedProject.description && <p className="project-desc">{selectedProject.description}</p>}

                <div className="section-actions" style={{ marginBottom: 16 }}>
                  <button className="section-btn chain-btn" onClick={generateChain} disabled={aiLoading}>
                    {aiLoading ? '⏳ Генерация...' : '🔗 Сгенерировать всё по цепочке (идея → анализ → план)'}
                  </button>
                  {aiLoading && (
                    <button className="section-btn cancel-btn" onClick={cancelGeneration}>
                      ✋ Отменить
                    </button>
                  )}
                </div>

                <div className="project-tabs">
                  {projectTabs.map((tab) => (
                    <button
                      key={tab.id}
                      className={`project-tab-btn ${projectTab === tab.id ? 'active' : ''}`}
                      onClick={() => { setProjectTab(tab.id); if (tab.id === 'stats') loadProjectStats(selectedProject.id); if (tab.id === 'trends') loadTrendsTab(selectedProject.id); }}
                    >
                      <span>{tab.icon}</span> {tab.label}
                    </button>
                  ))}
                </div>

                {projectTab === 'idea' && (
                  <div className="project-section">
                    <h3>💡 Идея проекта</h3>
                    <p className="section-desc">AI поможет разработать концепцию, стратегию и монетизацию</p>
                    <p className="section-hint">👉 Вы пишете: главный посыл и ключевые моменты идеи — для кого продукт, какую проблему решает, в чём фишка. AI предложит: варианты концепции, стратегии и монетизации.</p>
                    <div className="section-placeholder">
                      <textarea
                        className="idea-input"
                        placeholder="Например: сервис для поиска нянь с проверкой документов, ориентир на молодых родителей в крупных городах"
                        value={ideaPrompt}
                        onChange={(e) => setIdeaPrompt(e.target.value)}
                        disabled={aiLoading}
                        rows={3}
                      />
                      <p>Нажми, чтобы AI разработал концепцию проекта</p>
                      <div className="section-actions">
                        <button className="section-btn" onClick={generateIdea} disabled={aiLoading}>
                          {aiLoading ? '⏳ Генерация...' : '🤖 Сгенерировать с AI'}
                        </button>
                        {aiLoading && (
                          <button className="section-btn cancel-btn" onClick={cancelGeneration}>
                            ✋ Отменить
                          </button>
                        )}
                      </div>
                    </div>
                    {ideaResult && <div className="section-result">{ideaResult}</div>}
                  </div>
                )}

                {projectTab === 'analysis' && (
                  <div className="project-section">
                    <h3>🔍 Анализ ниши</h3>
                    <p className="section-desc">AI собирает данные о трендах, конкурентах и фишках</p>
                    <p className="section-hint">👉 Вы пишете: нишу и что важно учесть. Укажите каналы конкурентов — AI зайдёт в открытые Telegram-каналы, изучит последние 20 постов и сделает вывод, что сейчас в тренде, что в топе и как вести канал.</p>
                    <div className="section-placeholder">
                      <textarea
                        className="idea-input"
                        placeholder="Например: ниша доставки готовой еды для спортсменов, Москва"
                        value={analysisPrompt}
                        onChange={(e) => setAnalysisPrompt(e.target.value)}
                        disabled={aiLoading}
                        rows={3}
                      />
                      <textarea
                        className="idea-input"
                        placeholder="Каналы конкурентов через запятую или с новой строки: @channel1, @channel2 (необязательно)"
                        value={competitorChannels}
                        onChange={(e) => setCompetitorChannels(e.target.value)}
                        disabled={aiLoading}
                        rows={2}
                      />
                      <p>Нажми, чтобы AI проанализировал нишу</p>
                      <div className="section-actions">
                        <button className="section-btn" onClick={generateAnalysis} disabled={aiLoading}>
                          {aiLoading ? '⏳ Анализ...' : '🤖 Запустить анализ'}
                        </button>
                        {aiLoading && (
                          <button className="section-btn cancel-btn" onClick={cancelGeneration}>
                            ✋ Отменить
                          </button>
                        )}
                      </div>
                    </div>
                    {analysisResult && <div className="section-result">{analysisResult}</div>}
                  </div>
                )}

                {projectTab === 'plan' && (
                  <div className="project-section">
                    <h3>📋 Контент-план</h3>
                    <p className="section-desc">AI составит стратегию развития канала на основе идеи и анализа</p>
                    <p className="section-hint">👉 Строится на идее и анализе конкурентов/трендов (если вы их уже сгенерировали — они подставятся автоматически). AI предложит: стратегию развития канала, варианты монетизации, как привлекать подписчиков, и контент-план по неделям.</p>
                    {(ideaResult || analysisResult) && (
                      <p className="section-hint" style={{ borderColor: 'rgba(74, 222, 128, 0.4)', background: 'rgba(74, 222, 128, 0.08)', color: '#86efac' }}>
                        ✅ Учтено: {ideaResult ? 'идея проекта' : ''}{ideaResult && analysisResult ? ' + ' : ''}{analysisResult ? 'анализ ниши/конкурентов' : ''}
                      </p>
                    )}
                    <div className="section-placeholder">
                      <textarea
                        className="idea-input"
                        placeholder="Например: 3 поста в неделю в Telegram и VK, без тем про политику, акцент на кейсы клиентов"
                        value={planPrompt}
                        onChange={(e) => setPlanPrompt(e.target.value)}
                        disabled={aiLoading}
                        rows={3}
                      />
                      <p>Нажми, чтобы AI составил стратегию и контент-план</p>
                      <div className="section-actions">
                        <button className="section-btn" onClick={generatePlan} disabled={aiLoading}>
                          {aiLoading ? '⏳ Генерация...' : '🤖 Создать стратегию и план'}
                        </button>
                        {aiLoading && (
                          <button className="section-btn cancel-btn" onClick={cancelGeneration}>
                            ✋ Отменить
                          </button>
                        )}
                      </div>
                    </div>
                    {planResult && <div className="section-result">{planResult}</div>}
                  </div>
                )}

                {projectTab === 'content' && (
                  <div className="project-section">
                    <h3>🎨 Контент</h3>
                    <p className="section-desc">Все посты контент-завода по площадкам</p>
                    <p className="section-hint">👉 Кнопка ниже сама сгенерирует тексты и картинки на 3 дня вперёд (4 поста/день) для Telegram — используя идею, анализ и стратегию, если они уже сгенерированы. Готовые посты появятся ниже со статусом «В очереди» и опубликуются ботом по расписанию.</p>
                    <div className="content-toolbar">
                      <button className="section-btn chain-btn" onClick={generateContentBatch} disabled={aiLoading}>
                        {aiLoading ? '⏳ Генерирую тексты и картинки...' : '🤖 Сгенерировать контент на 3 дня (4 поста/день)'}
                      </button>
                      {aiLoading && (
                        <button className="section-btn cancel-btn" onClick={cancelGeneration}>
                          ✋ Отменить
                        </button>
                      )}
                      <button className="section-btn" onClick={createContentItem}>➕ Добавить пост вручную</button>
                      <select className="content-filter" value={contentFilter} onChange={(e) => setContentFilter(e.target.value)}>
                        <option value="all">Все площадки</option>
                        {PLATFORMS.map(p => <option key={p.id} value={p.id}>{p.icon} {p.label}</option>)}
                      </select>
                      <input
                        className="content-filter content-search-input"
                        type="text"
                        placeholder="🔎 Поиск по архиву (тема, текст)..."
                        value={contentSearch}
                        onChange={(e) => setContentSearch(e.target.value)}
                      />
                    </div>
                    {contentLoading && <p className="empty">Загрузка...</p>}
                    <div className="content-list">
                      {!contentLoading && projectContent.filter(c => (contentFilter === 'all' || c.platform === contentFilter) && matchesContentSearch(c, contentSearch)).length === 0 && (
                        <p className="empty">Постов не найдено</p>
                      )}
                      {projectContent.filter(c => (contentFilter === 'all' || c.platform === contentFilter) && matchesContentSearch(c, contentSearch)).map((item) => {
                        const platform = getPlatformInfo(item.platform);
                        return (
                          <div key={item.id} className="content-item">
                            <span className="content-platform">{platform.icon} {platform.label}{!platform.live && <span className="content-platform-badge">черновик до API</span>}</span>
                            {item.media_url && item.media_type === 'audio' ? (
                              <audio controls src={item.media_url} style={{ height: 32 }} />
                            ) : item.media_url && (
                              <img className="content-thumb" src={item.media_url} alt="" onClick={() => setPreviewItem(item)} style={{ cursor: 'pointer' }} />
                            )}
                            <div className="content-body">
                              <span className="content-title">{item.title}</span>
                              <span className="content-text">{item.body}</span>
                              {item.scheduled_at && <span className="content-text">📅 {new Date(item.scheduled_at).toLocaleString('ru-RU')}</span>}
                            </div>
                            <span className={`content-status status-${item.status}`}>{getContentStatusLabel(item.status)}</span>
                            <div className="content-actions">
                              <button className="content-action-btn" onClick={() => setPreviewItem(item)}>👁 Просмотр</button>
                              {item.status === 'draft' && <button className="content-action-btn" onClick={() => scheduleContentItem(item)}>⏳ В очередь</button>}
                              {(item.status === 'scheduled' || item.status === 'failed') && <button className="content-action-btn" onClick={() => publishNow(item)}>🚀 Опубликовать</button>}
                              <button className={`content-action-btn rate-btn ${item.rating === 'good' ? 'active-good' : ''}`} onClick={() => rateContentItem(item, 'good')} title="Хорошо зашло">👍</button>
                              <button className={`content-action-btn rate-btn ${item.rating === 'bad' ? 'active-bad' : ''}`} onClick={() => rateContentItem(item, 'bad')} title="Не зашло">👎</button>
                              <button className="content-action-btn delete" onClick={() => deleteContentItem(item.id)}>🗑️</button>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}

                {projectTab === 'trends' && (
                  <div className="project-section">
                    <h3>🔥 Тренды</h3>
                    <p className="section-desc">Поиск вирусных видео по нише через официальные API YouTube и VK, анализ виральности и адаптация под ваш бренд</p>
                    <p className="section-hint">👉 Впишите нишу/ключевые слова — найдём популярные короткие видео на YouTube и в VK, дальше можно проанализировать паттерн и превратить в сценарий под ваш продукт.</p>

                    <div className="content-toolbar">
                      <input
                        className="content-filter content-search-input"
                        type="text"
                        placeholder="Например: рецепты завтраков, гастрономия"
                        value={trendQuery}
                        onChange={(e) => setTrendQuery(e.target.value)}
                        onKeyDown={(e) => e.key === 'Enter' && searchTrends()}
                      />
                      <button className="section-btn chain-btn" onClick={searchTrends} disabled={trendLoading}>
                        {trendLoading ? '⏳ Ищу...' : '🔍 Найти тренды'}
                      </button>
                    </div>

                    {trendErrors.length > 0 && (
                      <p className="section-hint" style={{ borderColor: 'rgba(239, 68, 68, 0.4)', background: 'rgba(239, 68, 68, 0.08)', color: '#fca5a5' }}>
                        ⚠️ {trendErrors.join(' · ')}
                      </p>
                    )}

                    <div className="content-list">
                      {trendResults.length === 0 && <p className="empty">Пока ничего не найдено — начните поиск выше.</p>}
                      {trendResults.map((v) => (
                        <div key={v.id} className="content-item" style={{ flexWrap: 'wrap' }}>
                          <span className="content-platform">{v.platform === 'youtube' ? '▶️ YouTube' : '🔵 VK'}</span>
                          <div className="content-body">
                            <a href={v.url} target="_blank" rel="noreferrer" className="content-title" style={{ color: '#38bdf8', textDecoration: 'none' }}>{v.title || 'Без названия'}</a>
                            <span className="content-text">{v.channel_name} · 👁 {v.views?.toLocaleString('ru-RU')} · ❤️ {v.likes?.toLocaleString('ru-RU')} · 💬 {v.comments?.toLocaleString('ru-RU')}</span>
                            {v.viral_analysis && (
                              <span className="content-text">
                                🎯 Хук: {v.viral_analysis.hook_guess}<br />
                                📐 Структура: {v.viral_analysis.likely_structure}<br />
                                😊 Тон: {v.viral_analysis.emotional_tone}
                              </span>
                            )}
                          </div>
                          <div className="content-actions">
                            <button className="content-action-btn" onClick={() => analyzeTrend(v.id)} disabled={analyzingTrendId === v.id}>
                              {analyzingTrendId === v.id ? '⏳' : '🧠 Анализ'}
                            </button>
                            <button className="content-action-btn" onClick={() => adaptTrend(v.id)}>✍️ Адаптировать</button>
                          </div>
                        </div>
                      ))}
                    </div>

                    {trendScripts.length > 0 && (
                      <>
                        <h3 style={{ marginTop: 24 }}>✍️ Сценарии</h3>
                        <div className="content-list">
                          {trendScripts.map((s) => (
                            <div key={s.id} className="content-item">
                              <div className="content-body">
                                <span className="content-title">{s.brief?.niche} — {s.brief?.tone_of_voice}</span>
                                <span className="content-text">{(s.script_text || '').slice(0, 150)}...</span>
                              </div>
                              <span className={`content-status status-${s.status === 'review' ? 'draft' : s.status === 'published' ? 'published' : 'scheduled'}`}>{s.status}</span>
                              <div className="content-actions">
                                <select className="content-filter" value={s.status} onChange={(e) => updateTrendScriptStatus(s.id, e.target.value)}>
                                  <option value="review">На рассмотрении</option>
                                  <option value="in_production">В работе</option>
                                  <option value="filmed">Отснято</option>
                                  <option value="published">Опубликовано</option>
                                  <option value="rejected">Отклонено</option>
                                </select>
                              </div>
                            </div>
                          ))}
                        </div>
                      </>
                    )}
                  </div>
                )}

                {projectTab === 'posting' && (
                  <div className="project-section">
                    <h3>📤 Постинг</h3>
                    <p className="section-desc">Очередь публикаций: Telegram публикуется автоматически по расписанию, остальные площадки — вручную до подключения их API</p>
                    <div className="content-list">
                      {projectContent.filter(c => c.status === 'scheduled' || c.status === 'published' || c.status === 'failed').length === 0 && (
                        <p className="empty">Нет запланированных или опубликованных постов</p>
                      )}
                      {projectContent
                        .filter(c => c.status === 'scheduled' || c.status === 'published' || c.status === 'failed')
                        .sort((a, b) => new Date(a.scheduled_at || a.created_at) - new Date(b.scheduled_at || b.created_at))
                        .map((item) => {
                          const platform = getPlatformInfo(item.platform);
                          return (
                            <div key={item.id} className="content-item">
                              <span className="content-platform">{platform.icon} {platform.label}</span>
                              <div className="content-body">
                                <span className="content-title">{item.title}</span>
                                <span className="content-text">
                                  {item.status === 'published' && item.published_at && `Опубликовано: ${new Date(item.published_at).toLocaleString('ru-RU')}`}
                                  {item.status === 'scheduled' && item.scheduled_at && `Запланировано: ${new Date(item.scheduled_at).toLocaleString('ru-RU')}`}
                                  {item.status === 'failed' && (item.error || 'Ошибка публикации')}
                                </span>
                              </div>
                              <span className={`content-status status-${item.status}`}>{getContentStatusLabel(item.status)}</span>
                              <div className="content-actions">
                                <button className="content-action-btn" onClick={() => setPreviewItem(item)}>👁 Просмотр</button>
                                {item.status !== 'published' && <button className="content-action-btn" onClick={() => publishNow(item)}>🚀 Сейчас</button>}
                              </div>
                            </div>
                          );
                        })}
                    </div>
                  </div>
                )}

                {projectTab === 'stats' && (
                  <div className="project-section">
                    <h3>📊 Статистика</h3>
                    <p className="section-desc">Подписчики канала — реальные данные из Telegram (снимок раз в час + учёт вступлений/выходов)</p>
                    <p className="section-hint">ℹ️ Просмотры постов Telegram Bot API боту не отдаёт — это доступно только во встроенной аналитике Telegram внутри самого приложения (Настройки канала → Статистика), не через ботов.</p>

                    <div className="section-actions" style={{ marginBottom: 16 }}>
                      <button className="section-btn" onClick={() => loadProjectStats(selectedProject.id)} disabled={statsLoading}>
                        {statsLoading ? '⏳ Обновляю...' : '🔄 Обновить данные'}
                      </button>
                    </div>

                    {statsSnapshots.length === 0 ? (
                      <p className="empty">Пока нет данных — бот снимает число подписчиков раз в час, зайдите позже.</p>
                    ) : (
                      <>
                        {(() => {
                          const now = Date.now();
                          const current = statsSnapshots[statsSnapshots.length - 1].subscriber_count;
                          const dayAgo = statsSnapshots.find(s => new Date(s.captured_at).getTime() >= now - 24 * 3600 * 1000);
                          const weekAgo = statsSnapshots.find(s => new Date(s.captured_at).getTime() >= now - 7 * 24 * 3600 * 1000);
                          const growth24h = dayAgo ? current - dayAgo.subscriber_count : 0;
                          const growth7d = weekAgo ? current - weekAgo.subscriber_count : 0;
                          const countIn = (hours) => statsEvents.filter(e => e.event_type === 'joined' && new Date(e.occurred_at).getTime() >= now - hours * 3600 * 1000).length;
                          const countOut = (hours) => statsEvents.filter(e => e.event_type === 'left' && new Date(e.occurred_at).getTime() >= now - hours * 3600 * 1000).length;
                          const joinedWeek = countIn(24 * 7);
                          const leftWeek = countOut(24 * 7);
                          const joinedMonth = countIn(24 * 30);
                          const leftMonth = countOut(24 * 30);

                          return (
                            <>
                              <div className="stats-mini-grid">
                                <div className="stat-mini-card">
                                  <span className="stat-mini-value">{current}</span>
                                  <span className="stat-mini-label">Подписчиков сейчас</span>
                                </div>
                                <div className="stat-mini-card">
                                  <span className={`stat-mini-value ${growth7d >= 0 ? 'positive' : 'negative'}`}>{growth7d >= 0 ? '+' : ''}{growth7d}</span>
                                  <span className="stat-mini-label">Прирост за 7 дней</span>
                                </div>
                                <div className="stat-mini-card">
                                  <span className={`stat-mini-value ${growth24h >= 0 ? 'positive' : 'negative'}`}>{growth24h >= 0 ? '+' : ''}{growth24h}</span>
                                  <span className="stat-mini-label">Прирост за 24 часа</span>
                                </div>
                              </div>

                              <div className="stats-mini-grid">
                                <div className="stat-mini-card">
                                  <span className="stat-mini-value positive">➕ {joinedWeek}</span>
                                  <span className="stat-mini-label">Вступили за неделю</span>
                                </div>
                                <div className="stat-mini-card">
                                  <span className="stat-mini-value negative">➖ {leftWeek}</span>
                                  <span className="stat-mini-label">Отписались за неделю</span>
                                </div>
                                <div className="stat-mini-card">
                                  <span className="stat-mini-value positive">➕ {joinedMonth}</span>
                                  <span className="stat-mini-label">Вступили за месяц</span>
                                </div>
                                <div className="stat-mini-card">
                                  <span className="stat-mini-value negative">➖ {leftMonth}</span>
                                  <span className="stat-mini-label">Отписались за месяц</span>
                                </div>
                              </div>
                            </>
                          );
                        })()}

                        <SubscriberChart snapshots={statsSnapshots} />
                      </>
                    )}

                    {(() => {
                      const rated = projectContent.filter(c => c.rating);
                      if (rated.length === 0) return null;
                      const byRubric = {};
                      rated.forEach(c => {
                        const rubric = (c.topic && c.topic.includes(' — ')) ? c.topic.split(' — ')[1] : 'Кухня мира';
                        byRubric[rubric] = byRubric[rubric] || { good: 0, bad: 0 };
                        byRubric[rubric][c.rating]++;
                      });
                      const rows = Object.entries(byRubric)
                        .map(([rubric, r]) => ({ rubric, ...r, score: r.good - r.bad }))
                        .sort((a, b) => b.score - a.score);
                      return (
                        <div className="project-section" style={{ marginTop: 16, padding: 18 }}>
                          <h3>🏆 Топ рубрик</h3>
                          <p className="section-hint">По вашим оценкам 👍/👎 в разделе «Контент». Эти данные используются при генерации нового контента — топовые рубрики будут предлагаться чаще.</p>
                          <div className="rubric-rank-list">
                            {rows.map(r => (
                              <div key={r.rubric} className="rubric-rank-row">
                                <span className="rubric-rank-name">{r.rubric}</span>
                                <span className="rubric-rank-score">👍 {r.good} &nbsp; 👎 {r.bad}</span>
                              </div>
                            ))}
                          </div>
                        </div>
                      );
                    })()}
                  </div>
                )}

                {projectTab === 'finance' && (
                  <div className="project-section">
                    <h3>💰 Финансы</h3>
                    <p className="section-desc">Расходы, доходы и рекламные кабинеты — общие на весь аккаунт, доступны и отсюда, и из верхнего меню</p>
                    <div className="finance-summary">
                      <div className="finance-card income-card">
                        <span className="finance-label">💰 Доходы</span>
                        <span className="finance-value">+{income} ₽</span>
                      </div>
                      <div className="finance-card expense-card">
                        <span className="finance-label">💸 Расходы</span>
                        <span className="finance-value">-{expenses} ₽</span>
                      </div>
                      <div className="finance-card balance-card">
                        <span className="finance-label">💎 Баланс</span>
                        <span className="finance-value">{balance} ₽</span>
                      </div>
                    </div>
                    <div className="section-actions">
                      <button className="section-btn" onClick={() => { setActiveTab('finance'); loadFinanceAccounts(); }}>💰 Открыть раздел «Финансы»</button>
                    </div>
                  </div>
                )}
              </>
            ) : (
              <div className="welcome">
                <h1>👋 Добро пожаловать</h1>
                <p>Выбери проект слева или создай новый</p>
              </div>
            )}
          </main>
        </div>
      )}

      {previewItem && (
        <div className="modal-overlay" onClick={() => setPreviewItem(null)}>
          <div className="tg-preview-modal" onClick={(e) => e.stopPropagation()}>
            <div className="tg-preview-toolbar">
              <span>Предпросмотр поста</span>
              <button className="modal-close" onClick={() => setPreviewItem(null)}>✕</button>
            </div>
            <div className="tg-preview-card">
              <div className="tg-preview-header">
                <span className="tg-preview-avatar">🍽️</span>
                <div>
                  <div className="tg-preview-channel">{selectedProject?.name || 'Канал'}</div>
                  <div className="tg-preview-sub">канал</div>
                </div>
              </div>
              {previewItem.media_url && previewItem.media_type === 'audio' ? (
                <audio controls src={previewItem.media_url} style={{ width: '100%' }} />
              ) : previewItem.media_url ? (
                <img className="tg-preview-image" src={previewItem.media_url} alt="" />
              ) : (
                <div className="tg-preview-image tg-preview-no-image">Картинка ещё не сгенерирована</div>
              )}
              <div className="tg-preview-caption">{previewItem.body}</div>
              <div className="tg-preview-meta">
                {previewItem.status === 'published' && previewItem.published_at
                  ? `Опубликовано: ${new Date(previewItem.published_at).toLocaleString('ru-RU')}`
                  : previewItem.scheduled_at
                    ? `План: ${new Date(previewItem.scheduled_at).toLocaleString('ru-RU')}`
                    : 'Без даты'}
              </div>
            </div>
          </div>
        </div>
      )}

      {showAiChat && (
        <div className="modal-overlay" onClick={() => setShowAiChat(false)}>
          <div className="modal-ai" onClick={(e) => e.stopPropagation()}>
            <div className="modal-ai-header">
              <img src="/icon/AI.png" alt="AI" className="ai-dashboard-img" style={{width: '40px', height: '40px'}} />
              <h2>AI-ассистент</h2>
              <button className="modal-close" onClick={() => setShowAiChat(false)}>✕</button>
            </div>
            <div className="modal-ai-messages">
              {aiMessages.map((msg, idx) => (
                <div key={idx} className={`chat-message ${msg.role}`}>
                  {msg.role === 'ai' && <img src="/icon/AI.png" alt="AI" className="chat-avatar-img" />}
                  <div className="chat-bubble">{msg.text}</div>
                  {msg.role === 'user' && <span className="chat-avatar">👤</span>}
                </div>
              ))}
              {aiLoading && (
                <div className="chat-message ai">
                  <img src="/icon/AI.png" alt="AI" className="chat-avatar-img" />
                  <div className="chat-bubble">⏳ Думаю...</div>
                </div>
              )}
            </div>
            <div className="modal-ai-input">
              <input
                type="text"
                value={aiInput}
                onChange={(e) => setAiInput(e.target.value)}
                onKeyPress={(e) => e.key === 'Enter' && sendAiMessage()}
                placeholder="Напиши сообщение..."
                className="chat-input"
              />
              <button onClick={sendAiMessage} className="chat-send-btn">➤</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default App;