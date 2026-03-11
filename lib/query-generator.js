'use strict';

// linkscout/lib/query-generator.js — Smart LinkedIn search query builder.

/**
 * @fileoverview Generates 6–9 strategically varied LinkedIn People search URLs
 * from user preferences. Pure functions — no DOM or Chrome API dependencies.
 */

import {
  MAX_QUERIES,
  MAX_KEYWORDS_WORDS,
  LINKEDIN_SEARCH_BASE,
  LINKEDIN_SEARCH_ORIGIN,
  STRATEGY_DIRECT_ROLE,
  STRATEGY_SENIORITY_VERTICAL,
  STRATEGY_ALUMNI,
  STRATEGY_HIRING_SIGNAL,
  STRATEGY_ADJACENT,
  STRATEGY_RECRUITER,
  STRATEGY_PRIORITY,
  ADJACENT_ROLES_MAP,
  HIRING_KEYWORDS,
  ALUMNI_INDUSTRY_TERM
} from './constants.js';

/* ===================================================================
   HELPERS
   =================================================================== */

/**
 * Truncate a keyword string to MAX_KEYWORDS_WORDS words.
 * @param {string} keywords - Raw keyword string (may exceed word limit).
 * @returns {string} Trimmed keyword string with at most MAX_KEYWORDS_WORDS words.
 */
function truncateKeywords(keywords) {
  const words = keywords.split(/\s+/).filter(Boolean);
  return words.slice(0, MAX_KEYWORDS_WORDS).join(' ');
}

/**
 * Build a LinkedIn People Search URL from a keyword string.
 * @param {string} keywords - The search keywords (will be URI-encoded).
 * @returns {string} Full LinkedIn search URL.
 */
function buildSearchUrl(keywords) {
  const trimmed = truncateKeywords(keywords);
  const encoded = encodeURIComponent(trimmed);
  return `${LINKEDIN_SEARCH_BASE}?keywords=${encoded}&origin=${LINKEDIN_SEARCH_ORIGIN}`;
}

/**
 * Shorten a location string to its first meaningful token for keyword economy.
 * "Greater Toronto Area" → "Toronto", "New York City" → "New York City" (kept).
 * @param {string} location - Full location string.
 * @returns {string} Shortened location keyword.
 */
function shortenLocation(location) {
  if (!location) {
    return '';
  }
  const lower = location.toLowerCase();
  if (lower.startsWith('greater ')) {
    /* "Greater Toronto Area" → "Toronto" */
    const rest = location.substring('greater '.length);
    const parts = rest.split(/\s+/);
    return parts[0] || location;
  }
  return location;
}

/**
 * Extract the short role "family" name from a full role title.
 * "Capital Markets Analyst" → "Capital Markets".
 * @param {string} role - Full role title.
 * @returns {string} Shortened role family keyword.
 */
function extractRoleFamily(role) {
  const genericSuffixes = ['analyst', 'associate', 'manager', 'director', 'specialist', 'advisor'];
  const words = role.split(/\s+/);
  const filtered = words.filter((w) => !genericSuffixes.includes(w.toLowerCase()));
  return filtered.length > 0 ? filtered.join(' ') : role;
}

/**
 * Pick a random element from an array.
 * @param {Array<*>} arr - Source array.
 * @returns {*} A random element, or undefined if array is empty.
 */
function pickRandom(arr) {
  if (!arr || arr.length === 0) {
    return undefined;
  }
  return arr[Math.floor(Math.random() * arr.length)];
}

/**
 * Create a query result object.
 * @param {string} keywords - Raw keyword string (will be truncated and URL-encoded).
 * @param {string} label - Human-readable label for this query.
 * @param {string} strategy - Strategy category name.
 * @returns {{url: string, label: string, strategy: string}}
 */
function makeQuery(keywords, label, strategy) {
  return {
    url: buildSearchUrl(keywords),
    label: label,
    strategy: strategy
  };
}

/* ===================================================================
   CATEGORY GENERATORS
   =================================================================== */

/**
 * Category 1: Direct Role + Top Company queries.
 * Pairs the first 2–3 target roles with top companies and a seniority term.
 * @param {Object} config - User configuration object.
 * @returns {Array<{url: string, label: string, strategy: string}>}
 */
function generateDirectRoleQueries(config) {
  const queries = [];
  const roles = config.targetRoles.slice(0, 3);
  const companies = config.targetCompanies.slice(0, 2);
  const seniority = config.targetSeniority[0] || '';
  const location = shortenLocation(config.targetLocation);

  /* Phase 1 (highest precision): explicit company + role pairings. */
  for (const role of roles) {
    const roleFamily = extractRoleFamily(role);
    const company = companies[queries.length % Math.max(companies.length, 1)] || '';
    if (!company) {
      continue;
    }
    const coreKeywords = [company, roleFamily].filter(Boolean).join(' ');
    const coreLabel = `${company} + ${roleFamily}`;
    queries.push(makeQuery(coreKeywords, coreLabel, STRATEGY_DIRECT_ROLE));
  }

  /* Phase 2: broaden from core pairings with seniority/location context. */
  for (const role of roles) {
    const roleFamily = extractRoleFamily(role);
    const company = companies[queries.length % Math.max(companies.length, 1)] || '';
    /* Build keyword: "Capital Markets Manager RBC Toronto" */
    const parts = [roleFamily, seniority, company, location].filter(Boolean);
    const keywords = parts.join(' ');
    const label = `${roleFamily} at ${company || 'top companies'}`;
    queries.push(makeQuery(keywords, label, STRATEGY_DIRECT_ROLE));
  }

  return queries.slice(0, 3);
}

/**
 * Category 2: Seniority + Industry Vertical queries.
 * Broader searches without company names.
 * @param {Object} config - User configuration object.
 * @returns {Array<{url: string, label: string, strategy: string}>}
 */
function generateSeniorityVerticalQueries(config) {
  const queries = [];
  const location = shortenLocation(config.targetLocation);
  const topSeniority = config.targetSeniority[0] || 'Manager';

  /* Deduplicate role families */
  const families = [];
  for (const role of config.targetRoles) {
    const family = extractRoleFamily(role);
    if (!families.includes(family)) {
      families.push(family);
    }
  }

  for (const family of families.slice(0, 2)) {
    const parts = [topSeniority, family, location].filter(Boolean);
    const keywords = parts.join(' ');
    const label = `${topSeniority}s in ${family}`;
    queries.push(makeQuery(keywords, label, STRATEGY_SENIORITY_VERTICAL));
  }

  return queries;
}

/**
 * Category 3: Alumni Network query.
 * Searches for school alumni at target companies.
 * @param {Object} config - User configuration object.
 * @returns {Array<{url: string, label: string, strategy: string}>}
 */
function generateAlumniQuery(config) {
  if (!config.userSchool) {
    return [];
  }

  const topCompanies = config.targetCompanies.slice(0, 3);
  /* "University of Waterloo RBC TD finance" — aim for ≤6 words */
  const parts = [config.userSchool, ...topCompanies, ALUMNI_INDUSTRY_TERM];
  const keywords = parts.join(' ');
  const label = `${config.userSchool.split(' ').pop()} alumni at target companies`;

  return [makeQuery(keywords, label, STRATEGY_ALUMNI)];
}

/**
 * Category 4: Hiring Signal query.
 * Finds people posting about hiring in the user's target area.
 * @param {Object} config - User configuration object.
 * @returns {Array<{url: string, label: string, strategy: string}>}
 */
function generateHiringSignalQuery(config) {
  const location = shortenLocation(config.targetLocation);
  const roleFamily = extractRoleFamily(config.targetRoles[0] || 'finance');
  const hiringKeyword = pickRandom(HIRING_KEYWORDS);

  const parts = [hiringKeyword, roleFamily, location].filter(Boolean);
  const keywords = parts.join(' ');
  const label = 'Active hiring posts';

  return [makeQuery(keywords, label, STRATEGY_HIRING_SIGNAL)];
}

/**
 * Category 5: Adjacent Role Discovery query.
 * Picks a random adjacent role for diversity across sessions.
 * @param {Object} config - User configuration object.
 * @returns {Array<{url: string, label: string, strategy: string}>}
 */
function generateAdjacentQuery(config) {
  const location = shortenLocation(config.targetLocation);

  /* Find the first matching adjacent role family */
  for (const role of config.targetRoles) {
    const roleLower = role.toLowerCase();
    for (const [key, adjacents] of Object.entries(ADJACENT_ROLES_MAP)) {
      if (roleLower.includes(key)) {
        const adjacent = pickRandom(adjacents);
        if (adjacent) {
          const parts = [adjacent, location].filter(Boolean);
          const keywords = parts.join(' ');
          const label = `Adjacent: ${adjacent}`;
          return [makeQuery(keywords, label, STRATEGY_ADJACENT)];
        }
      }
    }
  }

  /* Fallback: generic adjacent search */
  const parts = ['finance professional', location].filter(Boolean);
  return [makeQuery(parts.join(' '), 'Adjacent: Finance Professionals', STRATEGY_ADJACENT)];
}

/**
 * Category 6: Recruiter Discovery query.
 * Finds recruiters specializing in the user's target field.
 * @param {Object} config - User configuration object.
 * @returns {Array<{url: string, label: string, strategy: string}>}
 */
function generateRecruiterQuery(config) {
  const location = shortenLocation(config.targetLocation);
  const roleFamily = extractRoleFamily(config.targetRoles[0] || 'finance');

  const parts = ['recruiter', roleFamily, location].filter(Boolean);
  const keywords = parts.join(' ');
  const label = `Recruiters in ${roleFamily}`;

  return [makeQuery(keywords, label, STRATEGY_RECRUITER)];
}

/* ===================================================================
   REMOTE VARIANT
   =================================================================== */

/**
 * Generate a remote variant of the highest-priority query (no location keyword).
 * @param {Array<{url: string, label: string, strategy: string}>} queries - Existing queries.
 * @param {Object} config - User configuration object.
 * @returns {{url: string, label: string, strategy: string}|null}
 */
function generateRemoteVariant(queries, config) {
  if (!config.includeRemote || queries.length === 0) {
    return null;
  }

  /* Take the first direct_role query and strip the location */
  const directRole = queries.find((q) => q.strategy === STRATEGY_DIRECT_ROLE);
  if (!directRole) {
    return null;
  }

  /* Reconstruct without location */
  const roles = config.targetRoles.slice(0, 1);
  const roleFamily = extractRoleFamily(roles[0] || '');
  const seniority = config.targetSeniority[0] || '';
  const company = config.targetCompanies[0] || '';

  const parts = [roleFamily, seniority, company, 'remote'].filter(Boolean);
  const keywords = parts.join(' ');
  const label = `${roleFamily} (Remote)`;

  return makeQuery(keywords, label, STRATEGY_DIRECT_ROLE);
}

/* ===================================================================
   PRIORITIZATION & DEDUP
   =================================================================== */

/**
 * Remove duplicate queries (by URL).
 * @param {Array<{url: string, label: string, strategy: string}>} queries - All generated queries.
 * @returns {Array<{url: string, label: string, strategy: string}>} Deduplicated array.
 */
function deduplicateQueries(queries) {
  const seen = new Set();
  const unique = [];
  for (const q of queries) {
    if (!seen.has(q.url)) {
      seen.add(q.url);
      unique.push(q);
    }
  }
  return unique;
}

/**
 * Cap the query list to MAX_QUERIES using the strategy priority order.
 * Ensures at least one query per category if available, then fills remaining
 * slots from higher-priority categories.
 * @param {Array<{url: string, label: string, strategy: string}>} queries - Deduplicated queries.
 * @returns {Array<{url: string, label: string, strategy: string}>} Capped array.
 */
function prioritizeQueries(queries) {
  if (queries.length <= MAX_QUERIES) {
    return queries;
  }

  const buckets = {};
  for (const strategy of STRATEGY_PRIORITY) {
    buckets[strategy] = [];
  }
  for (const q of queries) {
    if (buckets[q.strategy]) {
      buckets[q.strategy].push(q);
    }
  }

  const result = [];

  /* First pass: one from each category */
  for (const strategy of STRATEGY_PRIORITY) {
    if (buckets[strategy].length > 0 && result.length < MAX_QUERIES) {
      result.push(buckets[strategy].shift());
    }
  }

  /* Second pass: fill remaining from highest-priority categories */
  for (const strategy of STRATEGY_PRIORITY) {
    while (buckets[strategy].length > 0 && result.length < MAX_QUERIES) {
      result.push(buckets[strategy].shift());
    }
  }

  return result;
}

/**
 * Rotate the query order based on a session ID so the starting category varies.
 * @param {Array<{url: string, label: string, strategy: string}>} queries - Final query list.
 * @param {number} [sessionId=0] - Current session number (used as rotation offset).
 * @returns {Array<{url: string, label: string, strategy: string}>} Rotated array.
 */
function rotateBySession(queries, sessionId) {
  if (queries.length <= 1 || !sessionId) {
    return queries;
  }
  const offset = sessionId % queries.length;
  return [...queries.slice(offset), ...queries.slice(0, offset)];
}

/* ===================================================================
   MAIN EXPORT
   =================================================================== */

/**
 * Generate 6–9 strategically varied LinkedIn People search queries
 * based on the user's configured preferences.
 *
 * @param {Object} config - User configuration.
 * @param {string[]} config.targetRoles - Target role titles.
 * @param {string[]} config.targetCompanies - Target company names.
 * @param {string} config.targetLocation - Target geographic area.
 * @param {string[]} config.targetSeniority - Target seniority levels.
 * @param {string} config.userSchool - User's university/school name.
 * @param {boolean} config.includeRemote - Whether to include a remote variant.
 * @param {number} [sessionId=0] - Current session ID for rotation.
 * @returns {Array<{url: string, label: string, strategy: string}>}
 */
export function generateSearchQueries(config, sessionId = 0) {
  /* Guard against empty config */
  const safeConfig = {
    targetRoles: config.targetRoles || [],
    targetCompanies: config.targetCompanies || [],
    targetLocation: config.targetLocation || '',
    targetSeniority: config.targetSeniority || [],
    userSchool: config.userSchool || '',
    includeRemote: config.includeRemote || false
  };

  /* Generate all categories */
  let all = [
    ...generateDirectRoleQueries(safeConfig),
    ...generateSeniorityVerticalQueries(safeConfig),
    ...generateAlumniQuery(safeConfig),
    ...generateHiringSignalQuery(safeConfig),
    ...generateAdjacentQuery(safeConfig),
    ...generateRecruiterQuery(safeConfig)
  ];

  /* Add remote variant if enabled */
  const remoteVariant = generateRemoteVariant(all, safeConfig);
  if (remoteVariant) {
    all.push(remoteVariant);
  }

  /* Deduplicate, prioritize, rotate */
  all = deduplicateQueries(all);
  all = prioritizeQueries(all);
  all = rotateBySession(all, sessionId);

  return all;
}
