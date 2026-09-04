import React, { useState, useEffect, useRef } from 'react';
import { supabase } from './supabaseClient';
import './App.css';

function App() {
  const [projects, setProjects] = useState([]);
  const [allTasks, setAllTasks] = useState([]);
  const [finances, setFinances] = useState([]);
  const [pendingApprovalCount, setPendingApprovalCount] = useState(0);
  const [selectedProject, setSelectedProject] = useState(null);
  const [activeTab, setActiveTab] = useState('dashboard');
  const [projectTab, setProjectTab] = useState('idea');
  const [projectContent, setProjectContent] = useState([]);
  const [contentLoading, setContentLoading] = useState(false);
  const [contentFilter, setContentFilter] = useState('all');
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
    setProjects(projectsData || []);
    setAllTasks(tasksData || []);
    setFinances(financesData || []);
    setPendingApprovalCount(draftCount || 0);
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
    { id: 'posting', label: 'Постинг', icon: '📤' },
    { id: 'stats', label: 'Статистика', icon: '📊' },
    { id: 'finance', label: 'Финансы', icon: '💰' }
  ];

  return (
    <div className="app">
      <header className="header">
        <div className="logo">PONA DIGITAL</div>
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
          <button className={`nav-btn ${activeTab === 'finance' ? 'active' : ''}`} onClick={() => setActiveTab('finance')}>
            <span className="nav-emoji">💰</span> Финансы
          </button>
        </nav>
        <button onClick={handleLogout} className="logout-btn"><span className="nav-emoji">🚪</span> Выйти</button>
      </header>

      {activeTab === 'dashboard' ? (
        <div className="dashboard">
          <h1 className="dashboard-title">Общая картина</h1>
          {pendingApprovalCount > 0 && (
            <div className="approval-banner">
              📝 Ждут вашего утверждения: <strong>{pendingApprovalCount}</strong> {pendingApprovalCount === 1 ? 'пост' : 'постов'} — проверьте личные сообщения бота или раздел «Контент» нужного проекта.
            </div>
          )}
          <div className="stats-grid">
            <div className="stat-card"><img src="/icon/projects.png" alt="" className="stat-icon-img" /><span className="stat-value">{projects.length}</span><span className="stat-label">Проектов</span></div>
            <div className="stat-card"><img src="/icon/tasks.png" alt="" className="stat-icon-img" /><span className="stat-value">{totalTasks}</span><span className="stat-label">Всего задач</span></div>
            <div className="stat-card"><img src="/icon/todo.png" alt="" className="stat-icon-img" /><span className="stat-value">{todoCount}</span><span className="stat-label">Сделать</span></div>
            <div className="stat-card"><img src="/icon/progress.png" alt="" className="stat-icon-img" /><span className="stat-value">{inProgressCount}</span><span className="stat-label">В работе</span></div>
            <div className="stat-card"><img src="/icon/overdue.png" alt="" className="stat-icon-img" /><span className="stat-value">{overdueCount}</span><span className="stat-label">Просрочено</span></div>
            <div className="stat-card"><img src="/icon/done.png" alt="" className="stat-icon-img" /><span className="stat-value">{doneCount}</span><span className="stat-label">Готово</span></div>
            <div className="stat-card"><img src="/icon/chart.png" alt="" className="stat-icon-img" /><span className="stat-value">{completionRate}%</span><span className="stat-label">Выполнение</span></div>
            <div className="stat-card"><img src="/icon/money.png" alt="" className="stat-icon-img" /><span className="stat-value">{balance} ₽</span><span className="stat-label">Баланс</span></div>
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
          <div className="finance-actions">
            <button onClick={() => createFinance('income')} className="finance-btn income-btn">➕ Доход</button>
            <button onClick={() => createFinance('expense')} className="finance-btn expense-btn">➖ Расход</button>
          </div>
          <div className="finance-list">
            {finances.length === 0 && <p className="empty">Нет финансовых операций</p>}
            {finances.map((f) => (
              <div key={f.id} className="finance-item">
                <span className={`finance-type ${f.type === 'income' ? 'income' : 'expense'}`}>{f.type === 'income' ? '💰' : '💸'}</span>
                <span className="finance-desc">{f.description}</span>
                <span className={`finance-amount ${f.type === 'income' ? 'income' : 'expense'}`}>{f.type === 'income' ? '+' : '−'}{f.amount} ₽</span>
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
                      onClick={() => setProjectTab(tab.id)}
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
                    </div>
                    {contentLoading && <p className="empty">Загрузка...</p>}
                    <div className="content-list">
                      {!contentLoading && projectContent.filter(c => contentFilter === 'all' || c.platform === contentFilter).length === 0 && (
                        <p className="empty">Постов пока нет</p>
                      )}
                      {projectContent.filter(c => contentFilter === 'all' || c.platform === contentFilter).map((item) => {
                        const platform = getPlatformInfo(item.platform);
                        return (
                          <div key={item.id} className="content-item">
                            <span className="content-platform">{platform.icon} {platform.label}{!platform.live && <span className="content-platform-badge">черновик до API</span>}</span>
                            {item.media_url && <img className="content-thumb" src={item.media_url} alt="" />}
                            <div className="content-body">
                              <span className="content-title">{item.title}</span>
                              <span className="content-text">{item.body}</span>
                              {item.scheduled_at && <span className="content-text">📅 {new Date(item.scheduled_at).toLocaleString('ru-RU')}</span>}
                            </div>
                            <span className={`content-status status-${item.status}`}>{getContentStatusLabel(item.status)}</span>
                            <div className="content-actions">
                              {item.status === 'draft' && <button className="content-action-btn" onClick={() => scheduleContentItem(item)}>⏳ В очередь</button>}
                              {(item.status === 'scheduled' || item.status === 'failed') && <button className="content-action-btn" onClick={() => publishNow(item)}>🚀 Опубликовать</button>}
                              <button className="content-action-btn delete" onClick={() => deleteContentItem(item.id)}>🗑️</button>
                            </div>
                          </div>
                        );
                      })}
                    </div>
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
                              {item.status !== 'published' && (
                                <div className="content-actions">
                                  <button className="content-action-btn" onClick={() => publishNow(item)}>🚀 Сейчас</button>
                                </div>
                              )}
                            </div>
                          );
                        })}
                    </div>
                  </div>
                )}

                {projectTab === 'stats' && (
                  <div className="project-section">
                    <h3>📊 Статистика</h3>
                    <p className="section-desc">Подписчики, просмотры, лайки, комментарии</p>
                    <div className="section-placeholder">
                      <p>Здесь будет статистика по всем метрикам</p>
                      <button className="section-btn">📊 Обновить данные</button>
                    </div>
                  </div>
                )}

                {projectTab === 'finance' && (
                  <div className="project-section">
                    <h3>💰 Финансы проекта</h3>
                    <p className="section-desc">Реклама, заработок, монетизация</p>
                    <div className="section-placeholder">
                      <p>Здесь будет финансовая информация проекта</p>
                      <button className="section-btn">➕ Добавить доход</button>
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