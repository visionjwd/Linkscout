'use strict';

// linkscout/lib/constants.js — All named constants: default values, role/company/seniority options, and configuration defaults.

/**
 * @fileoverview Centralized constants for LinkScout configuration defaults and option lists.
 * Pure data — no DOM or Chrome API dependencies.
 */

/** @type {string} Storage key for target roles. */
export const KEY_TARGET_ROLES = 'targetRoles';

/** @type {string} Storage key for target companies. */
export const KEY_TARGET_COMPANIES = 'targetCompanies';

/** @type {string} Storage key for user school. */
export const KEY_USER_SCHOOL = 'userSchool';

/** @type {string} Storage key for target location. */
export const KEY_TARGET_LOCATION = 'targetLocation';

/** @type {string} Storage key for include-remote flag. */
export const KEY_INCLUDE_REMOTE = 'includeRemote';

/** @type {string} Storage key for target seniority levels. */
export const KEY_TARGET_SENIORITY = 'targetSeniority';

/** @type {string} Storage key for max profiles per scan. */
export const KEY_MAX_PROFILES = 'maxProfilesPerScan';

/** @type {string} Storage key for the active view identifier. */
export const KEY_ACTIVE_VIEW = 'activeView';

/** @type {string} Storage key for the debug logging flag. */
export const KEY_DEBUG_MODE = 'debugMode';

/** @type {string} Storage key for scan results array. */
export const KEY_SCAN_RESULTS = 'scanResults';

/** @type {string} Storage key for current scan state object. */
export const KEY_SCAN_STATE = 'scanState';

/** @type {string} Storage key for session history log array. */
export const KEY_SESSION_HISTORY = 'sessionHistory';

/** @type {string} Storage key for daily scan count object { date, count }. */
export const KEY_DAILY_SCAN_COUNT = 'dailyScanCount';

/** @type {number} Daily scan count that triggers a warning in the popup. */
export const DAILY_SCAN_WARNING_THRESHOLD = 100;

/** @type {string} Stop reason: scan completed all queries / hit session limit. */
export const STOP_REASON_COMPLETED = 'completed';

/** @type {string} Stop reason: user clicked Stop. */
export const STOP_REASON_USER_STOPPED = 'user_stopped';

/** @type {string} Stop reason: LinkedIn rate-limited the extension. */
export const STOP_REASON_RATE_LIMITED = 'rate_limited';

/** @type {string} Stop reason: session limit reached. */
export const STOP_REASON_SESSION_LIMIT = 'session_limit';

/** @type {string} Scan status: idle (not scanning). */
export const SCAN_STATUS_IDLE = 'idle';

/** @type {string} Scan status: actively scanning. */
export const SCAN_STATUS_SCANNING = 'scanning';

/** @type {string} Scan status: paused. */
export const SCAN_STATUS_PAUSED = 'paused';

/** @type {number} Maximum number of results to store. Lowest-scoring are dropped. */
export const MAX_STORED_RESULTS = 200;

/** @type {string} Storage key for the set of already-scanned profile URLs. */
export const KEY_SCANNED_URLS = 'scannedUrls';

/** @type {string} Name of the keepalive alarm during scanning. */
export const KEEPALIVE_ALARM_NAME = 'linkscout-keepalive';

/** @type {number} Keepalive alarm period in minutes (must be ≥1 for chrome.alarms). */
export const KEEPALIVE_PERIOD_MINUTES = 0.4;

/** @type {number} Minimum base delay between profile visits in ms. */
export const SCAN_DELAY_MIN_MS = 4000;

/** @type {number} Maximum base delay between profile visits in ms. */
export const SCAN_DELAY_MAX_MS = 7000;

/** @type {number} Minimum extra "break" delay every Nth profile in ms. */
export const SCAN_BREAK_DELAY_MIN_MS = 3000;

/** @type {number} Maximum extra "break" delay every Nth profile in ms. */
export const SCAN_BREAK_DELAY_MAX_MS = 8000;

/** @type {number} How many profiles between extended breaks. */
export const SCAN_BREAK_INTERVAL = 10;

/** @type {number} Timeout for waiting for a tab to load in ms. */
export const TAB_LOAD_TIMEOUT_MS = 15000;

/** @type {number} Extra delay after page load for dynamic content in ms. */
export const PAGE_SETTLE_DELAY_MS = 2500;

/** @type {number} Delay after scrolling search results for lazy loading in ms. */
export const SEARCH_SCROLL_DELAY_MS = 1500;

/** @type {number} Maximum profile URLs to collect from a single search results page. */
export const MAX_PROFILES_PER_SEARCH_PAGE = 10;

/** @type {number} Rate limit backoff delay in ms (60 seconds). */
export const RATE_LIMIT_BACKOFF_MS = 60000;

/** @type {number} Score threshold for the "scored 55+" summary stat. */
export const HIGH_SCORE_THRESHOLD = 55;

/** @type {number} Maximum signal tags shown per result card. */
export const MAX_TAGS_PER_CARD = 3;

/* ===== QUERY GENERATOR CONSTANTS ===== */

/** @type {number} Maximum total search queries per generation. */
export const MAX_QUERIES = 9;

/** @type {number} Maximum words allowed per keyword string (LinkedIn degrades beyond this). */
export const MAX_KEYWORDS_WORDS = 6;

/** @type {string} LinkedIn People search base URL. */
export const LINKEDIN_SEARCH_BASE = 'https://www.linkedin.com/search/results/people/';

/** @type {string} Origin parameter appended to every LinkedIn search URL. */
export const LINKEDIN_SEARCH_ORIGIN = 'GLOBAL_SEARCH_HEADER';

/** @type {string} Strategy name: direct role + top company. */
export const STRATEGY_DIRECT_ROLE = 'direct_role';

/** @type {string} Strategy name: seniority + industry vertical. */
export const STRATEGY_SENIORITY_VERTICAL = 'seniority_vertical';

/** @type {string} Strategy name: alumni network search. */
export const STRATEGY_ALUMNI = 'alumni';

/** @type {string} Strategy name: hiring signal discovery. */
export const STRATEGY_HIRING_SIGNAL = 'hiring_signal';

/** @type {string} Strategy name: adjacent role discovery. */
export const STRATEGY_ADJACENT = 'adjacent';

/** @type {string} Strategy name: recruiter discovery. */
export const STRATEGY_RECRUITER = 'recruiter';

/**
 * Mapping of role families to adjacent role keywords for discovery searches.
 * Each key is a lowercase substring that, if found in a target role, maps to adjacent roles.
 * @type {Object<string, string[]>}
 */
export const ADJACENT_ROLES_MAP = {
  'financial analyst': ['Investment Banking', 'Equity Research', 'FP&A', 'Corporate Finance'],
  'risk': ['Credit Risk', 'Market Risk', 'Compliance', 'Regulatory'],
  'capital markets': ['Sales & Trading', 'Fixed Income', 'Derivatives', 'Structured Products'],
  'wealth management': ['Private Banking', 'Financial Advisory', 'Portfolio Management', 'Client Relations'],
  'investment': ['Asset Management', 'Private Equity', 'Venture Capital', 'Fund Management'],
  'credit': ['Lending', 'Underwriting', 'Credit Risk', 'Loan Origination'],
  'portfolio': ['Asset Allocation', 'Fund Management', 'Investment Strategy', 'Quantitative Analysis'],
  'equity research': ['Sell-Side Research', 'Buy-Side Analysis', 'Sector Coverage', 'Investment Strategy']
};

/** @type {string[]} Hiring-signal keywords to prepend in hiring discovery queries. */
export const HIRING_KEYWORDS = ['hiring', 'join my team', 'open role', 'looking for'];

/** @type {string} Broad industry term used in alumni network queries. */
export const ALUMNI_INDUSTRY_TERM = 'finance';

/**
 * Priority order for query categories when capping at MAX_QUERIES.
 * Lower index = higher priority.
 * @type {string[]}
 */
export const STRATEGY_PRIORITY = [
  STRATEGY_DIRECT_ROLE,
  STRATEGY_HIRING_SIGNAL,
  STRATEGY_ALUMNI,
  STRATEGY_SENIORITY_VERTICAL,
  STRATEGY_RECRUITER,
  STRATEGY_ADJACENT
];

/** @type {string[]} Pre-populated role options for the target roles chip selector. */
export const DEFAULT_ROLE_OPTIONS = [
  'Financial Analyst',
  'Investment Analyst',
  'Risk Analyst',
  'Capital Markets Analyst',
  'Wealth Management',
  'Portfolio Analyst',
  'Credit Analyst',
  'Equity Research'
];

/** @type {string[]} Pre-populated company options for the target companies chip selector. */
export const DEFAULT_COMPANY_OPTIONS = [
  'RBC',
  'TD',
  'CIBC',
  'BMO',
  'Scotiabank',
  'PwC',
  'KPMG',
  'Deloitte',
  'EY',
  'Manulife',
  'Sun Life',
  'Brookfield',
  'CPP Investments',
  'OMERS',
  'OTPP'
];

/** @type {string[]} Pre-populated seniority level options. */
export const DEFAULT_SENIORITY_OPTIONS = [
  'Manager',
  'Senior Manager',
  'Director',
  'Senior Director',
  'VP',
  'Associate',
  'Senior Associate'
];

/** @type {string[]} Seniority levels that are active by default on first install. */
export const DEFAULT_SENIORITY_ACTIVE = [
  'Manager',
  'Senior Manager',
  'Director'
];

/** @type {string} Default school name. */
export const DEFAULT_SCHOOL = 'University of Waterloo';

/** @type {string} Default target location. */
export const DEFAULT_LOCATION = 'Greater Toronto Area';

/** @type {boolean} Default include-remote flag. */
export const DEFAULT_INCLUDE_REMOTE = true;

/** @type {number} Default max profiles per scanning session. */
export const DEFAULT_MAX_PROFILES = 40;

/** @type {number} Minimum allowed profiles per scan. */
export const MIN_PROFILES_PER_SCAN = 10;

/** @type {number} Maximum allowed profiles per scan. */
export const MAX_PROFILES_PER_SCAN = 80;

/** @type {number} Step increment for the profiles-per-scan input. */
export const PROFILES_STEP = 10;

/** @type {number} Duration in ms for the "Saved" toast notification. */
export const TOAST_DURATION_MS = 1500;

/** @type {string} View identifier for the settings panel. */
export const VIEW_SETTINGS = 'settings';

/** @type {string} View identifier for the results dashboard. */
export const VIEW_RESULTS = 'results';

/* ===== SCORING ENGINE CONSTANTS ===== */

/** @type {string} Tier: immediate outreach target. */
export const TIER_REACH_OUT = 'reach_out_today';

/** @type {string} Tier: strong candidate for outreach. */
export const TIER_STRONG = 'strong_candidate';

/** @type {string} Tier: worth keeping an eye on. */
export const TIER_MONITOR = 'worth_monitoring';

/** @type {string} Tier: low priority, archive. */
export const TIER_ARCHIVE = 'archive';

/** @type {number} Minimum score for "reach_out_today" tier. */
export const TIER_REACH_OUT_MIN = 75;

/** @type {number} Minimum score for "strong_candidate" tier. */
export const TIER_STRONG_MIN = 55;

/** @type {number} Minimum score for "worth_monitoring" tier. */
export const TIER_MONITOR_MIN = 35;

/** @type {number} Maximum possible total score. */
export const MAX_TOTAL_SCORE = 100;

/** @type {number} Max points for the role fit dimension. */
export const MAX_ROLE_FIT = 20;

/** @type {number} Max points for the company match dimension. */
export const MAX_COMPANY_MATCH = 15;

/** @type {number} Max points for the activity and hiring dimension. */
export const MAX_ACTIVITY_HIRING = 25;

/** @type {number} Max points for the approachability dimension. */
export const MAX_APPROACHABILITY = 20;

/** @type {number} Max points for the connection leverage dimension. */
export const MAX_CONNECTION_LEVERAGE = 15;

/** @type {number} Max points for the interaction bonus dimension. */
export const MAX_INTERACTION_BONUS = 5;

/** @type {number} Number of days considered "very recent" activity (~1 week). */
export const ACTIVITY_VERY_RECENT_DAYS = 7;

/** @type {number} Number of days considered "recent" activity (~1 month). */
export const ACTIVITY_RECENT_DAYS = 30;

/** @type {number} Number of days considered "somewhat recent" activity (~3 months). */
export const ACTIVITY_SOMEWHAT_RECENT_DAYS = 90;

/**
 * Role keyword map: maps user-facing role names to arrays of lowercase
 * keywords to search for in profile headlines.
 * @type {Object<string, string[]>}
 */
export const ROLE_KEYWORDS = {
  'Financial Analyst': ['financial analyst', 'finance analyst', 'fp&a', 'financial planning'],
  'Capital Markets': ['capital markets', 'sales and trading', 'fixed income', 'equities', 'trading'],
  'Capital Markets Analyst': ['capital markets', 'sales and trading', 'fixed income', 'equities', 'trading'],
  'Investment Analyst': ['investment analyst', 'investment associate', 'investment banking', 'ib analyst'],
  'Risk Analyst': ['risk analyst', 'risk management', 'credit risk', 'market risk', 'operational risk'],
  'Wealth Management': ['wealth management', 'private banking', 'financial advisor', 'portfolio manager', 'wealth advisor'],
  'Credit Analyst': ['credit analyst', 'credit risk', 'lending', 'underwriting'],
  'Equity Research': ['equity research', 'research analyst', 'buy side', 'sell side'],
  'Portfolio Analyst': ['portfolio analyst', 'portfolio manager', 'asset management', 'fund']
};

/**
 * Seniority keyword map: maps seniority level names to lowercase keyword variants.
 * @type {Object<string, string[]>}
 */
export const SENIORITY_KEYWORDS = {
  'Manager': ['manager', 'mgr'],
  'Senior Manager': ['senior manager', 'sr manager', 'sr. manager'],
  'Director': ['director'],
  'Senior Director': ['senior director', 'sr director'],
  'VP': ['vice president', 'vp', 'v.p.'],
  'Associate': ['associate'],
  'Senior Associate': ['senior associate', 'sr associate'],
  'Partner': ['partner'],
  'Managing Director': ['managing director', 'md']
};

/**
 * Ordered seniority levels from lowest to highest for "one level above" detection.
 * @type {string[]}
 */
export const SENIORITY_HIERARCHY = [
  'Associate', 'Senior Associate', 'Manager', 'Senior Manager',
  'Director', 'Senior Director', 'VP', 'Managing Director', 'Partner'
];

/** @type {string[]} Keywords that suggest a too-junior profile (no seniority bonus). */
export const JUNIOR_KEYWORDS = ['intern', 'co-op', 'coop', 'student', 'summer analyst'];

/**
 * Extended list of major financial institutions beyond the user's default company list.
 * Used for secondary company matching.
 * @type {string[]}
 */
export const EXTENDED_COMPANIES = [
  'Goldman Sachs', 'Morgan Stanley', 'JP Morgan', 'JPMorgan', 'Barclays',
  'Credit Suisse', 'UBS', 'Deutsche Bank', 'BNP Paribas', 'HSBC',
  'Scotiabank', 'National Bank', 'Laurentian Bank', 'iA Financial',
  'Great-West', 'Power Corporation', 'Fidelity', 'BlackRock', 'Vanguard',
  'State Street', 'Citadel', 'Two Sigma', 'AQR', 'Man Group',
  'CI Financial', 'AGF', 'IGM Financial', 'Mackenzie', 'GMP', 'Canaccord'
];

/** @type {string[]} Broad financial industry keywords for fallback company matching. */
export const FINANCIAL_INDUSTRY_KEYWORDS = [
  'bank', 'capital', 'securities', 'investment', 'financial',
  'asset management', 'wealth', 'insurance', 'pension', 'fund',
  'advisory', 'trust', 'brokerage', 'trading', 'markets'
];

/** @type {number} Number of top signals to display on a result card. */
export const TOP_SIGNALS_COUNT = 3;
