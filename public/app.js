// 解梦 PWA 前端逻辑
(() => {
  'use strict';

  const $ = (sel) => document.querySelector(sel);
  const STORAGE_KEY = 'dream-journal-v1';
  const STYLE_NAMES = { both: '综合', psych: '心理学', zhougong: '周公解梦' };

  // ---------- 安全的迷你 Markdown 渲染（先转义 HTML，再处理格式） ----------
  function escapeHtml(s) {
    return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }
  function inline(s) {
    return s
      .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
      .replace(/(^|[^*])\*([^*\n]+)\*/g, '$1<em>$2</em>');
  }
  function renderMarkdown(md) {
    const lines = escapeHtml(md).split('\n');
    let html = '';
    let list = null; // 'ul' | 'ol'
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

  // ---------- 梦境日记（localStorage） ----------
  function loadJournal() {
    try { return JSON.parse(localStorage.getItem(STORAGE_KEY)) || []; } catch { return []; }
  }
  function saveJournal(list) {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(list.slice(0, 200)));
  }

  // ---------- 标签页 ----------
  const tabs = { new: $('#tab-new'), history: $('#tab-history') };
  const panels = { new: $('#panel-new'), history: $('#panel-history') };
  function showTab(name) {
    for (const key of Object.keys(tabs)) {
      const active = key === name;
      tabs[key].classList.toggle('active', active);
      tabs[key].setAttribute('aria-selected', String(active));
      panels[key].hidden = !active;
    }
    if (name === 'history') renderHistory();
  }
  tabs.new.addEventListener('click', () => showTab('new'));
  tabs.history.addEventListener('click', () => showTab('history'));

  // ---------- 表单 ----------
  const input = $('#dream-input');
  const charCount = $('#char-count');
  const form = $('#dream-form');
  const submitBtn = $('#submit-btn');
  const formError = $('#form-error');
  const result = $('#result');
  const resultBody = $('#result-body');
  const resultLoading = $('#result-loading');
  const resultActions = $('#result-actions');
  let selectedMood = '';
  let lastText = '';

  // 草稿自动保存，防止误关页面
  input.value = localStorage.getItem('dream-draft') || '';
  charCount.textContent = input.value.length;
  input.addEventListener('input', () => {
    charCount.textContent = input.value.length;
    localStorage.setItem('dream-draft', input.value);
  });

  $('#mood-chips').addEventListener('click', (e) => {
    const chip = e.target.closest('.chip');
    if (!chip) return;
    const already = chip.getAttribute('aria-pressed') === 'true';
    document.querySelectorAll('#mood-chips .chip').forEach((c) => c.setAttribute('aria-pressed', 'false'));
    chip.setAttribute('aria-pressed', String(!already));
    selectedMood = already ? '' : chip.dataset.mood;
  });
  document.querySelectorAll('#mood-chips .chip').forEach((c) => c.setAttribute('aria-pressed', 'false'));

  // ---------- 访问密码弹窗 ----------
  const CODE_KEY = 'dream-access-code';
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

  function showError(msg) {
    formError.textContent = msg;
    formError.hidden = !msg;
  }

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const dream = input.value.trim();
    const style = form.querySelector('input[name="style"]:checked').value;
    if (dream.length < 5) return showError('梦境描述太短了，多写一点细节吧');
    showError('');

    submitBtn.disabled = true;
    submitBtn.textContent = '🔮 正在解读…';
    result.hidden = false;
    resultBody.innerHTML = '';
    resultActions.hidden = true;
    resultLoading.hidden = false;
    result.scrollIntoView({ behavior: 'smooth', block: 'start' });

    let text = '';
    try {
      const send = () => fetch('/api/interpret', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Access-Code': encodeURIComponent(localStorage.getItem(CODE_KEY) || ''),
        },
        body: JSON.stringify({ dream, style, mood: selectedMood }),
      });
      let resp = await send();
      // 需要访问密码：弹窗输入后自动重试，密码错误可反复输入
      while (resp.status === 401) {
        const data = await resp.json().catch(() => ({}));
        if (data.code !== 'NEED_CODE') throw new Error(data.error || '没有权限');
        const code = await askCode(data.error);
        if (!code) throw new Error('需要访问密码才能解梦');
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
        resultBody.innerHTML = renderMarkdown(text);
      }
      if (!text.trim()) throw new Error('没有收到解读内容，请稍后再试');

      lastText = text;
      const journal = loadJournal();
      journal.unshift({ id: Date.now(), date: new Date().toISOString(), dream, mood: selectedMood, style, text });
      saveJournal(journal);
      localStorage.removeItem('dream-draft');
      resultActions.hidden = false;
    } catch (err) {
      const msg = navigator.onLine ? err.message : '网络已断开，联网后再试';
      if (!text) result.hidden = true;
      showError(msg);
    } finally {
      resultLoading.hidden = true;
      submitBtn.disabled = false;
      submitBtn.textContent = '✨ 开始解梦';
    }
  });

  $('#copy-btn').addEventListener('click', async () => {
    const btn = $('#copy-btn');
    try {
      await navigator.clipboard.writeText(lastText);
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
    window.scrollTo({ top: 0, behavior: 'smooth' });
    input.focus();
  });

  // ---------- 日记列表 ----------
  const historyList = $('#history-list');
  const dialog = $('#detail-dialog');
  let currentId = null;

  function formatDate(iso) {
    const d = new Date(iso);
    return d.toLocaleString('zh-CN', { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' });
  }

  function renderHistory() {
    const journal = loadJournal();
    historyList.innerHTML = '';
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
      meta.textContent = `${formatDate(item.date)} · ${STYLE_NAMES[item.style] || ''}${item.mood ? ' · ' + item.mood : ''}`;
      const preview = document.createElement('div');
      preview.className = 'preview';
      preview.textContent = item.dream;
      btn.append(meta, preview);
      btn.addEventListener('click', () => openDetail(item));
      li.append(btn);
      historyList.append(li);
    }
  }

  function openDetail(item) {
    currentId = item.id;
    $('#detail-meta').textContent = `${formatDate(item.date)} · ${STYLE_NAMES[item.style] || ''}${item.mood ? ' · 醒来感到' + item.mood : ''}`;
    $('#detail-dream').textContent = item.dream;
    $('#detail-body').innerHTML = renderMarkdown(item.text);
    dialog.showModal();
  }

  $('#detail-close').addEventListener('click', () => dialog.close());
  dialog.addEventListener('click', (e) => { if (e.target === dialog) dialog.close(); });
  $('#detail-delete').addEventListener('click', () => {
    if (!confirm('确定删除这条梦境记录吗？')) return;
    saveJournal(loadJournal().filter((x) => x.id !== currentId));
    dialog.close();
    renderHistory();
  });
  $('#clear-history').addEventListener('click', () => {
    if (!confirm('确定清空全部梦境日记吗？此操作不可恢复。')) return;
    saveJournal([]);
    renderHistory();
  });

  // ---------- Service Worker：注册 + 新版本自动刷新 ----------
  if ('serviceWorker' in navigator) {
    window.addEventListener('load', async () => {
      try {
        const reg = await navigator.serviceWorker.register('/sw.js', { updateViaCache: 'none' });
        reg.update();
        let refreshing = false;
        navigator.serviceWorker.addEventListener('controllerchange', () => {
          if (refreshing) return;
          refreshing = true;
          location.reload();
        });
      } catch (err) {
        console.warn('Service Worker 注册失败:', err);
      }
    });
  }
})();
