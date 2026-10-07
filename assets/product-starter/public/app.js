(() => {
  'use strict';

  const $ = id => document.getElementById(id);
  const activeStatuses = new Set(['running', 'cancelling']);
  const statusLabels = { running: '分析中', cancelling: '正在取消', completed: '已完成', cancelled: '已取消', failed: '失败', interrupted: '已中断' };
  const recordStatusLabels = { new: '待处理', reviewed: '已审阅', resolved: '已解决' };
  let state = null;
  let selectedIds = new Set();
  let viewedRunId = null;
  let connection = null;
  let connectedRunId = null;
  let reconnectTimer = null;
  let refreshRequest = null;
  let starting = false;
  let cancelling = false;
  let uncertainStart = null;
  let editingId = null;
  let savingRecord = false;
  let pendingDeleteId = null;
  let deletingRecord = false;
  let createRequestId = null;
  const runActivity = new Map();
  const runPreview = new Map();
  const lastEventIds = new Map();
  const dateFormatter = new Intl.DateTimeFormat('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' });
  const timeFormatter = new Intl.DateTimeFormat('zh-CN', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false });

  function element(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = String(text);
    return node;
  }

  function textValue(value) {
    if (value === undefined || value === null) return '';
    return typeof value === 'string' ? value : JSON.stringify(value, null, 2);
  }

  function formatDate(value, timeOnly = false) {
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? '时间未知' : (timeOnly ? timeFormatter : dateFormatter).format(date);
  }

  function modeLabel(mode) { return mode === 'offline' ? '离线验证' : mode === 'platform' ? '真实平台' : '模式未知'; }
  function activeRun() { return state?.runs.find(run => run.id === state.activeRunId && activeStatuses.has(run.status)); }
  function viewedRun() { return state?.runs.find(run => run.id === viewedRunId); }
  function uuid() { return crypto.randomUUID(); }

  function showMessage(message, kind = '') {
    $('page-message').textContent = message;
    $('page-message').className = 'message' + (kind ? ' ' + kind : '');
    $('page-message').hidden = !message;
  }

  function setConnection(online, message) {
    $('connection-dot').className = 'connection-dot ' + (online ? 'online' : 'offline');
    $('connection-status').textContent = message;
  }

  async function api(path, options = {}) {
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), 15000);
    try {
      const response = await fetch(path, {
        ...options,
        cache: 'no-store',
        signal: controller.signal,
        headers: options.body ? { 'Content-Type': 'application/json', ...options.headers } : options.headers
      });
      let data;
      try { data = await response.json(); } catch {
        const error = new Error('本机服务返回了无法读取的响应，请重新读取状态。');
        error.status = response.status >= 400 ? response.status : 0;
        throw error;
      }
      if (!response.ok) {
        const error = new Error(data.error?.message || (typeof data.error === 'string' ? data.error : data.message) || '操作未完成，请稍后重试。');
        error.status = response.status;
        error.code = data.error?.code;
        throw error;
      }
      return data;
    } catch (error) {
      if (!error.status) {
        error.message = error.name === 'AbortError' ? '本机服务响应超时，尚不能确认操作结果。' : '无法连接本机服务。请确认服务正在运行，再重新读取状态。';
      }
      throw error;
    } finally { window.clearTimeout(timeout); }
  }

  function putRun(run) {
    if (!state || !run?.id) return;
    const index = state.runs.findIndex(item => item.id === run.id);
    if (index < 0) state.runs.unshift(run);
    else state.runs[index] = run;
    if (activeStatuses.has(run.status)) state.activeRunId = run.id;
    else if (state.activeRunId === run.id) state.activeRunId = null;
  }

  async function refreshState({ quiet = false } = {}) {
    if (refreshRequest) return refreshRequest;
    $('refresh-state').disabled = true;
    refreshRequest = (async () => {
      try {
        const next = await api('/api/state');
        if (!next.product || !Array.isArray(next.records) || !Array.isArray(next.runs)) throw new Error('工作台状态不完整。');
        state = next;
        const existing = new Set(state.records.map(record => record.id));
        selectedIds = new Set([...selectedIds].filter(id => existing.has(id)));
        const existingRuns = new Set(state.runs.map(run => run.id));
        for (const cache of [runActivity, runPreview, lastEventIds]) {
          for (const id of cache.keys()) if (!existingRuns.has(id)) cache.delete(id);
        }
        if (uncertainStart) {
          const recovered = state.runs.find(run => !uncertainStart.knownIds.has(run.id));
          if (recovered) {
            viewedRunId = recovered.id;
            uncertainStart = null;
            showMessage('已找回刚才提交的分析。将继续显示这一次的状态。');
          }
        }
        if (!state.runs.some(run => run.id === viewedRunId)) {
          const latest = [...state.runs].sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))[0];
          viewedRunId = state.activeRunId || latest?.id || null;
        }
        $('last-synced').textContent = '最近同步 ' + formatDate(Date.now(), true);
        setConnection(true, '本机服务已连接');
        render();
        syncEventStream();
        return true;
      } catch (error) {
        setConnection(false, '连接中断 · 可重新读取');
        if (!quiet) showMessage(error.message, 'error');
        if (!state) renderLoadError();
        return false;
      } finally {
        refreshRequest = null;
        $('refresh-state').disabled = false;
      }
    })();
    return refreshRequest;
  }

  function renderLoadError() {
    const box = element('div', 'empty-state');
    box.append(element('span', 'empty-symbol', '↻'), element('h3', '', '暂时无法读取工作台'), element('p', '', '请确认本机服务正在运行，点击右上角刷新按钮重新连接。现有数据不会因页面断线被清除。'));
    $('record-list').replaceChildren(box);
  }

  function render() {
    const product = state.product;
    const offline = product.mode === 'offline';
    $('product-name').textContent = product.name || '反馈工作台';
    document.title = (product.name || '反馈工作台') + ' · 本机工作区';
    $('product-description').textContent = product.description || '收集真实反馈，选择本轮记录，再检查分析与原文依据。';
    $('mode-badge').textContent = modeLabel(product.mode) + ' · 单用户本机';
    $('mode-badge').className = 'badge' + (offline ? '' : ' success');
    $('mode-notice').className = 'mode-notice ' + (offline ? 'offline' : 'live');
    $('mode-description').textContent = offline
      ? '当前运行离线规则流程，不会调用 AI 模型；结果仅用于检查产品流程。'
      : '分析会通过已配置的 Tansr 平台调用模型，授权读取的反馈将发送给该服务。';
    $('configuration-message').hidden = product.configuration?.ready !== false;
    $('configuration-message').textContent = product.configuration?.message || '分析配置尚未就绪。请在服务端完成配置后重新读取状态；仍可管理反馈。';
    $('record-count').textContent = String(state.records.length);
    $('nav-count').textContent = String(state.records.length);
    $('completed-count').textContent = String(state.runs.filter(run => run.status === 'completed').length);
    $('add-record').disabled = false;
    renderRecords();
    renderSelection();
    renderRun();
    renderHistory();
  }

  function visibleRecords() {
    const query = $('record-search').value.trim().toLocaleLowerCase();
    const filter = $('record-filter').value;
    return (state?.records || []).filter(record => {
      const matchesText = !query || [record.title, record.content, record.source].some(value => String(value || '').toLocaleLowerCase().includes(query));
      return matchesText && (filter === 'all' || (record.status || 'new') === filter);
    }).sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  }

  function renderRecords() {
    const records = visibleRecords();
    $('list-count').textContent = String(records.length);
    if (!records.length) {
      const hasRecords = state.records.length > 0;
      const box = element('div', 'empty-state');
      const symbol = element('span', 'empty-symbol', hasRecords ? '⌕' : '▤');
      symbol.setAttribute('aria-hidden', 'true');
      box.append(symbol, element('h3', '', hasRecords ? '没有匹配的反馈' : '从第一条真实反馈开始'), element('p', '', hasRecords ? '换一个关键词或处理状态，不会影响已经选择的记录。' : '把访谈、客服或使用过程中收到的反馈记在这里。保留原文，才有可靠的分析起点。'));
      if (!hasRecords) {
        const button = element('button', 'button secondary', '添加第一条反馈');
        button.type = 'button';
        button.addEventListener('click', () => openRecordDialog());
        box.append(button);
      }
      $('record-list').replaceChildren(box);
      return;
    }
    const fragment = document.createDocumentFragment();
    for (const record of records) {
      const card = element('article', 'record-card' + (selectedIds.has(record.id) ? ' selected' : ''));
      card.dataset.recordId = record.id;
      const top = element('div', 'record-card-top');
      const checkbox = element('input');
      checkbox.type = 'checkbox';
      checkbox.id = 'choose-' + record.id;
      checkbox.checked = selectedIds.has(record.id);
      checkbox.addEventListener('change', () => {
        if (checkbox.checked && selectedIds.size >= 50) {
          checkbox.checked = false;
          showMessage('每轮最多分析 50 条反馈，请先取消其他选择。', 'warning');
          return;
        }
        if (checkbox.checked) selectedIds.add(record.id);
        else selectedIds.delete(record.id);
        card.classList.toggle('selected', checkbox.checked);
        renderSelection();
      });
      const main = element('div', 'record-card-main');
      const title = element('h3');
      const label = element('label', '', record.title);
      label.htmlFor = checkbox.id;
      title.append(label);
      const meta = element('div', 'record-meta');
      meta.append(element('span', '', record.source || '未填写来源'), element('span', '', '·'), element('time', '', formatDate(record.createdAt)), element('span', 'record-status ' + (record.status || 'new'), recordStatusLabels[record.status] || '待处理'));
      main.append(title, meta);
      top.append(checkbox, main);
      card.append(top, element('p', 'record-content', record.content));
      const bottom = element('div', 'record-card-bottom');
      const tags = element('div', 'record-tags');
      if (record.category) tags.append(element('span', '', record.category));
      if (record.priority) tags.append(element('span', '', record.priority));
      if (!tags.childElementCount) tags.append(element('span', '', '保留原始反馈'));
      const actions = element('div', 'record-actions');
      const edit = element('button', 'text-button', '编辑');
      edit.type = 'button';
      edit.setAttribute('aria-label', '编辑反馈：' + record.title);
      edit.addEventListener('click', () => openRecordDialog(record));
      const remove = element('button', 'text-button delete-action', '删除');
      remove.type = 'button';
      remove.setAttribute('aria-label', '删除反馈：' + record.title);
      remove.addEventListener('click', () => openDeleteDialog(record));
      actions.append(edit, remove);
      bottom.append(tags, actions);
      card.append(bottom);
      fragment.append(card);
    }
    $('record-list').replaceChildren(fragment);
  }

  function renderSelection() {
    const count = selectedIds.size;
    const visible = visibleRecords();
    const visibleSelected = visible.filter(record => selectedIds.has(record.id)).length;
    $('selection-count').textContent = String(count);
    $('select-visible').disabled = !visible.length;
    $('select-visible').checked = visible.length > 0 && visibleSelected === visible.length;
    $('select-visible').indeterminate = visibleSelected > 0 && visibleSelected < visible.length;
    $('clear-selection').disabled = !count;
    const hiddenCount = count - visibleSelected;
    $('selection-hint').textContent = hiddenCount > 0
      ? '已选 ' + count + ' 条，其中 ' + hiddenCount + ' 条不在当前筛选中。每轮最多 50 条。'
      : '每轮最多选择 50 条反馈。分析不会自动修改原文。';
    const running = activeRun();
    $('start-analysis').disabled = !state || !count || !!running || starting || !!uncertainStart || state.product.configuration?.ready === false;
    $('start-label').textContent = starting ? '正在提交…' : state?.product.mode === 'offline' ? '运行离线分析' : '开始分析';
    $('analysis-action-label').textContent = running ? '本轮分析正在进行' : uncertainStart ? '正在确认上一次提交' : count ? '已选择 ' + count + ' 条反馈' : '准备好本轮反馈';
    $('analysis-action-hint').textContent = running ? '可继续整理反馈；当前任务完成后再开始下一轮。' : uncertainStart ? '请重新读取状态；不会自动再次提交分析。' : count ? '只分析所选原文，完成后请核对结果依据。' : '在左侧选择要分析的记录。';
  }

  function badgeClass(status) {
    if (status === 'completed') return 'badge success';
    if (status === 'failed' || status === 'interrupted') return 'badge failed';
    return activeStatuses.has(status) ? 'badge running' : 'badge neutral';
  }

  function renderRun() {
    const run = viewedRun();
    $('run-view').hidden = !run;
    $('analysis-empty').hidden = !!run;
    $('run-status').textContent = run ? (statusLabels[run.status] || run.status) : '尚未开始';
    $('run-status').className = run ? badgeClass(run.status) : 'badge neutral';
    if (!run) return;
    const isActive = activeStatuses.has(run.status);
    const isCurrent = activeRun()?.id === run.id;
    $('run-time').textContent = formatDate(run.createdAt) + ' · ' + (run.recordIds?.length || 0) + ' 条反馈';
    $('run-mode').textContent = modeLabel(run.mode);
    $('run-mode').className = 'badge' + (run.mode === 'offline' ? '' : ' success');
    $('cancel-analysis').hidden = !isCurrent;
    $('cancel-analysis').disabled = cancelling || run.status === 'cancelling';
    $('cancel-analysis').textContent = cancelling || run.status === 'cancelling' ? '取消请求处理中…' : '取消本次分析';
    $('show-active').hidden = !activeRun() || isCurrent;
    $('run-progress').hidden = !isActive;
    const activity = runActivity.get(run.id) || [];
    const lastProgress = [...activity].reverse().find(event => event.type === 'progress' || event.type === 'tool');
    $('progress-text').textContent = run.status === 'cancelling' ? '已请求取消，正在等待任务停止…' : lastProgress?.message || '分析仍在进行，等待下一条进度…';
    $('run-error').hidden = !run.error && !['cancelled', 'interrupted'].includes(run.status);
    $('run-error').textContent = run.error ? (run.error.code ? run.error.code + '：' : '') + textValue(run.error.message || run.error) : run.status === 'interrupted' ? '本机服务中断了这次分析。未自动重试；请核对历史与配置后手动开始新一轮。' : run.status === 'cancelled' ? '本次分析已取消。已显示的部分内容不代表完整结果。' : '';
    const result = run.result;
    const text = textValue(result?.text ?? runPreview.get(run.id));
    $('result-text').textContent = text || (isActive ? '正在等待分析输出…' : run.status === 'completed' ? '服务未返回可展示的结果文本。请查看执行活动与依据。' : '这次分析没有完整结果。原始反馈仍可继续管理。');
    $('result-text').classList.toggle('placeholder', !text);
    $('result-note').textContent = isActive ? '实时输出 · 尚未完成' : run.status === 'completed' ? (run.mode === 'offline' ? '离线规则输出 · 非模型回答' : '请结合原文审阅') : '未完成';
    renderActivity(run);
    renderEvidence(run);
  }

  function renderActivity(run) {
    const events = runActivity.get(run.id) || [];
    const fragment = document.createDocumentFragment();
    for (const event of events) {
      const row = element('li', event.type === 'tool' ? 'tool-event' : event.type === 'error' ? 'error-event' : '');
      row.append(element('time', '', formatDate(event.time, true)), element('span', 'activity-text', event.message));
      fragment.append(row);
    }
    $('activity-list').replaceChildren(fragment);
    $('activity-count').textContent = String(events.length);
    $('activity-empty').hidden = events.length > 0;
    $('activity-empty').textContent = activeStatuses.has(run.status) ? '等待服务推送进度与工具活动。' : '本次查看没有实时活动记录；下方依据来自保存的分析结果。';
  }

  function renderEvidence(run) {
    const readIds = Array.isArray(run.result?.readIds) ? run.result.readIds : null;
    const ids = readIds || run.recordIds || [];
    const snapshots = Array.isArray(run.inputRecords) ? run.inputRecords : [];
    $('evidence-heading').textContent = readIds ? '实际读取依据' : '本轮提交记录';
    $('evidence-count').textContent = String(ids.length);
    $('evidence-note').textContent = readIds
      ? '本轮提交 ' + (run.recordIds?.length || 0) + ' 条，工具实际读取 ' + ids.length + ' 条。' + (snapshots.length ? '以下为分析时保存的原文快照。' : '此历史没有原文快照，当前记录可能已变化。')
      : '以下为本轮提交范围；收到工具读取结果后，才标记实际依据。';
    const fragment = document.createDocumentFragment();
    for (const id of ids) {
      const snapshot = snapshots.find(record => record.id === id);
      const record = snapshot || state.records.find(item => item.id === id);
      const card = element('article', 'evidence-card');
      card.append(element('h4', '', record?.title || '原记录已不可用'), element('p', '', record?.content || '无法显示该记录内容。请勿仅凭模型输出推断原文。'), element('small', '', (record?.source || '未填写来源') + ' · ' + (snapshot ? '分析时快照' : '当前记录') + ' · ' + id));
      fragment.append(card);
    }
    if (!ids.length) fragment.append(element('p', 'detail-empty', readIds ? '本次没有已确认读取的记录，结果不能视为已核对原文。' : '没有可展示的输入记录。'));
    $('evidence-list').replaceChildren(fragment);
  }

  function renderHistory() {
    $('history-count').textContent = String(state.runs.length);
    if (!state.runs.length) {
      $('history-list').replaceChildren(element('p', 'history-empty', '暂无分析记录。完成第一轮后，可在这里回看结果与原始依据。'));
      return;
    }
    const fragment = document.createDocumentFragment();
    const sorted = [...state.runs].sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
    for (const run of sorted) {
      const row = element('article', 'history-row');
      const icon = element('span', 'history-icon', '✳');
      icon.setAttribute('aria-hidden', 'true');
      const main = element('div', 'history-main');
      main.append(element('strong', '', formatDate(run.createdAt) + ' 的反馈分析'), element('p', '', modeLabel(run.mode) + ' · ' + (run.recordIds?.length || 0) + ' 条反馈' + (run.finishedAt ? ' · 结束于 ' + formatDate(run.finishedAt, true) : '')));
      const button = element('button', 'text-button', run.id === viewedRunId ? '正在查看 ↑' : '查看分析 ↗');
      button.type = 'button';
      button.setAttribute('aria-label', '查看 ' + formatDate(run.createdAt) + ' 的' + modeLabel(run.mode) + '分析');
      button.addEventListener('click', () => {
        viewedRunId = run.id;
        renderRun();
        renderHistory();
        $('analysis-section').scrollIntoView({ block: 'start', behavior: 'auto' });
        $('result-text').focus({ preventScroll: true });
      });
      row.append(icon, main, element('span', badgeClass(run.status), statusLabels[run.status] || run.status), button);
      fragment.append(row);
    }
    $('history-list').replaceChildren(fragment);
  }

  function stopStream() {
    if (connection) connection.close();
    connection = null;
    connectedRunId = null;
    if (reconnectTimer) window.clearTimeout(reconnectTimer);
    reconnectTimer = null;
  }

  function scheduleReconnectCheck() {
    if (reconnectTimer) return;
    reconnectTimer = window.setTimeout(async () => {
      reconnectTimer = null;
      const refreshed = await refreshState({ quiet: true });
      if (!refreshed || (activeRun() && connection?.readyState !== EventSource.OPEN)) scheduleReconnectCheck();
    }, 3000);
  }

  function syncEventStream() {
    const run = activeRun();
    if (!run) { stopStream(); return; }
    if (connection && connectedRunId === run.id) return;
    stopStream();
    connectedRunId = run.id;
    const source = new EventSource('/api/runs/' + encodeURIComponent(run.id) + '/events');
    connection = source;
    source.onopen = () => {
      if (connection !== source) return;
      setConnection(true, '本机服务 · 进度已连接');
      if (reconnectTimer) window.clearTimeout(reconnectTimer);
      reconnectTimer = null;
    };
    source.onmessage = event => {
      if (connection !== source) return;
      let data;
      try { data = JSON.parse(event.data); } catch { return; }
      if (data.runId !== run.id) return;
      const eventId = Number(data.id);
      if (Number.isFinite(eventId) && eventId <= (lastEventIds.get(run.id) ?? -1)) return;
      if (Number.isFinite(eventId)) lastEventIds.set(run.id, eventId);
      receiveEvent(data);
    };
    source.onerror = () => {
      if (connection !== source) return;
      setConnection(false, '进度断线 · 正在恢复同一任务');
      scheduleReconnectCheck();
    };
  }

  function receiveEvent(event) {
    const run = state.runs.find(item => item.id === event.runId);
    if (!run) return;
    let message = event.message;
    if (event.type === 'progress') {
      if (activeStatuses.has(event.status)) run.status = event.status;
      if (event.replace) runPreview.set(run.id, '');
      if (typeof event.text === 'string') runPreview.set(run.id, (runPreview.get(run.id) || '') + event.text);
      if (event.replace && !message) message = '服务已撤回此前输出，正在继续处理。';
    } else if (event.type === 'tool') {
      message = message || (event.name || '业务工具') + ' · ' + (event.recordIds?.length || 0) + ' 条记录';
    } else if (event.type === 'result') {
      run.result = event.result;
      message = message || '已收到分析结果，正在等待任务结束确认。';
    } else if (event.type === 'error') {
      run.error = event.error;
      message = message || textValue(event.error?.message || event.error) || '分析发生错误。';
    } else if (event.type === 'done') {
      run.status = event.status || run.status;
      message = message || '任务状态：' + (statusLabels[run.status] || run.status);
    }
    if (message) {
      const events = runActivity.get(run.id) || [];
      events.push({ type: event.type, time: event.time || Date.now(), message: String(message) });
      if (events.length > 200) events.shift();
      runActivity.set(run.id, events);
    }
    if (event.type === 'done') {
      stopStream();
      if (state.activeRunId === run.id) state.activeRunId = null;
      renderSelection();
      renderHistory();
      void refreshState({ quiet: true });
    }
    if (viewedRunId === run.id) renderRun();
  }

  function openRecordDialog(record) {
    if (savingRecord) return;
    editingId = record?.id || null;
    createRequestId = uuid();
    $('record-form').reset();
    $('record-dialog-title').textContent = record ? '编辑反馈' : '添加反馈';
    $('record-title').value = record?.title || '';
    $('record-content').value = record?.content || '';
    $('record-source').value = record?.source || '';
    $('record-status').value = record?.status || 'new';
    $('record-status-field').hidden = !record;
    $('record-form-error').hidden = true;
    $('save-record').textContent = record ? '保存修改' : '保存反馈';
    $('record-dialog').showModal();
    $('record-title').focus();
  }

  function closeRecordDialog() { if (!savingRecord) $('record-dialog').close(); }

  async function saveRecord(event) {
    event.preventDefault();
    if (savingRecord || !$('record-form').reportValidity()) return;
    const title = $('record-title').value.trim();
    const content = $('record-content').value.trim();
    const source = $('record-source').value.trim();
    if (!title || !content) {
      $('record-form-error').textContent = '请填写标题和反馈原文，不能只输入空格。';
      $('record-form-error').hidden = false;
      (!title ? $('record-title') : $('record-content')).focus();
      return;
    }
    savingRecord = true;
    $('record-form').querySelectorAll('input, textarea, select').forEach(field => { field.disabled = true; });
    $('save-record').disabled = true;
    $('save-record').textContent = '正在保存…';
    $('record-form-error').hidden = true;
    try {
      const payload = editingId ? { title, content, source, status: $('record-status').value } : { title, content, source, clientRequestId: createRequestId };
      const response = await api(editingId ? '/api/records/' + encodeURIComponent(editingId) : '/api/records', { method: editingId ? 'PATCH' : 'POST', body: JSON.stringify(payload) });
      if (!response.record?.id) throw new Error('保存响应缺少记录，请重新读取工作台状态。');
      if (!editingId && selectedIds.size < 50) selectedIds.add(response.record.id);
      $('record-dialog').close();
      showMessage(editingId ? '反馈已更新。已有分析使用各自保存的原文快照。' : '反馈已保存，可以选择它加入本轮分析。');
      await refreshState();
      (editingId ? $('record-search') : $('add-record')).focus();
    } catch (error) {
      $('record-form-error').textContent = error.message + (!error.status ? ' 输入已保留；保持内容不变再次保存会复用同一个请求编号。' : '');
      $('record-form-error').hidden = false;
      void refreshState({ quiet: true });
    } finally {
      savingRecord = false;
      $('record-form').querySelectorAll('input, textarea, select').forEach(field => { field.disabled = false; });
      $('save-record').disabled = false;
      $('save-record').textContent = editingId ? '保存修改' : '保存反馈';
    }
  }

  function openDeleteDialog(record) {
    pendingDeleteId = record.id;
    const affected = state.runs.filter(run => run.recordIds?.includes(record.id)).length;
    $('delete-record-title').textContent = record.title;
    $('delete-description').textContent = '记录会从收件箱移除' + (affected ? '，并删除引用它的 ' + affected + ' 次历史分析和输入快照' : '，引用它的历史分析和输入快照也会一并删除') + '。此操作不能撤销。';
    $('delete-error').hidden = true;
    $('delete-dialog').showModal();
    $('cancel-delete').focus();
  }

  async function deleteRecord() {
    if (!pendingDeleteId || deletingRecord) return;
    deletingRecord = true;
    $('confirm-delete').disabled = true;
    $('confirm-delete').textContent = '正在删除…';
    try {
      await api('/api/records/' + encodeURIComponent(pendingDeleteId), { method: 'DELETE' });
      selectedIds.delete(pendingDeleteId);
      pendingDeleteId = null;
      $('delete-dialog').close();
      showMessage('反馈及引用它的历史分析已删除。');
      await refreshState();
      $('record-search').focus();
    } catch (error) {
      $('delete-error').textContent = error.message;
      $('delete-error').hidden = false;
      await refreshState({ quiet: true });
      if (state && !state.records.some(record => record.id === pendingDeleteId)) {
        $('delete-dialog').close();
        pendingDeleteId = null;
        showMessage('重新读取后确认：该反馈已不在收件箱中。');
      }
    } finally {
      deletingRecord = false;
      $('confirm-delete').disabled = false;
      $('confirm-delete').textContent = '删除反馈';
    }
  }

  async function startAnalysis() {
    if (starting || activeRun() || uncertainStart || !selectedIds.size || state.product.configuration?.ready === false) return;
    starting = true;
    const knownIds = new Set(state.runs.map(run => run.id));
    const recordIds = [...selectedIds];
    showMessage('');
    renderSelection();
    try {
      const response = await api('/api/runs', { method: 'POST', body: JSON.stringify({ recordIds }) });
      if (!response.run?.id) throw new Error('无法确认本轮分析编号。');
      putRun(response.run);
      viewedRunId = response.run.id;
      $('activity-details').open = true;
      renderRun();
      renderHistory();
      syncEventStream();
    } catch (error) {
      if ((!error.status || error.status >= 500) && !['missing_credentials', 'shutting_down'].includes(error.code)) {
        uncertainStart = { knownIds };
        showMessage(error.message + ' 已暂停再次提交；请重新读取状态以找回这次任务。', 'warning');
      } else showMessage(error.message, 'error');
      await refreshState({ quiet: true });
    } finally {
      starting = false;
      renderSelection();
    }
  }

  async function cancelAnalysis() {
    const run = activeRun();
    if (!run || cancelling || run.status === 'cancelling') return;
    cancelling = true;
    renderRun();
    try {
      const response = await api('/api/runs/' + encodeURIComponent(run.id) + '/cancel', { method: 'POST', body: '{}' });
      putRun(response.run);
      renderRun();
      renderHistory();
      renderSelection();
      syncEventStream();
      await refreshState({ quiet: true });
    } catch (error) {
      showMessage(error.message + ' 将重新读取原任务状态，请勿把页面断线视作取消成功。', 'warning');
      await refreshState({ quiet: true });
    } finally { cancelling = false; renderRun(); }
  }

  $('refresh-state').addEventListener('click', () => { void refreshState(); });
  $('add-record').addEventListener('click', () => openRecordDialog());
  $('close-record-dialog').addEventListener('click', closeRecordDialog);
  $('cancel-record-edit').addEventListener('click', closeRecordDialog);
  $('record-dialog').addEventListener('cancel', event => { if (savingRecord) event.preventDefault(); });
  $('record-form').addEventListener('submit', event => { void saveRecord(event); });
  $('record-form').addEventListener('input', () => { if (!savingRecord) createRequestId = uuid(); });
  $('record-search').addEventListener('input', () => { if (state) { renderRecords(); renderSelection(); } });
  $('record-filter').addEventListener('change', () => { if (state) { renderRecords(); renderSelection(); } });
  $('select-visible').addEventListener('change', event => {
    for (const record of visibleRecords()) {
      if (!event.target.checked) selectedIds.delete(record.id);
      else if (selectedIds.size < 50) selectedIds.add(record.id);
    }
    if (event.target.checked && visibleRecords().some(record => !selectedIds.has(record.id))) showMessage('已选择最多 50 条反馈。可分批运行分析。', 'warning');
    renderRecords();
    renderSelection();
  });
  $('clear-selection').addEventListener('click', () => { selectedIds.clear(); renderRecords(); renderSelection(); });
  $('cancel-delete').addEventListener('click', () => { if (!deletingRecord) { pendingDeleteId = null; $('delete-dialog').close(); } });
  $('delete-dialog').addEventListener('cancel', event => { if (deletingRecord) event.preventDefault(); else pendingDeleteId = null; });
  $('confirm-delete').addEventListener('click', () => { void deleteRecord(); });
  $('start-analysis').addEventListener('click', () => { void startAnalysis(); });
  $('cancel-analysis').addEventListener('click', () => { void cancelAnalysis(); });
  $('show-active').addEventListener('click', () => { viewedRunId = state.activeRunId; renderRun(); renderHistory(); });
  window.addEventListener('online', () => { void refreshState({ quiet: true }); });
  document.addEventListener('visibilitychange', () => { if (!document.hidden) void refreshState({ quiet: true }); });
  window.addEventListener('pagehide', stopStream);
  void refreshState();
})();
