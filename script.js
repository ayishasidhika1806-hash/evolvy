'use strict';

const STORAGE_KEY = 'evolvi-data-v1';
const DAY_MS = 86400000;
const defaultData = () => ({
  tasks: [],
  goals: [],
  journal: [],
  completions: [],
  planner: [],
  focusSessions: [],
  profile: { name: '' },
  intention: '',
});

function loadData() {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}');
    const fallback = defaultData();
    return {
      ...fallback,
      ...saved,
      tasks: Array.isArray(saved.tasks) ? saved.tasks : [],
      goals: Array.isArray(saved.goals) ? saved.goals : [],
      journal: Array.isArray(saved.journal) ? saved.journal : [],
      completions: Array.isArray(saved.completions) ? saved.completions : [],
      planner: Array.isArray(saved.planner) ? saved.planner : [],
      focusSessions: Array.isArray(saved.focusSessions) ? saved.focusSessions : [],
      profile: { ...fallback.profile, ...(saved.profile || {}) },
      intention: typeof saved.intention === 'string' ? saved.intention : '',
    };
  } catch {
    return defaultData();
  }
}

let data = loadData();
let currentPage = 'dashboard';
let selectedPlanDate = '';
let weekOffset = 0;
let journalEditId = null;
let timerLength = 25;
let timerRemaining = timerLength * 60;
let timerInterval = null;
let timerRunning = false;
let toastTimeout = null;

const $ = (selector, parent = document) => parent.querySelector(selector);
const $$ = (selector, parent = document) => [...parent.querySelectorAll(selector)];
const dateFromKey = (key) => new Date(`${key}T12:00:00`);
const localDateKey = (date) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
function todayKey() { return localDateKey(new Date()); }
selectedPlanDate = todayKey();
function makeId() { return globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(16).slice(2)}`; }
function saveData() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
  } catch {
    showToast('This browser could not save data. Check its storage settings.');
  }
}
function escapeHTML(value) {
  return String(value ?? '').replace(/[&<>"']/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]);
}
function formatDate(key, options = { month: 'long', day: 'numeric', year: 'numeric' }) {
  return dateFromKey(key).toLocaleDateString('en-US', options);
}
function formatRelative(key) {
  if (key === todayKey()) return 'Today';
  const age = Math.floor((dateFromKey(todayKey()) - dateFromKey(key)) / DAY_MS);
  if (age === 1) return 'Yesterday';
  if (age >= 0 && age < 7) return `${age} days ago`;
  return formatDate(key);
}
function beginningOfWeek(date) {
  const result = new Date(date);
  result.setHours(12, 0, 0, 0);
  result.setDate(result.getDate() - ((result.getDay() + 6) % 7));
  return result;
}
function showToast(message) {
  const toast = $('#toast');
  toast.textContent = message;
  toast.hidden = false;
  clearTimeout(toastTimeout);
  toastTimeout = setTimeout(() => { toast.hidden = true; }, 2600);
}
function completionDates() {
  return [...new Set(data.completions.map((item) => item.date))].sort();
}
function currentStreak() {
  const dates = new Set(completionDates());
  const cursor = dateFromKey(todayKey());
  if (!dates.has(todayKey())) cursor.setDate(cursor.getDate() - 1);
  let count = 0;
  while (dates.has(localDateKey(cursor))) {
    count += 1;
    cursor.setDate(cursor.getDate() - 1);
  }
  return count;
}
function weekDaysFor(offset = 0) {
  const start = beginningOfWeek(new Date());
  start.setDate(start.getDate() + offset * 7);
  return Array.from({ length: 7 }, (_, index) => {
    const day = new Date(start);
    day.setDate(start.getDate() + index);
    const key = localDateKey(day);
    return { date: day, key, count: data.completions.filter((item) => item.date === key).length, today: key === todayKey() };
  });
}
function weekRangeLabel(days) {
  const first = days[0].date;
  const last = days[6].date;
  const firstMonth = first.toLocaleDateString('en-US', { month: 'short' });
  const lastMonth = last.toLocaleDateString('en-US', { month: 'short' });
  return firstMonth === lastMonth
    ? `${firstMonth} ${first.getDate()}–${last.getDate()}, ${last.getFullYear()}`
    : `${firstMonth} ${first.getDate()} – ${lastMonth} ${last.getDate()}, ${last.getFullYear()}`;
}
function weeklyFocusMinutes() {
  const today = dateFromKey(todayKey());
  const weekStart = beginningOfWeek(today);
  return data.focusSessions.filter((session) => dateFromKey(session.date) >= weekStart && dateFromKey(session.date) <= today).reduce((total, session) => total + session.minutes, 0);
}

function navigate(page) {
  const target = document.querySelector(`[data-view="${page}"]`);
  if (!target) return;
  currentPage = page;
  $$('.view').forEach((view) => {
    const active = view.dataset.view === page;
    view.hidden = !active;
    view.classList.toggle('active', active);
  });
  $$('[data-page]').forEach((button) => button.classList.toggle('active', button.dataset.page === page));
  $('#page-label').textContent = ({ dashboard: 'Dashboard', planner: 'Planner', focus: 'Focus room', goals: 'Goals & habits', journal: 'Journal', progress: 'Progress' })[page] || 'Dashboard';
  window.scrollTo({ top: 0, behavior: 'smooth' });
  renderPage(page);
}

function renderDate() {
  const today = new Date();
  const key = todayKey();
  $('#top-date').textContent = today.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' }).toUpperCase();
  $('#date-day').textContent = today.toLocaleDateString('en-US', { day: '2-digit' });
  $('#date-weekday').textContent = today.toLocaleDateString('en-US', { weekday: 'long' }).toUpperCase();
  $('#date-month').textContent = today.toLocaleDateString('en-US', { month: 'long', year: 'numeric' }).toUpperCase();
  $('#journal-date').textContent = formatDate(key, { weekday: 'short', month: 'short', day: 'numeric' });
}

function renderProfile() {
  const name = data.profile.name.trim();
  $('#profile-label').textContent = name || 'Your space';
  $('#profile-avatar').textContent = name ? name.charAt(0).toUpperCase() : 'E';
  $('#profile-shortcut').textContent = name ? name.charAt(0).toUpperCase() : 'E';
  $('#welcome-title').textContent = name ? `Your day, your way, ${name.split(/\s+/)[0]}.` : 'Your day, your way.';
}

function renderTasks() {
  const tasks = data.tasks.filter((task) => !task.archived);
  const done = tasks.filter((task) => task.completedOn === todayKey()).length;
  $('#task-count').textContent = `${done}/${tasks.length}`;
  $('#planner-count').textContent = data.planner.filter((plan) => plan.date === todayKey()).length;
  $('#stat-percent').textContent = tasks.length ? Math.round(done / tasks.length * 100) : 0;
  $('#stat-tasks').textContent = `${done} of ${tasks.length} ${tasks.length === 1 ? 'task' : 'tasks'}`;
  $('#stat-progress-line').style.width = `${tasks.length ? done / tasks.length * 100 : 0}%`;
  const habits = tasks.filter((task) => task.kind === 'habit');
  const habitsDone = habits.filter((task) => task.completedOn === todayKey()).length;
  $('#stat-habits').textContent = habitsDone;
  $('#stat-habits-total').textContent = `/ ${habits.length}`;
  $('#stat-streak').textContent = currentStreak();
  $('#stat-focus').textContent = weeklyFocusMinutes();
  $('#task-motivation').textContent = !tasks.length ? 'Start with one small thing.' : done === tasks.length ? 'You made space for it.' : `${tasks.length - done} small ${tasks.length - done === 1 ? 'step' : 'steps'} to go.`;

  $('#task-list').innerHTML = tasks.length ? tasks.map((task) => {
    const completed = task.completedOn === todayKey();
    const habit = task.kind === 'habit';
    return `<div class="task-row ${completed ? 'done' : ''}" data-task-row="${escapeHTML(task.id)}">
      <button class="task-check" data-action="toggle-task" data-id="${escapeHTML(task.id)}" aria-label="${completed ? 'Mark incomplete' : 'Complete'} ${escapeHTML(task.title)}">${completed ? '<span>✓</span>' : ''}</button>
      <button class="task-main" data-action="edit-task" data-id="${escapeHTML(task.id)}" title="Edit task"><span>${escapeHTML(task.title)}</span><span class="kind-pill ${habit ? '' : 'task-pill'}">${habit ? 'HABIT' : 'TASK'}</span></button>
      <div class="task-tools"><button class="mini-button" data-action="delete-task" data-id="${escapeHTML(task.id)}" aria-label="Delete ${escapeHTML(task.title)}">×</button></div>
    </div>`;
  }).join('') : `<div class="empty-state"><span class="empty-orbit">＋</span><strong>A fresh page, all yours.</strong><small>Add a task or a habit to start your day.</small></div>`;
  renderMiniChart();
  renderGoalPreview();
  renderWins();
}

function renderMiniChart() {
  const days = weekDaysFor();
  const max = Math.max(1, ...days.map((day) => day.count));
  const total = days.reduce((sum, day) => sum + day.count, 0);
  $('#week-total').textContent = total;
  $('#week-average').textContent = total ? `${days.filter((day) => day.count).length} active days` : 'Your pace, your rules.';
  $('#mini-chart').innerHTML = days.map((day) => `<div class="mini-bar-column"><div class="mini-bar ${day.today ? 'today' : ''}" style="height:${day.count ? Math.max(9, day.count / max * 48) : 3}px" title="${day.count} completions"></div><small class="${day.today ? 'today-label' : ''}">${day.date.toLocaleDateString('en-US', { weekday: 'short' }).slice(0,1)}</small></div>`).join('');
}

function renderGoalPreview() {
  const goals = data.goals.filter((goal) => goal.progress < 100).slice(0, 2);
  $('#goal-preview-list').innerHTML = goals.length ? goals.map((goal) => `<div class="goal-mini"><div class="goal-mini-top"><span class="goal-mini-icon">◎</span><span class="goal-mini-copy"><strong>${escapeHTML(goal.title)}</strong><small>${escapeHTML(goal.details || 'One step at a time.')}</small></span><span class="goal-mini-progress">${goal.progress}%</span></div><div class="goal-mini-track"><i style="width:${goal.progress}%"></i></div></div>`).join('') : `<div class="panel-empty-note"><span>◎</span>${data.goals.length ? 'Every goal on your list is complete. Take a moment to enjoy that.' : 'Your goals will feel at home here.'}</div>`;
}

function renderWins() {
  const wins = [...data.completions].sort((a, b) => `${b.date}${b.createdAt || ''}`.localeCompare(`${a.date}${a.createdAt || ''}`)).slice(0, 3);
  $('#recent-wins').innerHTML = wins.length ? wins.map((item) => {
    const task = data.tasks.find((candidate) => candidate.id === item.taskId);
    const goal = data.goals.find((candidate) => candidate.id === item.goalId);
    return `<div class="win-mini"><span class="win-check">✓</span><div><strong>${escapeHTML(goal?.title || task?.title || 'A task you finished')}</strong><small>${escapeHTML(formatRelative(item.date))}</small></div><span>↗</span></div>`;
  }).join('') : `<div class="panel-empty-note"><span>✳</span>Your wins will collect here. They’re worth remembering.</div>`;
}

function renderGoals() {
  const incomplete = data.goals.filter((goal) => goal.progress < 100);
  $('#goal-total').textContent = data.goals.length;
  $('#goal-list').innerHTML = data.goals.length ? data.goals.map((goal) => `<article class="goal-card" data-goal-id="${escapeHTML(goal.id)}"><div class="goal-card-top"><span class="goal-card-symbol">◎</span><div class="goal-card-copy"><strong>${escapeHTML(goal.title)}</strong><p>${escapeHTML(goal.details || (goal.progress === 100 ? 'You made it happen.' : 'One step at a time.'))}</p></div><div class="goal-card-menu"><button data-action="edit-goal" data-id="${escapeHTML(goal.id)}" aria-label="Edit ${escapeHTML(goal.title)}" title="Edit goal">✎</button><button data-action="delete-goal" data-id="${escapeHTML(goal.id)}" aria-label="Delete ${escapeHTML(goal.title)}" title="Delete goal">×</button></div></div><div class="goal-progress-line"><div class="goal-track"><i style="width:${goal.progress}%"></i></div><span>${goal.progress}%</span></div>${goal.progress < 100 ? '<button class="goal-nudge" data-action="nudge-goal" data-id="' + escapeHTML(goal.id) + '">＋ Add a little progress</button>' : '<span class="goal-complete-tag">✓ You made it happen.</span>'}</article>`).join('') : `<div class="goal-empty"><span>◎</span><strong>Your horizon is wide open.</strong><small>Give something you care about a direction and take it one step at a time.</small></div>`;
  const habitTasks = data.tasks.filter((task) => task.kind === 'habit' && !task.archived);
  renderHabitTracker(habitTasks);
  renderGoalPreview();
  return incomplete.length;
}

function renderHabitTracker(habits) {
  if (!habits.length) {
    $('#habit-overview').innerHTML = '<div class="habit-empty">Add a task and choose “Habit” to start a gentle daily tracker.</div>';
    return;
  }
  const days = Array.from({ length: 7 }, (_, index) => {
    const date = dateFromKey(todayKey());
    date.setDate(date.getDate() - (6 - index));
    return { date, key: localDateKey(date) };
  });
  $('#habit-overview').innerHTML = days.map((day) => {
    const done = habits.filter((habit) => data.completions.some((item) => item.taskId === habit.id && item.date === day.key)).length;
    return `<div class="habit-day-cell ${done ? 'complete' : ''} ${day.key === todayKey() ? 'today' : ''}"><small>${day.date.toLocaleDateString('en-US', { weekday: 'short' }).slice(0,3).toUpperCase()}</small><span>${done === habits.length ? '✓' : done || '·'}</span></div>`;
  }).join('');
}

function addTask(event) {
  event.preventDefault();
  const input = $('#task-title');
  const title = input.value.trim();
  if (!title || title.length > 72) return showToast('Enter a task title under 72 characters.');
  const task = { id: makeId(), title, kind: $('#task-kind').value, createdAt: todayKey(), completedOn: null };
  data.tasks.unshift(task);
  saveData();
  input.value = '';
  renderAll();
  input.focus();
  showToast(task.kind === 'habit' ? 'Habit added to your daily rhythm.' : 'Task added to today.');
}

function toggleTask(id) {
  const task = data.tasks.find((item) => item.id === id);
  if (!task) return;
  const completing = task.completedOn !== todayKey();
  task.completedOn = completing ? todayKey() : null;
  if (completing && !data.completions.some((item) => item.taskId === id && item.date === todayKey())) {
    data.completions.push({ taskId: id, date: todayKey(), createdAt: new Date().toISOString() });
  } else if (!completing) {
    data.completions = data.completions.filter((item) => item.taskId !== id || item.date !== todayKey());
  }
  saveData();
  renderAll();
  showToast(completing ? 'A little progress, logged.' : 'Task moved back to your list.');
}

function editTask(id) {
  const task = data.tasks.find((item) => item.id === id);
  if (!task) return;
  const title = window.prompt('Edit this task', task.title);
  if (title === null) return;
  if (!title.trim() || title.trim().length > 72) return showToast('Add a task title under 72 characters.');
  task.title = title.trim();
  saveData();
  renderAll();
  showToast('Task updated.');
}

function deleteTask(id) {
  const task = data.tasks.find((item) => item.id === id);
  if (!task) return;
  data.tasks = data.tasks.filter((item) => item.id !== id);
  data.completions = data.completions.filter((item) => item.taskId !== id);
  saveData();
  renderAll();
  showToast('Task removed.');
}

function addGoal(event) {
  event.preventDefault();
  const title = $('#goal-title').value.trim();
  const details = $('#goal-details').value.trim();
  if (!title || title.length > 64) return showToast('Add a goal title under 64 characters.');
  data.goals.unshift({ id: makeId(), title, details: details.slice(0, 140), progress: 0, createdAt: todayKey() });
  saveData();
  event.currentTarget.reset();
  renderAll();
  showToast('A new goal. A fresh direction.');
}

function nudgeGoal(id) {
  const goal = data.goals.find((item) => item.id === id);
  if (!goal || goal.progress >= 100) return;
  goal.progress = Math.min(100, Number(goal.progress) + 25);
  if (goal.progress === 100 && !data.completions.some((item) => item.goalId === id)) {
    goal.completedAt = todayKey();
    data.completions.push({ goalId: id, date: todayKey(), createdAt: new Date().toISOString() });
  }
  saveData();
  renderAll();
  showToast(goal.progress === 100 ? 'Goal complete. Take that in.' : 'Goal progress updated.');
}

function editGoal(id) {
  const goal = data.goals.find((item) => item.id === id);
  if (!goal) return;
  const title = window.prompt('Edit your goal', goal.title);
  if (title === null) return;
  if (!title.trim() || title.trim().length > 64) return showToast('Add a goal title under 64 characters.');
  goal.title = title.trim();
  saveData();
  renderAll();
  showToast('Goal updated.');
}

function deleteGoal(id) {
  data.goals = data.goals.filter((goal) => goal.id !== id);
  data.completions = data.completions.filter((item) => item.goalId !== id);
  saveData();
  renderAll();
  showToast('Goal removed.');
}

function renderPlanner() {
  const days = weekDaysFor(weekOffset);
  const selected = days.find((day) => day.key === selectedPlanDate) || days.find((day) => day.today) || days[0];
  selectedPlanDate = selected.key;
  $('#planner-range').textContent = weekOffset === 0 ? `This week · ${weekRangeLabel(days)}` : weekRangeLabel(days);
  $('#planner-days').innerHTML = days.map((day) => `<button class="planner-day ${day.key === selected.key ? 'selected' : ''} ${day.today ? 'today' : ''}" data-action="select-day" data-date="${day.key}"><span class="day-weekday">${day.date.toLocaleDateString('en-US', { weekday: 'short' })}</span><strong class="day-number">${day.date.getDate()}</strong>${data.planner.some((plan) => plan.date === day.key) ? '<i class="day-dot"></i>' : ''}</button>`).join('');
  $('#agenda-date-label').textContent = selected.key === todayKey() ? 'TODAY' : selected.date.toLocaleDateString('en-US', { weekday: 'long' }).toUpperCase();
  $('#agenda-title').textContent = selected.key === todayKey() ? 'Your day, with room to move.' : `${selected.date.toLocaleDateString('en-US', { weekday: 'long' })}, with room to move.`;
  const plans = data.planner.filter((plan) => plan.date === selected.key).sort((a, b) => (a.time || '').localeCompare(b.time || ''));
  $('#agenda-count').textContent = `${plans.length} ${plans.length === 1 ? 'PLAN' : 'PLANS'}`;
  $('#agenda-list').innerHTML = plans.length ? plans.map((plan) => `<div class="agenda-row" data-kind="${escapeHTML(plan.kind)}"><span class="agenda-time">${plan.time ? formatTime(plan.time) : 'Any time'}</span><i class="agenda-color"></i><div class="agenda-content"><strong>${escapeHTML(plan.title)}</strong><small>${escapeHTML(plan.kind || 'plan')}</small></div><button class="agenda-delete" data-action="delete-plan" data-id="${escapeHTML(plan.id)}" aria-label="Delete plan ${escapeHTML(plan.title)}">×</button></div>`).join('') : '<div class="agenda-empty">Nothing planned here. Leave it open or add something below.</div>';
  $('#plan-time').value ||= '';
}

function formatTime(value) {
  const [hours, minutes] = value.split(':').map(Number);
  return new Date(2000, 0, 1, hours, minutes).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
}

function addPlan(event) {
  event.preventDefault();
  const title = $('#plan-title').value.trim();
  if (!title || title.length > 72) return showToast('Enter a plan title under 72 characters.');
  data.planner.push({ id: makeId(), title, date: selectedPlanDate, time: $('#plan-time').value, kind: $('#plan-kind').value });
  saveData();
  event.currentTarget.reset();
  renderPlanner();
  renderTasks();
  showToast('Plan added to your day.');
}

function deletePlan(id) {
  data.planner = data.planner.filter((plan) => plan.id !== id);
  saveData();
  renderPlanner();
  renderTasks();
  showToast('Plan removed.');
}

function renderFocus() {
  $('#intention-saved').textContent = data.intention ? `A note to yourself: ${data.intention}` : 'Your intention stays here until you change it.';
  $('#session-week-minutes').textContent = weeklyFocusMinutes();
  const sessions = [...data.focusSessions].sort((a, b) => `${b.date}${b.createdAt || ''}`.localeCompare(`${a.date}${a.createdAt || ''}`)).slice(0, 4);
  $('#focus-session-list').innerHTML = sessions.length ? sessions.map((session) => `<div class="session-row"><span>${escapeHTML(formatRelative(session.date))} · ${session.minutes} min</span><span>DONE ✓</span></div>`).join('') : '<div class="session-empty">Your first finished session will show up here.</div>';
  updateTimerDisplay();
}

function updateTimerDisplay() {
  const minutes = Math.floor(timerRemaining / 60).toString().padStart(2, '0');
  const seconds = (timerRemaining % 60).toString().padStart(2, '0');
  $('#timer-display').textContent = `${minutes}:${seconds}`;
  $('#timer-status').textContent = timerRunning ? 'YOU’RE IN YOUR FLOW' : timerRemaining === timerLength * 60 ? 'READY WHEN YOU ARE' : 'PAUSED, NO RUSH';
  $('#timer-start').innerHTML = timerRunning ? 'Pause for a moment <span>Ⅱ</span>' : timerRemaining === timerLength * 60 ? 'Start focus <span>→</span>' : 'Keep going <span>→</span>';
  $('#timer-ring').classList.toggle('running', timerRunning);
}

function startTimer() {
  if (timerRunning) {
    clearInterval(timerInterval);
    timerRunning = false;
    updateTimerDisplay();
    return;
  }
  timerRunning = true;
  updateTimerDisplay();
  timerInterval = setInterval(() => {
    timerRemaining -= 1;
    if (timerRemaining <= 0) completeFocusSession();
    else updateTimerDisplay();
  }, 1000);
}

function resetTimer() {
  clearInterval(timerInterval);
  timerRunning = false;
  timerRemaining = timerLength * 60;
  updateTimerDisplay();
}

function completeFocusSession() {
  clearInterval(timerInterval);
  timerRunning = false;
  timerRemaining = 0;
  data.focusSessions.push({ id: makeId(), date: todayKey(), minutes: timerLength, createdAt: new Date().toISOString() });
  saveData();
  updateTimerDisplay();
  renderTasks();
  renderFocus();
  showToast(`Focus session complete. ${timerLength} minutes, all yours.`);
  timerRemaining = timerLength * 60;
  updateTimerDisplay();
}

function renderJournal() {
  const entries = [...data.journal].sort((a, b) => `${b.date}${b.updatedAt || ''}`.localeCompare(`${a.date}${a.updatedAt || ''}`));
  $('#journal-count').textContent = entries.length;
  $('#archive-total').textContent = `${entries.length} SAVED`;
  $('#journal-entries').innerHTML = entries.length ? entries.map((entry) => `<article class="journal-entry"><div class="entry-date-block"><strong>${dateFromKey(entry.date).toLocaleDateString('en-US', { day: '2-digit' })}</strong><small>${dateFromKey(entry.date).toLocaleDateString('en-US', { month: 'short' })}</small></div><div class="entry-content"><div class="entry-meta"><span>${escapeHTML(entry.mood || 'Clear')}</span><span>${escapeHTML(formatDate(entry.date))}</span></div><p>${escapeHTML(entry.text)}</p></div><div class="entry-actions"><button data-action="edit-journal" data-id="${escapeHTML(entry.id)}" aria-label="Edit reflection">✎</button><button data-action="delete-journal" data-id="${escapeHTML(entry.id)}" aria-label="Delete reflection">×</button></div></article>`).join('') : '<div class="journal-empty"><span>▤</span><strong>Nothing written down yet.</strong><small>Your thoughts do not need to be polished. Start with one honest sentence.</small></div>';
}

function saveJournal(event) {
  event.preventDefault();
  const text = $('#journal-text').value.trim();
  if (!text) return showToast('Write a few words before saving.');
  if (text.length > 2400) return showToast('Journal entries have a 2,400 character limit.');
  const existing = data.journal.find((entry) => entry.id === journalEditId);
  const entry = { id: journalEditId || makeId(), text, mood: $('#journal-mood').value, date: existing?.date || todayKey(), updatedAt: new Date().toISOString() };
  data.journal = [entry, ...data.journal.filter((item) => item.id !== entry.id)];
  saveData();
  resetJournalForm();
  renderJournal();
  showToast('Your reflection is saved.');
}

function editJournal(id) {
  const entry = data.journal.find((item) => item.id === id);
  if (!entry) return;
  journalEditId = id;
  $('#journal-form-label').textContent = 'EDIT A REFLECTION';
  $('#journal-prompt').textContent = 'Come back to this.';
  $('#journal-date').textContent = formatDate(entry.date, { month: 'short', day: 'numeric' });
  $('#journal-text').value = entry.text;
  $('#journal-mood').value = entry.mood || 'Clear';
  $('#journal-length').textContent = `${entry.text.length} / 2400`;
  $('#journal-save').innerHTML = 'Save changes <span>↗</span>';
  $('#journal-cancel').hidden = false;
  $('#journal-text').focus();
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

function resetJournalForm() {
  journalEditId = null;
  $('#journal-form').reset();
  $('#journal-form-label').textContent = 'TODAY, IN YOUR WORDS';
  $('#journal-prompt').textContent = 'What’s on your mind?';
  $('#journal-date').textContent = formatDate(todayKey(), { weekday: 'short', month: 'short', day: 'numeric' });
  $('#journal-length').textContent = '0 / 2400';
  $('#journal-save').innerHTML = 'Save reflection <span>↗</span>';
  $('#journal-cancel').hidden = true;
}

function deleteJournal(id) {
  data.journal = data.journal.filter((entry) => entry.id !== id);
  saveData();
  renderJournal();
  showToast('Reflection deleted.');
}

function renderProgress() {
  const days = weekDaysFor();
  const total = days.reduce((sum, day) => sum + day.count, 0);
  const max = Math.max(1, ...days.map((day) => day.count));
  $('#progress-week-total').textContent = total;
  $('#large-week-chart').innerHTML = days.map((day) => `<div class="large-week-day"><div class="large-week-bar-track"><i class="large-week-bar ${day.today ? 'today' : ''}" style="height:${day.count ? Math.max(8, day.count / max * 100) : 2}%"><small>${day.count || ''}</small></i></div><span class="${day.today ? 'today' : ''}">${day.date.toLocaleDateString('en-US', { weekday: 'short' }).toUpperCase()}</span></div>`).join('');
  const monthStart = new Date();
  monthStart.setHours(12, 0, 0, 0);
  monthStart.setDate(monthStart.getDate() - 29);
  const recentDates = new Set(completionDates().filter((key) => dateFromKey(key) >= monthStart));
  $('#active-days').textContent = recentDates.size;
  $('#consistency-grid').innerHTML = Array.from({ length: 30 }, (_, index) => {
    const date = new Date(monthStart);
    date.setDate(monthStart.getDate() + index);
    const key = localDateKey(date);
    return `<i class="${recentDates.has(key) ? 'active' : ''}" title="${key}"></i>`;
  }).join('');
  renderMonthChart();
  renderRecords();
  renderAchievements();
}

function renderMonthChart() {
  const months = [];
  const current = new Date();
  for (let ago = 5; ago >= 0; ago -= 1) {
    const date = new Date(current.getFullYear(), current.getMonth() - ago, 1, 12);
    const prefix = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
    const count = data.completions.filter((item) => item.date.startsWith(prefix)).length;
    months.push({ label: date.toLocaleDateString('en-US', { month: 'short' }), count });
  }
  const max = Math.max(1, ...months.map((month) => month.count));
  $('#month-chart').innerHTML = months.map((month) => `<div class="month-column"><div class="month-bar-holder"><i class="month-bar" style="height:${month.count ? Math.max(7, month.count / max * 100) : 2}%"></i></div><span>${month.label}</span><small>${month.count || ''}</small></div>`).join('');
}

function bestCompletionsInDay() {
  const counts = data.completions.filter((item) => item.taskId).reduce((result, item) => {
    result[item.date] = (result[item.date] || 0) + 1;
    return result;
  }, {});
  return Math.max(0, ...Object.values(counts));
}

function getAchievements() {
  const completedGoals = data.goals.some((goal) => goal.progress >= 100);
  const activeDays = completionDates().length;
  const hasCompletedTask = data.completions.some((item) => item.taskId);
  return [
    { title: 'First Step', note: 'Complete your first task', icon: '↗', unlocked: hasCompletedTask },
    { title: 'Seven-Day Streak', note: 'Show up for seven days in a row', icon: '✳', unlocked: currentStreak() >= 7 },
    { title: 'Goal Crusher', note: 'Complete a personal goal', icon: '◎', unlocked: completedGoals },
    { title: 'Consistency Champion', note: 'Build a 30-day activity record', icon: '⌁', unlocked: activeDays >= 30 },
    { title: 'Personal Best', note: 'Complete three tasks in one day', icon: '☆', unlocked: bestCompletionsInDay() >= 3 },
  ];
}

function renderRecords() {
  const completedGoals = data.goals.filter((goal) => goal.progress >= 100).length;
  const recentActivity = completionDates().filter((key) => (dateFromKey(todayKey()) - dateFromKey(key)) / DAY_MS < 30).length;
  const records = [
    { icon: '↗', label: 'Best day', value: bestCompletionsInDay(), suffix: bestCompletionsInDay() === 1 ? 'task' : 'tasks' },
    { icon: '✳', label: 'Active days', value: recentActivity, suffix: 'in the last 30' },
    { icon: '◎', label: 'Goals reached', value: completedGoals, suffix: `of ${data.goals.length} goals` },
  ];
  $('#record-grid').innerHTML = records.map((record) => `<div class="record-card"><span class="record-icon">${record.icon}</span><span>${record.label}</span><strong>${record.value}</strong><small>${record.suffix}</small></div>`).join('');
}

function renderAchievements() {
  const achievements = getAchievements();
  const unlocked = achievements.filter((item) => item.unlocked).length;
  $('#achievement-progress').textContent = `${unlocked} / ${achievements.length}`;
  $('#achievement-grid').innerHTML = achievements.map((item) => `<article class="achievement-badge ${item.unlocked ? 'unlocked' : ''}" title="${escapeHTML(item.unlocked ? `${item.title} unlocked` : item.note)}"><div class="achievement-shape"><span>${item.icon}</span></div><strong>${escapeHTML(item.title)}</strong><small>${item.unlocked ? 'UNLOCKED' : escapeHTML(item.note)}</small></article>`).join('');
}

function renderPage(page) {
  if (page === 'dashboard') renderAll();
  if (page === 'planner') renderPlanner();
  if (page === 'focus') renderFocus();
  if (page === 'goals') renderGoals();
  if (page === 'journal') renderJournal();
  if (page === 'progress') renderProgress();
}

function renderAll() {
  renderDate();
  renderProfile();
  renderTasks();
  if (currentPage === 'planner') renderPlanner();
  if (currentPage === 'focus') renderFocus();
  if (currentPage === 'goals') renderGoals();
  if (currentPage === 'journal') renderJournal();
  if (currentPage === 'progress') renderProgress();
}

function openProfile() {
  $('#profile-name').value = data.profile.name || '';
  $('#profile-modal').hidden = false;
  $('#profile-name').focus();
}

function closeProfile() {
  $('#profile-modal').hidden = true;
}

function saveProfile(event) {
  event.preventDefault();
  data.profile.name = $('#profile-name').value.trim().slice(0, 32);
  saveData();
  closeProfile();
  renderProfile();
  showToast(data.profile.name ? `Good to have you here, ${data.profile.name}.` : 'Your space is updated.');
}

function handleAction(action, id, button) {
  if (action === 'toggle-task') toggleTask(id);
  if (action === 'edit-task') editTask(id);
  if (action === 'delete-task') deleteTask(id);
  if (action === 'nudge-goal') nudgeGoal(id);
  if (action === 'edit-goal') editGoal(id);
  if (action === 'delete-goal') deleteGoal(id);
  if (action === 'select-day') {
    selectedPlanDate = button.dataset.date;
    renderPlanner();
  }
  if (action === 'delete-plan') deletePlan(id);
  if (action === 'edit-journal') editJournal(id);
  if (action === 'delete-journal') deleteJournal(id);
}

function bindEvents() {
  document.addEventListener('click', (event) => {
    const pageButton = event.target.closest('[data-page]');
    if (pageButton) return navigate(pageButton.dataset.page);
    const goButton = event.target.closest('[data-go]');
    if (goButton) return navigate(goButton.dataset.go);
    const actionButton = event.target.closest('[data-action]');
    if (actionButton) return handleAction(actionButton.dataset.action, actionButton.dataset.id, actionButton);
  });
  $('#task-form').addEventListener('submit', addTask);
  $('#goal-form').addEventListener('submit', addGoal);
  $('#planner-form').addEventListener('submit', addPlan);
  $('#journal-form').addEventListener('submit', saveJournal);
  $('#journal-text').addEventListener('input', () => { $('#journal-length').textContent = `${$('#journal-text').value.length} / 2400`; });
  $('#journal-cancel').addEventListener('click', resetJournalForm);
  $('#intention-form').addEventListener('submit', (event) => {
    event.preventDefault();
    data.intention = $('#focus-intention').value.trim().slice(0, 72);
    saveData();
    $('#focus-intention').value = '';
    renderFocus();
    showToast(data.intention ? 'Intention saved.' : 'Intention cleared.');
  });
  $('#week-prev').addEventListener('click', () => { weekOffset -= 1; selectedPlanDate = ''; renderPlanner(); });
  $('#week-next').addEventListener('click', () => { weekOffset += 1; selectedPlanDate = ''; renderPlanner(); });
  $('#week-today').addEventListener('click', () => { weekOffset = 0; selectedPlanDate = todayKey(); renderPlanner(); });
  $('#dashboard-date').addEventListener('click', () => { weekOffset = 0; selectedPlanDate = todayKey(); navigate('planner'); });
  $('#timer-start').addEventListener('click', startTimer);
  $('#timer-reset').addEventListener('click', resetTimer);
  $$('.timer-presets button').forEach((button) => button.addEventListener('click', () => {
    if (timerRunning) return showToast('Pause your session before changing its length.');
    timerLength = Number(button.dataset.minutes);
    timerRemaining = timerLength * 60;
    $$('.timer-presets button').forEach((item) => item.classList.toggle('selected', item === button));
    updateTimerDisplay();
  }));
  $('#profile-open').addEventListener('click', openProfile);
  $('#profile-shortcut').addEventListener('click', openProfile);
  $('#profile-form').addEventListener('submit', saveProfile);
  $$('[data-close-profile]').forEach((button) => button.addEventListener('click', closeProfile));
  $('#profile-modal').addEventListener('click', (event) => { if (event.target === $('#profile-modal')) closeProfile(); });
  document.addEventListener('keydown', (event) => { if (event.key === 'Escape') closeProfile(); });
  window.addEventListener('storage', (event) => {
    if (event.key !== STORAGE_KEY) return;
    data = loadData();
    renderAll();
    renderPage(currentPage);
  });
}

function initialize() {
  bindEvents();
  renderAll();
  renderFocus();
  $('#focus-intention').value = data.intention || '';
  if (!window.matchMedia('(prefers-reduced-motion: reduce)').matches && 'IntersectionObserver' in window) {
    const observer = new IntersectionObserver((entries) => entries.forEach((entry) => {
      if (entry.isIntersecting) {
        entry.target.classList.add('visible');
        observer.unobserve(entry.target);
      }
    }), { threshold: 0.12 });
    $$('.welcome-row, .stat-card, .dashboard-grid > .panel').forEach((element) => {
      element.classList.add('reveal');
      observer.observe(element);
    });
  } else {
    $$('.welcome-row, .stat-card, .dashboard-grid > .panel').forEach((element) => element.classList.add('visible'));
  }
}

initialize();