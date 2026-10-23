// 解梦 PWA 前端逻辑：本地词典解读（免费）+ 可选 AI 深度解读
(() => {
  'use strict';

  const DICT = window.DREAM_DICT || [];
  const MOOD_NOTES = window.MOOD_NOTES || {};
  const STORAGE_KEY = 'dream-journal-v1';
  const CODE_KEY = 'dream-access-code';
  const STYLE_NAMES = { both: '综合', psych: '心理学', zhougong: '周公解梦' };
  const BY_NAME = new Map(DICT.map((e) => [e[0], e]));

  // ================= 意象匹配 =================
  // 所有词（名称 + 别名）按长度降序，优先匹配长词，避免「火车」被拆成「火」
  // 带 * 的别名是通配词，如「被*追」可匹配「被狗追」，* 最多代表 6 个字
  const TERMS = [];
  const PATTERNS = [];
  const escRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  for (const entry of DICT) {
    for (const w of [entry[0], ...entry[1].split('|')]) {
      if (!w) continue;
      if (w.includes('*')) PATTERNS.push([new RegExp(w.split('*').map(escRe).join('[^，。！？,.!?\\s]{1,6}?'), 'g'), entry]);
      else TERMS.push([w, entry]);
    }
  }
  TERMS.sort((a, b) => b[0].length - a[0].length);
  // 前面带否定词的不算，例如「没有梦见蛇」
  const NEGATION = /(没有|没|不是|并没有|未曾|未|别)(梦见|梦到|看到|看见|遇到)?$/;

  function analyze(text) {
    const used = new Uint8Array(text.length);
    const found = new Map(); // 名称 -> { entry, pos }
    for (const [w, entry] of TERMS) {
      let from = 0;
      for (;;) {
        const i = text.indexOf(w, from);
        if (i < 0) break;
        from = i + 1;
        let free = true;
        for (let k = i; k < i + w.length; k++) if (used[k]) { free = false; break; }
        if (!free) continue;
        used.fill(1, i, i + w.length);
        if (NEGATION.test(text.slice(Math.max(0, i - 6), i))) continue;
        const prev = found.get(entry[0]);
        if (!prev || i < prev.pos) found.set(entry[0], { entry, pos: i });
      }
    }
    // 通配词可以跨过已匹配的词（「被狗追」里的「狗」）
    for (const [re, entry] of PATTERNS) {
      re.lastIndex = 0;
      let m;
      while ((m = re.exec(text))) {
        if (NEGATION.test(text.slice(Math.max(0, m.index - 6), m.index))) continue;
        const prev = found.get(entry[0]);
        if (!prev || m.index < prev.pos) found.set(entry[0], { entry, pos: m.index });
      }
    }
    // 按在梦中出现的顺序排列
    return [...found.values()].sort((a, b) => a.pos - b.pos).map((x) => x.entry);
  }

  // ================= 渲染工具 =================
  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }
  function inline(s) {
    return s
      .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
      .replace(/(^|[^*])\*([^*\n]+)\*/g, '$1<em>$2</em>');
  }
  // 安全的迷你 Markdown：先整体转义，再加格式
  function renderMarkdown(md) {
    const lines = escapeHtml(md).split('\n');
    let html = '';
    let list = null;
    const closeList = () => { if (list) { html += `</${list}>`; list = null; } };
    for (const raw of lines) {
      const line = raw.trim();
      let m;
      if (!line) { closeList(); continue; }
      if ((m = line.match(/^#{1,6}\s+(.*)$/))) { closeList(); html += `<h3>${inline(m[1])}</h3>`; continue; }
      if ((m = line.match(/^[-*•]\s+(.*)$/))) {
        if (list !== 'ul') { closeList(); html += '<ul>'; list = 'ul'; }
        html += `<li>${inline(m[1])}</li>`; continue;
      }
      if ((m = line.match(/^\d+[.)、]\s*(.*)$/))) {
        if (list !== 'ol') { closeList(); html += '<ol>'; list = 'ol'; }
        html += `<li>${inline(m[1])}</li>`; continue;
      }
      if ((m = line.match(/^&gt;\s?(.*)$/))) { closeList(); html += `<blockquote>${inline(m[1])}</blockquote>`; continue; }
      closeList();
      html += `<p>${inline(line)}</p>`;
    }
    closeList();
    return html;
  }

  function symbolHtml(entry, style) {
    const [name, , cat, zg, psy] = entry;
    let body = '';
    if (style !== 'psych') body += `<p><span class="k">周公说：</span>${escapeHtml(zg)}</p>`;
    if (style !== 'zhougong') body += `<p><span class="k">心理学：</span>${escapeHtml(psy)}</p>`;
    return `<div class="symbol"><div class="symbol-head"><span class="symbol-name">${escapeHtml(name)}</span><span class="tag">${escapeHtml(cat)}</span></div>${body}</div>`;
  }

  function renderLocal(entries, style, mood) {
    let html = '';
    if (entries.length) {
      html += `<h3 class="section-title">梦里的 ${entries.length} 个意象</h3>`;
      html += entries.map((e) => symbolHtml(e, style)).join('');
    } else {
      html += '<h3 class="section-title">梦里的意象</h3>';
      html += '<p class="empty-tip">词典里暂时没找到熟悉的意象。可以试着写得更具体一点（比如出现了什么动物、在什么地方、做了什么），或者用下面的 AI 深度解读。</p>';
    }
    if (mood && MOOD_NOTES[mood]) html += `<div class="note">💭 ${escapeHtml(MOOD_NOTES[mood])}</div>`;
    return html;
  }

  function localPlainText(entries, style, mood) {
    const parts = entries.map(([name, , , zg, psy]) => {
      let s = `【${name}】`;
      if (style !== 'psych') s += `\n周公说：${zg}`;
      if (style !== 'zhougong') s += `\n心理学：${psy}`;
      return s;
    });
    if (mood && MOOD_NOTES[mood]) parts.push(MOOD_NOTES[mood]);
    return parts.join('\n\n');
  }

  // ================= 日记存储 =================
  function loadJournal() {
    try { return JSON.parse(localStorage.getItem(STORAGE_KEY)) || []; } catch { return []; }
  }
  function saveJournal(list) {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(list.slice(0, 300)));
    } catch {
      alert('手机存储空间不足，日记没能保存');
    }
  }
  function entriesOf(item) {
    // 旧记录没有 keys 字段时，按梦境文本重新匹配
    if (Array.isArray(item.keys)) return item.keys.map((k) => BY_NAME.get(k)).filter(Boolean);
    return analyze(item.dream);
  }

  const $ = (sel) => document.querySelector(sel);

  // ================= 底部导航 =================
  const navItems = document.querySelectorAll('.nav-item');
  function showTab(name) {
    navItems.forEach((btn) => {
      const active = btn.dataset.tab === name;
      btn.classList.toggle('active', active);
      btn.setAttribute('aria-selected', String(active));
      $('#panel-' + btn.dataset.tab).hidden = !active;
    });
    if (name === 'history') renderHistory();
    if (name === 'dict') renderDict();
    window.scrollTo({ top: 0 });
  }
  navItems.forEach((btn) => btn.addEventListener('click', () => showTab(btn.dataset.tab)));

  // ================= AI 是否可用 =================
  // 部署在纯静态托管上时没有后端，AI 按钮自动隐藏
  let aiAvailable = false;
  const aiReady = fetch('api/health', { cache: 'no-store' })
    .then((r) => (r.ok ? r.json() : null))
    .then((d) => { aiAvailable = !!(d && d.ai); })
    .catch(() => { aiAvailable = false; });

  // ================= 解梦表单 =================
  const form = $('#dream-form');
  const input = $('#dream-input');
  const charCount = $('#char-count');
  const formError = $('#form-error');
  const result = $('#result');
  let selectedMood = '';
  let current = null; // 当前这次解梦 { id, dream, mood, style, entries, aiText }

  input.value = localStorage.getItem('dream-draft') || '';
  charCount.textContent = input.value.length;
  input.addEventListener('input', () => {
    charCount.textContent = input.value.length;
    localStorage.setItem('dream-draft', input.value);
  });

  const chips = document.querySelectorAll('#mood-chips .chip');
  chips.forEach((c) => c.setAttribute('aria-pressed', 'false'));
  $('#mood-chips').addEventListener('click', (e) => {
    const chip = e.target.closest('.chip');
    if (!chip) return;
    const already = chip.getAttribute('aria-pressed') === 'true';
    chips.forEach((c) => c.setAttribute('aria-pressed', 'false'));
    chip.setAttribute('aria-pressed', String(!already));
    selectedMood = already ? '' : chip.dataset.mood;
  });

  function showError(msg) {
    formError.textContent = msg;
    formError.hidden = !msg;
  }

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const dream = input.value.trim();
    const style = form.querySelector('input[name="style"]:checked').value;
    if (dream.length < 2) return showError('先写下你的梦吧');
    showError('');
    input.blur(); // 收起手机键盘

    const entries = analyze(dream);
    current = { id: Date.now(), dream, mood: selectedMood, style, entries, aiText: '' };

    $('#local-body').innerHTML = renderLocal(entries, style, selectedMood);
    $('#ai-wrap').hidden = true;
    $('#ai-body').innerHTML = '';
    $('#ai-btn').hidden = false;
    $('#ai-btn').disabled = false;
    $('#ai-hint').hidden = false;
    result.hidden = false;

    await aiReady;
    $('#ai-section').hidden = !aiAvailable;
    result.scrollIntoView({ behavior: 'smooth', block: 'start' });

    const journal = loadJournal();
    journal.unshift({
      id: current.id, date: new Date().toISOString(), dream, mood: selectedMood, style,
      keys: entries.map((x) => x[0]), text: '',
    });
    saveJournal(journal);
    localStorage.removeItem('dream-draft');
  });

  // ================= AI 深度解读 =================
  const codeDialog = $('#code-dialog');
  const codeInput = $('#code-input');
  function askCode(hint) {
    return new Promise((resolve) => {
      $('#code-hint').textContent = hint || '输入一次后会记在这台设备上';
      codeInput.value = '';
      const finish = (val) => {
        codeDialog.removeEventListener('close', onClose);
        $('#code-form').removeEventListener('submit', onSubmit);
        $('#code-cancel').removeEventListener('click', onCancel);
        if (codeDialog.open) codeDialog.close();
        resolve(val);
      };
      const onSubmit = (e) => { e.preventDefault(); finish(codeInput.value.trim()); };
      const onCancel = () => finish('');
      const onClose = () => finish('');
      $('#code-form').addEventListener('submit', onSubmit);
      $('#code-cancel').addEventListener('click', onCancel);
      codeDialog.addEventListener('close', onClose);
      codeDialog.showModal();
      codeInput.focus();
    });
  }

  $('#ai-btn').addEventListener('click', async () => {
    if (!current) return;
    const btn = $('#ai-btn');
    const body = $('#ai-body');
    const loading = $('#ai-loading');
    btn.disabled = true;
    btn.textContent = '🔮 正在解读…';
    $('#ai-wrap').hidden = false;
    body.innerHTML = '';
    loading.hidden = false;

    let text = '';
    try {
      const send = () => fetch('api/interpret', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Access-Code': encodeURIComponent(localStorage.getItem(CODE_KEY) || ''),
        },
        body: JSON.stringify({ dream: current.dream, style: current.style, mood: current.mood }),
      });
      let resp = await send();
      while (resp.status === 401) {
        const data = await resp.json().catch(() => ({}));
        if (data.code !== 'NEED_CODE') throw new Error(data.error || '没有权限');
        const code = await askCode(data.error);
        if (!code) throw new Error('需要访问密码才能使用 AI 解读');
        localStorage.setItem(CODE_KEY, code);
        resp = await send();
      }
      if (!resp.ok) {
        const data = await resp.json().catch(() => ({}));
        throw new Error(data.error || `请求失败（${resp.status}）`);
      }
      const reader = resp.body.getReader();
      const decoder = new TextDecoder();
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        text += decoder.decode(value, { stream: true });
        body.innerHTML = renderMarkdown(text);
      }
      if (!text.trim()) throw new Error('没有收到解读内容，请稍后再试');

      current.aiText = text;
      const journal = loadJournal();
      const item = journal.find((x) => x.id === current.id);
      if (item) { item.text = text; saveJournal(journal); }
      btn.hidden = true;
      $('#ai-hint').hidden = true;
    } catch (err) {
      const msg = navigator.onLine ? err.message : '网络已断开，联网后再试';
      if (!text) $('#ai-wrap').hidden = true;
      $('#ai-hint').textContent = '⚠️ ' + msg;
      btn.disabled = false;
      btn.textContent = '✨ 重试 AI 深度解读';
    } finally {
      loading.hidden = true;
    }
  });

  $('#copy-btn').addEventListener('click', async () => {
    if (!current) return;
    const btn = $('#copy-btn');
    let txt = `我的梦：${current.dream}\n\n${localPlainText(current.entries, current.style, current.mood)}`;
    if (current.aiText) txt += `\n\n—— AI 深度解读 ——\n${current.aiText}`;
    try {
      await navigator.clipboard.writeText(txt);
      btn.textContent = '✅ 已复制';
    } catch {
      btn.textContent = '复制失败';
    }
    setTimeout(() => { btn.textContent = '📋 复制'; }, 1500);
  });

  $('#again-btn').addEventListener('click', () => {
    input.value = '';
    charCount.textContent = '0';
    result.hidden = true;
    current = null;
    window.scrollTo({ top: 0, behavior: 'smooth' });
    input.focus();
  });

  // ================= 词典页 =================
  const CATS = ['全部', ...new Set(DICT.map((e) => e[2]))];
  let dictCat = '全部';
  let dictBuilt = false;
  const dictSearch = $('#dict-search');

  function renderDict() {
    if (!dictBuilt) {
      $('#dict-cats').innerHTML = CATS.map((c) =>
        `<button type="button" class="chip" data-cat="${escapeHtml(c)}" aria-pressed="${c === dictCat}">${escapeHtml(c)}</button>`).join('');
      dictBuilt = true;
    }
    const q = dictSearch.value.trim();
    const list = DICT.filter((e) =>
      (dictCat === '全部' || e[2] === dictCat) &&
      (!q || e[0].includes(q) || e[1].includes(q) || e[3].includes(q) || e[4].includes(q)));
    $('#dict-count').textContent = `共 ${list.length} 个意象`;
    $('#dict-list').innerHTML = list.map(([name, alias, cat, zg, psy]) => `
      <details class="dict-item">
        <summary><strong>${escapeHtml(name)}</strong><span class="tag">${escapeHtml(cat)}</span></summary>
        <div class="dict-body">
          ${alias ? `<p class="alias">也包括：${escapeHtml(alias.split('|').filter((w) => !w.includes('*')).join('、'))}</p>` : ''}
          <p><span class="k">周公说：</span>${escapeHtml(zg)}</p>
          <p><span class="k">心理学：</span>${escapeHtml(psy)}</p>
        </div>
      </details>`).join('') || '<p class="muted center">没有找到，换个词试试</p>';
  }
  dictSearch.addEventListener('input', renderDict);
  $('#dict-cats').addEventListener('click', (e) => {
    const chip = e.target.closest('.chip');
    if (!chip) return;
    dictCat = chip.dataset.cat;
    document.querySelectorAll('#dict-cats .chip').forEach((c) => c.setAttribute('aria-pressed', String(c === chip)));
    renderDict();
  });

  // ================= 日记页 =================
  const dialog = $('#detail-dialog');
  let detailId = null;

  function formatDate(iso) {
    return new Date(iso).toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' });
  }

  function renderHistory() {
    const journal = loadJournal();
    const list = $('#history-list');
    list.innerHTML = '';
    $('#history-empty').hidden = journal.length > 0;
    $('#clear-history').hidden = journal.length === 0;
    $('#history-count').textContent = journal.length ? `共 ${journal.length} 个梦` : '';
    for (const item of journal) {
      const li = document.createElement('li');
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'history-item';
      const meta = document.createElement('div');
      meta.className = 'meta';
      meta.textContent = `${formatDate(item.date)}${item.mood ? ' · ' + item.mood : ''}${item.text ? ' · ✨AI' : ''}`;
      const preview = document.createElement('div');
      preview.className = 'preview';
      preview.textContent = item.dream;
      btn.append(meta, preview);
      const keys = entriesOf(item).slice(0, 6);
      if (keys.length) {
        const wrap = document.createElement('div');
        wrap.className = 'keys';
        for (const k of keys) {
          const tag = document.createElement('span');
          tag.className = 'tag';
          tag.textContent = k[0];
          wrap.append(tag);
        }
        btn.append(wrap);
      }
      btn.addEventListener('click', () => openDetail(item));
      li.append(btn);
      list.append(li);
    }
  }

  function openDetail(item) {
    detailId = item.id;
    $('#detail-meta').textContent =
      `${new Date(item.date).toLocaleString('zh-CN')} · ${STYLE_NAMES[item.style] || ''}${item.mood ? ' · 醒来感到' + item.mood : ''}`;
    $('#detail-dream').textContent = item.dream;
    $('#detail-local').innerHTML = renderLocal(entriesOf(item), item.style, item.mood);
    $('#detail-ai').hidden = !item.text;
    $('#detail-ai-body').innerHTML = item.text ? renderMarkdown(item.text) : '';
    dialog.showModal();
    dialog.scrollTop = 0;
  }

  $('#detail-close').addEventListener('click', () => dialog.close());
  dialog.addEventListener('click', (e) => { if (e.target === dialog) dialog.close(); });
  $('#detail-delete').addEventListener('click', () => {
    if (!confirm('确定删除这条梦境记录吗？')) return;
    saveJournal(loadJournal().filter((x) => x.id !== detailId));
    dialog.close();
    renderHistory();
  });
  $('#clear-history').addEventListener('click', () => {
    if (!confirm('确定清空全部梦境日记吗？此操作不可恢复。')) return;
    saveJournal([]);
    renderHistory();
  });

  // ================= Service Worker：注册 + 新版本自动刷新 =================
  if ('serviceWorker' in navigator) {
    window.addEventListener('load', async () => {
      try {
        // 首次安装时没有旧版本，不需要刷新；只有新版本替换旧版本时才刷新
        const hadController = !!navigator.serviceWorker.controller;
        const reg = await navigator.serviceWorker.register('sw.js', { updateViaCache: 'none' });
        reg.update();
        let refreshing = false;
        navigator.serviceWorker.addEventListener('controllerchange', () => {
          if (!hadController || refreshing) return;
          refreshing = true;
          location.reload();
        });
      } catch (err) {
        console.warn('Service Worker 注册失败:', err);
      }
    });
  }

  // 供测试用
  window.__dream = { analyze };
})();
