const medicineForm = document.getElementById('medicineForm');
const medicineInput = document.getElementById('medicineInput');
const timeInput = document.getElementById('timeInput');
const medicineList = document.getElementById('medicineList');
const emptyState = document.getElementById('emptyState');
const summary = document.getElementById('summary');
const todayLabel = document.getElementById('todayLabel');
const resetTodayBtn = document.getElementById('resetTodayBtn');

const STORAGE_KEY = 'medication-tracker.v1';
const TIME_OPTIONS = ['morning', 'afternoon', 'evening'];

function makeId() {
  if (window.crypto && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }

  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function normalizeTime(value) {
  if (typeof value !== 'string') return 'morning';
  const lower = value.toLowerCase();
  return TIME_OPTIONS.includes(lower) ? lower : 'morning';
}

function formatTimeLabel(value) {
  switch (normalizeTime(value)) {
    case 'afternoon':
      return 'Afternoon';
    case 'evening':
      return 'Evening';
    case 'morning':
    default:
      return 'Morning';
  }
}

function getTodayKey() {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function sanitizeMedicines(medicines) {
  if (!Array.isArray(medicines)) return [];

  return medicines
    .filter((m) => m && typeof m.name === 'string')
    .map((m) => ({
      id: typeof m.id === 'string' ? m.id : makeId(),
      name: m.name,
      taken: Boolean(m.taken),
      time: normalizeTime(m.time),
    }));
}

function loadState() {
  const today = getTodayKey();

  try {
    const raw = localStorage.getItem(STORAGE_KEY);

    if (!raw) {
      return { date: today, medicines: [] };
    }

    const parsed = JSON.parse(raw);
    const storedDate = typeof parsed?.date === 'string' ? parsed.date : today;
    const safeMedicines = sanitizeMedicines(parsed?.medicines);

    if (storedDate !== today) {
      safeMedicines.forEach((m) => {
        m.taken = false;
      });

      return { date: today, medicines: safeMedicines };
    }

    return { date: storedDate, medicines: safeMedicines };
  } catch {
    return { date: today, medicines: [] };
  }
}

function saveState() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
    // If localStorage is blocked, the app still works in-memory.
  }
}

function updateHeader() {
  const today = getTodayKey();

  if (todayLabel) {
    todayLabel.textContent = `Today: ${today}`;
  }
}

function updateSummary() {
  if (!summary) return;

  const total = state.medicines.length;
  const takenCount = state.medicines.filter((m) => m.taken).length;
  const pendingCount = total - takenCount;

  if (total === 0) {
    summary.textContent = '';
    return;
  }

  summary.textContent = `${takenCount} taken · ${pendingCount} pending`;
}

function syncResetButton() {
  if (!resetTodayBtn) return;
  resetTodayBtn.disabled = state.medicines.length === 0;
}

function renderMedicines() {
  medicineList.innerHTML = '';

  if (state.medicines.length === 0) {
    emptyState.style.display = 'block';
    updateSummary();
    syncResetButton();
    return;
  }

  emptyState.style.display = 'none';

  state.medicines.forEach((medicine) => {
    const listItem = document.createElement('li');
    listItem.className = `medicine-item ${medicine.taken ? 'taken' : ''}`;

    const leftSide = document.createElement('div');

    const nameRow = document.createElement('div');
    nameRow.className = 'name-row';

    const name = document.createElement('div');
    name.className = 'medicine-name';
    name.textContent = medicine.name;

    const tag = document.createElement('span');
    tag.className = 'tag';
    tag.textContent = formatTimeLabel(medicine.time);

    const timeSelect = document.createElement('select');
    timeSelect.className = 'time-edit';
    timeSelect.setAttribute('aria-label', `Edit time for ${medicine.name}`);

    TIME_OPTIONS.forEach((opt) => {
      const option = document.createElement('option');
      option.value = opt;
      option.textContent = formatTimeLabel(opt);
      if (normalizeTime(medicine.time) === opt) {
        option.selected = true;
      }
      timeSelect.appendChild(option);
    });

    timeSelect.addEventListener('change', () => {
      medicine.time = normalizeTime(timeSelect.value);
      saveState();
      tag.textContent = formatTimeLabel(medicine.time);
    });

    nameRow.appendChild(name);
    nameRow.appendChild(tag);
    nameRow.appendChild(timeSelect);

    const status = document.createElement('div');
    status.className = `status ${medicine.taken ? 'taken' : ''}`;
    status.textContent = medicine.taken ? 'Status: Taken' : 'Status: Pending';

    leftSide.appendChild(nameRow);
    leftSide.appendChild(status);

    const completeButton = document.createElement('button');
    completeButton.type = 'button';
    completeButton.textContent = medicine.taken ? 'Completed' : 'Mark as Taken';
    completeButton.disabled = medicine.taken;
    completeButton.setAttribute(
      'aria-label',
      medicine.taken ? `Completed: ${medicine.name}` : `Mark ${medicine.name} as taken`
    );

    completeButton.addEventListener('click', () => {
      medicine.taken = true;
      saveState();
      renderMedicines();
    });

    listItem.appendChild(leftSide);
    listItem.appendChild(completeButton);
    medicineList.appendChild(listItem);
  });

  updateSummary();
  syncResetButton();
}

function addMedicine(name, time) {
  const trimmed = name.trim();
  if (!trimmed) return;

  state.medicines.push({
    id: makeId(),
    name: trimmed,
    time: normalizeTime(time),
    taken: false,
  });

  saveState();
  renderMedicines();
}

function resetToday() {
  state.medicines.forEach((m) => {
    m.taken = false;
  });
  state.date = getTodayKey();

  saveState();
  renderMedicines();
}

let state = loadState();
state.date = getTodayKey();
saveState();

updateHeader();
renderMedicines();

medicineForm.addEventListener('submit', (event) => {
  event.preventDefault();

  addMedicine(medicineInput.value, timeInput?.value);

  medicineInput.value = '';
  medicineInput.focus();
});

if (resetTodayBtn) {
  resetTodayBtn.addEventListener('click', () => {
    if (state.medicines.length === 0) return;

    const ok = window.confirm('Reset all medicines back to Pending for today?');
    if (!ok) return;

    resetToday();
  });
}

window.addEventListener('storage', (event) => {
  if (event.key !== STORAGE_KEY) return;

  state = loadState();
  updateHeader();
  renderMedicines();
});

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./service-worker.js').catch(() => {});
  });
}
