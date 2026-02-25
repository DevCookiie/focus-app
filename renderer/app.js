// ─── State ──────────────────────────────────────────────────────────
const MODES = {
  work:  { label: 'Focus Time',  minutes: 25, bodyClass: '' },
  break: { label: 'Short Break', minutes: 5,  bodyClass: 'break-mode' },
  long:  { label: 'Long Break',  minutes: 15, bodyClass: 'break-mode' },
};

let currentMode   = 'work';
let totalSeconds  = MODES.work.minutes * 60;
let secondsLeft   = totalSeconds;
let isRunning     = false;
let timerId       = null;
let sessionsDone  = 0;
let linkedTaskId  = null;

/** @type {{ id: string; text: string; done: boolean; status: string; priority: string; tags: string[]; addedAt: number; }[]} */
let tasks;
try {
  tasks = JSON.parse(localStorage.getItem('focus-tasks') || '[]');
} catch (_) {
  tasks = [];
  localStorage.removeItem('focus-tasks');
}
let activeFilter = 'all';
let collapsedGroups = new Set();
let pendingTags = [];
let searchQuery = '';
let draggedId = null;
let expandedSubtasks = new Set();
let expandedNotes = new Set();
let isDark = localStorage.getItem('focus-theme') !== 'light';

// ─── Boards ───────────────────────────────────────────────
let boards;
try { boards = JSON.parse(localStorage.getItem('focus-boards') || '[]'); } catch (_) { boards = []; }
let activeBoardId = null;
function saveBoards() { localStorage.setItem('focus-boards', JSON.stringify(boards)); }
const BOARD_EMOJIS  = ['📋','✅','🚀','💡','🎯','📝','⚡','🔥','🌟','🏆'];
const BOARD_COLORS  = ['#8B5CF6','#3B82F6','#10B981','#F59E0B','#EF4444','#EC4899','#06B6D4','#F97316','#84CC16','#A855F7'];
const MEMBER_COLORS = ['#8B5CF6','#3B82F6','#10B981','#F59E0B','#EF4444','#EC4899','#06B6D4','#F97316','#84CC16','#A855F7'];

// ─── DOM refs ────────────────────────────────────────────────────────
const timerTime    = document.getElementById('timer-time');
const timerLabel   = document.getElementById('timer-label');
const ringProgress = document.getElementById('ring-progress');
const btnStart     = document.getElementById('btn-start-pause');
const btnReset     = document.getElementById('btn-reset');
const btnSkip      = document.getElementById('btn-skip');
const taskInput      = document.getElementById('task-input');
const prioritySelect = document.getElementById('priority-select');
const taskList       = document.getElementById('task-list');
const statDone       = document.getElementById('stat-done');
const statLeft       = document.getElementById('stat-left');
const btnClear       = document.getElementById('btn-clear-done');
const linkedName     = document.getElementById('linked-task-name');
const btnUnlink      = document.getElementById('btn-unlink');
const sessionText    = document.getElementById('session-text');
const tagInputEl     = document.getElementById('tag-input');
const tagWrap        = document.getElementById('tag-wrap');
const sessionDots  = [
  document.getElementById('s1'),
  document.getElementById('s2'),
  document.getElementById('s3'),
  document.getElementById('s4'),
];

// ─── Audio (Web Audio API beep) ───────────────────────────────────────
function playBeep(freq = 880, duration = 0.5) {
  try {
    const ctx = new AudioContext();
    const oscillator = ctx.createOscillator();
    const gain = ctx.createGain();
    oscillator.connect(gain);
    gain.connect(ctx.destination);
    oscillator.type = 'sine';
    oscillator.frequency.setValueAtTime(freq, ctx.currentTime);
    gain.gain.setValueAtTime(0.4, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + duration);
    oscillator.start(ctx.currentTime);
    oscillator.stop(ctx.currentTime + duration);
    // Play two tones
    const osc2 = ctx.createOscillator();
    const g2 = ctx.createGain();
    osc2.connect(g2); g2.connect(ctx.destination);
    osc2.type = 'sine';
    osc2.frequency.setValueAtTime(freq * 1.5, ctx.currentTime + duration * 0.8);
    g2.gain.setValueAtTime(0.3, ctx.currentTime + duration * 0.8);
    g2.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + duration * 2);
    osc2.start(ctx.currentTime + duration * 0.8);
    osc2.stop(ctx.currentTime + duration * 2);
  } catch (_) { /* silently ignore */ }
}

// ─── Timer logic ─────────────────────────────────────────────────────
function setMode(mode) {
  if (isRunning) stopTimer();
  currentMode  = mode;
  totalSeconds = MODES[mode].minutes * 60;
  secondsLeft  = totalSeconds;

  document.querySelectorAll('.mode-tab').forEach(t =>
    t.classList.toggle('active', t.dataset.mode === mode)
  );
  const wasLight = document.body.classList.contains('light');
  document.body.className = MODES[mode].bodyClass;
  if (wasLight) document.body.classList.add('light');
  timerLabel.textContent  = MODES[mode].label;
  btnStart.textContent    = 'Start';
  updateTimerDisplay();
  updateRing();
}

function startTimer() {
  if (secondsLeft <= 0) return;
  isRunning = true;
  btnStart.textContent = 'Pause';
  timerId = setInterval(() => {
    secondsLeft--;
    updateTimerDisplay();
    updateRing();
    if (secondsLeft <= 0) {
      clearInterval(timerId);
      isRunning = false;
      playBeep();
      onTimerEnd();
    }
  }, 1000);
}

function stopTimer() {
  clearInterval(timerId);
  isRunning = false;
  btnStart.textContent = 'Resume';
}

function resetTimer() {
  stopTimer();
  secondsLeft = totalSeconds;
  btnStart.textContent = 'Start';
  updateTimerDisplay();
  updateRing();
}

function skipTimer() {
  stopTimer();
  onTimerEnd(true);
}

// ─── Notifications ───────────────────────────────────────────────────
function showNotification(title, body) {
  if (!('Notification' in window)) return;
  const send = () => new Notification(title, { body, silent: false });
  if (Notification.permission === 'granted') {
    send();
  } else if (Notification.permission !== 'denied') {
    Notification.requestPermission().then(p => { if (p === 'granted') send(); });
  }
}

function onTimerEnd(skipped = false) {
  if (!skipped && currentMode === 'work') {
    sessionsDone = Math.min(sessionsDone + 1, 4);
    updateSessionDots();
    // Increment pomodoros on linked task
    if (linkedTaskId) {
      const lt = tasks.find(t => t.id === linkedTaskId);
      if (lt) {
        lt.pomodorosDone = (lt.pomodorosDone || 0) + 1;
        saveTasks();
        renderTasks();
      }
    }
    const linkedTask = linkedTaskId ? tasks.find(t => t.id === linkedTaskId) : null;
    showNotification(
      'Fokus-session færdig! 🍅',
      linkedTask ? `Godt arbejde med "${linkedTask.text}"` : 'Tid til en pause!'
    );
    if (sessionsDone >= 4) {
      setMode('long');
      sessionsDone = 0;
      updateSessionDots();
    } else {
      setMode('break');
    }
  } else if (!skipped && (currentMode === 'break' || currentMode === 'long')) {
    showNotification('Pause slut!', 'Klar til næste fokus-session?');
    setMode('work');
  } else {
    // Skip: just move to next mode
    if (currentMode === 'work') setMode('break');
    else setMode('work');
  }
}

function updateTimerDisplay() {
  const m = Math.floor(secondsLeft / 60).toString().padStart(2, '0');
  const s = (secondsLeft % 60).toString().padStart(2, '0');
  timerTime.textContent = `${m}:${s}`;
  document.title = `${m}:${s} — Focus`;
}

function updateRing() {
  const circumference = 2 * Math.PI * 82; // ~515
  const fraction = secondsLeft / totalSeconds;
  const offset   = circumference * (1 - fraction);
  ringProgress.style.strokeDasharray  = `${circumference}`;
  ringProgress.style.strokeDashoffset = `${offset}`;
}

function updateSessionDots() {
  sessionDots.forEach((dot, i) => {
    dot.classList.remove('active', 'done');
    if (i < sessionsDone)            dot.classList.add('done');
    else if (i === sessionsDone)     dot.classList.add('active');
  });
  const s = sessionsDone === 0 ? 1 : sessionsDone;
  sessionText.textContent = `Session ${s} of 4`;
}

// ─── Todo logic ───────────────────────────────────────────────────────
function saveTasks() {
  localStorage.setItem('focus-tasks', JSON.stringify(tasks));
}

function uid() {
  return Math.random().toString(36).slice(2, 9);
}

// ─── Due-date helpers ───────────────────────────────────────────────────
function dueDateClass(iso) {
  if (!iso) return '';
  const today = new Date(); today.setHours(0,0,0,0);
  const due   = new Date(iso);
  const diff  = (due - today) / 86400000;
  if (diff < 0)  return 'due-overdue';
  if (diff <= 2) return 'due-soon';
  return '';
}

function formatDueDate(iso) {
  if (!iso) return '';
  const today = new Date(); today.setHours(0,0,0,0);
  const due   = new Date(iso);
  const diff  = Math.round((due - today) / 86400000);
  if (diff === 0)  return 'Today';
  if (diff === 1)  return 'Tomorrow';
  if (diff === -1) return 'Yesterday';
  if (diff < -1)   return `${Math.abs(diff)}d overdue`;
  return due.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
}

function nextDueDate(iso, recur) {
  const base = iso ? new Date(iso) : new Date();
  if (recur === 'daily')  base.setDate(base.getDate() + 1);
  if (recur === 'weekly') base.setDate(base.getDate() + 7);
  return base.toISOString().slice(0, 10);
}

// ─── Subtask helpers ───────────────────────────────────────────────────
function addSubtask(taskId, text) {
  const t = tasks.find(t => t.id === taskId);
  if (!t) return;
  if (!t.subtasks) t.subtasks = [];
  t.subtasks.push({ id: uid(), text, done: false });
  expandedSubtasks.add(taskId);
  saveTasks();
  renderTasks();
}

function toggleSubtask(taskId, subId) {
  const t = tasks.find(t => t.id === taskId);
  if (!t || !t.subtasks) return;
  const s = t.subtasks.find(s => s.id === subId);
  if (s) s.done = !s.done;
  saveTasks();
  renderTasks();
}

function deleteSubtask(taskId, subId) {
  const t = tasks.find(t => t.id === taskId);
  if (!t || !t.subtasks) return;
  t.subtasks = t.subtasks.filter(s => s.id !== subId);
  saveTasks();
  renderTasks();
}

// ─── Tag helpers ───────────────────────────────────────────────
function tagColor(name) {
  let h = 0;
  for (const c of name) h = ((h * 31) + c.charCodeAt(0)) & 0xff;
  return 'c' + (h % 8);
}

function buildTagPill(tag, onRemove) {
  const pill = document.createElement('span');
  pill.className = `tag-pill tag-${tagColor(tag)}`;
  const pipe = document.createElement('span');
  pipe.className = 'tag-pipe';
  pipe.textContent = '|';
  const name = document.createElement('span');
  name.className = 'tag-name';
  name.textContent = tag;
  const rm = document.createElement('button');
  rm.className = 'tag-remove';
  rm.type = 'button';
  rm.textContent = '\u00d7';
  rm.addEventListener('click', e => { e.stopPropagation(); onRemove(); });
  pill.append(pipe, name, rm);
  return pill;
}

function buildTagPillForm(tag, onRemove) {
  const pill = buildTagPill(tag, onRemove);
  pill.classList.add('tag-pill-form');
  return pill;
}

function renderPendingTags() {
  if (!tagWrap) return;
  tagWrap.querySelectorAll('.tag-pill').forEach(p => p.remove());
  pendingTags.forEach((tag, i) => {
    const pill = buildTagPillForm(tag, () => {
      pendingTags.splice(i, 1);
      renderPendingTags();
    });
    tagWrap.insertBefore(pill, tagInputEl);
  });
}

// ─── Status icon SVG helper ───────────────────────────────────────────
function buildStatusIcon(status) {
  const ns = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(ns, 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('fill', 'none');
  svg.setAttribute('stroke', 'currentColor');
  svg.setAttribute('stroke-width', '2');
  svg.classList.add('task-status-icon', status);
  svg.title = 'Click to cycle status';
  if (status === 'done') {
    const c = document.createElementNS(ns, 'circle');
    c.setAttribute('cx', '12'); c.setAttribute('cy', '12'); c.setAttribute('r', '10');
    const p = document.createElementNS(ns, 'polyline');
    p.setAttribute('points', '9 12 11 14 15 10');
    svg.append(c, p);
  } else if (status === 'inprog') {
    const c = document.createElementNS(ns, 'circle');
    c.setAttribute('cx', '12'); c.setAttribute('cy', '12'); c.setAttribute('r', '10');
    const path = document.createElementNS(ns, 'path');
    path.setAttribute('d', 'M12 2 A10 10 0 0 1 12 22 Z');
    path.setAttribute('fill', 'currentColor');
    svg.append(c, path);
  } else {
    const c = document.createElementNS(ns, 'circle');
    c.setAttribute('cx', '12'); c.setAttribute('cy', '12'); c.setAttribute('r', '10');
    svg.appendChild(c);
  }
  return svg;
}

function addTagToTask(id, tag) {
  tag = tag.trim().toLowerCase();
  const t = tasks.find(t => t.id === id);
  if (!t || !tag) { renderTasks(); return; }
  if (!t.tags) t.tags = [];
  if (!t.tags.includes(tag)) t.tags.push(tag);
  saveTasks();
  renderTasks();
}

function removeTagFromTask(id, tag) {
  const t = tasks.find(t => t.id === id);
  if (!t || !t.tags) return;
  t.tags = t.tags.filter(tg => tg !== tag);
  saveTasks();
  renderTasks();
}

function addTask(text) {
  text = text.trim();
  if (!text) return;
  const priority   = prioritySelect ? prioritySelect.value : 'none';
  const dueDateEl  = document.getElementById('due-date-input');
  const recurEl    = document.getElementById('recur-select');
  const pomoEl     = document.getElementById('pomo-est-input');
  const dueDate    = dueDateEl?.value || null;
  const recur      = recurEl?.value || 'none';
  const pomodoroEst = Math.max(0, parseInt(pomoEl?.value || '0', 10)) || 0;
  tasks.unshift({
    id: uid(), text, done: false, status: 'todo', priority,
    tags: [...pendingTags], addedAt: Date.now(),
    subtasks: [], dueDate, recur, pomodoroEst, pomodorosDone: 0, boardId: activeBoardId,
  });
  if (prioritySelect) prioritySelect.value = 'none';
  if (dueDateEl) dueDateEl.value = '';
  if (recurEl)   recurEl.value   = 'none';
  if (pomoEl)    pomoEl.value    = '0';
  pendingTags = [];
  renderPendingTags();
  saveTasks();
  renderTasks();
}

function toggleDone(id) {
  const t = tasks.find(t => t.id === id);
  if (!t) return;
  t.done   = !t.done;
  t.status = t.done ? 'done' : 'todo';
  saveTasks();
  renderTasks();
}

function deleteTask(id) {
  if (linkedTaskId === id) unlinkTask();
  tasks = tasks.filter(t => t.id !== id);
  saveTasks();
  renderTasks();
}

function cycleStatus(id) {
  const t = tasks.find(t => t.id === id);
  if (!t) return;
  const cycle = { todo: 'inprog', inprog: 'done', done: 'todo' };
  const newStatus = cycle[t.status || 'todo'] || 'todo';
  if (newStatus === 'done' && t.recur && t.recur !== 'none') {
    // Recurring: reset instead of completing
    t.dueDate      = nextDueDate(t.dueDate, t.recur);
    t.status       = 'todo';
    t.done         = false;
    t.pomodorosDone = 0;
    if (t.subtasks) t.subtasks.forEach(s => { s.done = false; });
  } else {
    t.status = newStatus;
    t.done   = t.status === 'done';
  }
  saveTasks();
  renderTasks();
}

function linkTask(id) {
  const t = tasks.find(t => t.id === id);
  if (!t) return;
  linkedTaskId = id;
  linkedName.textContent = t.text;
  btnUnlink.style.display = 'block';
  renderTasks();
}

function unlinkTask() {
  linkedTaskId = null;
  linkedName.textContent = 'None';
  btnUnlink.style.display = 'none';
  renderTasks();
}

function clearDone() {
  if (linkedTaskId) {
    const linked = tasks.find(t => t.id === linkedTaskId);
    if (linked && linked.done) unlinkTask();
  }
  tasks = tasks.filter(t => !t.done);
  saveTasks();
  renderTasks();
}

function buildTaskRow(task) {
  const li = document.createElement('li');
  const status = task.status || (task.done ? 'done' : 'todo');
  li.className = 'task-item' +
    (task.done ? ' done' : '') +
    (task.id === linkedTaskId ? ' linked-active' : '');
  li.dataset.id = task.id;

  // ─ Cell 1: priority pill ─
  const prioCell = document.createElement('div');
  prioCell.className = 'task-prio-cell';
  if (task.priority && task.priority !== 'none') {
    const prioLabels = { urgent: 'Urgent', high: 'High', med: 'Med', low: 'Low' };
    const pill = document.createElement('span');
    pill.className = `prio-pill ${task.priority}`;
    pill.textContent = prioLabels[task.priority] || task.priority;
    prioCell.appendChild(pill);
  }

  // ─ Cell 2: name cell ─
  const nameCell = document.createElement('div');
  nameCell.className = 'task-name-cell';

  // Subtask expand toggle
  const hasSubs = task.subtasks && task.subtasks.length > 0;
  const isExpanded = expandedSubtasks.has(task.id);
  const subToggle = document.createElement('span');
  subToggle.className = 'subtask-toggle' + (isExpanded ? ' expanded' : '');
  subToggle.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" width="10" height="10"><polyline points="6 9 12 15 18 9"/></svg>`;
  subToggle.style.visibility = hasSubs ? 'visible' : 'hidden';
  subToggle.addEventListener('click', () => {
    if (expandedSubtasks.has(task.id)) expandedSubtasks.delete(task.id);
    else expandedSubtasks.add(task.id);
    renderTasks();
  });
  nameCell.appendChild(subToggle);

  const statusIcon = buildStatusIcon(status);
  statusIcon.addEventListener('click', () => cycleStatus(task.id));
  nameCell.appendChild(statusIcon);

  const nameSpan = document.createElement('span');
  nameSpan.className = 'task-text';
  nameSpan.textContent = task.text;
  nameSpan.title = task.text;
  nameCell.appendChild(nameSpan);

  // Subtask progress badge
  if (hasSubs) {
    const doneSubs = task.subtasks.filter(s => s.done).length;
    const badge = document.createElement('span');
    badge.className = 'subtask-badge';
    badge.textContent = `${doneSubs}/${task.subtasks.length}`;
    badge.title = 'Click to toggle subtasks';
    badge.addEventListener('click', () => {
      if (expandedSubtasks.has(task.id)) expandedSubtasks.delete(task.id);
      else expandedSubtasks.add(task.id);
      renderTasks();
    });
    nameCell.appendChild(badge);
  }

  // Pomodoro dots
  const pomoEst = task.pomodoroEst || 0;
  if (pomoEst > 0) {
    const pomoDone = task.pomodorosDone || 0;
    const dotsEl = document.createElement('span');
    dotsEl.className = 'pomo-dots';
    dotsEl.title = `${pomoDone}/${pomoEst} focus sessions`;
    for (let i = 0; i < Math.min(pomoEst, 8); i++) {
      const dot = document.createElement('span');
      dot.className = `pomo-dot${i < pomoDone ? ' done' : ''}`;
      dotsEl.appendChild(dot);
    }
    nameCell.appendChild(dotsEl);
  }

  // Recur badge
  if (task.recur && task.recur !== 'none') {
    const recurBadge = document.createElement('span');
    recurBadge.className = 'recur-badge';
    recurBadge.title = task.recur === 'daily' ? 'Repeats daily' : 'Repeats weekly';
    recurBadge.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" width="11" height="11"><polyline points="23 4 23 10 17 10"/><path d="M20.49 15a9 9 0 1 1-.49-4.73"/></svg>`;
    nameCell.appendChild(recurBadge);
  }

  // Note indicator
  if (task.notes && task.notes.trim().length > 0) {
    const noteInd = document.createElement('span');
    noteInd.className = 'note-indicator';
    noteInd.title = 'Has notes';
    noteInd.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="11" height="11"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/><polyline points="10 9 9 9 8 9"/></svg>`;
    noteInd.addEventListener('click', () => {
      if (expandedNotes.has(task.id)) expandedNotes.delete(task.id);
      else expandedNotes.add(task.id);
      renderTasks();
      setTimeout(() => document.querySelector(`[data-id="${task.id}"] .note-textarea`)?.focus(), 40);
    });
    nameCell.appendChild(noteInd);
  }

  // Tags
  if (task.tags && task.tags.length > 0) {
    const tagsDiv = document.createElement('div');
    tagsDiv.className = 'task-tags';
    task.tags.forEach(tag => {
      tagsDiv.appendChild(buildTagPill(tag, () => removeTagFromTask(task.id, tag)));
    });
    nameCell.appendChild(tagsDiv);
  }

  // + tag button
  const addTagBtn = document.createElement('button');
  addTagBtn.className = 'add-tag-btn';
  addTagBtn.type = 'button';
  addTagBtn.title = 'Add tag';
  addTagBtn.textContent = '+ tag';
  addTagBtn.addEventListener('click', () => {
    addTagBtn.style.display = 'none';
    const inp = document.createElement('input');
    inp.className = 'tag-quick-input';
    inp.placeholder = 'tag name\u2026';
    inp.maxLength = 30;
    inp.style.width = '84px';
    nameCell.appendChild(inp);
    inp.focus();
    const commit = () => {
      const v = inp.value.trim().toLowerCase();
      if (v) addTagToTask(task.id, v);
      else renderTasks();
    };
    inp.addEventListener('keydown', e => {
      if (e.key === 'Enter') { e.preventDefault(); commit(); }
      if (e.key === 'Escape') renderTasks();
    });
    inp.addEventListener('blur', () => setTimeout(commit, 120));
  });
  nameCell.appendChild(addTagBtn);

  // ─ Cell 3: due date or created ─
  const dateDiv = document.createElement('div');
  dateDiv.className = 'task-date';
  if (task.dueDate) {
    const cls = dueDateClass(task.dueDate);
    if (cls) dateDiv.classList.add(cls);
    dateDiv.textContent = formatDueDate(task.dueDate);
    dateDiv.title = 'Due: ' + task.dueDate;
  } else if (task.addedAt) {
    dateDiv.textContent = new Date(task.addedAt).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
  }

  // ─ Cell 4: actions ─
  const actions = document.createElement('div');
  actions.className = 'task-actions';

  const addSubBtn = document.createElement('button');
  addSubBtn.className = 'task-action-btn addsub-btn';
  addSubBtn.title = 'Add subtask';
  addSubBtn.type = 'button';
  addSubBtn.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>`;
  addSubBtn.addEventListener('click', () => {
    if (!task.subtasks) task.subtasks = [];
    expandedSubtasks.add(task.id);
    saveTasks();
    renderTasks();
    setTimeout(() => {
      const inp = document.querySelector(`[data-id="${task.id}"] .subtask-new-input`);
      inp?.focus();
    }, 40);
  });

  const noteBtn = document.createElement('button');
  noteBtn.className = 'task-action-btn note-btn' + (expandedNotes.has(task.id) ? ' active' : '');
  noteBtn.title = 'Notes';
  noteBtn.type = 'button';
  noteBtn.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/><polyline points="10 9 9 9 8 9"/></svg>`;
  noteBtn.addEventListener('click', () => {
    if (expandedNotes.has(task.id)) expandedNotes.delete(task.id);
    else expandedNotes.add(task.id);
    renderTasks();
    setTimeout(() => document.querySelector(`[data-id="${task.id}"] .note-textarea`)?.focus(), 40);
  });

  const linkBtn = document.createElement('button');
  linkBtn.className = 'task-action-btn link-btn' + (task.id === linkedTaskId ? ' active' : '');
  linkBtn.title = task.id === linkedTaskId ? 'Unlink from Pomodoro' : 'Focus with Pomodoro';
  linkBtn.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/></svg>`;
  linkBtn.addEventListener('click', () => { if (task.id === linkedTaskId) unlinkTask(); else linkTask(task.id); });

  const delBtn = document.createElement('button');
  delBtn.className = 'task-action-btn delete-btn';
  delBtn.title = 'Delete';
  delBtn.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14H6L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/><path d="M9 6V4h6v2"/></svg>`;
  delBtn.addEventListener('click', () => deleteTask(task.id));

  actions.append(addSubBtn, noteBtn, linkBtn, delBtn);

  // ─ Drag and drop ─
  li.draggable = true;
  li.addEventListener('dragstart', e => {
    draggedId = task.id;
    e.dataTransfer.effectAllowed = 'move';
    setTimeout(() => li.classList.add('dragging'), 0);
  });
  li.addEventListener('dragend', () => {
    li.classList.remove('dragging');
    document.querySelectorAll('.task-item.drag-over').forEach(el => el.classList.remove('drag-over'));
  });
  li.addEventListener('dragover', e => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    if (draggedId && draggedId !== task.id) li.classList.add('drag-over');
  });
  li.addEventListener('dragleave', e => {
    if (!li.contains(e.relatedTarget)) li.classList.remove('drag-over');
  });
  li.addEventListener('drop', e => {
    e.preventDefault();
    li.classList.remove('drag-over');
    if (!draggedId || draggedId === task.id) return;
    const fromIdx = tasks.findIndex(t => t.id === draggedId);
    if (fromIdx === -1) return;
    const to = tasks.find(t => t.id === task.id);
    if (!to || tasks[fromIdx].status !== to.status) return;
    const [moved] = tasks.splice(fromIdx, 1);
    const newToIdx = tasks.findIndex(t => t.id === task.id);
    tasks.splice(newToIdx, 0, moved);
    draggedId = null;
    saveTasks();
    renderTasks();
  });

  // ─ Subtask area (5th grid child, full width) ─
  if (isExpanded) {
    const subArea = document.createElement('div');
    subArea.className = 'subtask-area';
    const subList = document.createElement('ul');
    subList.className = 'subtask-list';
    (task.subtasks || []).forEach(sub => {
      const subLi = document.createElement('li');
      subLi.className = 'subtask-item' + (sub.done ? ' done' : '');
      const cb = document.createElement('input');
      cb.type = 'checkbox';
      cb.checked = sub.done;
      cb.className = 'subtask-check';
      cb.addEventListener('change', () => toggleSubtask(task.id, sub.id));
      const txt = document.createElement('span');
      txt.className = 'subtask-text';
      txt.textContent = sub.text;
      const delSub = document.createElement('button');
      delSub.type = 'button';
      delSub.className = 'subtask-del';
      delSub.textContent = '\u00d7';
      delSub.addEventListener('click', () => deleteSubtask(task.id, sub.id));
      subLi.append(cb, txt, delSub);
      subList.appendChild(subLi);
    });
    const addSubLi = document.createElement('li');
    addSubLi.className = 'subtask-add-row';
    const newSubInp = document.createElement('input');
    newSubInp.type = 'text';
    newSubInp.className = 'subtask-new-input';
    newSubInp.placeholder = 'New subtask\u2026';
    newSubInp.maxLength = 80;
    newSubInp.addEventListener('keydown', e => {
      if (e.key === 'Enter') {
        e.preventDefault();
        const v = newSubInp.value.trim();
        if (v) addSubtask(task.id, v);
        else renderTasks();
      }
      if (e.key === 'Escape') { expandedSubtasks.delete(task.id); renderTasks(); }
    });
    newSubInp.addEventListener('blur', () => setTimeout(() => {
      const v = newSubInp.value.trim();
      if (v) addSubtask(task.id, v);
    }, 100));
    addSubLi.appendChild(newSubInp);
    subList.appendChild(addSubLi);
    subArea.appendChild(subList);
    li.append(prioCell, nameCell, dateDiv, actions, subArea);
  } else {
    li.append(prioCell, nameCell, dateDiv, actions);
  }

  // ─ Notes area (always after other children, full width) ─
  if (expandedNotes.has(task.id)) {
    const noteArea = document.createElement('div');
    noteArea.className = 'note-area';
    const noteTA = document.createElement('textarea');
    noteTA.className = 'note-textarea';
    noteTA.placeholder = 'Write notes or comments…';
    noteTA.value = task.notes || '';
    noteTA.rows = 3;
    noteTA.addEventListener('input', () => { task.notes = noteTA.value; saveTasks(); });
    noteTA.addEventListener('keydown', e => {
      if (e.key === 'Escape') { expandedNotes.delete(task.id); renderTasks(); }
    });
    noteArea.appendChild(noteTA);
    li.appendChild(noteArea);
  }

  return li;
}

function renderTasks() {
  const filtered = tasks.filter(t => {
    if (activeBoardId && t.boardId !== activeBoardId) return false;
    if (activeFilter === 'active' && t.done)  return false;
    if (activeFilter === 'done'   && !t.done) return false;
    if (searchQuery) {
      const q = searchQuery;
      const textMatch = t.text.toLowerCase().includes(q);
      const tagMatch  = t.tags && t.tags.some(tg => tg.includes(q));
      if (!textMatch && !tagMatch) return false;
    }
    return true;
  });

  taskList.innerHTML = '';

  const groupDefs = [
    { status: 'todo',   label: 'To do',      dotClass: 'todo'   },
    { status: 'inprog', label: 'In Progress', dotClass: 'inprog' },
    { status: 'done',   label: 'Done',        dotClass: 'done'   },
  ];

  const visibleGroups = groupDefs.filter(g => {
    if (activeFilter === 'active') return g.status !== 'done';
    if (activeFilter === 'done')   return g.status === 'done';
    return true;
  });

  let totalShown = 0;

  visibleGroups.forEach(group => {
    const groupTasks = filtered.filter(t => (t.status || 'todo') === group.status);
    if (groupTasks.length === 0) return;
    totalShown += groupTasks.length;

    const groupLi = document.createElement('li');
    groupLi.className = 'status-group';
    groupLi.dataset.status = group.status;
    if (collapsedGroups.has(group.status)) groupLi.classList.add('collapsed');

    const header = document.createElement('div');
    header.className = 'group-header';
    const chevron = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    chevron.setAttribute('viewBox', '0 0 24 24');
    chevron.setAttribute('fill', 'none');
    chevron.setAttribute('stroke', 'currentColor');
    chevron.setAttribute('stroke-width', '2.5');
    chevron.classList.add('group-chevron');
    const poly = document.createElementNS('http://www.w3.org/2000/svg', 'polyline');
    poly.setAttribute('points', '6 9 12 15 18 9');
    chevron.appendChild(poly);
    const nameLbl = document.createElement('span');
    nameLbl.className = 'group-name';
    nameLbl.textContent = group.label;
    const countLbl = document.createElement('span');
    countLbl.className = 'group-count';
    countLbl.textContent = groupTasks.length;
    header.appendChild(chevron);
    const groupIcon = buildStatusIcon(group.status);
    groupIcon.classList.add('group-status-icon');
    header.appendChild(groupIcon);
    header.appendChild(nameLbl);
    header.appendChild(countLbl);
    header.addEventListener('click', () => {
      groupLi.classList.toggle('collapsed');
      if (groupLi.classList.contains('collapsed')) collapsedGroups.add(group.status);
      else collapsedGroups.delete(group.status);
    });
    groupLi.appendChild(header);

    const ul = document.createElement('ul');
    ul.className = 'group-tasks';
    groupTasks.forEach(t => ul.appendChild(buildTaskRow(t)));
    groupLi.appendChild(ul);
    taskList.appendChild(groupLi);
  });

  if (totalShown === 0) {
    const li = document.createElement('li');
    li.innerHTML = `<div class="empty-state">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><polyline points="9 11 12 14 22 4"/><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/></svg>
      <p>${activeFilter === 'done' ? 'No completed tasks yet.' : 'No tasks yet \u2014 add one above!'}</p>
    </div>`;
    taskList.appendChild(li);
  }

  // Stats + nav counts
  const doneCount   = tasks.filter(t => t.done).length;
  const activeCount = tasks.filter(t => !t.done).length;
  if (statDone) statDone.textContent = String(doneCount);
  if (statLeft) statLeft.textContent = String(activeCount);
  const navAll    = document.getElementById('nav-count-all');
  const navActive = document.getElementById('nav-count-active');
  const navDone   = document.getElementById('nav-count-done');
  if (navAll)    navAll.textContent    = String(tasks.length);
  if (navActive) navActive.textContent = String(activeCount);
  if (navDone)   navDone.textContent   = String(doneCount);
}
// ─── Theme ───────────────────────────────────────────────────────────
const SUN_ICON = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="13" height="13"><circle cx="12" cy="12" r="5"/><line x1="12" y1="1" x2="12" y2="3"/><line x1="12" y1="21" x2="12" y2="23"/><line x1="4.22" y1="4.22" x2="5.64" y2="5.64"/><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"/><line x1="1" y1="12" x2="3" y2="12"/><line x1="21" y1="12" x2="23" y2="12"/><line x1="4.22" y1="19.78" x2="5.64" y2="18.36"/><line x1="18.36" y1="5.64" x2="19.78" y2="4.22"/></svg>`;
const MOON_ICON = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="13" height="13"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/></svg>`;

// ─── Accent colours ──────────────────────────────────────────────────
const ACCENT_PALETTES = {
  purple: { accent: '#7b68ee', dim: 'rgba(123,104,238,.14)', glow: 'rgba(123,104,238,.30)' },
  blue:   { accent: '#4a9eff', dim: 'rgba(74,158,255,.14)',  glow: 'rgba(74,158,255,.30)'  },
  green:  { accent: '#43d98e', dim: 'rgba(67,217,142,.14)',  glow: 'rgba(67,217,142,.30)'  },
  pink:   { accent: '#ff6b81', dim: 'rgba(255,107,129,.14)', glow: 'rgba(255,107,129,.30)' },
  orange: { accent: '#f59e0b', dim: 'rgba(245,158,11,.14)',  glow: 'rgba(245,158,11,.30)'  },
};
function applyAccent(key) {
  const p = ACCENT_PALETTES[key] || ACCENT_PALETTES.purple;
  const root = document.documentElement;
  root.style.setProperty('--accent',      p.accent);
  root.style.setProperty('--accent-dim',  p.dim);
  root.style.setProperty('--accent-glow', p.glow);
  // Update swatch active state
  document.querySelectorAll('.swatch').forEach(s =>
    s.classList.toggle('active', s.dataset.accent === key));
}
// Load saved accent on startup
applyAccent(localStorage.getItem('focus-accent') || 'purple');

function applyTheme() {
  document.body.classList.toggle('light', !isDark);
  const btn = document.getElementById('btn-theme');
  if (!btn) return;
  if (isDark) {
    btn.innerHTML = SUN_ICON;
    btn.title = 'Switch to light mode';
  } else {
    btn.innerHTML = MOON_ICON;
    btn.title = 'Switch to dark mode';
  }
}
// ─── Event listeners ──────────────────────────────────────────────────
btnStart.addEventListener('click', () => {
  if (isRunning) stopTimer();
  else startTimer();
});

btnReset.addEventListener('click', resetTimer);
btnSkip.addEventListener('click', skipTimer);
btnUnlink.addEventListener('click', unlinkTask);
btnClear.addEventListener('click', clearDone);

// Search
const searchInputEl = document.getElementById('search-input');
if (searchInputEl) {
  searchInputEl.addEventListener('input', () => {
    searchQuery = searchInputEl.value.trim().toLowerCase();
    renderTasks();
  });
}

// New task button → focus task input
const btnNewTask = document.getElementById('btn-new-task');
if (btnNewTask && taskInput) {
  btnNewTask.addEventListener('click', () => taskInput.focus());
}

document.querySelectorAll('.mode-tab').forEach(tab => {
  tab.addEventListener('click', () => setMode(tab.dataset.mode));
});

document.getElementById('add-task-form').addEventListener('submit', e => {
  e.preventDefault();
  addTask(taskInput.value);
  taskInput.value = '';
});

document.querySelector('.btn-add').addEventListener('click', e => {
  e.preventDefault();
  e.stopPropagation();
  addTask(taskInput.value);
  taskInput.value = '';
  taskInput.focus();
});

document.querySelectorAll('.nav-item[data-filter]').forEach(btn => {
  btn.addEventListener('click', () => {
    activeBoardId = null;
    activeFilter = btn.dataset.filter || 'all';
    document.querySelectorAll('.nav-item').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    const vt = document.querySelector('.view-title');
    if (vt) vt.textContent =
      activeFilter === 'done' ? 'Completed' :
      activeFilter === 'active' ? 'Active' : 'All Tasks';
    renderBoards();
    renderTasks();
  });
});

// Tag input in add-form
if (tagInputEl) {
  tagInputEl.addEventListener('keydown', e => {
    const val = tagInputEl.value.trim().replace(/,/g, '').toLowerCase();
    if ((e.key === 'Enter' || e.key === ',') && val) {
      e.preventDefault();
      if (!pendingTags.includes(val)) { pendingTags.push(val); renderPendingTags(); }
      tagInputEl.value = '';
    } else if (e.key === 'Backspace' && !tagInputEl.value && pendingTags.length) {
      pendingTags.pop();
      renderPendingTags();
    }
  });
}

// Window control buttons
const api = window.electronAPI;
if (api) {
  document.getElementById('btn-minimize').addEventListener('click', () => api.minimize());
  document.getElementById('btn-maximize').addEventListener('click', () => api.maximize());
  document.getElementById('btn-close').addEventListener('click',    () => api.close());
}

// Theme toggle
document.getElementById('btn-theme')?.addEventListener('click', () => {
  isDark = !isDark;
  localStorage.setItem('focus-theme', isDark ? 'dark' : 'light');
  applyTheme();
});

// ─── Keyboard shortcuts (► N = new task │ Space = timer │ R = reset │ Esc = blur) ───────
document.addEventListener('keydown', e => {
  const tag = (document.activeElement?.tagName || '').toUpperCase();
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
  switch (e.key) {
    case 'n': case 'N':
      e.preventDefault();
      taskInput?.focus();
      break;
    case ' ':
      e.preventDefault();
      if (isRunning) stopTimer(); else startTimer();
      break;
    case 'r': case 'R':
      if (!e.ctrlKey && !e.metaKey) { e.preventDefault(); resetTimer(); }
      break;
    case 'Escape':
      document.activeElement?.blur();
      break;
  }
});

// ─── Init ──────────────────────────────────────────────────────────────────
const dateEl = document.getElementById('todo-date');
if (dateEl) {
  dateEl.textContent = new Date().toLocaleDateString('en-GB', {
    weekday: 'long', day: 'numeric', month: 'long'
  });
}
applyTheme();
if ('Notification' in window && Notification.permission === 'default') {
  Notification.requestPermission();
}
updateTimerDisplay();
updateRing();
updateSessionDots();
renderBoards();
renderTasks();

// ─── Splash ───────────────────────────────────────────────────────────────
// ── Account page ────────────────────────────────────────────────
function refreshAccountNav() {
  const ACCOUNT_KEY = 'focus-account';
  try {
    const acc = JSON.parse(localStorage.getItem(ACCOUNT_KEY));
    const ini = acc?.name
      ? acc.name.trim().split(/\s+/).map(w => w[0]).join('').toUpperCase().slice(0, 2)
      : '?';
    const navInit = document.getElementById('nav-avatar-init');
    const navName = document.getElementById('nav-account-name');
    if (navInit) navInit.textContent = ini;
    if (navName) navName.textContent = acc?.name || 'Account';
  } catch {}
}

(function initAccountPage() {
  const ACCOUNT_KEY  = 'focus-account';
  const CREATED_KEY  = 'focus-account-created';
  const navBtn       = document.getElementById('nav-account-btn');
  const accountPage  = document.getElementById('account-page');
  const appEl        = document.querySelector('.app');

  function loadAccount() {
    try { return JSON.parse(localStorage.getItem(ACCOUNT_KEY)); } catch { return null; }
  }
  function saveAccount(data) {
    localStorage.setItem(ACCOUNT_KEY, JSON.stringify(data));
  }
  function initials(name) {
    if (!name) return '?';
    return name.trim().split(/\s+/).map(w => w[0]).join('').toUpperCase().slice(0, 2);
  }
  function updateNavAvatar() { refreshAccountNav(); }
  function showFeedback(el, msg, ok) {
    if (!el) return;
    el.textContent = msg;
    el.style.color = ok ? 'var(--accent)' : '#ff6b81';
    el.classList.add('visible');
    clearTimeout(el._t);
    el._t = setTimeout(() => el.classList.remove('visible'), 3000);
  }

  // Open account page — hide the whole app, show full-screen account page
  function openAccount() {
    const acc = loadAccount();
    if (!acc) return;

    const ini = initials(acc.name);
    const avatarEl = document.getElementById('account-avatar-init');
    const nameEl   = document.getElementById('account-display-name');
    const sinceEl  = document.getElementById('account-since');
    if (avatarEl) avatarEl.textContent = ini;
    if (nameEl)   nameEl.textContent   = acc.name;

    const created = localStorage.getItem(CREATED_KEY);
    if (sinceEl) {
      sinceEl.textContent = created
        ? 'Member since ' + new Date(created).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' })
        : 'Local account';
    }

    const nameInput = document.getElementById('account-new-name');
    if (nameInput) nameInput.value = acc.name;

    const statsGrid = document.getElementById('account-stats-grid');
    if (statsGrid) {
      const today     = new Date().toISOString().slice(0, 10);
      const total     = tasks.length;
      const done      = tasks.filter(t => t.done).length;
      const active    = tasks.filter(t => !t.done).length;
      const overdue   = tasks.filter(t => t.dueDate && t.dueDate < today && !t.done).length;
      const pomoTotal = tasks.reduce((s, t) => s + (t.pomoDone || 0), 0);
      statsGrid.innerHTML = [
        ['Total tasks',    total],
        ['Completed',      done],
        ['Active',         active],
        ['Overdue',        overdue,   overdue > 0 ? 'warn'   : ''],
        ['Pomodoros done', pomoTotal, 'accent'],
      ].map(([label, val, cls]) =>
        `<div class="acc-stat${cls ? ' acc-stat-' + cls : ''}">
           <span class="acc-stat-n">${val}</span>
           <span class="acc-stat-l">${label}</span>
         </div>`
      ).join('');
    }

    // Sync accent swatches
    const savedAccent = localStorage.getItem('focus-accent') || 'purple';
    document.querySelectorAll('.swatch').forEach(s =>
      s.classList.toggle('active', s.dataset.accent === savedAccent));

    // Sync theme buttons
    document.querySelectorAll('.theme-opt').forEach(b =>
      b.classList.toggle('active', b.dataset.theme === (isDark ? 'dark' : 'light')));

    appEl?.classList.add('hidden');
    accountPage?.classList.remove('hidden');
    navBtn?.classList.add('active');
  }

  // Close account page — restore the app
  function closeAccount() {
    accountPage?.classList.add('hidden');
    appEl?.classList.remove('hidden');
    navBtn?.classList.remove('active');
    // Restore whichever filter was active
    const prev = document.querySelector('.nav-item[data-filter].active');
    if (!prev) document.querySelector('.nav-item[data-filter="all"]')?.classList.add('active');
  }

  navBtn?.addEventListener('click', openAccount);

  document.getElementById('nav-home-btn')?.addEventListener('click', () => {
    window.openHomePage?.();
  });

  document.getElementById('account-back')?.addEventListener('click', closeAccount);

  // Save name
  document.getElementById('account-save-name')?.addEventListener('click', () => {
    const val = document.getElementById('account-new-name')?.value.trim();
    const fb  = document.getElementById('account-name-feedback');
    if (!val) { showFeedback(fb, 'Name cannot be empty.', false); return; }
    const acc = loadAccount();
    if (!acc) return;
    acc.name = val;
    saveAccount(acc);
    document.getElementById('account-display-name').textContent = val;
    updateNavAvatar();
    showFeedback(fb, 'Name updated!', true);
  });

  // Save password
  document.getElementById('account-save-pw')?.addEventListener('click', () => {
    const acc     = loadAccount();
    const curPw   = document.getElementById('account-cur-pw')?.value;
    const newPw   = document.getElementById('account-new-pw')?.value;
    const confPw  = document.getElementById('account-conf-pw')?.value;
    const fb      = document.getElementById('account-pw-feedback');
    if (!curPw) { showFeedback(fb, 'Enter your current password.', false); return; }
    if (btoa(encodeURIComponent(curPw)) !== acc.passwordHash) {
      showFeedback(fb, 'Current password is incorrect.', false); return;
    }
    if (!newPw)          { showFeedback(fb, 'Enter a new password.', false); return; }
    if (newPw !== confPw){ showFeedback(fb, 'New passwords do not match.', false); return; }
    acc.passwordHash = btoa(encodeURIComponent(newPw));
    saveAccount(acc);
    document.getElementById('account-cur-pw').value  = '';
    document.getElementById('account-new-pw').value  = '';
    document.getElementById('account-conf-pw').value = '';
    showFeedback(fb, 'Password updated!', true);
  });

  // Sign out
  document.getElementById('account-signout')?.addEventListener('click', () => {
    if (confirm('Sign out? You will need to log in again next time.')) {
      localStorage.removeItem(ACCOUNT_KEY);
      localStorage.removeItem(CREATED_KEY);
      location.reload();
    }
  });

  // Accent swatch click handlers
  document.querySelectorAll('.swatch').forEach(btn => {
    btn.addEventListener('click', () => {
      applyAccent(btn.dataset.accent);
      localStorage.setItem('focus-accent', btn.dataset.accent);
      document.querySelectorAll('.swatch').forEach(s =>
        s.classList.toggle('active', s === btn));
    });
  });

  // Theme-opt click handlers
  document.querySelectorAll('.theme-opt').forEach(btn => {
    btn.addEventListener('click', () => {
      isDark = btn.dataset.theme === 'dark';
      localStorage.setItem('focus-theme', isDark ? 'dark' : 'light');
      applyTheme();
      document.querySelectorAll('.theme-opt').forEach(b =>
        b.classList.toggle('active', b === btn));
    });
  });

  // Init nav avatar on page load
  updateNavAvatar();
})();

// ─── Boards: render sidebar list ───────────────────────────────
function renderBoards() {
  const list = document.getElementById('sidebar-board-list');
  if (!list) return;
  list.innerHTML = '';
  boards.forEach(board => {
    const taskCount = tasks.filter(t => t.boardId === board.id).length;
    const li = document.createElement('li');
    const btn = document.createElement('button');
    btn.className = 'nav-item board-nav-item' + (activeBoardId === board.id ? ' active' : '');
    btn.dataset.boardId = board.id;
    btn.innerHTML = `<span class="board-emoji">${board.emoji}</span><span class="board-nav-name">${board.name}</span><span class="nav-count">${taskCount}</span>`;
    btn.addEventListener('click', () => {
      activeBoardId = board.id;
      activeFilter = 'all';
      document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
      btn.classList.add('active');
      const vt = document.querySelector('.view-title');
      if (vt) vt.textContent = board.name;
      renderBoards();
      renderTasks();
    });
    li.appendChild(btn);
    list.appendChild(li);
  });
}

// Sidebar “New board” inline creation
document.getElementById('sidebar-add-board')?.addEventListener('click', () => {
  const list = document.getElementById('sidebar-board-list');
  if (!list || document.getElementById('board-inline-row')) return;
  const li = document.createElement('li');
  li.id = 'board-inline-row';
  const inp = document.createElement('input');
  inp.className = 'board-inline-input';
  inp.placeholder = 'Board name…';
  inp.maxLength = 40;
  li.appendChild(inp);
  list.appendChild(li);
  inp.focus();
  const commit = () => {
    li.remove();
    const name = inp.value.trim();
    if (!name) return;
    boards.push({ id: 'b' + Date.now(), name, emoji: BOARD_EMOJIS[boards.length % BOARD_EMOJIS.length] });
    saveBoards();
    renderBoards();
  };
  inp.addEventListener('blur', () => setTimeout(commit, 100));
  inp.addEventListener('keydown', e => {
    if (e.key === 'Enter')  { inp.blur(); }
    if (e.key === 'Escape') { li.remove(); }
  });
});

// ─── Home page ───────────────────────────────────────────────
(function initHomePage() {
  const homePage  = document.getElementById('home-page');
  const grid      = document.getElementById('home-board-grid');
  const greetEl   = document.getElementById('home-greeting');
  const enterBtn  = document.getElementById('home-enter-btn');
  const appEl     = document.querySelector('.app');
  if (!homePage) return;

  function getGreeting() {
    const h = new Date().getHours();
    return h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening';
  }
  function getAcc() {
    try { return JSON.parse(localStorage.getItem('focus-account') || 'null'); } catch { return null; }
  }
  function initials(name) {
    if (!name) return '?';
    return name.trim().split(/\s+/).map(w => w[0]).join('').toUpperCase().slice(0, 2);
  }

  // ── Sidebar ───────────────────────────────────────────────────
  function renderHomeSidebar() {
    const acc = getAcc();
    const avatarEl  = document.getElementById('hs-avatar');
    const nameEl    = document.getElementById('hs-name');
    const sinceEl   = document.getElementById('hs-since');
    const accAvatar = document.getElementById('hs-account-avatar');
    const accName   = document.getElementById('hs-account-name');
    if (acc) {
      if (avatarEl)  avatarEl.textContent  = initials(acc.name);
      if (nameEl)    nameEl.textContent    = acc.name;
      if (accAvatar) accAvatar.textContent = initials(acc.name);
      if (accName)   accName.textContent   = acc.name;
    }
    const created = localStorage.getItem('focus-account-created');
    if (sinceEl) sinceEl.textContent = created
      ? 'Since ' + new Date(created).toLocaleDateString('en-GB', { month: 'short', year: 'numeric' })
      : 'Local account';
    const dateEl = document.getElementById('hs-date');
    if (dateEl) dateEl.textContent = new Date().toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' });
    // board list in sidebar
    const boardList = document.getElementById('hs-board-list');
    if (boardList) {
      boardList.innerHTML = '';
      boards.forEach(board => {
        const count = tasks.filter(t => t.boardId === board.id).length;
        const li  = document.createElement('li');
        const btn = document.createElement('button');
        btn.className = 'hs-nav-item hs-board-nav';
        btn.innerHTML = `<span class="hs-board-emoji">${board.emoji}</span><span class="hs-board-label">${board.name}</span><span class="hs-board-count">${count}</span>`;
        btn.addEventListener('click', () => goBoard(board.id));
        li.appendChild(btn);
        boardList.appendChild(li);
      });
    }
  }

  // ── Stats row ────────────────────────────────────────────────
  function renderStats() {
    const row = document.getElementById('hs-stats-row');
    if (!row) return;
    const today     = new Date().toISOString().slice(0, 10);
    const total     = tasks.length;
    const done      = tasks.filter(t => t.done).length;
    const active    = tasks.filter(t => !t.done).length;
    const overdue   = tasks.filter(t => t.dueDate && t.dueDate < today && !t.done).length;
    const pomoTotal = tasks.reduce((s, t) => s + (t.pomodorosDone || 0), 0);
    row.innerHTML = [
      { icon: '📋', label: 'Total tasks',    value: total,     cls: '' },
      { icon: '✅', label: 'Completed',      value: done,      cls: '' },
      { icon: '⚠️', label: 'Overdue',        value: overdue,   cls: overdue > 0 ? 'warn' : '' },
      { icon: '🍅', label: 'Pomodoros done', value: pomoTotal, cls: '' },
    ].map(s => `<div class="hs-stat${s.cls ? ' hs-stat-' + s.cls : ''}">
        <span class="hs-stat-icon">${s.icon}</span>
        <span class="hs-stat-val">${s.value}</span>
        <span class="hs-stat-lbl">${s.label}</span>
      </div>`).join('');
    // Hero sub-line
    const sub = document.getElementById('hs-hero-sub');
    if (sub) {
      const parts = [];
      if (active > 0) parts.push(`${active} active task${active !== 1 ? 's' : ''}`);
      if (overdue > 0) parts.push(`${overdue} overdue`);
      if (pomoTotal > 0) parts.push(`${pomoTotal} pomodoro${pomoTotal !== 1 ? 's' : ''} done`);
      sub.textContent = parts.length ? parts.join(' · ') : 'No active tasks — all clear! 🎉';
    }
  }

  // helper: member initials
  function memberInitials(name) {
    if (!name) return '?';
    return name.trim().split(/\s+/).map(w => w[0]).join('').toUpperCase().slice(0, 2);
  }

  // ── Board grid ───────────────────────────────────────────────
  function renderGrid() {
    if (!grid) return;
    const acc = getAcc();
    if (greetEl) greetEl.textContent = getGreeting() + (acc ? ', ' + acc.name.split(' ')[0] : '') + '.';
    grid.innerHTML = '';
    boards.forEach((board, idx) => {
      const count   = tasks.filter(t => t.boardId === board.id).length;
      const doneN   = tasks.filter(t => t.boardId === board.id && t.done).length;
      const pct     = count ? Math.round((doneN / count) * 100) : 0;
      const color   = BOARD_COLORS[idx % BOARD_COLORS.length];
      const members = board.members || [];
      const shown   = members.slice(0, 5);
      const extra   = members.length > 5 ? members.length - 5 : 0;

      const avatarsHtml = shown.map(m =>
        `<div class="hb-member-av" style="background:${m.color}" title="${m.name}">${memberInitials(m.name)}</div>`
      ).join('') + (extra ? `<div class="hb-member-av hb-member-extra">+${extra}</div>` : '');

      const teamLabel = members.length > 0
        ? `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="12" height="12"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg> ${members.length}`
        : `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="12" height="12"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg> Team`;

      const card = document.createElement('div');
      card.className = 'hb-card';
      card.style.setProperty('--bc', color);
      card.innerHTML = `
        <div class="hb-top">
          <span class="hb-emoji">${board.emoji}</span>
          <span class="hb-count-badge">${count} task${count !== 1 ? 's' : ''}</span>
        </div>
        <p class="hb-name">${board.name}</p>
        <p class="hb-meta">${pct}% complete</p>
        <div class="hb-bar"><div class="hb-bar-fill" style="width:${pct}%"></div></div>
        <div class="hb-footer">
          <div class="hb-members">${avatarsHtml}</div>
          <button class="hb-team-btn" title="Manage team">${teamLabel}</button>
        </div>
        <button class="hb-del" title="Delete board">×</button>`;

      card.addEventListener('click', e => {
        if (!e.target.closest('.hb-del') && !e.target.closest('.hb-team-btn')) goBoard(board.id);
      });
      card.querySelector('.hb-del').addEventListener('click', e => {
        e.stopPropagation();
        if (confirm(`Delete board "${board.name}"? Tasks stay.`)) {
          boards = boards.filter(b => b.id !== board.id);
          saveBoards();
          if (activeBoardId === board.id) activeBoardId = null;
          renderBoards();
          renderHome();
        }
      });
      card.querySelector('.hb-team-btn').addEventListener('click', e => {
        e.stopPropagation();
        showTeamModal(board.id);
      });
      grid.appendChild(card);
    });
    const newCard = document.createElement('div');
    newCard.className = 'hb-card hb-new';
    newCard.innerHTML = `<div class="hb-new-icon">+</div><p class="hb-new-label">New board</p>`;
    newCard.addEventListener('click', showCreateForm);
    grid.appendChild(newCard);
  }

  // ── Recent tasks ─────────────────────────────────────────────
  function renderRecent() {
    const el = document.getElementById('hs-recent');
    if (!el) return;
    const recent = [...tasks].filter(t => !t.done)
      .sort((a, b) => (b.addedAt || 0) - (a.addedAt || 0)).slice(0, 6);
    if (recent.length === 0) {
      el.innerHTML = `<p class="hs-recent-empty">No active tasks — you're all clear! 🎉</p>`;
      return;
    }
    const todayStr = new Date().toISOString().slice(0, 10);
    el.innerHTML = recent.map(t => {
      const board    = boards.find(b => b.id === t.boardId);
      const hasPrio  = t.priority && t.priority !== 'none';
      const prioCls  = hasPrio ? ` prio-${t.priority}` : '';
      const prio     = hasPrio ? `<span class="hs-rt-prio">${t.priority}</span>` : '';
      const bd       = board ? `<span class="hs-rt-board">${board.emoji} ${board.name}</span>` : '';
      const isOverdue = t.dueDate && t.dueDate < todayStr;
      const due      = t.dueDate ? `<span class="hs-rt-due${isOverdue ? ' overdue' : ''}">${t.dueDate}</span>` : '';
      return `<div class="hs-rt-row${prioCls}" data-tid="${t.id}">
        <div class="hs-rt-main">
          <span class="hs-rt-text">${t.text}</span>
          <div class="hs-rt-meta">${bd}${prio}${due}</div>
        </div>
        <button class="hs-rt-go" title="Open task">→</button>
      </div>`;
    }).join('');
    el.querySelectorAll('.hs-rt-go').forEach(btn => {
      btn.addEventListener('click', () => {
        const t = tasks.find(tk => String(tk.id) === btn.closest('[data-tid]')?.dataset.tid);
        if (t?.boardId) goBoard(t.boardId); else enterAll();
      });
    });
  }

  function renderHome() {
    renderHomeSidebar();
    renderStats();
    renderGrid();
    renderRecent();
  }

  // ── Team modal ───────────────────────────────────────────────
  let currentTeamBoardId = null;

  function showTeamModal(boardId) {
    const board = boards.find(b => b.id === boardId);
    if (!board) return;
    if (!board.members) board.members = [];
    // Auto-seed owner as first member
    if (board.members.length === 0) {
      const acc = getAcc();
      if (acc) {
        board.members.push({ name: acc.name, color: MEMBER_COLORS[0] });
        saveBoards();
      }
    }
    currentTeamBoardId = boardId;
    const nameEl  = document.getElementById('team-modal-board-name');
    const emojiEl = document.getElementById('team-modal-emoji');
    const overlay = document.getElementById('team-modal-overlay');
    const errEl   = document.getElementById('team-invite-err');
    if (nameEl)  nameEl.textContent  = board.name;
    if (emojiEl) emojiEl.textContent = board.emoji;
    if (errEl)   { errEl.textContent = ''; errEl.classList.add('hidden'); }
    const inp = document.getElementById('team-invite-input');
    if (inp) inp.value = '';
    overlay?.classList.remove('hidden');
    setTimeout(() => inp?.focus(), 60);
    renderTeamMemberList();
  }

  function renderTeamMemberList() {
    const board  = boards.find(b => b.id === currentTeamBoardId);
    const listEl = document.getElementById('team-members-list');
    if (!board || !listEl) return;
    listEl.innerHTML = '';
    if (!board.members || board.members.length === 0) {
      listEl.innerHTML = '<p class="team-empty">No members yet — invite your first collaborator!</p>';
      return;
    }
    board.members.forEach((m, i) => {
      const isOwner = i === 0;
      const row = document.createElement('div');
      row.className = 'team-member-row' + (isOwner ? ' owner-row' : '');
      row.innerHTML = `
        <div class="team-member-av" style="background:${m.color}">${memberInitials(m.name)}</div>
        <div class="team-member-info">
          <span class="team-member-name">${m.name}</span>
          <span class="team-member-role ${isOwner ? 'owner' : 'member'}">${isOwner ? 'Owner' : 'Member'}</span>
        </div>
        ${!isOwner ? '<button class="team-member-remove" title="Remove member">×</button>' : ''}
      `;
      if (!isOwner) {
        row.querySelector('.team-member-remove').addEventListener('click', () => {
          board.members.splice(i, 1);
          saveBoards();
          renderTeamMemberList();
          renderGrid();
        });
      }
      listEl.appendChild(row);
    });
  }

  function inviteMember() {
    const input  = document.getElementById('team-invite-input');
    const errEl  = document.getElementById('team-invite-err');
    const name   = input?.value.trim();
    const board  = boards.find(b => b.id === currentTeamBoardId);
    if (!board || !name) { input?.focus(); return; }
    if (!board.members) board.members = [];
    if (board.members.some(m => m.name.toLowerCase() === name.toLowerCase())) {
      if (errEl) { errEl.textContent = `"${name}" is already a member.`; errEl.classList.remove('hidden'); }
      input?.select();
      return;
    }
    const color = MEMBER_COLORS[board.members.length % MEMBER_COLORS.length];
    board.members.push({ name, color });
    saveBoards();
    if (input)  input.value = '';
    if (errEl)  { errEl.textContent = ''; errEl.classList.add('hidden'); }
    renderTeamMemberList();
    renderGrid();
    input?.focus();
  }

  function closeTeamModal() {
    document.getElementById('team-modal-overlay')?.classList.add('hidden');
    currentTeamBoardId = null;
  }

  // Team modal listeners (wired once)
  document.getElementById('team-modal-close')?.addEventListener('click', closeTeamModal);
  document.getElementById('team-modal-overlay')?.addEventListener('click', e => {
    if (e.target === e.currentTarget) closeTeamModal();
  });
  document.getElementById('team-invite-btn')?.addEventListener('click', inviteMember);
  document.getElementById('team-invite-input')?.addEventListener('keydown', e => {
    if (e.key === 'Enter')  inviteMember();
    if (e.key === 'Escape') closeTeamModal();
  });

  // ── Create form ──────────────────────────────────────────────
  function showCreateForm() {
    if (!grid) return;
    grid.innerHTML = '';
    const form = document.createElement('div');
    form.className = 'hb-create-form';
    form.innerHTML = `
      <p class="hb-cf-title">New board</p>
      <input class="hb-cf-input" id="hb-name-inp" placeholder="Board name…" maxlength="40" autocomplete="off" />
      <div class="hb-cf-actions">
        <button class="hb-cf-create" id="hb-cf-create">Create</button>
        <button class="hb-cf-cancel" id="hb-cf-cancel">Cancel</button>
      </div>`;
    grid.appendChild(form);
    const inp = document.getElementById('hb-name-inp');
    inp?.focus();
    const create = () => {
      const name = inp?.value.trim();
      if (!name) { inp?.focus(); return; }
      const board = { id: 'b' + Date.now(), name, emoji: BOARD_EMOJIS[boards.length % BOARD_EMOJIS.length] };
      boards.push(board);
      saveBoards();
      renderBoards();
      goBoard(board.id);
    };
    document.getElementById('hb-cf-create')?.addEventListener('click', create);
    document.getElementById('hb-cf-cancel')?.addEventListener('click', renderHome);
    inp?.addEventListener('keydown', e => {
      if (e.key === 'Enter')  create();
      if (e.key === 'Escape') renderHome();
    });
  }

  function goBoard(boardId) {
    activeBoardId = boardId;
    activeFilter  = 'all';
    const board   = boards.find(b => b.id === boardId);
    document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
    document.querySelector(`[data-board-id="${boardId}"]`)?.classList.add('active');
    const vt = document.querySelector('.view-title');
    if (vt && board) vt.textContent = board.name;
    renderBoards();
    renderTasks();
    close();
  }

  function enterAll() {
    activeBoardId = null;
    activeFilter  = 'all';
    document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
    document.querySelector('.nav-item[data-filter="all"]')?.classList.add('active');
    const vt = document.querySelector('.view-title');
    if (vt) vt.textContent = 'All Tasks';
    renderBoards();
    renderTasks();
    close();
  }

  function open() {
    renderBoards();
    renderHome();
    appEl?.classList.add('hidden');
    document.getElementById('account-page')?.classList.add('hidden');
    homePage.classList.remove('hidden');
  }

  function close() {
    homePage.classList.add('hidden');
    appEl?.classList.remove('hidden');
  }

  enterBtn?.addEventListener('click', enterAll);
  document.getElementById('hs-nav-tasks')?.addEventListener('click', enterAll);
  document.getElementById('hs-nav-home')?.addEventListener('click', () => {
    renderHome();
    document.querySelectorAll('.hs-nav-item').forEach(n => n.classList.remove('active'));
    document.getElementById('hs-nav-home')?.classList.add('active');
  });
  document.getElementById('hs-new-board-btn')?.addEventListener('click',  showCreateForm);
  document.getElementById('hs-new-board-main')?.addEventListener('click', showCreateForm);
  document.getElementById('hs-account-btn')?.addEventListener('click', () => {
    close();
    appEl?.classList.add('hidden');
    document.getElementById('nav-account-btn')?.click();
  });

  window.openHomePage = open;
})();

(function initSplash() {
  const splash        = document.getElementById('splash');
  const enterBtn      = document.getElementById('splash-enter');
  const dateHint      = document.getElementById('splash-date');
  const statsBox      = document.getElementById('splash-stats');
  if (!splash) return;

  // ── Helpers ──────────────────────────────────────────────────
  const ACCOUNT_KEY = 'focus-account';
  function saveAccount(name, password) {
    localStorage.setItem(ACCOUNT_KEY, JSON.stringify({
      name, passwordHash: btoa(encodeURIComponent(password))
    }));
  }
  function loadAccount() {
    try { return JSON.parse(localStorage.getItem(ACCOUNT_KEY)); } catch { return null; }
  }
  function checkPassword(password, hash) {
    return btoa(encodeURIComponent(password)) === hash;
  }
  function clearAccount() { localStorage.removeItem(ACCOUNT_KEY); }

  // ── Dismiss (slide-out animation) ────────────────────────────
  function dismiss() {
    splash.classList.add('splash-out');
    splash.addEventListener('animationend', () => splash.remove(), { once: true });
  }

  // ── After successful auth: go to home page ────────────────
  function postAuth() {
    refreshAccountNav();
    dismiss();
    window.openHomePage?.();
  }

  // ── Onboarding step (first task) ─────────────────────────────
  function goOnboard() {
    splash.classList.remove('splash-step-signup', 'splash-step-login');
    splash.classList.add('splash-onboarding');
    const hl = splash.querySelector('.splash-headline');
    if (hl) hl.innerHTML = "Add your first task.<br><span>Let\u2019s get going.</span>";
    setTimeout(() => document.getElementById('splash-first-task')?.focus(), 80);
  }
  function submitFirst() {
    const val = document.getElementById('splash-first-task')?.value.trim();
    if (val) {
      tasks.push({
        id: Date.now(), text: val, done: false, priority: 'none',
        tags: [], createdAt: new Date().toISOString(), subtasks: [],
        dueDate: null, recur: 'none', pomoEst: 0, pomoDone: 0
      });
      saveTasks();
      renderTasks();
    }
    dismiss();
  }
  document.getElementById('splash-onboard-submit')?.addEventListener('click', submitFirst);
  document.getElementById('splash-skip')?.addEventListener('click', dismiss);
  document.getElementById('splash-first-task')?.addEventListener('keydown', e => {
    if (e.key === 'Enter') { e.preventDefault(); submitFirst(); }
    if (e.key === 'Escape') dismiss();
  });

  // ── Sign up step ─────────────────────────────────────────────
  function goSignup() {
    splash.classList.add('splash-step-signup');
    const hl = splash.querySelector('.splash-headline');
    if (hl) hl.innerHTML = "Create your account.<br><span>It only takes a second.</span>";
    setTimeout(() => document.getElementById('signup-name')?.focus(), 80);
  }
  document.getElementById('signup-submit')?.addEventListener('click', () => {
    const name     = document.getElementById('signup-name')?.value.trim();
    const pw       = document.getElementById('signup-password')?.value;
    const confirm  = document.getElementById('signup-confirm')?.value;
    const errEl    = document.getElementById('signup-error');
    if (!name)          { showErr(errEl, 'Please enter your name.'); return; }
    if (!pw)            { showErr(errEl, 'Please choose a password.'); return; }
    if (pw !== confirm) { showErr(errEl, 'Passwords do not match.'); return; }
    saveAccount(name, pw);
    localStorage.setItem('focus-account-created', new Date().toISOString());
    postAuth();
  });
  ['signup-name','signup-password','signup-confirm'].forEach(id => {
    document.getElementById(id)?.addEventListener('keydown', e => {
      if (e.key === 'Enter') document.getElementById('signup-submit')?.click();
    });
  });

  // ── Login step ───────────────────────────────────────────────
  function goLogin(account) {
    splash.classList.add('splash-step-login');
    const hl = splash.querySelector('.splash-headline');
    if (hl) hl.innerHTML = `Welcome back,<br><span>${account.name}.</span>`;
    const greeting = document.getElementById('login-greeting');
    if (greeting) greeting.textContent = 'Enter your password to continue';
    setTimeout(() => document.getElementById('login-password')?.focus(), 80);
  }
  document.getElementById('login-submit')?.addEventListener('click', () => {
    const account = loadAccount();
    const pw      = document.getElementById('login-password')?.value;
    const errEl   = document.getElementById('login-error');
    if (!pw)                              { showErr(errEl, 'Please enter your password.'); return; }
    if (!checkPassword(pw, account.passwordHash)) { showErr(errEl, 'Incorrect password. Try again.'); return; }
    postAuth();
  });
  document.getElementById('login-password')?.addEventListener('keydown', e => {
    if (e.key === 'Enter') document.getElementById('login-submit')?.click();
  });
  document.getElementById('login-switch-account')?.addEventListener('click', () => {
    clearAccount();
    splash.classList.remove('splash-step-login');
    goSignup();
  });

  // ── Shared error helper ───────────────────────────────────────
  function showErr(el, msg) {
    if (!el) return;
    el.textContent = msg;
    el.classList.add('visible');
    clearTimeout(el._t);
    el._t = setTimeout(() => el.classList.remove('visible'), 3500);
  }

  // ── Date / greeting line ─────────────────────────────────────
  if (dateHint) {
    const h = new Date().getHours();
    const greet = h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening';
    dateHint.textContent = greet + ' \u2014 ' + new Date().toLocaleDateString('en-GB', {
      weekday: 'long', day: 'numeric', month: 'long'
    });
  }

  // ── Stats row (returning users with tasks) ───────────────────
  if (statsBox && tasks.length > 0) {
    const today = new Date().toISOString().slice(0, 10);
    const total = tasks.length;
    const done  = tasks.filter(t => t.done).length;
    const due   = tasks.filter(t => t.dueDate && t.dueDate <= today && !t.done).length;
    statsBox.innerHTML =
      `<div class="sp-stat"><span class="sp-n">${total}</span><span class="sp-l">total</span></div>` +
      `<div class="sp-stat"><span class="sp-n">${done}</span><span class="sp-l">done</span></div>` +
      (due > 0 ? `<div class="sp-stat sp-overdue"><span class="sp-n">${due}</span><span class="sp-l">due today</span></div>` : '');
  }

  // ── "Open app" button — auth gate ────────────────────────────
  enterBtn?.addEventListener('click', () => {
    const account = loadAccount();
    if (!account) goSignup(); else goLogin(account);
  });

  // Global Enter/Escape on the landing step only
  document.addEventListener('keydown', function onKey(e) {
    if (splash.classList.contains('splash-step-signup') ||
        splash.classList.contains('splash-step-login')  ||
        splash.classList.contains('splash-onboarding')) return;
    if (e.key === 'Escape') { document.removeEventListener('keydown', onKey); dismiss(); }
    if (e.key === 'Enter') {
      document.removeEventListener('keydown', onKey);
      const account = loadAccount();
      if (!account) goSignup(); else goLogin(account);
    }
  });
})();

// ─── Auto-Updater UI ─────────────────────────────────────────────────────────
(function initUpdater() {
  if (!window.electronAPI) return; // safety guard for browser/dev preview

  const banner          = document.getElementById('update-banner');
  const bannerText      = document.getElementById('update-banner-text');
  const showBtn         = document.getElementById('update-show-btn');
  const dismissBtn      = document.getElementById('update-dismiss-btn');
  const overlay         = document.getElementById('update-modal-overlay');
  const modalVersion    = document.getElementById('update-modal-version');
  const modalNotes      = document.getElementById('update-modal-notes');
  const progressWrap    = document.getElementById('update-progress-wrap');
  const progressFill    = document.getElementById('update-progress-fill');
  const progressPct     = document.getElementById('update-progress-pct');
  const installBtn      = document.getElementById('update-install-btn');
  const laterBtn        = document.getElementById('update-later-btn');
  const modalClose      = document.getElementById('update-modal-close');

  let currentUpdateInfo = null;
  let downloadStarted   = false;
  let downloadDone      = false;

  // ── Helpers ──────────────────────────────────────────────────────────
  function formatNotes(notes) {
    if (!notes) return '<p>Ingen beskrivelse tilgængelig.</p>';
    if (typeof notes === 'string') {
      // Konverter simpel markdown-liste til HTML
      return notes
        .split('\n')
        .filter(l => l.trim())
        .map(l => {
          l = l.trim();
          if (l.startsWith('## '))  return `<h3>${l.slice(3)}</h3>`;
          if (l.startsWith('### ')) return `<h4>${l.slice(4)}</h4>`;
          if (l.startsWith('- ') || l.startsWith('* ')) return `<li>${l.slice(2)}</li>`;
          if (l.startsWith('# '))  return `<strong>${l.slice(2)}</strong>`;
          return `<p>${l}</p>`;
        })
        .join('')
        .replace(/(<li>.*<\/li>)+/g, m => `<ul>${m}</ul>`);
    }
    // Array af release-noter (f.eks. fra GitHub)
    if (Array.isArray(notes)) {
      return notes.map(n => {
        const v = n.version ? `<strong>v${n.version}</strong><br>` : '';
        return `<div class="rn-block">${v}${formatNotes(n.note)}</div>`;
      }).join('');
    }
    return '<p>Ingen beskrivelse tilgængelig.</p>';
  }

  function showBanner(version) {
    bannerText.textContent = `Version ${version} er klar til download`;
    banner.classList.remove('hidden');
    // Animate in
    requestAnimationFrame(() => banner.classList.add('update-banner--visible'));
  }

  function hideBanner() {
    banner.classList.remove('update-banner--visible');
    setTimeout(() => banner.classList.add('hidden'), 300);
  }

  function openModal() {
    if (!currentUpdateInfo) return;
    overlay.classList.remove('hidden');
    requestAnimationFrame(() => overlay.classList.add('update-modal--open'));
  }

  function closeModal() {
    overlay.classList.remove('update-modal--open');
    setTimeout(() => overlay.classList.add('hidden'), 250);
  }

  function setInstallBtnReady() {
    installBtn.innerHTML = `
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
        <polyline points="23 4 23 10 17 10"/><polyline points="1 20 1 14 7 14"/>
        <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"/>
      </svg>
      Genstart & Installer`;
    installBtn.classList.add('update-action-restart');
  }

  // ── Events fra main process ───────────────────────────────────────────
  window.electronAPI.onUpdateAvailable((info) => {
    currentUpdateInfo = info;
    modalVersion.textContent = `Version ${info.version}`;
    modalNotes.innerHTML = formatNotes(info.releaseNotes);
    showBanner(info.version);
  });

  window.electronAPI.onUpdateProgress((p) => {
    if (!downloadStarted) {
      downloadStarted = true;
      progressWrap.classList.remove('hidden');
      installBtn.disabled = true;
      installBtn.textContent = 'Downloader...';
    }
    const pct = p.percent;
    progressFill.style.width = pct + '%';
    progressPct.textContent  = pct + '%';
  });

  window.electronAPI.onUpdateDownloaded((info) => {
    downloadDone = true;
    progressWrap.classList.add('hidden');
    installBtn.disabled = false;
    setInstallBtnReady();
    // Opdater banner
    bannerText.textContent = `Version ${info.version} hentet — klar til installation`;
    showBtn.textContent    = 'Genstart nu';
  });

  window.electronAPI.onUpdateError?.((msg) => {
    console.warn('[Updater fejl]', msg);
  });

  window.electronAPI.onUpdateNotAvailable?.(() => {
    console.log('[Updater] Ingen opdatering tilgængelig');
  });

  // Renderer starter check selv — sikrer listeners er klar inden check køres
  setTimeout(() => {
    window.electronAPI.checkForUpdates().catch((e) => {
      console.warn('[Updater check fejlede]', e?.message ?? e);
    });
  }, 4000);

  // ── Knapper ──────────────────────────────────────────────────────────
  showBtn.addEventListener('click', () => {
    if (downloadDone) {
      window.electronAPI.installUpdate();
    } else {
      openModal();
    }
  });

  dismissBtn.addEventListener('click', hideBanner);
  modalClose.addEventListener('click', closeModal);
  laterBtn.addEventListener('click', closeModal);

  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) closeModal();
  });

  installBtn.addEventListener('click', () => {
    if (downloadDone) {
      window.electronAPI.installUpdate();
    } else if (!downloadStarted) {
      window.electronAPI.startDownloadUpdate();
    }
  });
})();
