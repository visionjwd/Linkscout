'use strict';

// linkscout/background/service-worker.js — MV3 service worker: scan orchestration.

/**
 * @fileoverview Event-driven background service worker. Orchestrates the scan
 * loop: generates queries, navigates tabs, triggers extraction, scores results,
 * and persists state after every operation. Stays alive via chrome.alarms.
 */

import * as storage from '../lib/storage.js';
import { generateSearchQueries } from '../lib/query-generator.js';
import { scoreProfile } from '../lib/scoring.js';
import {
  KEY_TARGET_ROLES,
  KEY_TARGET_COMPANIES,
  KEY_USER_SCHOOL,
  KEY_TARGET_LOCATION,
  KEY_INCLUDE_REMOTE,
  KEY_TARGET_SENIORITY,
  KEY_MAX_PROFILES,
  KEY_SCAN_RESULTS,
  KEY_SCAN_STATE,
  KEY_SCANNED_URLS,
  KEY_SESSION_HISTORY,
  KEY_DAILY_SCAN_COUNT,
  SCAN_STATUS_IDLE,
  SCAN_STATUS_SCANNING,
  SCAN_STATUS_PAUSED,
  MAX_STORED_RESULTS,
  HIGH_SCORE_THRESHOLD,
  KEEPALIVE_ALARM_NAME,
  KEEPALIVE_PERIOD_MINUTES,
  SCAN_DELAY_MIN_MS,
  SCAN_DELAY_MAX_MS,
  SCAN_BREAK_DELAY_MIN_MS,
  SCAN_BREAK_DELAY_MAX_MS,
  SCAN_BREAK_INTERVAL,
  TAB_LOAD_TIMEOUT_MS,
  PAGE_SETTLE_DELAY_MS,
  SEARCH_SCROLL_DELAY_MS,
  MAX_PROFILES_PER_SEARCH_PAGE,
  RATE_LIMIT_BACKOFF_MS,
  DEFAULT_MAX_PROFILES,
  STOP_REASON_COMPLETED,
  STOP_REASON_USER_STOPPED,
  STOP_REASON_RATE_LIMITED,
  STOP_REASON_SESSION_LIMIT
} from '../lib/constants.js';

/* ===================================================================
   IN-MEMORY FLAGS (lost on worker termination — always persist state)
   =================================================================== */

/** @type {boolean} Flag set by STOP_SCAN to interrupt the scan loop. */
let stopRequested = false;

/** @type {boolean} Flag to prevent multiple concurrent scan loops. */
let scanInProgress = false;

/* ===================================================================
   HELPERS
   =================================================================== */

/**
 * Extract a stable ID from a LinkedIn profile URL.
 * @param {string} url - Full or partial LinkedIn profile URL.
 * @returns {string} Normalized username identifier.
 */
function hashProfileUrl(url) {
  const match = (url || '').match(/\/in\/([a-zA-Z0-9_-]+)/);
  return match ? match[1].toLowerCase() : url;
}

/**
 * Generate a random integer between min and max (inclusive).
 * @param {number} min
 * @param {number} max
 * @returns {number}
 */
function randomInt(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

/**
 * Wait for a specified number of milliseconds.
 * @param {number} ms
 * @returns {Promise<void>}
 */
function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Compute a human-like random delay between profile visits.
 * @param {number} profileIndex - Current profile count (0-based).
 * @returns {number} Total delay in ms.
 */
function computeScanDelay(profileIndex) {
  let total = randomInt(SCAN_DELAY_MIN_MS, SCAN_DELAY_MAX_MS);
  if (profileIndex > 0 && profileIndex % SCAN_BREAK_INTERVAL === 0) {
    total += randomInt(SCAN_BREAK_DELAY_MIN_MS, SCAN_BREAK_DELAY_MAX_MS);
  }
  return total;
}

/**
 * Broadcast a message to the popup. Safe to call when popup is closed.
 * @param {Object} message
 */
async function broadcastToPopup(message) {
  try {
    await chrome.runtime.sendMessage(message);
  } catch (_e) {
    /* Popup not open — ignore */
  }
}

/**
 * Get today's date as a YYYY-MM-DD string.
 * @returns {string}
 */
function todayDateString() {
  return new Date().toISOString().slice(0, 10);
}

/**
 * Build keyword terms used to pre-filter search results cards.
 * Keeps terms compact and unique to avoid noisy matching.
 * @param {Object} config
 * @returns {string[]}
 */
function buildSearchKeywordTerms(config) {
  const terms = new Set();

  for (const company of (config.targetCompanies || [])) {
    const value = String(company || '').trim().toLowerCase();
    if (value) {
      terms.add(value);
    }
  }

  for (const role of (config.targetRoles || [])) {
    const words = String(role || '').toLowerCase().split(/\s+/).filter(Boolean);
    for (const word of words) {
      if (word.length >= 3) {
        terms.add(word);
      }
    }
  }

  return [...terms];
}

/* ===================================================================
   TAB MANAGEMENT
   =================================================================== */

/**
 * Wait for a tab to finish loading (status === 'complete').
 * @param {number} tabId
 * @returns {Promise<void>}
 */
function waitForTabLoad(tabId) {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      chrome.tabs.onUpdated.removeListener(listener);
      reject(new Error('Tab load timeout'));
    }, TAB_LOAD_TIMEOUT_MS);

    /**
     * @param {number} updatedTabId
     * @param {Object} changeInfo
     */
    function listener(updatedTabId, changeInfo) {
      if (updatedTabId === tabId && changeInfo.status === 'complete') {
        clearTimeout(timeout);
        chrome.tabs.onUpdated.removeListener(listener);
        resolve();
      }
    }

    chrome.tabs.onUpdated.addListener(listener);
  });
}

/**
 * Navigate a tab to a URL and wait for full load + dynamic content settle.
 * @param {number} tabId
 * @param {string} url
 * @returns {Promise<void>}
 */
async function navigateAndWait(tabId, url) {
  await chrome.tabs.update(tabId, { url });
  try {
    await waitForTabLoad(tabId);
  } catch (_e) {
    /* Timeout — proceed anyway */
  }
  await delay(PAGE_SETTLE_DELAY_MS);
}

/* ===================================================================
   KEEPALIVE
   =================================================================== */

/**
 * Start the keepalive alarm to prevent service worker termination.
 */
async function startKeepalive() {
  await chrome.alarms.create(KEEPALIVE_ALARM_NAME, {
    periodInMinutes: KEEPALIVE_PERIOD_MINUTES
  });
}

/**
 * Stop the keepalive alarm.
 */
async function stopKeepalive() {
  await chrome.alarms.clear(KEEPALIVE_ALARM_NAME);
}

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === KEEPALIVE_ALARM_NAME) {
    /* No-op — handler execution keeps the worker alive */
  }
});

/* ===================================================================
   SEARCH RESULTS COLLECTION
   =================================================================== */

/**
 * Inject a script into the scanning tab to collect profile URLs.
 * @param {number} tabId
 * @returns {Promise<string[]>}
 */
async function collectProfileUrls(tabId, keywordTerms = []) {
  try {
    const results = await chrome.scripting.executeScript({
      target: { tabId },
      func: collectProfileUrlsInjected,
      args: [MAX_PROFILES_PER_SEARCH_PAGE, SEARCH_SCROLL_DELAY_MS, keywordTerms]
    });
    if (results && results[0] && Array.isArray(results[0].result)) {
      return results[0].result;
    }
    return [];
  } catch (_e) {
    return [];
  }
}

/**
 * INJECTED into the LinkedIn search page via executeScript.
 * @param {number} maxUrls
 * @param {number} scrollDelay
 * @returns {Promise<string[]>}
 */
async function collectProfileUrlsInjected(maxUrls, scrollDelay, keywordTerms) {
  window.scrollTo({ top: document.body.scrollHeight, behavior: 'smooth' });
  await new Promise((r) => setTimeout(r, scrollDelay));

  const links = document.querySelectorAll('a[href*="/in/"]');
  const seen = new Set();
  const urls = [];

  const terms = (Array.isArray(keywordTerms) ? keywordTerms : [])
    .map((t) => String(t || '').toLowerCase().trim())
    .filter(Boolean);

  for (const link of links) {
    const href = link.href || '';
    const match = href.match(/(https:\/\/www\.linkedin\.com\/in\/[a-zA-Z0-9_-]+)/);
    if (!match) {
      continue;
    }

    const card = link.closest('li, .reusable-search__result-container, .entity-result, .search-result') || link;
    const cardText = (card.textContent || '').toLowerCase();
    const hasKeywordHit = terms.length === 0 || terms.some((term) => cardText.includes(term));
    if (!hasKeywordHit) {
      continue;
    }

    const normalized = match[1].replace(/\/$/, '');
    if (!seen.has(normalized)) {
      seen.add(normalized);
      urls.push(normalized);
      if (urls.length >= maxUrls) {
        break;
      }
    }
  }
  return urls;
}

/* ===================================================================
   SCAN STATE PERSISTENCE
   =================================================================== */

/**
 * Load the current scan state from storage, or return defaults.
 * @returns {Promise<Object>}
 */
async function loadScanState() {
  try {
    const state = await storage.get(KEY_SCAN_STATE);
    if (state) {
      return state;
    }
  } catch (_e) { /* use defaults */ }
  return {
    status: SCAN_STATUS_IDLE,
    currentQuery: '',
    currentQueryIndex: 0,
    currentProfileIndex: 0,
    profilesScanned: 0,
    sessionId: 0,
    tabId: null,
    pauseReason: null,
    scanStartedAt: null
  };
}

/**
 * Save scan state to storage.
 * @param {Object} state
 * @returns {Promise<void>}
 */
async function saveScanState(state) {
  try {
    await storage.set(KEY_SCAN_STATE, state);
  } catch (_e) { /* best-effort */ }
}

/**
 * Generate the next session ID.
 * @returns {Promise<number>}
 */
async function generateSessionId() {
  const state = await loadScanState();
  return (state.sessionId || 0) + 1;
}

/**
 * Append a scan result to storage with cap enforcement.
 * @param {Object} result
 * @returns {Promise<void>}
 */
async function appendResult(result) {
  try {
    let results = (await storage.get(KEY_SCAN_RESULTS)) || [];
    if (!Array.isArray(results)) {
      results = [];
    }
    const existingIdx = results.findIndex((r) => r.id === result.id);
    if (existingIdx !== -1) {
      results[existingIdx] = result;
    } else {
      results.push(result);
    }
    if (results.length > MAX_STORED_RESULTS) {
      results.sort((a, b) => b.score - a.score);
      results.length = MAX_STORED_RESULTS;
    }
    await storage.set(KEY_SCAN_RESULTS, results);
  } catch (_e) { /* best-effort */ }
}

/**
 * Mark a URL as scanned for deduplication.
 * @param {string} url
 * @returns {Promise<void>}
 */
async function markUrlScanned(url) {
  try {
    let urls = (await storage.get(KEY_SCANNED_URLS)) || [];
    if (!Array.isArray(urls)) {
      urls = [];
    }
    const id = hashProfileUrl(url);
    if (!urls.includes(id)) {
      urls.push(id);
      await storage.set(KEY_SCANNED_URLS, urls);
    }
  } catch (_e) { /* best-effort */ }
}

/**
 * Check if a profile URL has already been scanned.
 * @param {string} url
 * @returns {Promise<boolean>}
 */
async function isAlreadyScanned(url) {
  try {
    const urls = (await storage.get(KEY_SCANNED_URLS)) || [];
    return urls.includes(hashProfileUrl(url));
  } catch (_e) {
    return false;
  }
}

/* ===================================================================
   DAILY SCAN COUNTER
   =================================================================== */

/**
 * Increment today's daily scan count and return the new total.
 * @returns {Promise<number>}
 */
async function incrementDailyScanCount() {
  try {
    const data = (await storage.get(KEY_DAILY_SCAN_COUNT)) || {};
    const today = todayDateString();
    if (data.date !== today) {
      /* New day — reset */
      const newData = { date: today, count: 1 };
      await storage.set(KEY_DAILY_SCAN_COUNT, newData);
      return 1;
    }
    data.count = (data.count || 0) + 1;
    await storage.set(KEY_DAILY_SCAN_COUNT, data);
    return data.count;
  } catch (_e) {
    return 0;
  }
}

/* ===================================================================
   SESSION HISTORY
   =================================================================== */

/**
 * Log a completed (or stopped) session to the session history.
 * @param {Object} entry - Session log entry.
 * @returns {Promise<void>}
 */
async function logSession(entry) {
  try {
    let history = (await storage.get(KEY_SESSION_HISTORY)) || [];
    if (!Array.isArray(history)) {
      history = [];
    }
    history.push(entry);
    /* Keep last 50 sessions */
    if (history.length > 50) {
      history = history.slice(-50);
    }
    await storage.set(KEY_SESSION_HISTORY, history);
  } catch (_e) { /* best-effort */ }
}

/* ===================================================================
   PROFILE EXTRACTION
   =================================================================== */

/**
 * Send an extraction request to the content script in a tab.
 * @param {number} tabId
 * @param {Object} config
 * @returns {Promise<Object|null>}
 */
async function extractProfile(tabId, config) {
  try {
    const response = await chrome.tabs.sendMessage(tabId, {
      type: 'EXTRACT_PROFILE',
      config: { userSchool: config.userSchool || '' }
    });
    return response || null;
  } catch (_e) {
    return null;
  }
}

/* ===================================================================
   LOAD CONFIG
   =================================================================== */

/**
 * Load user configuration from storage.
 * @returns {Promise<Object>}
 */
async function loadConfig() {
  try {
    const data = await storage.getAll();
    return {
      targetRoles: data[KEY_TARGET_ROLES] || [],
      targetCompanies: data[KEY_TARGET_COMPANIES] || [],
      targetLocation: data[KEY_TARGET_LOCATION] || '',
      targetSeniority: data[KEY_TARGET_SENIORITY] || [],
      userSchool: data[KEY_USER_SCHOOL] || '',
      includeRemote: data[KEY_INCLUDE_REMOTE] || false,
      maxProfilesPerScan: data[KEY_MAX_PROFILES] || DEFAULT_MAX_PROFILES
    };
  } catch (_e) {
    return {
      targetRoles: [], targetCompanies: [], targetLocation: '',
      targetSeniority: [], userSchool: '', includeRemote: false,
      maxProfilesPerScan: DEFAULT_MAX_PROFILES
    };
  }
}

/* ===================================================================
   MAIN SCAN LOOP
   =================================================================== */

/**
 * Run the scan loop. Can be called for a fresh start or to resume
 * from a paused state.
 * @param {boolean} [isResume=false] - If true, resume from stored indices.
 * @returns {Promise<void>}
 */
async function runScanLoop(isResume = false) {
  if (scanInProgress) {
    return;
  }
  scanInProgress = true;
  stopRequested = false;

  let tabId = null;
  let stoppedReason = STOP_REASON_COMPLETED;
  let scanState;

  try {
    const config = await loadConfig();

    if (isResume) {
      /* Resume from stored state */
      scanState = await loadScanState();
      scanState.status = SCAN_STATUS_SCANNING;
      scanState.pauseReason = null;
    } else {
      /* Fresh scan */
      const sessionId = await generateSessionId();
      scanState = {
        status: SCAN_STATUS_SCANNING,
        currentQuery: '',
        currentQueryIndex: 0,
        currentProfileIndex: 0,
        profilesScanned: 0,
        sessionId,
        tabId: null,
        pauseReason: null,
        scanStartedAt: new Date().toISOString()
      };
    }

    const queries = generateSearchQueries(config, scanState.sessionId);
    if (queries.length === 0) {
      scanInProgress = false;
      return;
    }

    /* Determine starting query index (for resume) */
    const startQi = isResume ? (scanState.currentQueryIndex || 0) : 0;

    /* Create or reuse scanning tab */
    const tab = await chrome.tabs.create({ url: queries[startQi].url, active: false });
    tabId = tab.id;
    scanState.tabId = tabId;
    await saveScanState(scanState);
    await startKeepalive();

    try {
      await waitForTabLoad(tabId);
    } catch (_e) { /* timeout — proceed */ }
    await delay(PAGE_SETTLE_DELAY_MS);

    /* === Main loop: queries === */
    for (let qi = startQi; qi < queries.length; qi++) {
      if (stopRequested) {
        stoppedReason = STOP_REASON_USER_STOPPED;
        break;
      }
      if (scanState.profilesScanned >= config.maxProfilesPerScan) {
        stoppedReason = STOP_REASON_SESSION_LIMIT;
        break;
      }

      const query = queries[qi];
      scanState.currentQueryIndex = qi;
      scanState.currentQuery = query.label;
      await saveScanState(scanState);

      if (qi > startQi || (isResume && qi === startQi)) {
        /* Navigate to search page (skip first on fresh start) */
        if (!(qi === 0 && !isResume)) {
          await navigateAndWait(tabId, query.url);
        }
      }

      await broadcastToPopup({
        type: 'SCAN_PROGRESS',
        profilesScanned: scanState.profilesScanned,
        currentQuery: query.label
      });

      const searchKeywordTerms = buildSearchKeywordTerms(config);
      const profileUrls = await collectProfileUrls(tabId, searchKeywordTerms);

      /* === Inner loop: profiles === */
      const startPi = (isResume && qi === startQi)
        ? (scanState.currentProfileIndex || 0)
        : 0;
      /* Clear resume offset after first query */
      if (qi > startQi) {
        scanState.currentProfileIndex = 0;
      }

      for (let pi = startPi; pi < profileUrls.length; pi++) {
        if (stopRequested) {
          stoppedReason = STOP_REASON_USER_STOPPED;
          break;
        }
        if (scanState.profilesScanned >= config.maxProfilesPerScan) {
          stoppedReason = STOP_REASON_SESSION_LIMIT;
          break;
        }

        const profileUrl = profileUrls[pi];
        scanState.currentProfileIndex = pi;

        if (await isAlreadyScanned(profileUrl)) {
          continue;
        }

        await navigateAndWait(tabId, profileUrl);

        let profileData = await extractProfile(tabId, config);

        /* --- Rate limit handling --- */
        if (profileData && profileData.type === 'EXTRACTION_FAILED' && profileData.reason === 'rate_limited') {
          await delay(RATE_LIMIT_BACKOFF_MS);
          profileData = await extractProfile(tabId, config);

          if (profileData && profileData.type === 'EXTRACTION_FAILED') {
            /* Still rate-limited — pause scan */
            stoppedReason = STOP_REASON_RATE_LIMITED;
            scanState.status = SCAN_STATUS_PAUSED;
            scanState.pauseReason = 'rate_limited';
            await saveScanState(scanState);
            await broadcastToPopup({
              type: 'SCAN_PAUSED',
              reason: 'LinkedIn has detected unusual activity. Scanning paused. Wait 5-10 minutes before resuming.'
            });
            await stopKeepalive();
            /* Don't close tab — user may resume */
            scanInProgress = false;
            await logSessionEntry(scanState, stoppedReason);
            return;
          }
        }

        if (profileData && profileData.type === 'EXTRACTION_FAILED') {
          continue; /* Skip non-profile pages, extraction errors */
        }

        if (!profileData || !profileData.name) {
          continue;
        }

        /* Score */
        const scoreResult = scoreProfile(profileData, config);

        const result = {
          id: hashProfileUrl(profileUrl),
          name: profileData.name,
          title: profileData.headline || '',
          company: profileData.currentCompany || '',
          location: profileData.location || '',
          profileUrl: (profileData.profileUrl || profileUrl || '').replace(/\/$/, ''),
          score: scoreResult.totalScore,
          signals: {
            isAlumni: profileData.education?.isAlumni || false,
            recentActivity: profileData.activity?.hasRecentActivity || false,
            hiringSignals: profileData.hiringSignals?.hasHiringSignals || false,
            mutualConnections: profileData.mutualConnections || 0,
            connectionDegree: profileData.connectionDegree || null
          },
          scannedAt: new Date().toISOString(),
          sessionId: scanState.sessionId
        };

        await appendResult(result);
        await markUrlScanned(profileUrl);
        await incrementDailyScanCount();

        scanState.profilesScanned += 1;
        await saveScanState(scanState);

        await broadcastToPopup({ type: 'PROFILE_FOUND', profile: result });
        await broadcastToPopup({
          type: 'SCAN_PROGRESS',
          profilesScanned: scanState.profilesScanned,
          currentQuery: query.label
        });

        const waitTime = computeScanDelay(scanState.profilesScanned);
        await delay(waitTime);
      }

      if (stopRequested || stoppedReason !== STOP_REASON_COMPLETED) {
        break;
      }
    }

    /* === Scan finished === */
    scanState.status = SCAN_STATUS_IDLE;
    scanState.currentQuery = '';
    scanState.pauseReason = null;
    await saveScanState(scanState);

    const allResults = (await storage.get(KEY_SCAN_RESULTS)) || [];
    const scored55Plus = allResults.filter((r) => r.score >= HIGH_SCORE_THRESHOLD).length;

    await broadcastToPopup({
      type: 'SCAN_COMPLETE',
      totalScanned: scanState.profilesScanned,
      totalScored55Plus: scored55Plus
    });

    if (tabId) {
      try { await chrome.tabs.remove(tabId); } catch (_e) { /* already closed */ }
    }

    await logSessionEntry(scanState, stoppedReason);

  } catch (_error) {
    const state = await loadScanState();
    state.status = SCAN_STATUS_IDLE;
    state.pauseReason = null;
    await saveScanState(state);
    await broadcastToPopup({ type: 'SCAN_ERROR', error: 'Scan stopped unexpectedly.' });
    if (tabId) {
      try { await chrome.tabs.remove(tabId); } catch (_e) { /* already closed */ }
    }
    stoppedReason = 'error';
  } finally {
    scanInProgress = false;
    await stopKeepalive();
  }
}

/**
 * Log the end of a scan session to history.
 * @param {Object} scanState
 * @param {string} stoppedReason
 * @returns {Promise<void>}
 */
async function logSessionEntry(scanState, stoppedReason) {
  const allResults = (await storage.get(KEY_SCAN_RESULTS)) || [];
  const sessionResults = allResults.filter((r) => r.sessionId === scanState.sessionId);
  const scored55Plus = sessionResults.filter((r) => r.score >= HIGH_SCORE_THRESHOLD).length;

  await logSession({
    sessionId: scanState.sessionId,
    startedAt: scanState.scanStartedAt || new Date().toISOString(),
    endedAt: new Date().toISOString(),
    profilesScanned: scanState.profilesScanned,
    profilesScored55Plus: scored55Plus,
    queriesRun: (scanState.currentQueryIndex || 0) + 1,
    stoppedReason
  });
}

/* ===================================================================
   STOP / RESUME
   =================================================================== */

/**
 * Handle a stop-scan request.
 * @returns {Promise<void>}
 */
async function handleStopScan() {
  stopRequested = true;

  const state = await loadScanState();
  state.status = SCAN_STATUS_IDLE;
  state.currentQuery = '';
  state.pauseReason = null;

  if (state.tabId) {
    try { await chrome.tabs.remove(state.tabId); } catch (_e) { /* tab already closed */ }
    state.tabId = null;
  }

  await saveScanState(state);
  await stopKeepalive();
}

/**
 * Handle a resume-scan request. Picks up where we left off.
 * @returns {Promise<void>}
 */
async function handleResumeScan() {
  const state = await loadScanState();
  if (state.status !== SCAN_STATUS_PAUSED) {
    return; /* Can only resume from paused state */
  }

  /* Close old tab if still around */
  if (state.tabId) {
    try { await chrome.tabs.remove(state.tabId); } catch (_e) { /* already closed */ }
    state.tabId = null;
    await saveScanState(state);
  }

  /* Kick off the loop in resume mode */
  runScanLoop(true);
}

/* ===================================================================
   MESSAGE HANDLER
   =================================================================== */

/**
 * Handle incoming messages from the popup or content scripts.
 * @param {Object} message
 * @param {chrome.runtime.MessageSender} _sender
 * @param {function} sendResponse
 * @returns {boolean}
 */
function handleMessage(message, _sender, sendResponse) {
  if (!message || !message.type) {
    sendResponse({ status: 'error', message: 'No message type' });
    return true;
  }

  switch (message.type) {
    case 'PING':
      sendResponse({ status: 'ok', message: 'Service worker active' });
      return true;

    case 'START_SCAN':
      generateSessionId().then((sessionId) => {
        sendResponse({ status: 'ok', sessionId });
        runScanLoop(false);
      });
      return true;

    case 'STOP_SCAN':
      handleStopScan().then(() => {
        sendResponse({ status: 'ok' });
      });
      return true;

    case 'RESUME_SCAN':
      sendResponse({ status: 'ok' });
      handleResumeScan();
      return true;

    case 'GET_STATUS':
      loadScanState().then((state) => {
        sendResponse({ status: 'ok', scanState: state });
      });
      return true;

    case 'RATE_LIMITED':
      /* Proactive rate-limit notification from content script */
      loadScanState().then(async (state) => {
        if (state.status === SCAN_STATUS_SCANNING) {
          stopRequested = true;
          state.status = SCAN_STATUS_PAUSED;
          state.pauseReason = 'rate_limited';
          await saveScanState(state);
          await broadcastToPopup({
            type: 'SCAN_PAUSED',
            reason: 'LinkedIn has detected unusual activity. Scanning paused. Wait 5-10 minutes before resuming.'
          });
          await stopKeepalive();
        }
        sendResponse({ status: 'ok' });
      });
      return true;

    case 'GET_DAILY_COUNT':
      storage.get(KEY_DAILY_SCAN_COUNT).then((data) => {
        const today = todayDateString();
        const count = (data && data.date === today) ? data.count : 0;
        sendResponse({ status: 'ok', count });
      }).catch(() => {
        sendResponse({ status: 'ok', count: 0 });
      });
      return true;

    default:
      sendResponse({ status: 'ok', message: 'Unhandled type' });
      return true;
  }
}

chrome.runtime.onMessage.addListener(handleMessage);
