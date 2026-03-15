import { FIREBASE_CONFIG } from './firebase-config.js';

const medicineForm = document.getElementById('medicineForm');
const medicineInput = document.getElementById('medicineInput');
const timeInput = document.getElementById('timeInput');
const medicineList = document.getElementById('medicineList');
const emptyState = document.getElementById('emptyState');
const summary = document.getElementById('summary');
const todayLabel = document.getElementById('todayLabel');
const resetTodayBtn = document.getElementById('resetTodayBtn');

const exportBtn = document.getElementById('exportBtn');
const importBtn = document.getElementById('importBtn');
const importModal = document.getElementById('importModal');
const importTextarea = document.getElementById('importTextarea');
const confirmImportBtn = document.getElementById('confirmImportBtn');
const cancelImportBtn = document.getElementById('cancelImportBtn');

const signInBtn = document.getElementById('signInBtn');
const signOutBtn = document.getElementById('signOutBtn');
const userLabel = document.getElementById('userLabel');\r\nconst statusLabel = document.getElementById('statusLabel');\r\nconst fixCacheBtn = document.getElementById('fixCacheBtn');

const STORAGE_KEY = 'medication-tracker.v1';
const DEVICE_ID_KEY = 'medication-tracker.deviceId';
const TIME_OPTIONS = ['morning', 'afternoon', 'evening'];

const FIREBASE_SDK_VERSION = '10.12.5';

let editingMedicineId = null;

function makeId() {
  if (window.crypto && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }

  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function getOrCreateDeviceId() {
  try {
    const existing = localStorage.getItem(DEVICE_ID_KEY);
    if (existing) return existing;

    const created = makeId();
    localStorage.setItem(DEVICE_ID_KEY, created);
    return created;
  } catch {
    return makeId();
  }
}

const deviceId = getOrCreateDeviceId();
const isIos = /\\b(iPad|iPhone|iPod)\\b/i.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
const isStandalone = window.matchMedia?.('(display-mode: standalone)')?.matches || navigator.standalone === true;


const AUTH_ATTEMPT_KEY = 'medication-tracker.authAttemptAt';
let authHelpShown = false;

function markAuthAttempt() {
  try {
    localStorage.setItem(AUTH_ATTEMPT_KEY, String(Date.now()));
  } catch {
    // ignore
  }
}

function clearAuthAttempt() {
  try {
    localStorage.removeItem(AUTH_ATTEMPT_KEY);
  } catch {
    // ignore
  }
}

function maybeShowAuthHelp() {
  if (authHelpShown) return;

  let attemptAt = 0;
  try {
    attemptAt = Number(localStorage.getItem(AUTH_ATTEMPT_KEY) || 0);
  } catch {
    attemptAt = 0;
  }

  if (!attemptAt) return;

  const ageMs = Date.now() - attemptAt;
  if (ageMs > 2 * 60 * 1000) {
    clearAuthAttempt();
    return;
  }

  authHelpShown = true;

  setTimeout(() => {
    if (cloud?.user) return;

    window.alert(
      'Google sign-in started but did not finish.\n\nTry: \n- iPhone Settings > Safari: turn OFF Block All Cookies (and try turning OFF Prevent Cross-Site Tracking).\n- Firebase Console > Authentication > Authorized domains: add sunnyhighhigh.github.io\n- Use Safari (not an in-app browser) and not Private Browsing.\n- If you added to Home Screen, sign in in Safari first.\n\nThen reload and try again.'
    );
  }, 1200);
}
function scheduleAuthHelpOnLoad() {
  // iOS redirect sign-in can return in a different tab/context; localStorage keeps the attempt marker.
  setTimeout(() => {
    if (cloud?.user) {
      clearAuthAttempt();
      return;
    }

    let attemptAt = 0;
    try {
      attemptAt = Number(localStorage.getItem(AUTH_ATTEMPT_KEY) || 0);
    } catch {
      attemptAt = 0;
    }

    if (!attemptAt) return;

    const ageMs = Date.now() - attemptAt;
    if (ageMs > 2 * 60 * 1000) {
      clearAuthAttempt();
      return;
    }

    maybeShowAuthHelp();
  }, 2000);
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

function normalizeState(loaded) {
  const today = getTodayKey();
  const storedDate = typeof loaded?.date === 'string' ? loaded.date : today;
  const safeMedicines = sanitizeMedicines(loaded?.medicines);

  if (storedDate !== today) {
    safeMedicines.forEach((m) => {
      m.taken = false;
    });

    return { date: today, medicines: safeMedicines };
  }

  return { date: storedDate, medicines: safeMedicines };
}

function loadState() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return normalizeState({ date: getTodayKey(), medicines: [] });

    const parsed = JSON.parse(raw);
    return normalizeState(parsed);
  } catch {
    return normalizeState({ date: getTodayKey(), medicines: [] });
  }
}

function saveLocalState() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
    // If localStorage is blocked, the app still works in-memory.
  }
}

function isFirebaseConfigured() {
  const cfg = FIREBASE_CONFIG;
  if (!cfg || typeof cfg !== 'object') return false;
  const requiredKeys = ['apiKey', 'authDomain', 'projectId', 'appId'];
  for (const k of requiredKeys) {
    const v = String(cfg[k] ?? '').trim();
    if (!v) return false;
    if (v.startsWith('PASTE_')) return false;
  }
  return true;
}

const cloud = {
  available: isFirebaseConfigured(),
  connected: false,
  applyingRemote: false,
  lastRemoteUpdatedAtMs: 0,
  user: null,

  sdk: null,
  auth: null,
  db: null,
  userDocRef: null,
  unsubscribe: null,

  pushTimer: null,
  inFlight: false,
};


function setStatus(message) {
  if (!statusLabel) return;
  statusLabel.textContent = message;
}\r\n
  const today = getTodayKey();
  let cloudLabel = '';

  if (!cloud.available) {\r\n    cloudLabel = ' · Cloud: Off';\r\n    setStatus('Status: Cloud not configured (v12)');\r\n  } else if (!cloud.user) {\r\n    cloudLabel = ' · Cloud: Sign in';\r\n    setStatus('Status: Signed out (v12)');\r\n  } else {\r\n    cloudLabel = cloud.connected ? ' · Cloud: On' : ' · Cloud: Connecting';\r\n    setStatus(cloud.connected ? 'Status: Signed in + synced (v12)' : 'Status: Signed in, connecting (v12)');\r\n  }

  if (todayLabel) {
    todayLabel.textContent = `Today: ${today}${cloudLabel}`;
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

  const medicinesForDisplay = state.medicines
    .map((medicine, index) => ({ medicine, index }))
    .sort((a, b) => {
      const aRank = TIME_OPTIONS.indexOf(normalizeTime(a.medicine.time));
      const bRank = TIME_OPTIONS.indexOf(normalizeTime(b.medicine.time));
      if (aRank !== bRank) return aRank - bRank;
      return a.index - b.index;
    })
    .map(({ medicine }) => medicine);

  medicinesForDisplay.forEach((medicine) => {
    const isEditing = medicine.id === editingMedicineId;

    const listItem = document.createElement('li');
    listItem.className = `medicine-item ${medicine.taken ? 'taken' : ''}`;

    const leftSide = document.createElement('div');
    leftSide.className = 'medicine-left';

    const nameRow = document.createElement('div');
    nameRow.className = 'name-row';

    let nameNode;
    let nameInput;

    if (isEditing) {
      nameInput = document.createElement('input');
      nameInput.type = 'text';
      nameInput.className = 'name-edit-input';
      nameInput.id = `edit-name-${medicine.id}`;
      nameInput.value = medicine.name;
      nameInput.setAttribute('aria-label', `Edit medicine name for ${medicine.name}`);
      nameInput.addEventListener('keydown', (event) => {
        if (event.key === 'Escape') {
          editingMedicineId = null;
          renderMedicines();
          return;
        }

        if (event.key === 'Enter') {
          event.preventDefault();
          const trimmed = nameInput.value.trim();
          if (!trimmed) return;
          medicine.name = trimmed;
          editingMedicineId = null;
          saveState();
          renderMedicines();
        }
      });
      nameNode = nameInput;

      requestAnimationFrame(() => {
        nameInput.focus();
        nameInput.select();
      });
    } else {
      const name = document.createElement('div');
      name.className = 'medicine-name';
      name.textContent = medicine.name;
      nameNode = name;
    }

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
      tag.textContent = formatTimeLabel(medicine.time);
      saveState();
    });

    nameRow.appendChild(nameNode);
    nameRow.appendChild(tag);
    nameRow.appendChild(timeSelect);

    const status = document.createElement('div');
    status.className = `status ${medicine.taken ? 'taken' : ''}`;
    status.textContent = medicine.taken ? 'Status: Taken' : 'Status: Pending';

    leftSide.appendChild(nameRow);
    leftSide.appendChild(status);

    const actions = document.createElement('div');
    actions.className = 'medicine-actions';

    if (isEditing) {
      const saveButton = document.createElement('button');
      saveButton.type = 'button';
      saveButton.className = 'mini';
      saveButton.textContent = 'Save';
      saveButton.setAttribute('aria-label', `Save changes for ${medicine.name}`);
      saveButton.addEventListener('click', () => {
        const trimmed = String(nameInput?.value ?? '').trim();
        if (!trimmed) return;
        medicine.name = trimmed;
        editingMedicineId = null;
        saveState();
        renderMedicines();
      });

      const cancelButton = document.createElement('button');
      cancelButton.type = 'button';
      cancelButton.className = 'mini secondary';
      cancelButton.textContent = 'Cancel';
      cancelButton.setAttribute('aria-label', `Cancel editing for ${medicine.name}`);
      cancelButton.addEventListener('click', () => {
        editingMedicineId = null;
        renderMedicines();
      });

      actions.appendChild(saveButton);
      actions.appendChild(cancelButton);
    } else {
      const editButton = document.createElement('button');
      editButton.type = 'button';
      editButton.className = 'mini secondary';
      editButton.textContent = 'Edit';
      editButton.setAttribute('aria-label', `Edit ${medicine.name}`);
      editButton.addEventListener('click', () => {
        editingMedicineId = medicine.id;
        renderMedicines();
      });

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

      actions.appendChild(editButton);
      actions.appendChild(completeButton);
    }

    listItem.appendChild(leftSide);
    listItem.appendChild(actions);
    medicineList.appendChild(listItem);
  });

  updateSummary();
  syncResetButton();
}

function addMedicine(name, time) {
  const trimmed = String(name ?? '').trim();
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

function openImportModal() {
  if (!importModal) return;
  importModal.hidden = false;
  if (importTextarea) {
    importTextarea.value = '';
    importTextarea.focus();
  }
}

function closeImportModal() {
  if (!importModal) return;
  importModal.hidden = true;
}

function parseImportedMedicines(rawText) {
  const trimmed = String(rawText ?? '').trim();
  if (!trimmed) return [];

  const parsed = JSON.parse(trimmed);

  if (Array.isArray(parsed)) {
    return sanitizeMedicines(parsed);
  }

  if (parsed && typeof parsed === 'object' && Array.isArray(parsed.medicines)) {
    return sanitizeMedicines(parsed.medicines);
  }

  throw new Error('Invalid import format');
}

function applyRemoteState(remoteState, updatedAtMs, sourceDeviceId) {
  if (sourceDeviceId && sourceDeviceId === deviceId) {
    cloud.lastRemoteUpdatedAtMs = Math.max(cloud.lastRemoteUpdatedAtMs, updatedAtMs || 0);
    return;
  }

  const next = normalizeState(remoteState);

  cloud.applyingRemote = true;
  try {
    editingMedicineId = null;
    state = next;
    saveLocalState();
    renderMedicines();
  } finally {
    cloud.applyingRemote = false;
  }

  cloud.lastRemoteUpdatedAtMs = Math.max(cloud.lastRemoteUpdatedAtMs, updatedAtMs || 0);
  updateHeader();
}

function queueCloudPush() {
  if (!cloud.available || !cloud.user || !cloud.userDocRef || !cloud.sdk) {
    updateHeader();
    return;
  }

  if (cloud.applyingRemote) {
    updateHeader();
    return;
  }

  if (cloud.pushTimer) {
    clearTimeout(cloud.pushTimer);
  }

  cloud.pushTimer = setTimeout(() => {
    cloud.pushTimer = null;
    pushStateToCloud().catch(() => {});
  }, 250);

  updateHeader();
}

async function pushStateToCloud() {
  if (cloud.inFlight || !cloud.userDocRef || !cloud.sdk) return;
  cloud.inFlight = true;

  try {
    const { setDoc, serverTimestamp } = cloud.sdk;
    await setDoc(
      cloud.userDocRef,
      {
        schemaVersion: 1,
        state,
        updatedAtMs: Date.now(),
        updatedAt: serverTimestamp(),
        sourceDeviceId: deviceId,
      },
      { merge: true }
    );
  } finally {
    cloud.inFlight = false;
  }
}

function saveState() {
  saveLocalState();
  queueCloudPush();
}

function setAuthUi(user) {
  if (signInBtn) {
      signInBtn.addEventListener('click', async () => {
        try {
          markAuthAttempt();

          if (isIos || isStandalone) {
            if (isStandalone) {
              window.alert(
                'If you added this to your Home Screen, iOS may open Safari to finish sign-in. If sign-in fails, open the site in Safari and sign in there.'
              );
            }
            await signInWithRedirect(cloud.auth, cloud.provider);
          } else {
            await signInWithPopup(cloud.auth, cloud.provider);
          }
        } catch (err) {
          clearAuthAttempt();
          const msg = String(err?.message || err || 'Sign-in failed');
          window.alert(`Sign-in failed.\n\n${msg}`);
        }
      });
    }

    if (signOutBtn) {
      signOutBtn.addEventListener('click', async () => {
        try {
          await signOut(cloud.auth);
        } catch {
          // ignore
        }
      });
    }

    // If we used redirect sign-in (mobile), this finishes the auth flow.
    try {
      await getRedirectResult(cloud.auth);
    } catch (err) {
      if (isIos || isStandalone) {
        const msg = String(err?.message || err || 'Redirect sign-in failed');
        window.alert(`Redirect sign-in failed.\n\n${msg}`);
      }
    }

    onAuthStateChanged(cloud.auth, (user) => {
      if (user) {
        clearAuthAttempt();
        handleSignedIn(user).catch(() => {
          cloud.connected = false;
          updateHeader();
        });
      } else {
        maybeShowAuthHelp();
        handleSignedOut().catch(() => {});
      }
    });} else {
        handleSignedOut().catch(() => {});
      }
    });
  } catch (err) {
    cloud.available = false;
    setAuthUi(null);
    updateHeader();

    const msg = String(err?.message || err || 'Cloud sync failed to initialize');
    if (userLabel) {
      userLabel.textContent = 'Cloud sync unavailable';
    }

    // Helpful for debugging CDN blocks / offline.
    console.error(msg);
  }
}

let state = loadState();
state.date = getTodayKey();
saveLocalState();

updateHeader();
renderMedicines();
initCloud();\r\nscheduleAuthHelpOnLoad();

medicineForm?.addEventListener('submit', (event) => {
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

if (exportBtn) {
  exportBtn.addEventListener('click', async () => {
    const payload = {
      date: getTodayKey(),
      medicines: state.medicines,
    };

    const text = JSON.stringify(payload, null, 2);

    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(text);
        window.alert('Export copied to clipboard.');
        return;
      }
    } catch {
      // fallback below
    }

    window.prompt('Copy this JSON export:', text);
  });
}

if (importBtn) {
  importBtn.addEventListener('click', () => {
    openImportModal();
  });
}

if (cancelImportBtn) {
  cancelImportBtn.addEventListener('click', () => {
    closeImportModal();
  });
}

if (importModal) {
  importModal.addEventListener('click', (event) => {
    if (event.target === importModal) {
      closeImportModal();
    }
  });
}

if (confirmImportBtn) {
  confirmImportBtn.addEventListener('click', () => {
    try {
      const imported = parseImportedMedicines(importTextarea?.value);

      const ok = window.confirm(
        `Import ${imported.length} medicine(s)? This will replace your current list on this device.`
      );
      if (!ok) return;

      editingMedicineId = null;
      state.medicines = imported;
      state.date = getTodayKey();
      saveState();
      renderMedicines();
      closeImportModal();
    } catch {
      window.alert('Import failed. Make sure you paste valid JSON exported from the app.');
    }
  });
}

window.addEventListener('keydown', (event) => {
  if (event.key !== 'Escape') return;
  if (!importModal || importModal.hidden) return;
  closeImportModal();
});

window.addEventListener('storage', (event) => {\r\n  if (event.key !== STORAGE_KEY) return;\r\n\r\n  editingMedicineId = null;\r\n  state = loadState();\r\n  updateHeader();\r\n  renderMedicines();\r\n});\r\n\r\nif (fixCacheBtn) {\r\n  fixCacheBtn.addEventListener('click', () => {\r\n    resetAppCache().catch(() => {});\r\n  });\r\n}\r\n\r\nif ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./service-worker.js').catch(() => {});
  });
}










async function resetAppCache() {
  try {
    if ('serviceWorker' in navigator) {
      const regs = await navigator.serviceWorker.getRegistrations();
      await Promise.all(regs.map((r) => r.unregister()));
    }
  } catch {
    // ignore
  }

  try {
    if (window.caches?.keys) {
      const keys = await caches.keys();
      await Promise.all(keys.map((k) => caches.delete(k)));
    }
  } catch {
    // ignore
  }

  const next = `${location.origin}${location.pathname}?v=12&ts=${Date.now()}`;
  location.replace(next);
}
