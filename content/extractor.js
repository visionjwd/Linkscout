'use strict';

// linkscout/content/extractor.js — LinkedIn profile DOM extractor with layered strategy.

/**
 * @fileoverview Extracts structured profile data from LinkedIn profile pages.
 * Uses a layered extraction strategy: accessibility attrs → semantic HTML →
 * text patterns → CSS classes (last resort). Every field returns a confidence
 * level and extraction method for debugging.
 *
 * Depends on navigator.js being loaded first (via manifest content_scripts order).
 */

/* ===================================================================
   CONSTANTS
   =================================================================== */

/** @type {number} Max time in ms to wait for the profile page to load. */
const PAGE_LOAD_TIMEOUT_MS = 8000;

/** @type {number} Days threshold for "recent" activity. */
const RECENT_ACTIVITY_DAYS = 90;

/** @type {string[]} Keywords that signal hiring intent in posts. */
const HIRING_KEYWORDS = [
  'hiring', 'open role', 'open position', 'join my team',
  'join our team', 'looking for', "we're looking", 'dm me',
  '#hiring', '#opentowork', 'new opening'
];

/** @type {RegExp} Pattern to extract connection count from text. */
const CONNECTIONS_PATTERN = /(\d[\d,]*)\+?\s*connections?/i;

/** @type {RegExp} Pattern to extract mutual connection count. */
const MUTUAL_PATTERN = /(\d[\d,]*)\s*mutual\s*connections?/i;

/** @type {RegExp} Pattern to identify connection degree badge. */
const DEGREE_PATTERN = /\b(1st|2nd|3rd)\b/;

/** @type {Object<string, number>} Mapping of LinkedIn relative date suffixes to day multipliers. */
const DATE_UNIT_MAP = {
  's': 0,     /* seconds — essentially "just now" */
  'm': 0,     /* minutes */
  'h': 0,     /* hours — same day */
  'd': 1,     /* days */
  'w': 7,     /* weeks */
  'mo': 30,   /* months */
  'yr': 365   /* years */
};

/* ===================================================================
   NAVIGATOR REFERENCE
   =================================================================== */

/**
 * Reference to navigator helpers injected by navigator.js.
 * @type {Object}
 */
const nav = (typeof globalThis !== 'undefined' && globalThis.__linkscout)
  ? globalThis.__linkscout.navigator
  : {};

/* ===================================================================
   EXTRACTION RESULT HELPER
   =================================================================== */

/**
 * Create a standardized extraction result.
 *
 * @param {*} value - The extracted value.
 * @param {'high'|'medium'|'low'} confidence - Confidence in the extraction.
 * @param {string} method - Description of the extraction method used.
 * @returns {{value: *, confidence: string, method: string}}
 */
function result(value, confidence, method) {
  return { value, confidence, method };
}

/* ===================================================================
   PAGE STATE DETECTION
   =================================================================== */

/**
 * Check if the current page appears to be rate-limited or showing a CAPTCHA.
 * Checks title, body content, DOM size, and CAPTCHA iframes.
 *
 * @returns {boolean} True if the page looks like a rate-limit/error page.
 */
function isRateLimited() {
  const title = (document.title || '').toLowerCase();
  const bodyText = (document.body.innerText || '').toLowerCase();

  /* Title-based detection */
  const titleSignals = ['security verification', 'security check', 'challenge'];
  const titleMatch = titleSignals.some((s) => title.includes(s));
  if (titleMatch) {
    return true;
  }

  /* Very low DOM content + known phrases */
  const elementCount = document.body.querySelectorAll('*').length;
  const lowContent = elementCount < 50 || bodyText.length < 500;
  const phraseSignals = [
    'something went wrong', 'captcha', 'verify you are a human',
    'too many requests', 'try again later', 'unusual activity',
    'let\'s do a quick security check', 'security verification'
  ];
  const hasPhrase = phraseSignals.some((s) => bodyText.includes(s));

  if (lowContent && hasPhrase) {
    return true;
  }

  /* CAPTCHA iframe detection */
  const iframes = document.querySelectorAll('iframe[src]');
  for (const iframe of iframes) {
    const src = (iframe.src || '').toLowerCase();
    if (src.includes('recaptcha') || src.includes('captcha') || src.includes('challenge')) {
      return true;
    }
  }

  return false;
}

/**
 * Proactively check for rate limiting and notify the service worker if detected.
 * Called on page load via the content script.
 */
function proactiveRateLimitCheck() {
  if (isRateLimited()) {
    try {
      chrome.runtime.sendMessage({ type: 'RATE_LIMITED' });
    } catch (_e) {
      /* Service worker may not be listening — ignore */
    }
  }
}

/* Run proactive check after a short delay to let the page settle */
setTimeout(proactiveRateLimitCheck, 2000);

/**
 * Check if the current page is a LinkedIn profile page (not search, feed, etc.).
 *
 * @returns {boolean}
 */
function isProfilePage() {
  const url = window.location.href;
  return url.includes('linkedin.com/in/');
}

/* ===================================================================
   INDIVIDUAL EXTRACTORS
   =================================================================== */

/**
 * Extract the person's full name from the profile.
 *
 * @returns {{value: string|null, confidence: string, method: string}}
 */
function extractName() {
  /* Strategy 1: h1 in the main profile intro — most reliable */
  const h1 = document.querySelector('h1');
  if (h1) {
    const text = h1.textContent.trim();
    if (text && text.length > 1 && text.length < 100) {
      return result(text, 'high', 'h1_element');
    }
  }

  /* Strategy 2: document.title — format is typically "Name | LinkedIn" */
  const title = document.title || '';
  const pipeParts = title.split('|');
  if (pipeParts.length >= 2) {
    const name = pipeParts[0].trim();
    if (name && name.length > 1) {
      return result(name, 'medium', 'document_title');
    }
  }

  /* Strategy 3: og:title meta tag */
  const ogTitle = document.querySelector('meta[property="og:title"]');
  if (ogTitle) {
    const content = (ogTitle.getAttribute('content') || '').trim();
    if (content) {
      return result(content, 'medium', 'og_title_meta');
    }
  }

  return result(null, 'low', 'not_found');
}

/**
 * Extract the headline / current title text.
 *
 * @returns {{value: string|null, confidence: string, method: string}}
 */
function extractHeadline() {
  /* Strategy 1: The element immediately after h1 that looks like a headline.
     LinkedIn typically places the headline in a div that's a sibling/descendant
     near the h1. We look for the first substantial text block after h1. */
  const h1 = document.querySelector('h1');
  if (h1) {
    /* Walk siblings and descendants of h1's parent container */
    const parent = h1.closest('section') || h1.parentElement;
    if (parent) {
      const candidates = parent.querySelectorAll('div, span');
      for (const el of candidates) {
        /* Skip if it's inside h1 or is the h1 itself */
        if (h1.contains(el) || el.contains(h1)) {
          continue;
        }
        const text = el.textContent.trim();
        /* Headline is typically 10–200 chars, not a connection count, not a location */
        if (
          text.length >= 10 &&
          text.length <= 300 &&
          !CONNECTIONS_PATTERN.test(text) &&
          !DEGREE_PATTERN.test(text) &&
          !MUTUAL_PATTERN.test(text) &&
          !/^\d/.test(text) &&
          !text.includes('connection')
        ) {
          return result(text, 'high', 'first_text_after_h1');
        }
      }
    }
  }

  /* Strategy 2: meta description often contains "headline" */
  const metaDesc = document.querySelector('meta[name="description"]');
  if (metaDesc) {
    const content = (metaDesc.getAttribute('content') || '').trim();
    /* Format is often "Name · Headline · Location" */
    const parts = content.split('·').map((p) => p.trim());
    if (parts.length >= 2 && parts[1].length >= 5) {
      return result(parts[1], 'medium', 'meta_description');
    }
  }

  return result(null, 'low', 'not_found');
}

/**
 * Extract the current company from the experience section or intro card.
 *
 * @returns {{value: string|null, confidence: string, method: string}}
 */
function extractCompany() {
  /* Strategy 1: Experience section — find "Experience" heading, then first company */
  const expSection = findSection('Experience');
  if (expSection) {
    /* Company names are typically in spans or links within the first experience entry */
    const entries = expSection.querySelectorAll('li, div[data-view-name]');
    if (entries.length > 0) {
      /* Look for a link or prominent span that's the company name */
      const links = entries[0].querySelectorAll('a[href*="/company/"], a[data-field="experience_company_logo"]');
      if (links.length > 0) {
        const text = links[0].textContent.trim();
        if (text) {
          return result(text, 'high', 'experience_section_link');
        }
      }
      /* Fallback: look for a span with "Full-time", "Part-time" nearby — the company is usually the parent */
      const spans = entries[0].querySelectorAll('span');
      for (const span of spans) {
        const text = span.textContent.trim();
        if (text && text.length >= 2 && text.length <= 80 && !text.includes('·') && !text.includes(' yr') && !text.includes(' mo')) {
          /* Heuristic: second significant span in first entry is often the company */
          return result(text, 'medium', 'experience_section_span');
        }
      }
    }
  }

  /* Strategy 2: Intro card — look for a link to a company page near the headline */
  const companyLinks = document.querySelectorAll('a[href*="/company/"]');
  for (const link of companyLinks) {
    /* Only consider links in the top ~500px of the profile (intro card area) */
    const rect = link.getBoundingClientRect();
    if (rect.top < 500 && rect.top > 0) {
      const text = link.textContent.trim();
      if (text && text.length >= 2 && text.length <= 80) {
        return result(text, 'medium', 'intro_card_company_link');
      }
    }
  }

  /* Strategy 3: Meta description — "Name at Company" pattern */
  const metaDesc = document.querySelector('meta[name="description"]');
  if (metaDesc) {
    const content = metaDesc.getAttribute('content') || '';
    const atMatch = content.match(/\bat\s+([A-Z][\w\s&.',-]+?)(?:\s*·|\s*-|\s*$)/i);
    if (atMatch && atMatch[1]) {
      return result(atMatch[1].trim(), 'medium', 'meta_description_at_pattern');
    }
  }

  return result(null, 'low', 'not_found');
}

/**
 * Extract the location from the profile intro section.
 *
 * @returns {{value: string|null, confidence: string, method: string}}
 */
function extractLocation() {
  /* Strategy 1: Look for a span in the intro area with location-like text.
     Locations typically contain commas (City, Province) or known geographic terms. */
  const introSection = document.querySelector('h1')?.closest('section') || document.querySelector('main');
  if (introSection) {
    const spans = introSection.querySelectorAll('span');
    for (const span of spans) {
      const text = span.textContent.trim();
      /* Location heuristic: contains a comma or known geo keywords, not too long */
      if (
        text.length >= 3 &&
        text.length <= 80 &&
        (text.includes(',') || /\b(area|region|canada|ontario|toronto|vancouver|montreal|united states|uk|india|remote)\b/i.test(text)) &&
        !CONNECTIONS_PATTERN.test(text) &&
        !text.includes('follower')
      ) {
        return result(text, 'high', 'intro_section_span_geo');
      }
    }
  }

  /* Strategy 2: meta description — usually 3rd segment after "·" */
  const metaDesc = document.querySelector('meta[name="description"]');
  if (metaDesc) {
    const content = metaDesc.getAttribute('content') || '';
    const parts = content.split('·').map((p) => p.trim());
    /* Location is often the last segment before "X connections" */
    for (let i = parts.length - 1; i >= 0; i--) {
      const part = parts[i];
      if (part.length >= 3 && part.length <= 80 && !part.includes('connection') && /[A-Z]/.test(part)) {
        return result(part, 'medium', 'meta_description_segment');
      }
    }
  }

  return result(null, 'low', 'not_found');
}

/**
 * Extract the connection count and 500+ flag.
 *
 * @returns {{value: {count: number|null, is500Plus: boolean}, confidence: string, method: string}}
 */
function extractConnectionCount() {
  const bodyText = document.body.innerText || '';

  /* Strategy 1: Regex scan of full page text */
  const match = bodyText.match(CONNECTIONS_PATTERN);
  if (match) {
    const raw = match[1].replace(/,/g, '');
    const count = parseInt(raw, 10);
    const is500Plus = match[0].includes('+');
    return result({ count, is500Plus }, 'high', 'text_pattern_match');
  }

  /* Strategy 2: Look for connection links/buttons */
  const connLink = document.querySelector('a[href*="connections"], span[aria-label*="connection"]');
  if (connLink) {
    const text = (connLink.textContent || connLink.getAttribute('aria-label') || '');
    const linkMatch = text.match(/(\d[\d,]*)\+?/);
    if (linkMatch) {
      const count = parseInt(linkMatch[1].replace(/,/g, ''), 10);
      return result({ count, is500Plus: text.includes('+') }, 'medium', 'connection_link');
    }
  }

  return result({ count: null, is500Plus: false }, 'low', 'not_found');
}

/**
 * Extract the connection degree (1st, 2nd, 3rd).
 *
 * @returns {{value: number|null, confidence: string, method: string}}
 */
function extractConnectionDegree() {
  /* Strategy 1: Badge near the name — look for "1st", "2nd", "3rd" in the intro area */
  const introSection = document.querySelector('h1')?.closest('section') || document.body;
  const allText = introSection.querySelectorAll('span, div, svg title');

  for (const el of allText) {
    const text = (el.textContent || '').trim();
    const match = text.match(DEGREE_PATTERN);
    if (match) {
      const degree = parseInt(match[1], 10);
      return result(degree, 'high', 'intro_section_badge');
    }
    /* Also check aria-label for accessibility-tagged badges */
    const aria = el.getAttribute('aria-label') || '';
    const ariaMatch = aria.match(/(\d)(?:st|nd|rd)\s*degree/i);
    if (ariaMatch) {
      return result(parseInt(ariaMatch[1], 10), 'high', 'aria_label_degree');
    }
  }

  /* Strategy 2: Full page scan (less specific) */
  const bodyText = document.body.innerText || '';
  const bodyMatch = bodyText.match(DEGREE_PATTERN);
  if (bodyMatch) {
    return result(parseInt(bodyMatch[1], 10), 'medium', 'body_text_scan');
  }

  return result(null, 'low', 'not_found');
}

/**
 * Extract the mutual connections count.
 *
 * @returns {{value: number, confidence: string, method: string}}
 */
function extractMutualConnections() {
  const bodyText = document.body.innerText || '';
  const match = bodyText.match(MUTUAL_PATTERN);
  if (match) {
    const count = parseInt(match[1].replace(/,/g, ''), 10);
    return result(count, 'high', 'text_pattern_match');
  }

  /* Check aria-labels */
  const mutualEl = document.querySelector('[aria-label*="mutual"]');
  if (mutualEl) {
    const aria = mutualEl.getAttribute('aria-label') || '';
    const ariaMatch = aria.match(/(\d[\d,]*)/);
    if (ariaMatch) {
      return result(parseInt(ariaMatch[1].replace(/,/g, ''), 10), 'medium', 'aria_label_mutual');
    }
  }

  /* Default: 0 (not the same as "confirmed zero" — section may be hidden) */
  return result(0, 'low', 'not_found_default_zero');
}

/**
 * Check education entries for a school name match.
 *
 * @param {string} userSchool - The user's school name to match against.
 * @returns {{value: {isAlumni: boolean, schoolMatch: string|null}, confidence: string, method: string}}
 */
function extractEducation(userSchool) {
  const eduSection = findSection('Education');
  if (!eduSection) {
    return result({ isAlumni: false, schoolMatch: null }, 'low', 'education_section_not_found');
  }

  const schoolLower = (userSchool || '').toLowerCase();
  if (!schoolLower) {
    return result({ isAlumni: false, schoolMatch: null }, 'low', 'no_school_configured');
  }

  /* Scan all text in the education section for a case-insensitive partial match */
  const allText = eduSection.querySelectorAll('span, a, div, h3');
  for (const el of allText) {
    const text = (el.textContent || '').trim();
    if (text.toLowerCase().includes(schoolLower) || schoolLower.includes(text.toLowerCase())) {
      return result({ isAlumni: true, schoolMatch: text }, 'high', 'education_section_text_match');
    }
    /* Also try partial keyword match — "waterloo" matches "University of Waterloo" */
    const schoolKeywords = schoolLower.split(/\s+/).filter((w) => w.length >= 4);
    for (const keyword of schoolKeywords) {
      if (text.toLowerCase().includes(keyword)) {
        return result({ isAlumni: true, schoolMatch: text }, 'medium', 'education_section_keyword_match');
      }
    }
  }

  return result({ isAlumni: false, schoolMatch: null }, 'high', 'education_section_no_match');
}

/**
 * Parse a LinkedIn relative date string into an approximate day count.
 * Examples: "3d" → 3, "2w" → 14, "1mo" → 30, "1yr" → 365.
 *
 * @param {string} dateString - LinkedIn relative date (e.g., "3d", "2mo").
 * @returns {{withinDays: number}}
 */
function parseRelativeDate(dateString) {
  if (!dateString) {
    return { withinDays: Infinity };
  }

  const cleaned = dateString.trim().toLowerCase();

  /* Match number + unit: "3d", "2w", "1mo", "1yr", "45m", "3h" */
  const match = cleaned.match(/^(\d+)\s*(yr|mo|w|d|h|m|s)$/);
  if (match) {
    const num = parseInt(match[1], 10);
    const unit = match[2];
    const multiplier = DATE_UNIT_MAP[unit];
    if (multiplier !== undefined) {
      return { withinDays: num * multiplier };
    }
  }

  /* "Just now", "today" */
  if (cleaned === 'now' || cleaned === 'just now' || cleaned === 'today') {
    return { withinDays: 0 };
  }

  return { withinDays: Infinity };
}

/**
 * Extract recent activity and check for hiring signals.
 *
 * @returns {{
 *   activity: {hasRecentActivity: boolean, mostRecentPost: string|null, activityType: string|null},
 *   hiringSignals: {hasHiringSignals: boolean, matchedKeywords: string[]},
 *   confidence: string,
 *   method: string
 * }}
 */
function extractActivityAndHiring() {
  const defaultActivity = { hasRecentActivity: false, mostRecentPost: null, activityType: null };
  const defaultHiring = { hasHiringSignals: false, matchedKeywords: [] };

  /* Find the activity section */
  const actSection = findSection('Activity');
  if (!actSection) {
    /* Also try "Show all activity" link */
    const actLink = document.querySelector('a[href*="detail/recent-activity"]');
    if (!actLink) {
      return { activity: defaultActivity, hiringSignals: defaultHiring, confidence: 'low', method: 'activity_section_not_found' };
    }
    /* Use the link's parent container as the activity section */
  }

  const searchRoot = actSection || document.body;

  /* Look for relative date stamps in the activity area */
  const dateSpans = searchRoot.querySelectorAll('span, time');
  let mostRecentDays = Infinity;
  let mostRecentText = null;

  for (const span of dateSpans) {
    const text = (span.textContent || '').trim();
    /* Match patterns like "3d", "2w", "1mo" — usually short spans */
    if (text.length <= 5 && /^\d+\s*(?:yr|mo|w|d|h|m|s)$/.test(text)) {
      const parsed = parseRelativeDate(text);
      if (parsed.withinDays < mostRecentDays) {
        mostRecentDays = parsed.withinDays;
        mostRecentText = text;
      }
    }
    /* Also check datetime attribute on <time> elements */
    const datetime = span.getAttribute('datetime');
    if (datetime) {
      try {
        const date = new Date(datetime);
        const daysDiff = Math.floor((Date.now() - date.getTime()) / (86400000));
        if (daysDiff < mostRecentDays) {
          mostRecentDays = daysDiff;
          mostRecentText = text || `${daysDiff}d ago`;
        }
      } catch (_e) {
        /* Ignore parse errors */
      }
    }
  }

  const hasRecentActivity = mostRecentDays <= RECENT_ACTIVITY_DAYS;

  /* Determine activity type from visible content */
  let activityType = null;
  if (hasRecentActivity) {
    const actText = (searchRoot.textContent || '').toLowerCase();
    if (actText.includes('posted') || actText.includes('shared a post')) {
      activityType = 'post';
    } else if (actText.includes('reposted') || actText.includes('shared')) {
      activityType = 'repost';
    } else if (actText.includes('article') || actText.includes('published')) {
      activityType = 'article';
    } else {
      activityType = 'post';
    }
  }

  /* Scan for hiring keywords in visible post content */
  const actTextFull = (searchRoot.textContent || '').toLowerCase();
  const matchedKeywords = [];
  for (const keyword of HIRING_KEYWORDS) {
    if (actTextFull.includes(keyword.toLowerCase())) {
      matchedKeywords.push(keyword);
    }
  }

  return {
    activity: {
      hasRecentActivity,
      mostRecentPost: mostRecentText,
      activityType
    },
    hiringSignals: {
      hasHiringSignals: matchedKeywords.length > 0,
      matchedKeywords
    },
    confidence: actSection ? 'medium' : 'low',
    method: actSection ? 'activity_section_scan' : 'body_text_fallback'
  };
}

/**
 * Extract and normalize the canonical profile URL.
 *
 * @returns {{value: string, confidence: string, method: string}}
 */
function extractProfileUrl() {
  const raw = window.location.href;

  /* Strip query params, hash, trailing slash */
  try {
    const url = new URL(raw);
    let path = url.pathname.replace(/\/+$/, '');
    /* Normalize: ensure it's a /in/ URL */
    if (path.includes('/in/')) {
      const clean = `${url.origin}${path}`;
      return result(clean, 'high', 'window_location');
    }
  } catch (_e) {
    /* Fallback */
  }

  return result(raw.split('?')[0].replace(/\/+$/, ''), 'medium', 'window_location_raw');
}

/* ===================================================================
   SECTION FINDER HELPER
   =================================================================== */

/**
 * Find a profile section by its heading text.
 * Uses multiple strategies: id-based, aria-based, and text-content scanning.
 *
 * @param {string} sectionName - Visible heading text (e.g., "Experience", "Education").
 * @returns {Element|null} The section element, or null if not found.
 */
function findSection(sectionName) {
  /* Strategy 1: Section with an ID containing the name */
  const byId = document.querySelector(`section[id*="${sectionName.toLowerCase()}"], #${sectionName.toLowerCase()}`);
  if (byId) {
    return byId;
  }

  /* Strategy 2: aria-label on a section */
  const sections = document.querySelectorAll('section');
  for (const section of sections) {
    const aria = (section.getAttribute('aria-label') || '').toLowerCase();
    if (aria.includes(sectionName.toLowerCase())) {
      return section;
    }
  }

  /* Strategy 3: Find a heading containing the section name, then return its parent section */
  if (nav.findElementByText) {
    const heading = nav.findElementByText('h2', sectionName) ||
                    nav.findElementByText('h3', sectionName) ||
                    nav.findElementByText('span', sectionName);
    if (heading) {
      return heading.closest('section') || heading.parentElement;
    }
  }

  /* Strategy 4: Direct querySelectorAll fallback */
  const headings = document.querySelectorAll('h2, h3');
  for (const h of headings) {
    if ((h.textContent || '').trim().toLowerCase().includes(sectionName.toLowerCase())) {
      return h.closest('section') || h.parentElement;
    }
  }

  return null;
}

/* ===================================================================
   MAIN EXTRACTION ORCHESTRATOR
   =================================================================== */

/**
 * Extract all profile data from the current LinkedIn profile page.
 * Waits for the page to load, scrolls to trigger lazy sections, then extracts.
 *
 * @param {Object} userConfig - User configuration for context-dependent extraction.
 * @param {string} [userConfig.userSchool=''] - School name for alumni matching.
 * @returns {Promise<Object>} Complete ProfileData object.
 */
async function extractProfileData(userConfig = {}) {
  const config = {
    userSchool: userConfig.userSchool || ''
  };

  /* --- Pre-flight checks --- */

  if (isRateLimited()) {
    return {
      type: 'EXTRACTION_FAILED',
      reason: 'rate_limited'
    };
  }

  if (!isProfilePage()) {
    return {
      type: 'EXTRACTION_FAILED',
      reason: 'not_a_profile_page'
    };
  }

  /* --- Wait for page to load (h1 is the key indicator) --- */

  if (nav.waitForElement) {
    const h1 = await nav.waitForElement('h1', PAGE_LOAD_TIMEOUT_MS);
    if (!h1) {
      return {
        type: 'EXTRACTION_FAILED',
        reason: 'not_a_profile_page'
      };
    }
  }

  /* --- Extract above-the-fold data --- */

  const nameResult = extractName();
  const headlineResult = extractHeadline();
  const locationResult = extractLocation();
  const connectionCountResult = extractConnectionCount();
  const connectionDegreeResult = extractConnectionDegree();
  const mutualResult = extractMutualConnections();
  const urlResult = extractProfileUrl();

  /* --- Scroll down to trigger lazy-loaded sections --- */

  if (nav.scrollToLoadSections) {
    await nav.scrollToLoadSections();
  }

  /* --- Extract below-the-fold data --- */

  const companyResult = extractCompany();
  const educationResult = extractEducation(config.userSchool);
  const activityResult = extractActivityAndHiring();

  /* --- Assemble ProfileData object --- */

  const connData = connectionCountResult.value || { count: null, is500Plus: false };
  const eduData = educationResult.value || { isAlumni: false, schoolMatch: null };

  return {
    name: nameResult.value || 'Unknown',
    headline: headlineResult.value || '',
    currentCompany: companyResult.value || null,
    location: locationResult.value || null,
    connectionCount: connData.count,
    is500Plus: connData.is500Plus,
    connectionDegree: connectionDegreeResult.value,
    mutualConnections: mutualResult.value || 0,
    education: eduData,
    activity: activityResult.activity,
    hiringSignals: activityResult.hiringSignals,
    profileUrl: urlResult.value,
    extractedAt: new Date().toISOString(),
    confidence: {
      name: nameResult.confidence,
      headline: headlineResult.confidence,
      company: companyResult.confidence,
      location: locationResult.confidence,
      education: educationResult.confidence,
      activity: activityResult.confidence
    }
  };
}

/* ===================================================================
   MESSAGE LISTENER
   =================================================================== */

/**
 * Listen for extraction requests from the service worker.
 */
chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message.type === 'EXTRACT_PROFILE') {
    extractProfileData(message.config)
      .then((data) => {
        sendResponse(data);
      })
      .catch((error) => {
        sendResponse({
          type: 'EXTRACTION_FAILED',
          reason: 'extraction_error',
          error: error.message || String(error)
        });
      });
    return true; /* Keep message channel open for async response */
  }
  return false;
});
