window.__appLoaded = true;

const medicineForm = document.getElementById('medicineForm');
const medicineInput = document.getElementById('medicineInput');
const timeInput = document.getElementById('timeInput');
const addBtn = document.getElementById('addBtn');
const medicineList = document.getElementById('medicineList');
const emptyState = document.getElementById('emptyState');
const summary = document.getElementById('summary');
const todayLabel = document.getElementById('todayLabel');
const resetTodayBtn = document.getElementById('resetTodayBtn');
const signinHint = document.getElementById('signinHint');

const signInBtn = document.getElementById('signInBtn');
const signOutBtn = document.getElementById('signOutBtn');
const userLabel = document.getElementById('userLabel');
const updateBanner = document.getElementById('updateBanner');
const updateMessage = document.getElementById('updateMessage');
const refreshAppBtn = document.getElementById('refreshAppBtn');
const dismissUpdateBtn = document.getElementById('dismissUpdateBtn');

const PROFILE_ID = (() => {
  const meta = document.querySelector('meta[name="profile-id"]');
  const raw = meta && meta.content ? meta.content : 'default';
  return String(raw).trim().toLowerCase() || 'default';
})();
const STORAGE_KEY = 'medication-tracker.' + PROFILE_ID + '.v2';
const LEGACY_STORAGE_KEYS = ['medication-tracker.v2', 'medication-tracker.v1'];
const DEVICE_ID_KEY = 'medication-tracker.deviceId';
const TIME_OPTIONS = ['morning', 'afternoon', 'evening'];
const POST_SIGNIN_RELOAD_KEY = 'medication-tracker.postSigninReload';
const POST_SIGNIN_RELOADED_KEY = 'medication-tracker.postSigninReloaded';

let editingMedicineId = null;
let waitingWorker = null;
let isRefreshingForUpdate = false;

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
const isIos = /\b(iPad|iPhone|iPod)\b/i.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);

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
  const empty = () => normalizeState({ date: getTodayKey(), medicines: [] });

  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      return normalizeState(parsed);
    }
  } catch {
    // ignore
  }

  // Migrate from older versions (single-key storage).
  for (const legacyKey of LEGACY_STORAGE_KEYS) {
    try {
      const legacyRaw = localStorage.getItem(legacyKey);
      if (!legacyRaw) continue;

      const parsed = JSON.parse(legacyRaw);
      const migrated = normalizeState(parsed);

      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(migrated));
      } catch {
        // ignore
      }

      return migrated;
    } catch {
      // ignore
    }
  }

  return empty();
}

function saveLocalState() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
    // ignore
  }
}

function clearLocalState() {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    // ignore
  }
}

function setSignedInUi(isSignedIn) {
  if (signInBtn) {
    signInBtn.hidden = isSignedIn;
  }

  if (signOutBtn) {
    signOutBtn.hidden = !isSignedIn;
  }

  if (medicineInput) medicineInput.disabled = !isSignedIn;
  if (timeInput) timeInput.disabled = !isSignedIn;
  if (addBtn) addBtn.disabled = !isSignedIn;
  if (resetTodayBtn) resetTodayBtn.disabled = !isSignedIn || state.medicines.length === 0;

  if (signinHint) {
    signinHint.hidden = isSignedIn;
  }

  if (emptyState && !isSignedIn) {
    emptyState.textContent = 'Sign in to view your medicines.';
  } else if (emptyState) {
    emptyState.textContent = 'No medicines added yet.';
  }
}

const cloud = {
  available: Boolean(window.FIREBASE_CONFIG && window.FIREBASE_CONFIG.apiKey),
  connected: false,
  user: null,
  auth: null,
  db: null,
  userDocRef: null,
  unsubscribe: null,
  inFlight: false,
  pushTimer: null,
  applyingRemote: false,
  lastRemoteUpdatedAtMs: 0,
};

function updateHeader() {
  const today = getTodayKey();
  const cloudLabel = !cloud.available
    ? ' · Cloud: Off'
    : !cloud.user
      ? ' · Cloud: Sign in'
      : cloud.connected
        ? ' · Cloud: On'
        : ' · Cloud: Connecting';

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

function renderMedicines() {
  medicineList.innerHTML = '';

  if (state.medicines.length === 0) {
    emptyState.style.display = 'block';
    updateSummary();
    if (resetTodayBtn) resetTodayBtn.disabled = !cloud.user || state.medicines.length === 0;
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
    let nameInputNode;

    if (isEditing) {
      nameInputNode = document.createElement('input');
      nameInputNode.type = 'text';
      nameInputNode.className = 'name-edit-input';
      nameInputNode.value = medicine.name;
      nameInputNode.setAttribute('aria-label', `Edit medicine name for ${medicine.name}`);
      nameInputNode.addEventListener('keydown', (event) => {
        if (event.key === 'Escape') {
          editingMedicineId = null;
          renderMedicines();
          return;
        }

        if (event.key === 'Enter') {
          event.preventDefault();
          const trimmed = nameInputNode.value.trim();
          if (!trimmed) return;
          medicine.name = trimmed;
          editingMedicineId = null;
          saveState();
          renderMedicines();
        }
      });
      nameNode = nameInputNode;

      requestAnimationFrame(() => {
        nameInputNode.focus();
        nameInputNode.select();
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
      saveButton.addEventListener('click', () => {
        const trimmed = String(nameInputNode?.value ?? '').trim();
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
      editButton.addEventListener('click', () => {
        editingMedicineId = medicine.id;
        renderMedicines();
      });

      const completeButton = document.createElement('button');
      completeButton.type = 'button';
      completeButton.textContent = medicine.taken ? 'Completed' : 'Mark as Taken';
      completeButton.disabled = medicine.taken;

      completeButton.addEventListener('click', () => {
        medicine.taken = true;
        saveState();
        renderMedicines();
      });

      const deleteButton = document.createElement('button');
      deleteButton.type = 'button';
      deleteButton.className = 'mini danger';
      deleteButton.textContent = 'Delete';
      deleteButton.addEventListener('click', () => {
        state.medicines = state.medicines.filter((item) => item.id !== medicine.id);
        if (editingMedicineId === medicine.id) editingMedicineId = null;
        saveState();
        renderMedicines();
      });

      actions.appendChild(editButton);
      actions.appendChild(completeButton);
      actions.appendChild(deleteButton);
    }

    listItem.appendChild(leftSide);
    listItem.appendChild(actions);
    medicineList.appendChild(listItem);
  });

  updateSummary();
  if (resetTodayBtn) resetTodayBtn.disabled = !cloud.user || state.medicines.length === 0;
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

function teardownCloudListener() {
  if (cloud.unsubscribe) {
    cloud.unsubscribe();
    cloud.unsubscribe = null;
  }
  cloud.userDocRef = null;
  cloud.connected = false;
  cloud.lastRemoteUpdatedAtMs = 0;
}

function applyRemoteState(remoteState, updatedAtMs, sourceDeviceId, options = {}) {
  const force = Boolean(options && options.force);
  const next = normalizeState(remoteState);

  const remoteHasMeds = Array.isArray(next.medicines) && next.medicines.length > 0;
  const localHasMeds = Array.isArray(state?.medicines) && state.medicines.length > 0;

  // Avoid echoing our own writes, but still apply on first connect so the UI populates
  // immediately after sign-in (no manual refresh).
  if (!force && sourceDeviceId && sourceDeviceId === deviceId) {
    if (cloud.lastRemoteUpdatedAtMs > 0 || localHasMeds || !remoteHasMeds) {
      cloud.lastRemoteUpdatedAtMs = Math.max(cloud.lastRemoteUpdatedAtMs, updatedAtMs || 0);
      return;
    }
  }

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

async function queueCloudPush() {
  if (!cloud.available || !cloud.user || !cloud.userDocRef || cloud.applyingRemote) {
    return;
  }

  if (cloud.pushTimer) {
    clearTimeout(cloud.pushTimer);
  }

  cloud.pushTimer = setTimeout(async () => {
    if (cloud.inFlight || !cloud.userDocRef) return;

    cloud.pushTimer = null;
    cloud.inFlight = true;

    const updatedAtMs = Date.now();
    const payload = {
      schemaVersion: 2,
      profiles: {
        [PROFILE_ID]: {
          state: normalizeState(state),
          updatedAtMs,
          updatedAt: firebase.firestore.FieldValue.serverTimestamp(),
          sourceDeviceId: deviceId,
        },
      },
    };

    cloud.lastRemoteUpdatedAtMs = Math.max(cloud.lastRemoteUpdatedAtMs, updatedAtMs);

    try {
      await cloud.userDocRef.set(payload, { merge: true });
      cloud.connected = true;
    } catch {
      cloud.connected = false;
    } finally {
      cloud.inFlight = false;
      updateHeader();
    }
  }, 150);
}
async function ensureUserDocExists() {
  if (!cloud.userDocRef) return;

  const snap = await cloud.userDocRef.get();

  if (!snap.exists) {
    const seeded = normalizeState(state);
    await cloud.userDocRef.set({
      schemaVersion: 2,
      profiles: {
        [PROFILE_ID]: {
          state: seeded,
          updatedAtMs: Date.now(),
          updatedAt: firebase.firestore.FieldValue.serverTimestamp(),
          sourceDeviceId: deviceId,
        },
      },
    });
    return;
  }

  const data = snap.data() || {};
  const hasProfile = Boolean(data.profiles && data.profiles[PROFILE_ID]);
  const hasAnyProfiles = Boolean(data.profiles && Object.keys(data.profiles).length > 0);

  if (!hasProfile && !hasAnyProfiles && Array.isArray(state.medicines) && state.medicines.length > 0) {
    await cloud.userDocRef.set(
      {
        schemaVersion: 2,
        profiles: {
          [PROFILE_ID]: {
            state: normalizeState(state),
            updatedAtMs: Date.now(),
            updatedAt: firebase.firestore.FieldValue.serverTimestamp(),
            sourceDeviceId: deviceId,
          },
        },
      },
      { merge: true }
    );
    return;
  }

  // If this user already has legacy data under state, migrate it into this profile.
  if (!hasProfile && data.state && typeof data.state === 'object') {
    await cloud.userDocRef.set(
      {
        schemaVersion: 2,
        profiles: {
          [PROFILE_ID]: {
            state: normalizeState(data.state),
            updatedAtMs: Date.now(),
            updatedAt: firebase.firestore.FieldValue.serverTimestamp(),
            sourceDeviceId: deviceId,
          },
        },
      },
      { merge: true }
    );
  }
}

function saveState() {
  saveLocalState();
  queueCloudPush();
}

function initCloud() {
  setSignedInUi(false);
  updateHeader();

  if (!cloud.available) return;

  try {
    firebase.initializeApp(window.FIREBASE_CONFIG);
    cloud.auth = firebase.auth();
    cloud.db = firebase.firestore();

    const provider = new firebase.auth.GoogleAuthProvider();
    try {
      provider.setCustomParameters({ prompt: 'select_account' });
    } catch {
      // ignore
    }

    cloud.auth.setPersistence(firebase.auth.Auth.Persistence.LOCAL).catch(() => {});

    cloud.auth
      .getRedirectResult()
      .then(() => {})
      .catch(() => {});

    if (signInBtn) {
      signInBtn.addEventListener('click', async () => {
        
if (!isIos) {
          
try {
            
sessionStorage.setItem(POST_SIGNIN_RELOAD_KEY, '1');
            
sessionStorage.removeItem(POST_SIGNIN_RELOADED_KEY);
          
} catch {
            
// ignore
          
}
        
}
        try {
          if (isIos) {
            try {
              await cloud.auth.signInWithPopup(provider);
              return;
            } catch (err) {
              const code = err && err.code ? String(err.code) : '';
              if (
                code === 'auth/popup-blocked' ||
                code === 'auth/popup-closed-by-user' ||
                code === 'auth/operation-not-supported-in-this-environment' ||
                code === 'auth/cancelled-popup-request'
              ) {
                await cloud.auth.signInWithRedirect(provider);
                return;
              }
              throw err;
            }
          }

          await cloud.auth.signInWithPopup(provider);
        } catch (err) {
          const msg = String(err?.message || err || 'Sign-in failed');
          window.alert(`Sign-in failed.\n\n${msg}`);
        }
      });
    }

    if (signOutBtn) {
      signOutBtn.addEventListener('click', async () => {
        try {
          await cloud.auth.signOut();
        } catch {
          // ignore
        }
      });
    }

    cloud.auth.onAuthStateChanged((user) => {
      if (user) {
        
if (!isIos) {
          
try {
            
const shouldReload =
              
sessionStorage.getItem(POST_SIGNIN_RELOAD_KEY) === '1' &&
              
sessionStorage.getItem(POST_SIGNIN_RELOADED_KEY) !== '1';

            
if (shouldReload) {
              
sessionStorage.setItem(POST_SIGNIN_RELOADED_KEY, '1');
              
sessionStorage.removeItem(POST_SIGNIN_RELOAD_KEY);
              
location.reload();
              
return;
            
}
          
} catch {
            
// ignore
          
}
        
}
        cloud.user = user;
        cloud.userDocRef = cloud.db.collection('users').doc(user.uid);

        if (userLabel) {
          userLabel.textContent = user.displayName || user.email || 'Signed in';
        }

        setSignedInUi(true);
        updateHeader();

        teardownCloudListener();
        cloud.userDocRef = cloud.db.collection('users').doc(user.uid);

        cloud.unsubscribe = cloud.userDocRef.onSnapshot(
          (snap) => {
            cloud.connected = true;
            updateHeader();

            if (!snap.exists) return;

            const data = snap.data() || {};

            const profileData = data.profiles && data.profiles[PROFILE_ID] ? data.profiles[PROFILE_ID] : null;
            const updatedAtMs =
              typeof profileData?.updatedAtMs === 'number'
                ? profileData.updatedAtMs
                : typeof data?.updatedAtMs === 'number'
                  ? data.updatedAtMs
                  : 0;

            if (updatedAtMs && updatedAtMs <= cloud.lastRemoteUpdatedAtMs) return;

            const remoteState = profileData?.state || data?.state;
            const sourceDeviceId = profileData?.sourceDeviceId || data?.sourceDeviceId;

            applyRemoteState(remoteState, updatedAtMs, sourceDeviceId);
          },
          () => {
            cloud.connected = false;
            updateHeader();
          }
        );

        ensureUserDocExists()
  .then(() => cloud.userDocRef.get())
  .then((snap) => {
    if (!snap.exists) return;
    if (Array.isArray(state.medicines) && state.medicines.length > 0) return;

    const data = snap.data() || {};
    const profileData = data.profiles && data.profiles[PROFILE_ID] ? data.profiles[PROFILE_ID] : null;
    const updatedAtMs =
      typeof profileData?.updatedAtMs === 'number'
        ? profileData.updatedAtMs
        : typeof data?.updatedAtMs === 'number'
          ? data.updatedAtMs
          : 0;

    const remoteState = profileData?.state || data?.state;
    const sourceDeviceId = profileData?.sourceDeviceId || data?.sourceDeviceId;

    applyRemoteState(remoteState, updatedAtMs, sourceDeviceId, { force: true });
  })
  .catch(() => {});
      } else {
        cloud.user = null;
        
try {
          
sessionStorage.removeItem(POST_SIGNIN_RELOAD_KEY);
          
sessionStorage.removeItem(POST_SIGNIN_RELOADED_KEY);
        
} catch {
          
// ignore
        
}
        if (userLabel) userLabel.textContent = '';

        teardownCloudListener();
        clearLocalState();
        editingMedicineId = null;
        state = normalizeState({ date: getTodayKey(), medicines: [] });
        renderMedicines();

        setSignedInUi(false);
        updateHeader();
      }
    });
  } catch {
    cloud.available = false;
    updateHeader();
  }
}

let state = loadState();
state.date = getTodayKey();

updateHeader();
renderMedicines();
setSignedInUi(false);
initCloud();

medicineForm?.addEventListener('submit', (event) => {
  event.preventDefault();
  if (!cloud.user) return;

  addMedicine(medicineInput.value, timeInput?.value);

  medicineInput.value = '';
  medicineInput.focus();
});

if (resetTodayBtn) {
  resetTodayBtn.addEventListener('click', () => {
    if (!cloud.user) return;
    if (state.medicines.length === 0) return;

    const ok = window.confirm('Reset all medicines back to Pending for today?');
    if (!ok) return;

    resetToday();
  });
}

function showUpdateBanner(worker) {
  waitingWorker = worker || waitingWorker;
  if (!updateBanner || !waitingWorker) return;
  if (updateMessage) updateMessage.textContent = 'A newer version is ready. Refresh to update this app.';
  updateBanner.hidden = false;
}

function hideUpdateBanner() {
  waitingWorker = null;
  if (updateBanner) updateBanner.hidden = true;
}

function watchServiceWorkerRegistration(registration) {
  if (!registration) return;

  if (registration.waiting) {
    showUpdateBanner(registration.waiting);
  }

  registration.addEventListener('updatefound', () => {
    const installingWorker = registration.installing;
    if (!installingWorker) return;

    installingWorker.addEventListener('statechange', () => {
      if (installingWorker.state === 'installed' && navigator.serviceWorker.controller) {
        showUpdateBanner(registration.waiting || installingWorker);
      }
    });
  });
}

refreshAppBtn?.addEventListener('click', () => {
  if (!waitingWorker) return;
  if (updateBanner) updateBanner.hidden = true;
  waitingWorker.postMessage({ type: 'SKIP_WAITING' });
});

dismissUpdateBtn?.addEventListener('click', () => {
  hideUpdateBanner();
});

if ('serviceWorker' in navigator) {
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (isRefreshingForUpdate) return;
    isRefreshingForUpdate = true;
    window.location.reload();
  });

  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./service-worker.js').then((registration) => {
      watchServiceWorkerRegistration(registration);
    }).catch(() => {});
  });
}


