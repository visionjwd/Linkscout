'use strict';

// linkscout/popup/popup.js — Popup logic: settings, dashboard, scan control, result rendering.

/**
 * @fileoverview Main popup entry point. Manages the settings UI, results dashboard,
 * scan controls, real-time updates, export, and safety features.
 */

import * as storage from '../lib/storage.js';
import * as logger from '../lib/logger.js';
import { scoreProfile } from '../lib/scoring.js';
import {
  KEY_TARGET_ROLES,
  KEY_TARGET_COMPANIES,
  KEY_USER_SCHOOL,
  KEY_TARGET_LOCATION,
  KEY_INCLUDE_REMOTE,
  KEY_TARGET_SENIORITY,
  KEY_MAX_PROFILES,
  KEY_ACTIVE_VIEW,
  KEY_SCAN_RESULTS,
  KEY_SCAN_STATE,
  KEY_SCANNED_URLS,
  KEY_SESSION_HISTORY,
  KEY_DAILY_SCAN_COUNT,
  KEY_DEBUG_MODE,
  DEFAULT_ROLE_OPTIONS,
  DEFAULT_COMPANY_OPTIONS,
  DEFAULT_SENIORITY_OPTIONS,
  DEFAULT_SENIORITY_ACTIVE,
  DEFAULT_SCHOOL,
  DEFAULT_LOCATION,
  DEFAULT_INCLUDE_REMOTE,
  DEFAULT_MAX_PROFILES,
  MIN_PROFILES_PER_SCAN,
  MAX_PROFILES_PER_SCAN,
  PROFILES_STEP,
  TOAST_DURATION_MS,
  VIEW_SETTINGS,
  VIEW_RESULTS,
  SCAN_STATUS_IDLE,
  SCAN_STATUS_SCANNING,
  SCAN_STATUS_PAUSED,
  HIGH_SCORE_THRESHOLD,
  MAX_TAGS_PER_CARD,
  DAILY_SCAN_WARNING_THRESHOLD
} from '../lib/constants.js';

/* ===================================================================
   STATE
   =================================================================== */

/** @type {Object} In-memory popup state. */
const state = {
  targetRoles: [],
  targetCompanies: [],
  userSchool: DEFAULT_SCHOOL,
  targetLocation: DEFAULT_LOCATION,
  includeRemote: DEFAULT_INCLUDE_REMOTE,
  targetSeniority: [],
  maxProfilesPerScan: DEFAULT_MAX_PROFILES,
  activeView: VIEW_SETTINGS,
  roleOptions: [...DEFAULT_ROLE_OPTIONS],
  companyOptions: [...DEFAULT_COMPANY_OPTIONS],
  seniorityOptions: [...DEFAULT_SENIORITY_OPTIONS],

  /* Dashboard */
  scanState: {
    status: SCAN_STATUS_IDLE,
    currentQuery: '',
    profilesScanned: 0,
    sessionId: 0,
    pauseReason: null,
    scanStartedAt: null
  },
  scanResults: [],
  dailyWarningDismissed: false,

  /* Debug */
  debugMode: false,
  debugTapCount: 0,
  debugTapTimer: null
};

/** @type {number|null} Interval ID for the scan elapsed timer. */
let timerIntervalId = null;

/* ===================================================================
   DOM REFERENCES
   =================================================================== */

/** @returns {HTMLElement} */
const $ = (id) => document.getElementById(id);

const DOM = {
  /* Settings */
  viewSettings: null, viewResults: null, btnToggle: null, btnSave: null,
  chipsRoles: null, chipsCompanies: null, chipsSeniority: null,
  inputCustomRole: null, inputCustomCompany: null,
  inputSchool: null, inputLocation: null, inputRemote: null, inputMaxProfiles: null,
  toast: null,

  /* Dashboard */
  scanDot: null, scanStatusText: null, btnScan: null, btnResume: null,
  pauseBanner: null, pauseBannerText: null,
  dailyWarning: null, btnDismissWarning: null,
  queryBar: null, queryText: null,
  exportBar: null, btnExport: null,
  emptyState: null, resultsList: null, summaryText: null,

  /* Data management */
  btnClearData: null,
  confirmOverlay: null, confirmText: null, confirmCancel: null, confirmOk: null,

  /* Debug */
  headerVersion: null, debugBadge: null, debugPanel: null, debugStatePre: null,
  btnInjectMock: null, btnResetStorage: null, btnExportDebug: null
};

/**
 * Cache all DOM element references.
 */
function cacheDom() {
  DOM.viewSettings = $('view-settings');
  DOM.viewResults = $('view-results');
  DOM.btnToggle = $('btn-toggle-view');
  DOM.btnSave = $('btn-save');
  DOM.chipsRoles = $('chips-roles');
  DOM.chipsCompanies = $('chips-companies');
  DOM.chipsSeniority = $('chips-seniority');
  DOM.inputCustomRole = $('input-custom-role');
  DOM.inputCustomCompany = $('input-custom-company');
  DOM.inputSchool = $('input-school');
  DOM.inputLocation = $('input-location');
  DOM.inputRemote = $('input-remote');
  DOM.inputMaxProfiles = $('input-max-profiles');
  DOM.toast = $('toast');

  DOM.scanDot = $('scan-dot');
  DOM.scanStatusText = $('scan-status-text');
  DOM.btnScan = $('btn-scan');
  DOM.btnResume = $('btn-resume');
  DOM.pauseBanner = $('pause-banner');
  DOM.pauseBannerText = $('pause-banner-text');
  DOM.dailyWarning = $('daily-warning');
  DOM.btnDismissWarning = $('btn-dismiss-warning');
  DOM.queryBar = $('query-bar');
  DOM.queryText = $('query-text');
  DOM.exportBar = $('export-bar');
  DOM.btnExport = $('btn-export');
  DOM.emptyState = $('empty-state');
  DOM.resultsList = $('results-list');
  DOM.summaryText = $('summary-text');

  DOM.btnClearData = $('btn-clear-data');
  DOM.confirmOverlay = $('confirm-overlay');
  DOM.confirmText = $('confirm-text');
  DOM.confirmCancel = $('confirm-cancel');
  DOM.confirmOk = $('confirm-ok');

  DOM.headerVersion = $('header-version');
  DOM.debugBadge = $('debug-badge');
  DOM.debugPanel = $('debug-panel');
  DOM.debugStatePre = $('debug-state-pre');
  DOM.btnInjectMock = $('btn-inject-mock');
  DOM.btnResetStorage = $('btn-reset-storage');
  DOM.btnExportDebug = $('btn-export-debug');
}

/* ===================================================================
   CHIP RENDERING & INTERACTION (unchanged from Phase 2)
   =================================================================== */

/** @param {string} label @param {boolean} isActive @param {boolean} isCustom @returns {HTMLButtonElement} */
function createChipElement(label, isActive, isCustom) {
  const chip = document.createElement('button');
  chip.type = 'button';
  chip.className = 'chip' + (isActive ? ' chip--active' : '') + (isCustom ? ' chip--custom' : '');
  chip.setAttribute('data-value', label);
  chip.setAttribute('aria-pressed', String(isActive));
  chip.appendChild(document.createTextNode(label));
  if (isCustom && isActive) {
    const rm = document.createElement('span');
    rm.className = 'chip__remove';
    rm.textContent = '×';
    rm.setAttribute('aria-label', `Remove ${label}`);
    chip.appendChild(rm);
  }
  return chip;
}

/** @param {HTMLElement} container @param {string[]} options @param {string[]} selected @param {string[]} defaults */
function renderChips(container, options, selected, defaults) {
  container.innerHTML = '';
  for (const opt of options) {
    container.appendChild(createChipElement(opt, selected.includes(opt), !defaults.includes(opt)));
  }
}

/** Re-render all chip groups. */
function renderAllChips() {
  renderChips(DOM.chipsRoles, state.roleOptions, state.targetRoles, DEFAULT_ROLE_OPTIONS);
  renderChips(DOM.chipsCompanies, state.companyOptions, state.targetCompanies, DEFAULT_COMPANY_OPTIONS);
  renderChips(DOM.chipsSeniority, state.seniorityOptions, state.targetSeniority, DEFAULT_SENIORITY_OPTIONS);
}

/** @param {MouseEvent} e @param {string[]} sel @param {string[]} opts @param {string[]} defs @param {HTMLElement} cont */
function handleChipClick(e, sel, opts, defs, cont) {
  const chip = e.target.closest('.chip');
  if (!chip) { return; }
  const value = chip.getAttribute('data-value');
  if (e.target.closest('.chip__remove')) {
    const si = sel.indexOf(value); if (si !== -1) { sel.splice(si, 1); }
    const oi = opts.indexOf(value); if (oi !== -1) { opts.splice(oi, 1); }
  } else {
    const idx = sel.indexOf(value);
    if (idx !== -1) { sel.splice(idx, 1); } else { sel.push(value); }
  }
  renderChips(cont, opts, sel, defs);
}

/** @param {KeyboardEvent} e @param {string[]} sel @param {string[]} opts @param {string[]} defs @param {HTMLElement} cont */
function handleCustomChipAdd(e, sel, opts, defs, cont) {
  if (e.key !== 'Enter') { return; }
  const value = e.target.value.trim();
  if (!value) { return; }
  if (opts.some((o) => o.toLowerCase() === value.toLowerCase())) { e.target.value = ''; return; }
  opts.push(value); sel.push(value); e.target.value = '';
  renderChips(cont, opts, sel, defs);
}

/* ===================================================================
   VIEW MANAGEMENT
   =================================================================== */

/** @param {string} viewName */
function switchView(viewName) {
  state.activeView = viewName;
  const isSettings = viewName === VIEW_SETTINGS;
  DOM.viewSettings.classList.toggle('view--active', isSettings);
  DOM.viewResults.classList.toggle('view--active', !isSettings);
  DOM.btnToggle.classList.toggle('header__toggle--active', isSettings);
}

/* ===================================================================
   TOAST
   =================================================================== */

/** @type {number|null} */
let toastTimeout = null;

/** @param {string} message @param {'success'|'warning'|'error'} [variant='success'] */
function showToast(message, variant = 'success') {
  if (toastTimeout) { clearTimeout(toastTimeout); }
  DOM.toast.textContent = message;
  DOM.toast.className = 'toast toast--visible';
  if (variant === 'warning') { DOM.toast.classList.add('toast--warning'); }
  else if (variant === 'error') { DOM.toast.classList.add('toast--error'); }
  toastTimeout = setTimeout(() => { DOM.toast.className = 'toast'; toastTimeout = null; }, TOAST_DURATION_MS);
}

/* ===================================================================
   SETTINGS SAVE / LOAD
   =================================================================== */

/** Persist settings to storage. */
async function saveSettings() {
  try {
    await storage.setMany({
      [KEY_TARGET_ROLES]: state.targetRoles,
      [KEY_TARGET_COMPANIES]: state.targetCompanies,
      [KEY_USER_SCHOOL]: DOM.inputSchool.value.trim() || DEFAULT_SCHOOL,
      [KEY_TARGET_LOCATION]: DOM.inputLocation.value.trim() || DEFAULT_LOCATION,
      [KEY_INCLUDE_REMOTE]: DOM.inputRemote.checked,
      [KEY_TARGET_SENIORITY]: state.targetSeniority,
      [KEY_MAX_PROFILES]: clampProfiles(Number(DOM.inputMaxProfiles.value)),
      [KEY_ACTIVE_VIEW]: VIEW_RESULTS,
      _customRoleOptions: state.roleOptions.filter((r) => !DEFAULT_ROLE_OPTIONS.includes(r)),
      _customCompanyOptions: state.companyOptions.filter((c) => !DEFAULT_COMPANY_OPTIONS.includes(c))
    });
    showToast('✓ Saved');
    switchView(VIEW_RESULTS);
  } catch (_e) {
    showToast('⚠ Save failed', 'warning');
  }
}

/** @param {number} value @returns {number} */
function clampProfiles(value) {
  if (isNaN(value) || value < MIN_PROFILES_PER_SCAN) { return MIN_PROFILES_PER_SCAN; }
  if (value > MAX_PROFILES_PER_SCAN) { return MAX_PROFILES_PER_SCAN; }
  return value;
}

/** Load all state from storage and populate the UI. */
async function loadAllState() {
  try {
    const data = await storage.getAll();
    const hasSaved = data && Object.keys(data).length > 0;

    /* Settings */
    const customRoles = data._customRoleOptions || [];
    state.roleOptions = [...DEFAULT_ROLE_OPTIONS, ...customRoles];
    state.targetRoles = hasSaved && data[KEY_TARGET_ROLES] ? data[KEY_TARGET_ROLES] : [];
    const customCompanies = data._customCompanyOptions || [];
    state.companyOptions = [...DEFAULT_COMPANY_OPTIONS, ...customCompanies];
    state.targetCompanies = hasSaved && data[KEY_TARGET_COMPANIES] ? data[KEY_TARGET_COMPANIES] : [];
    state.targetSeniority = hasSaved && data[KEY_TARGET_SENIORITY] ? data[KEY_TARGET_SENIORITY] : [...DEFAULT_SENIORITY_ACTIVE];
    DOM.inputSchool.value = hasSaved && data[KEY_USER_SCHOOL] ? data[KEY_USER_SCHOOL] : DEFAULT_SCHOOL;
    DOM.inputLocation.value = hasSaved && data[KEY_TARGET_LOCATION] ? data[KEY_TARGET_LOCATION] : DEFAULT_LOCATION;
    DOM.inputRemote.checked = hasSaved && data[KEY_INCLUDE_REMOTE] !== undefined ? data[KEY_INCLUDE_REMOTE] : DEFAULT_INCLUDE_REMOTE;
    const savedMax = hasSaved ? data[KEY_MAX_PROFILES] : null;
    DOM.inputMaxProfiles.value = savedMax != null ? savedMax : DEFAULT_MAX_PROFILES;
    DOM.inputMaxProfiles.min = MIN_PROFILES_PER_SCAN;
    DOM.inputMaxProfiles.max = MAX_PROFILES_PER_SCAN;
    DOM.inputMaxProfiles.step = PROFILES_STEP;

    renderAllChips();

    /* Dashboard */
    if (data[KEY_SCAN_STATE]) { state.scanState = data[KEY_SCAN_STATE]; }
    if (data[KEY_SCAN_RESULTS] && Array.isArray(data[KEY_SCAN_RESULTS])) { state.scanResults = data[KEY_SCAN_RESULTS]; }

    renderScanControls();
    renderResults();
    renderSummary();
    checkDailyWarning();

    /* Debug mode */
    state.debugMode = !!data[KEY_DEBUG_MODE];
    applyDebugMode();

    /* View state */
    const savedView = data[KEY_ACTIVE_VIEW];
    switchView(savedView === VIEW_RESULTS ? VIEW_RESULTS : VIEW_SETTINGS);

  } catch (_e) {
    state.targetSeniority = [...DEFAULT_SENIORITY_ACTIVE];
    DOM.inputSchool.value = DEFAULT_SCHOOL;
    DOM.inputLocation.value = DEFAULT_LOCATION;
    DOM.inputRemote.checked = DEFAULT_INCLUDE_REMOTE;
    DOM.inputMaxProfiles.value = DEFAULT_MAX_PROFILES;
    DOM.inputMaxProfiles.min = MIN_PROFILES_PER_SCAN;
    DOM.inputMaxProfiles.max = MAX_PROFILES_PER_SCAN;
    DOM.inputMaxProfiles.step = PROFILES_STEP;
    renderAllChips();
    renderScanControls();
    renderResults();
    renderSummary();
    switchView(VIEW_SETTINGS);
  }
}

/* ===================================================================
   SCAN CONTROLS
   =================================================================== */

/** Render scan bar (dot, text, buttons) based on current state. */
function renderScanControls() {
  const { status, profilesScanned, pauseReason } = state.scanState;
  const maxProfiles = state.maxProfilesPerScan || DEFAULT_MAX_PROFILES;

  /* Dot */
  DOM.scanDot.className = 'scan-dot';
  if (status === SCAN_STATUS_SCANNING) { DOM.scanDot.classList.add('scan-dot--scanning'); }
  else if (status === SCAN_STATUS_PAUSED) { DOM.scanDot.classList.add('scan-dot--paused'); }
  else { DOM.scanDot.classList.add('scan-dot--idle'); }

  /* Status text */
  DOM.scanStatusText.className = 'scan-bar__text';
  if (status === SCAN_STATUS_SCANNING) {
    DOM.scanStatusText.textContent = `Scanning... (${profilesScanned}/${maxProfiles})`;
    DOM.scanStatusText.classList.add('scan-bar__text--scanning');
  } else if (status === SCAN_STATUS_PAUSED) {
    DOM.scanStatusText.textContent = 'Paused';
    DOM.scanStatusText.classList.add('scan-bar__text--paused');
  } else {
    DOM.scanStatusText.textContent = 'Ready to scan';
  }

  /* Buttons */
  if (status === SCAN_STATUS_SCANNING) {
    DOM.btnScan.textContent = 'Stop';
    DOM.btnScan.className = 'scan-btn scan-btn--stop';
    DOM.btnResume.classList.add('scan-btn--hidden');
  } else if (status === SCAN_STATUS_PAUSED) {
    DOM.btnScan.textContent = 'Stop';
    DOM.btnScan.className = 'scan-btn scan-btn--stop';
    DOM.btnResume.classList.remove('scan-btn--hidden');
  } else {
    DOM.btnScan.textContent = 'Start Scan';
    DOM.btnScan.className = 'scan-btn scan-btn--start';
    DOM.btnResume.classList.add('scan-btn--hidden');
  }

  /* Query bar */
  if (status === SCAN_STATUS_SCANNING && state.scanState.currentQuery) {
    DOM.queryText.textContent = `Searching: "${state.scanState.currentQuery}"`;
    DOM.queryBar.classList.remove('query-bar--hidden');
  } else {
    DOM.queryBar.classList.add('query-bar--hidden');
  }

  /* Pause banner */
  if (status === SCAN_STATUS_PAUSED && pauseReason) {
    DOM.pauseBannerText.textContent = 'LinkedIn has detected unusual activity. Wait 5-10 minutes before resuming.';
    DOM.pauseBanner.classList.remove('pause-banner--hidden');
  } else {
    DOM.pauseBanner.classList.add('pause-banner--hidden');
  }

  /* Timer */
  if (status === SCAN_STATUS_SCANNING) {
    startScanTimer();
  } else {
    stopScanTimer();
  }
}

/** Send start-scan to service worker. */
async function startScan() {
  try {
    const response = await chrome.runtime.sendMessage({ type: 'START_SCAN' });
    if (response && response.status === 'ok') {
      state.scanState.status = SCAN_STATUS_SCANNING;
      state.scanState.profilesScanned = 0;
      state.scanState.sessionId = response.sessionId || state.scanState.sessionId + 1;
      state.scanState.scanStartedAt = new Date().toISOString();
      renderScanControls();
    }
  } catch (_e) {
    showToast('⚠ Could not start scan', 'warning');
  }
}

/** Send stop-scan to service worker. */
async function stopScan() {
  try {
    await chrome.runtime.sendMessage({ type: 'STOP_SCAN' });
    state.scanState.status = SCAN_STATUS_IDLE;
    state.scanState.currentQuery = '';
    state.scanState.pauseReason = null;
    renderScanControls();
  } catch (_e) {
    showToast('⚠ Could not stop scan', 'warning');
  }
}

/** Send resume-scan to service worker. */
async function resumeScan() {
  try {
    await chrome.runtime.sendMessage({ type: 'RESUME_SCAN' });
    state.scanState.status = SCAN_STATUS_SCANNING;
    state.scanState.pauseReason = null;
    renderScanControls();
  } catch (_e) {
    showToast('⚠ Could not resume scan', 'warning');
  }
}

/* ===================================================================
   SCAN ELAPSED TIMER
   =================================================================== */

/** Start the elapsed timer that updates the summary bar every second. */
function startScanTimer() {
  if (timerIntervalId) { return; }
  timerIntervalId = setInterval(updateTimerDisplay, 1000);
}

/** Stop the elapsed timer. */
function stopScanTimer() {
  if (timerIntervalId) {
    clearInterval(timerIntervalId);
    timerIntervalId = null;
  }
}

/** Update the summary bar with elapsed time. */
function updateTimerDisplay() {
  if (state.scanState.status !== SCAN_STATUS_SCANNING) {
    stopScanTimer();
    return;
  }

  const startedAt = state.scanState.scanStartedAt;
  if (!startedAt) { return; }

  const elapsed = Math.floor((Date.now() - new Date(startedAt).getTime()) / 1000);
  const minutes = Math.floor(elapsed / 60);
  const seconds = elapsed % 60;
  const timeStr = minutes > 0
    ? `${minutes}m ${String(seconds).padStart(2, '0')}s`
    : `${seconds}s`;

  const maxProfiles = state.maxProfilesPerScan || DEFAULT_MAX_PROFILES;
  DOM.summaryText.textContent = `Scanning... ${timeStr} · ${state.scanState.profilesScanned}/${maxProfiles} profiles`;
}

/* ===================================================================
   DAILY WARNING
   =================================================================== */

/** Check daily scan count and show warning if needed. */
async function checkDailyWarning() {
  try {
    const response = await chrome.runtime.sendMessage({ type: 'GET_DAILY_COUNT' });
    if (response && response.count >= DAILY_SCAN_WARNING_THRESHOLD && !state.dailyWarningDismissed) {
      DOM.dailyWarning.classList.remove('daily-warning--hidden');
    } else {
      DOM.dailyWarning.classList.add('daily-warning--hidden');
    }
  } catch (_e) {
    DOM.dailyWarning.classList.add('daily-warning--hidden');
  }
}

/* ===================================================================
   RESULTS RENDERING
   =================================================================== */

/** @param {number} score @returns {string} */
function getScoreClass(score) {
  if (score >= 75) { return 'score-badge--high'; }
  if (score >= 55) { return 'score-badge--good'; }
  if (score >= 35) { return 'score-badge--mid'; }
  return 'score-badge--low';
}

/** @param {Object} signals @returns {Array<{label: string, cssClass: string}>} */
function buildSignalTags(signals) {
  const tags = [];
  if (signals.hiringSignals) { tags.push({ label: '🔥 Hiring', cssClass: 'signal-tag--hiring', priority: 0 }); }
  if (signals.recentActivity) { tags.push({ label: '📢 Active', cssClass: 'signal-tag--active', priority: 1 }); }
  if (signals.isAlumni) { tags.push({ label: '🎓 UWaterloo', cssClass: 'signal-tag--alumni', priority: 2 }); }
  if (signals.mutualConnections > 0) { tags.push({ label: `🤝 ${signals.mutualConnections} mutual`, cssClass: 'signal-tag--mutual', priority: 3 }); }
  tags.sort((a, b) => a.priority - b.priority);
  return tags.slice(0, MAX_TAGS_PER_CARD);
}

/** @param {Object} profile @returns {HTMLElement} */
function createResultCard(profile) {
  const card = document.createElement('div');
  card.className = 'result-card';

  const row1 = document.createElement('div');
  row1.className = 'result-card__row1';
  const nameEl = document.createElement('span');
  nameEl.className = 'result-card__name';
  nameEl.textContent = profile.name;
  const badge = document.createElement('span');
  badge.className = `score-badge ${getScoreClass(profile.score)}`;
  badge.textContent = String(profile.score);
  row1.appendChild(nameEl);
  row1.appendChild(badge);
  card.appendChild(row1);

  const row2 = document.createElement('div');
  row2.className = 'result-card__row2';
  row2.textContent = [profile.title, profile.company].filter(Boolean).join(' · ');
  card.appendChild(row2);

  const signals = profile.signals || {};
  const tags = buildSignalTags(signals);
  if (tags.length > 0) {
    const row3 = document.createElement('div');
    row3.className = 'result-card__tags';
    for (const tag of tags) {
      const tagEl = document.createElement('span');
      tagEl.className = `signal-tag ${tag.cssClass}`;
      tagEl.textContent = tag.label;
      row3.appendChild(tagEl);
    }
    card.appendChild(row3);
  }

  if (profile.profileUrl) {
    const linkRow = document.createElement('div');
    linkRow.className = 'result-card__link-row';
    const link = document.createElement('a');
    link.className = 'result-card__link';
    link.href = profile.profileUrl;
    link.textContent = 'View Profile →';
    link.target = '_blank';
    link.rel = 'noopener noreferrer';
    linkRow.appendChild(link);
    card.appendChild(linkRow);
  }

  return card;
}

/** Render the full results list. */
function renderResults() {
  const hasResults = state.scanResults.length > 0;
  DOM.emptyState.classList.toggle('empty-state--hidden', hasResults);
  DOM.exportBar.classList.toggle('export-bar--hidden', !hasResults);

  if (!hasResults) { DOM.resultsList.innerHTML = ''; return; }

  const sorted = [...state.scanResults].sort((a, b) => b.score - a.score);
  const fragment = document.createDocumentFragment();
  for (const profile of sorted) { fragment.appendChild(createResultCard(profile)); }
  DOM.resultsList.innerHTML = '';
  DOM.resultsList.appendChild(fragment);
}

/** Render the summary bar. */
function renderSummary() {
  if (state.scanState.status === SCAN_STATUS_SCANNING) {
    updateTimerDisplay();
    return;
  }
  const total = state.scanResults.length;
  const highScorers = state.scanResults.filter((r) => r.score >= HIGH_SCORE_THRESHOLD).length;
  const session = state.scanState.sessionId || 0;
  DOM.summaryText.textContent = `${total} profiles scanned · ${highScorers} scored ${HIGH_SCORE_THRESHOLD}+ · Session ${session}`;
}

/** Add a profile result and re-render. */
function addProfileResult(profile) {
  const existingIdx = state.scanResults.findIndex((r) => r.id === profile.id);
  if (existingIdx !== -1) { state.scanResults[existingIdx] = profile; }
  else { state.scanResults.push(profile); }
}

/* ===================================================================
   EXPORT CSV
   =================================================================== */

/**
 * Escape a value for CSV (handles commas, quotes, newlines).
 * @param {*} val
 * @returns {string}
 */
function csvEscape(val) {
  const str = val == null ? '' : String(val);
  if (str.includes(',') || str.includes('"') || str.includes('\n')) {
    return '"' + str.replace(/"/g, '""') + '"';
  }
  return str;
}

/**
 * Determine the tier label from a score.
 * @param {number} score
 * @returns {string}
 */
function scoreTier(score) {
  if (score >= 75) { return 'reach_out_today'; }
  if (score >= 55) { return 'strong_candidate'; }
  if (score >= 35) { return 'worth_monitoring'; }
  return 'archive';
}

/** Generate and download a CSV of all scan results. */
function exportCsv() {
  if (state.scanResults.length === 0) { return; }

  const headers = ['Name', 'Title', 'Company', 'Location', 'Score', 'Tier', 'Is Alumni', 'Has Hiring Signals', 'Is Active', 'Mutual Connections', 'Profile URL', 'Scanned Date'];
  const rows = state.scanResults
    .sort((a, b) => b.score - a.score)
    .map((r) => {
      const s = r.signals || {};
      return [
        csvEscape(r.name), csvEscape(r.title), csvEscape(r.company), csvEscape(r.location),
        r.score, csvEscape(scoreTier(r.score)),
        s.isAlumni ? 'Yes' : 'No',
        s.hiringSignals ? 'Yes' : 'No',
        s.recentActivity ? 'Yes' : 'No',
        s.mutualConnections || 0,
        csvEscape(r.profileUrl),
        csvEscape(r.scannedAt || '')
      ].join(',');
    });

  const csv = [headers.join(','), ...rows].join('\n');
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);

  const a = document.createElement('a');
  a.href = url;
  a.download = `linkscout-results-${new Date().toISOString().slice(0, 10)}.csv`;
  a.style.display = 'none';
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);

  showToast(`✓ Exported ${state.scanResults.length} results`);
}

/* ===================================================================
   CLEAR DATA
   =================================================================== */

/** Show the confirmation dialog for clearing data. */
function showClearConfirm() {
  DOM.confirmText.textContent = 'This will delete all scan results, history, and scanned URL records. Your settings will be preserved. Continue?';
  DOM.confirmOverlay.classList.remove('confirm-overlay--hidden');
}

/** Hide the confirmation dialog. */
function hideClearConfirm() {
  DOM.confirmOverlay.classList.add('confirm-overlay--hidden');
}

/** Clear all scan data from storage. */
async function clearAllData() {
  try {
    await storage.setMany({
      [KEY_SCAN_RESULTS]: [],
      [KEY_SCAN_STATE]: {
        status: SCAN_STATUS_IDLE, currentQuery: '', currentQueryIndex: 0,
        currentProfileIndex: 0, profilesScanned: 0, sessionId: 0,
        tabId: null, pauseReason: null, scanStartedAt: null
      },
      [KEY_SCANNED_URLS]: [],
      [KEY_SESSION_HISTORY]: [],
      [KEY_DAILY_SCAN_COUNT]: { date: '', count: 0 }
    });

    state.scanResults = [];
    state.scanState = {
      status: SCAN_STATUS_IDLE, currentQuery: '', profilesScanned: 0,
      sessionId: 0, pauseReason: null, scanStartedAt: null
    };

    renderResults();
    renderScanControls();
    renderSummary();
    hideClearConfirm();
    showToast('✓ All scan data cleared');
  } catch (_e) {
    showToast('⚠ Failed to clear data', 'warning');
  }
}

/* ===================================================================
   REAL-TIME UPDATES FROM SERVICE WORKER
   =================================================================== */

/** @param {Object} message */
function handleServiceWorkerMessage(message) {
  if (!message || !message.type) { return; }

  switch (message.type) {
    case 'SCAN_PROGRESS':
      state.scanState.status = SCAN_STATUS_SCANNING;
      state.scanState.profilesScanned = message.profilesScanned || state.scanState.profilesScanned;
      state.scanState.currentQuery = message.currentQuery || state.scanState.currentQuery;
      renderScanControls();
      break;

    case 'PROFILE_FOUND':
      if (message.profile) {
        addProfileResult(message.profile);
        renderResults();
        renderSummary();
      }
      break;

    case 'SCAN_COMPLETE':
      state.scanState.status = SCAN_STATUS_IDLE;
      state.scanState.currentQuery = '';
      state.scanState.pauseReason = null;
      renderScanControls();
      renderSummary();
      showToast(`✓ Scan complete — ${state.scanResults.length} profiles found`);
      break;

    case 'SCAN_PAUSED':
      state.scanState.status = SCAN_STATUS_PAUSED;
      state.scanState.pauseReason = 'rate_limited';
      renderScanControls();
      showToast(message.reason || 'Scan paused', 'warning');
      break;

    case 'SCAN_ERROR':
      state.scanState.status = SCAN_STATUS_IDLE;
      state.scanState.currentQuery = '';
      state.scanState.pauseReason = null;
      renderScanControls();
      showToast(message.error || '⚠ Scan error', 'error');
      break;

    default:
      break;
  }
}

/* ===================================================================
   DEBUG MODE
   =================================================================== */

/** @type {number} Taps needed to toggle debug mode. */
const DEBUG_TAP_THRESHOLD = 5;

/** @type {number} Window in ms to accumulate taps. */
const DEBUG_TAP_WINDOW_MS = 3000;

/**
 * Handle a tap on the version number. After 5 taps within 3 seconds,
 * toggle debug mode on/off.
 */
function handleVersionTap() {
  state.debugTapCount += 1;

  if (state.debugTapTimer) {
    clearTimeout(state.debugTapTimer);
  }

  state.debugTapTimer = setTimeout(() => {
    state.debugTapCount = 0;
  }, DEBUG_TAP_WINDOW_MS);

  if (state.debugTapCount >= DEBUG_TAP_THRESHOLD) {
    state.debugTapCount = 0;
    clearTimeout(state.debugTapTimer);
    toggleDebugMode();
  }
}

/**
 * Toggle debug mode on or off. Persists the flag to storage.
 */
async function toggleDebugMode() {
  state.debugMode = !state.debugMode;
  try {
    await storage.set(KEY_DEBUG_MODE, state.debugMode);
  } catch (_e) { /* best-effort */ }
  applyDebugMode();
  showToast(state.debugMode ? '🐛 Debug mode ON' : 'Debug mode OFF');
}

/**
 * Apply the current debug mode state to the UI — show/hide badge and panel.
 */
function applyDebugMode() {
  DOM.debugBadge.classList.toggle('debug-badge--hidden', !state.debugMode);
  DOM.debugPanel.classList.toggle('debug-panel--hidden', !state.debugMode);
  if (state.debugMode) {
    refreshDebugPanel();
  }
}

/**
 * Refresh the debug panel with current storage state information.
 */
async function refreshDebugPanel() {
  try {
    const data = await storage.getAll();
    const scanState = data[KEY_SCAN_STATE] || {};
    const results = data[KEY_SCAN_RESULTS] || [];
    const scannedUrls = data[KEY_SCANNED_URLS] || [];
    const sessions = data[KEY_SESSION_HISTORY] || [];
    const daily = data[KEY_DAILY_SCAN_COUNT] || {};

    const info = {
      scanState: {
        status: scanState.status || 'idle',
        profilesScanned: scanState.profilesScanned || 0,
        sessionId: scanState.sessionId || 0,
        pauseReason: scanState.pauseReason || null,
        queryIdx: scanState.currentQueryIndex || 0,
        profileIdx: scanState.currentProfileIndex || 0
      },
      counts: {
        scanResults: results.length,
        scannedUrls: scannedUrls.length,
        sessionHistory: sessions.length,
        dailyScans: daily.count || 0,
        dailyDate: daily.date || 'N/A'
      },
      storage: {
        keys: Object.keys(data).length,
        estimatedBytes: JSON.stringify(data).length
      }
    };

    DOM.debugStatePre.textContent = JSON.stringify(info, null, 2);
  } catch (err) {
    DOM.debugStatePre.textContent = 'Error loading debug info: ' + String(err);
  }
}

/**
 * Inject mock profile results for UI testing without actual LinkedIn scanning.
 * Fetches mock-profiles.json, scores each, and inserts into scanResults.
 */
async function injectMockResults() {
  try {
    const resp = await fetch(chrome.runtime.getURL('test/mock-profiles.json'));
    const mockProfiles = await resp.json();

    const config = {
      targetRoles: state.targetRoles.length > 0 ? state.targetRoles : ['Financial Analyst', 'Capital Markets Analyst'],
      targetCompanies: state.targetCompanies.length > 0 ? state.targetCompanies : ['RBC', 'TD', 'CIBC'],
      targetSeniority: state.targetSeniority.length > 0 ? state.targetSeniority : ['Manager', 'Director'],
      userSchool: state.userSchool || 'University of Waterloo'
    };

    const results = mockProfiles.map((p) => {
      const sr = scoreProfile(p, config);
      return {
        id: (p.profileUrl || '').split('/in/')[1] || Math.random().toString(36).slice(2),
        name: p.name || 'Unknown',
        title: p.headline || '',
        company: p.currentCompany || '',
        location: p.location || '',
        profileUrl: p.profileUrl || '',
        score: sr.totalScore,
        signals: {
          isAlumni: p.education?.isAlumni || false,
          recentActivity: p.activity?.hasRecentActivity || false,
          hiringSignals: p.hiringSignals?.hasHiringSignals || false,
          mutualConnections: p.mutualConnections || 0,
          connectionDegree: p.connectionDegree || null
        },
        scannedAt: new Date().toISOString(),
        sessionId: 999
      };
    });

    await storage.set(KEY_SCAN_RESULTS, results);
    state.scanResults = results;
    renderResults();
    renderSummary();
    refreshDebugPanel();
    showToast(`🐛 Injected ${results.length} mock results`);
  } catch (err) {
    showToast('⚠ Mock injection failed', 'error');
    await logger.error('Mock injection failed', err);
  }
}

/**
 * Completely reset all storage — settings AND scan data.
 */
async function resetAllStorage() {
  try {
    await storage.clear();
    showToast('🐛 All storage cleared — reload popup');
  } catch (_e) {
    showToast('⚠ Reset failed', 'error');
  }
}

/**
 * Export a JSON file with all storage data and the in-memory log buffer.
 */
async function exportDebugLog() {
  try {
    const allData = await storage.getAll();
    const exportObj = {
      exportedAt: new Date().toISOString(),
      extensionVersion: '0.1.0',
      storageData: allData,
      logBuffer: logger.getLogBuffer()
    };

    const json = JSON.stringify(exportObj, null, 2);
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);

    const a = document.createElement('a');
    a.href = url;
    a.download = `linkscout-debug-${new Date().toISOString().slice(0, 19).replace(/:/g, '-')}.json`;
    a.style.display = 'none';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);

    showToast('🐛 Debug log exported');
  } catch (_e) {
    showToast('⚠ Export failed', 'error');
  }
}

/* ===================================================================
   EVENT BINDING
   =================================================================== */

/** Attach all event listeners. */
function bindEvents() {
  /* Settings chip groups */
  DOM.chipsRoles.addEventListener('click', (e) => handleChipClick(e, state.targetRoles, state.roleOptions, DEFAULT_ROLE_OPTIONS, DOM.chipsRoles));
  DOM.chipsCompanies.addEventListener('click', (e) => handleChipClick(e, state.targetCompanies, state.companyOptions, DEFAULT_COMPANY_OPTIONS, DOM.chipsCompanies));
  DOM.chipsSeniority.addEventListener('click', (e) => handleChipClick(e, state.targetSeniority, state.seniorityOptions, DEFAULT_SENIORITY_OPTIONS, DOM.chipsSeniority));

  DOM.inputCustomRole.addEventListener('keydown', (e) => handleCustomChipAdd(e, state.targetRoles, state.roleOptions, DEFAULT_ROLE_OPTIONS, DOM.chipsRoles));
  DOM.inputCustomCompany.addEventListener('keydown', (e) => handleCustomChipAdd(e, state.targetCompanies, state.companyOptions, DEFAULT_COMPANY_OPTIONS, DOM.chipsCompanies));

  /* View toggle */
  DOM.btnToggle.addEventListener('click', () => {
    switchView(state.activeView === VIEW_SETTINGS ? VIEW_RESULTS : VIEW_SETTINGS);
  });

  /* Settings save */
  DOM.btnSave.addEventListener('click', async () => { await saveSettings(); });

  /* Scan button */
  DOM.btnScan.addEventListener('click', async () => {
    if (state.scanState.status === SCAN_STATUS_SCANNING || state.scanState.status === SCAN_STATUS_PAUSED) {
      await stopScan();
    } else {
      await startScan();
    }
  });

  /* Resume button */
  DOM.btnResume.addEventListener('click', async () => { await resumeScan(); });

  /* Daily warning dismiss */
  DOM.btnDismissWarning.addEventListener('click', () => {
    state.dailyWarningDismissed = true;
    DOM.dailyWarning.classList.add('daily-warning--hidden');
  });

  /* Export CSV */
  DOM.btnExport.addEventListener('click', () => { exportCsv(); });

  /* Clear data */
  DOM.btnClearData.addEventListener('click', () => { showClearConfirm(); });
  DOM.confirmCancel.addEventListener('click', () => { hideClearConfirm(); });
  DOM.confirmOk.addEventListener('click', async () => { await clearAllData(); });

  /* Debug mode */
  DOM.headerVersion.addEventListener('click', () => { handleVersionTap(); });
  DOM.btnInjectMock.addEventListener('click', async () => { await injectMockResults(); });
  DOM.btnResetStorage.addEventListener('click', async () => { await resetAllStorage(); });
  DOM.btnExportDebug.addEventListener('click', async () => { await exportDebugLog(); });

  /* Service worker message listener */
  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    handleServiceWorkerMessage(message);
    sendResponse({ received: true });
    return true;
  });
}

/* ===================================================================
   INIT
   =================================================================== */

/** Initialize the popup. */
async function init() {
  cacheDom();
  bindEvents();
  await loadAllState();
}

document.addEventListener('DOMContentLoaded', init);
