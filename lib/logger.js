'use strict';

// linkscout/lib/logger.js — Debug logging utility: togglable via storage flag.

/**
 * @fileoverview Provides a structured logging utility that is silent in
 * production and verbose when debug mode is enabled. Error-level messages
 * always print regardless of the debug flag.
 *
 * Usage (in any context — popup, service worker, content script):
 *   import * as logger from '../lib/logger.js';
 *   logger.debug('Extracting profile', { url });
 *   logger.error('Extraction failed', err);
 */

/** @type {string} Prefix shown on every log line. */
const LOG_PREFIX = '[LinkScout]';

/** @type {string} Storage key for the debug mode flag. */
const DEBUG_KEY = 'debugMode';

/** @type {Array<{ts: string, level: string, args: Array}>} In-memory log buffer for export. */
const logBuffer = [];

/** @type {number} Maximum entries in the in-memory log buffer. */
const MAX_LOG_BUFFER = 500;

/**
 * Check if debug mode is currently enabled.
 * @returns {Promise<boolean>}
 */
async function isDebugEnabled() {
  try {
    const result = await chrome.storage.local.get(DEBUG_KEY);
    return !!result[DEBUG_KEY];
  } catch (_e) {
    return false;
  }
}

/**
 * Core logging function. Checks debug flag, then routes to the
 * appropriate console method.
 *
 * @param {'debug'|'info'|'warn'|'error'} level - Severity level.
 * @param {...*} args - Values to log.
 * @returns {Promise<void>}
 */
export async function log(level, ...args) {
  /* Always buffer for debug export */
  logBuffer.push({
    ts: new Date().toISOString(),
    level,
    args: args.map((a) => {
      try { return typeof a === 'object' ? JSON.stringify(a) : String(a); }
      catch (_e) { return String(a); }
    })
  });
  if (logBuffer.length > MAX_LOG_BUFFER) {
    logBuffer.shift();
  }

  /* Errors always print; other levels only print in debug mode */
  const shouldPrint = level === 'error' || await isDebugEnabled();
  if (!shouldPrint) {
    return;
  }

  const tag = `[${level.toUpperCase()}]`;
  const fn = level === 'error'
    ? console.error   // eslint-disable-line no-console
    : level === 'warn'
      ? console.warn  // eslint-disable-line no-console
      : console.log;  // eslint-disable-line no-console

  fn(LOG_PREFIX, tag, ...args);
}

/**
 * Log a debug-level message (only visible when debug mode is on).
 * @param {...*} args
 */
export const debug = (...args) => log('debug', ...args);

/**
 * Log an info-level message (only visible when debug mode is on).
 * @param {...*} args
 */
export const info = (...args) => log('info', ...args);

/**
 * Log a warning-level message (only visible when debug mode is on).
 * @param {...*} args
 */
export const warn = (...args) => log('warn', ...args);

/**
 * Log an error-level message (always visible).
 * @param {...*} args
 */
export const error = (...args) => log('error', ...args);

/**
 * Retrieve the in-memory log buffer for debug export.
 * @returns {Array<{ts: string, level: string, args: Array}>}
 */
export function getLogBuffer() {
  return [...logBuffer];
}
