'use strict';

// linkscout/content/navigator.js — Page navigation helpers for LinkedIn profile pages.

/**
 * @fileoverview DOM navigation utilities: element polling, smooth scrolling,
 * section discovery, and human-like random delays. No Chrome API dependencies.
 */

/** @type {number} Default polling interval in ms for waitForElement. */
const POLL_INTERVAL_MS = 200;

/** @type {number} Default timeout in ms for waitForElement. */
const DEFAULT_TIMEOUT_MS = 8000;

/** @type {number} Duration in ms to wait after a smooth scroll for content to settle. */
const SCROLL_SETTLE_MS = 1500;

/**
 * Poll for a DOM element matching a selector. Resolves with the element
 * or null if the timeout is reached.
 *
 * @param {string} selector - CSS selector or a special ":contains(text)" pseudo-selector.
 * @param {number} [timeout=8000] - Maximum wait time in ms.
 * @returns {Promise<Element|null>}
 */
async function waitForElement(selector, timeout = DEFAULT_TIMEOUT_MS) {
  const start = Date.now();

  return new Promise((resolve) => {
    const check = () => {
      const el = document.querySelector(selector);
      if (el) {
        resolve(el);
        return;
      }
      if (Date.now() - start >= timeout) {
        resolve(null);
        return;
      }
      setTimeout(check, POLL_INTERVAL_MS);
    };
    check();
  });
}

/**
 * Find an element by its visible text content. Searches within an optional root.
 *
 * @param {string} tagName - Tag name to search (e.g., "h2", "span", "section").
 * @param {string} textMatch - Substring to match (case-insensitive).
 * @param {Element} [root=document] - Root element to search within.
 * @returns {Element|null}
 */
function findElementByText(tagName, textMatch, root = document) {
  const elements = root.querySelectorAll(tagName);
  const lower = textMatch.toLowerCase();
  for (const el of elements) {
    const text = (el.textContent || '').trim().toLowerCase();
    if (text.includes(lower)) {
      return el;
    }
  }
  return null;
}

/**
 * Smooth-scroll to a Y position and wait for the scroll to settle.
 *
 * @param {number} yPosition - Target scroll position in pixels.
 * @returns {Promise<void>} Resolves after scrolling completes and content settles.
 */
async function smoothScrollTo(yPosition) {
  return new Promise((resolve) => {
    window.scrollTo({ top: yPosition, behavior: 'smooth' });
    setTimeout(resolve, SCROLL_SETTLE_MS);
  });
}

/**
 * Attempt to scroll to a named profile section (e.g., "Experience", "Education", "Activity").
 * Finds the section heading, then scrolls it into view.
 *
 * @param {string} sectionName - The visible heading text of the section.
 * @returns {Promise<Element|null>} The section element, or null if not found.
 */
async function scrollToSection(sectionName) {
  /* Strategy 1: Look for an element with id containing the section name */
  const idMatch = document.querySelector(`[id*="${sectionName.toLowerCase()}"]`);
  if (idMatch) {
    idMatch.scrollIntoView({ behavior: 'smooth', block: 'start' });
    await delay(SCROLL_SETTLE_MS);
    return idMatch;
  }

  /* Strategy 2: Find a heading or span containing the section name */
  const headingTags = ['h2', 'h3', 'span', 'div'];
  for (const tag of headingTags) {
    const el = findElementByText(tag, sectionName);
    if (el) {
      el.scrollIntoView({ behavior: 'smooth', block: 'start' });
      await delay(SCROLL_SETTLE_MS);
      /* Return the closest section-level ancestor */
      return el.closest('section') || el.parentElement || el;
    }
  }

  return null;
}

/**
 * Wait for a fixed duration.
 *
 * @param {number} ms - Duration in milliseconds.
 * @returns {Promise<void>}
 */
function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Wait for a random duration between min and max milliseconds.
 * Useful for adding human-like pauses between actions.
 *
 * @param {number} minMs - Minimum delay in ms.
 * @param {number} maxMs - Maximum delay in ms.
 * @returns {Promise<void>}
 */
function randomDelay(minMs, maxMs) {
  const ms = Math.floor(Math.random() * (maxMs - minMs + 1)) + minMs;
  return delay(ms);
}

/**
 * Scroll down the page incrementally to trigger lazy-loaded sections.
 * Scrolls in chunks with pauses between each chunk.
 *
 * @param {number} [totalDistance=3000] - Total distance to scroll in pixels.
 * @param {number} [chunkSize=600] - Pixels to scroll per chunk.
 * @param {number} [chunkDelay=400] - Delay between chunks in ms.
 * @returns {Promise<void>}
 */
async function scrollToLoadSections(totalDistance = 3000, chunkSize = 600, chunkDelay = 400) {
  let scrolled = 0;
  while (scrolled < totalDistance) {
    window.scrollBy({ top: chunkSize, behavior: 'smooth' });
    scrolled += chunkSize;
    await delay(chunkDelay);
  }
  /* Extra settle time for lazy content */
  await delay(SCROLL_SETTLE_MS);
}

/* Export for use by extractor.js (loaded in same content script context) */
/* eslint-disable no-unused-vars */
// These functions are accessed via the shared content script scope.
// In the manifest, both navigator.js and extractor.js are injected together.

if (typeof globalThis.__linkscout === 'undefined') {
  globalThis.__linkscout = {};
}

globalThis.__linkscout.navigator = {
  waitForElement,
  findElementByText,
  smoothScrollTo,
  scrollToSection,
  delay,
  randomDelay,
  scrollToLoadSections
};
