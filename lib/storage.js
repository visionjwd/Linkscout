'use strict';

// linkscout/lib/storage.js — Wrapper around chrome.storage.local with typed getters/setters.

/**
 * @fileoverview Promise-based wrapper for chrome.storage.local.
 * All extension state flows through these functions.
 */

/**
 * Retrieve a single value from chrome.storage.local.
 * @param {string} key - The storage key to look up.
 * @returns {Promise<*>} The stored value, or undefined if not found.
 */
export async function get(key) {
  try {
    const result = await chrome.storage.local.get(key);
    return result[key];
  } catch (error) {
    throw new Error(`storage.get("${key}") failed: ${error.message}`);
  }
}

/**
 * Save a single key-value pair to chrome.storage.local.
 * @param {string} key - The storage key.
 * @param {*} value - The value to store (must be JSON-serializable).
 * @returns {Promise<void>}
 */
export async function set(key, value) {
  try {
    await chrome.storage.local.set({ [key]: value });
  } catch (error) {
    throw new Error(`storage.set("${key}") failed: ${error.message}`);
  }
}

/**
 * Retrieve all key-value pairs from chrome.storage.local.
 * @returns {Promise<Object>} An object containing all stored key-value pairs.
 */
export async function getAll() {
  try {
    return await chrome.storage.local.get(null);
  } catch (error) {
    throw new Error(`storage.getAll() failed: ${error.message}`);
  }
}

/**
 * Remove all data from chrome.storage.local.
 * @returns {Promise<void>}
 */
export async function clear() {
  try {
    await chrome.storage.local.clear();
  } catch (error) {
    throw new Error(`storage.clear() failed: ${error.message}`);
  }
}

/**
 * Save multiple key-value pairs to chrome.storage.local in one operation.
 * @param {Object} data - An object of key-value pairs to store.
 * @returns {Promise<void>}
 */
export async function setMany(data) {
  try {
    await chrome.storage.local.set(data);
  } catch (error) {
    throw new Error(`storage.setMany() failed: ${error.message}`);
  }
}
