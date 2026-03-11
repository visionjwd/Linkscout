'use strict';

// linkscout/lib/scoring.js — Scoring engine: pure functions that compute networking value scores.

/**
 * @fileoverview Takes a ProfileData object and user config, returns a numeric
 * score (0–100) with a detailed breakdown. Pure functions only — no DOM,
 * no Chrome APIs, no async. Runs in any context.
 */

import {
  ROLE_KEYWORDS,
  SENIORITY_KEYWORDS,
  SENIORITY_HIERARCHY,
  JUNIOR_KEYWORDS,
  EXTENDED_COMPANIES,
  FINANCIAL_INDUSTRY_KEYWORDS,
  MAX_ROLE_FIT,
  MAX_COMPANY_MATCH,
  MAX_ACTIVITY_HIRING,
  MAX_APPROACHABILITY,
  MAX_CONNECTION_LEVERAGE,
  MAX_INTERACTION_BONUS,
  MAX_TOTAL_SCORE,
  ACTIVITY_VERY_RECENT_DAYS,
  ACTIVITY_RECENT_DAYS,
  ACTIVITY_SOMEWHAT_RECENT_DAYS,
  TIER_REACH_OUT,
  TIER_STRONG,
  TIER_MONITOR,
  TIER_ARCHIVE,
  TIER_REACH_OUT_MIN,
  TIER_STRONG_MIN,
  TIER_MONITOR_MIN,
  TOP_SIGNALS_COUNT
} from './constants.js';

/* ===================================================================
   HELPERS
   =================================================================== */

/**
 * Clamp a value to a maximum.
 * @param {number} val - The raw value.
 * @param {number} max - The cap.
 * @returns {number}
 */
function cap(val, max) {
  return Math.min(Math.max(val, 0), max);
}

/**
 * Check if a text contains any keyword from an array (case-insensitive).
 * @param {string} text - Text to search in.
 * @param {string[]} keywords - Keywords to search for.
 * @returns {string|null} The first matched keyword, or null.
 */
function findKeyword(text, keywords) {
  const lower = text.toLowerCase();
  for (const kw of keywords) {
    if (lower.includes(kw.toLowerCase())) {
      return kw;
    }
  }
  return null;
}

/**
 * Parse a relative date string ("3d", "2w", "1mo") into approximate days.
 * Mirrors the content script's parseRelativeDate but kept here as a pure
 * function for scoring context.
 * @param {string|null} dateStr - Relative date string.
 * @returns {number|null} Approximate days ago, or null if unparseable.
 */
function parseDaysAgo(dateStr) {
  if (!dateStr) {
    return null;
  }
  const cleaned = dateStr.trim().toLowerCase().replace(/\s+/g, '');
  const match = cleaned.match(/^(\d+)\s*(s|m|h|d|w|mo|yr)$/);
  if (!match) {
    return null;
  }
  const num = parseInt(match[1], 10);
  const suffixMap = { 's': 0, 'm': 0, 'h': 0, 'd': 1, 'w': 7, 'mo': 30, 'yr': 365 };
  const multiplier = suffixMap[match[2]];
  return multiplier !== undefined ? num * multiplier : null;
}

/* ===================================================================
   DIMENSION 1: ROLE FIT (max 20)
   =================================================================== */

/**
 * Score how well the profile's headline matches the user's target roles and seniority.
 * @param {Object} profile - ProfileData object.
 * @param {Object} config - User configuration.
 * @returns {{score: number, max: number, reasons: string[]}}
 */
function scoreRoleFit(profile, config) {
  const reasons = [];
  let points = 0;
  const headline = (profile.headline || '').toLowerCase();

  if (!headline) {
    reasons.push('No headline available');
    return { score: 0, max: MAX_ROLE_FIT, reasons };
  }

  /* --- Role keyword matching --- */
  let rolePoints = 0;
  let bestRoleMatch = null;

  for (const role of (config.targetRoles || [])) {
    const keywords = ROLE_KEYWORDS[role] || [role.toLowerCase()];
    const matched = findKeyword(headline, keywords);
    if (matched) {
      if (rolePoints < 14) {
        rolePoints = 15;
        bestRoleMatch = role;
      }
    }
  }

  /* Partial match: check all role keywords across all target roles */
  if (!bestRoleMatch) {
    const allKeywords = [];
    for (const role of (config.targetRoles || [])) {
      const kws = ROLE_KEYWORDS[role] || [role.toLowerCase()];
      allKeywords.push(...kws);
    }
    /* Check for partial overlap: single-word matches from multi-word keywords */
    for (const kw of allKeywords) {
      const kwWords = kw.split(/\s+/);
      for (const word of kwWords) {
        if (word.length >= 4 && headline.includes(word)) {
          if (rolePoints < 8) {
            rolePoints = 10;
            bestRoleMatch = word;
          }
          break;
        }
      }
      if (bestRoleMatch) {
        break;
      }
    }
  }

  /* Fallback: broad financial industry terms */
  if (!bestRoleMatch) {
    const broadTerms = ['finance', 'financial', 'banking', 'investment', 'capital', 'risk', 'wealth', 'portfolio', 'credit', 'equity'];
    const matched = findKeyword(headline, broadTerms);
    if (matched) {
      rolePoints = 4;
      bestRoleMatch = matched;
      reasons.push(`Broad industry match: "${matched}"`);
    }
  }

  if (bestRoleMatch && rolePoints >= 10) {
    reasons.push(`Role match: "${bestRoleMatch}" (${rolePoints >= 14 ? 'exact' : 'partial'})`);
  }

  points += rolePoints;

  /* --- Seniority matching --- */
  let seniorityPoints = 0;

  /* Check for junior indicators first */
  const isJunior = findKeyword(headline, JUNIOR_KEYWORDS);
  if (isJunior) {
    reasons.push(`Junior indicator: "${isJunior}" — no seniority bonus`);
  } else {
    /* Direct seniority match */
    for (const level of (config.targetSeniority || [])) {
      const keywords = SENIORITY_KEYWORDS[level] || [level.toLowerCase()];
      const matched = findKeyword(headline, keywords);
      if (matched) {
        seniorityPoints = 4;
        reasons.push(`Seniority match: "${level}"`);
        break;
      }
    }

    /* One level above check */
    if (seniorityPoints === 0) {
      const targetIndices = (config.targetSeniority || []).map(
        (s) => SENIORITY_HIERARCHY.indexOf(s)
      ).filter((i) => i !== -1);
      const maxTargetIdx = Math.max(...targetIndices, -1);

      if (maxTargetIdx >= 0 && maxTargetIdx < SENIORITY_HIERARCHY.length - 1) {
        const oneLevelAbove = SENIORITY_HIERARCHY[maxTargetIdx + 1];
        const aboveKeywords = SENIORITY_KEYWORDS[oneLevelAbove] || [oneLevelAbove.toLowerCase()];
        const matched = findKeyword(headline, aboveKeywords);
        if (matched) {
          seniorityPoints = 2;
          reasons.push(`Seniority one level above target: "${oneLevelAbove}"`);
        }
      }
    }
  }

  points += seniorityPoints;

  return { score: cap(points, MAX_ROLE_FIT), max: MAX_ROLE_FIT, reasons };
}

/* ===================================================================
   DIMENSION 2: COMPANY MATCH (max 15)
   =================================================================== */

/**
 * Score how well the profile's current company matches target companies.
 * @param {Object} profile - ProfileData object.
 * @param {Object} config - User configuration.
 * @returns {{score: number, max: number, reasons: string[]}}
 */
function scoreCompanyMatch(profile, config) {
  const reasons = [];
  const company = (profile.currentCompany || '').toLowerCase();

  if (!company) {
    reasons.push('No company data');
    return { score: 0, max: MAX_COMPANY_MATCH, reasons };
  }

  /* Exact match against user's target companies (includes-based) */
  for (const target of (config.targetCompanies || [])) {
    if (company.includes(target.toLowerCase()) || target.toLowerCase().includes(company)) {
      reasons.push(`Target company match: "${target}"`);
      return { score: 15, max: MAX_COMPANY_MATCH, reasons };
    }
  }

  /* Extended major financial institutions */
  for (const ext of EXTENDED_COMPANIES) {
    if (company.includes(ext.toLowerCase()) || ext.toLowerCase().includes(company)) {
      reasons.push(`Major financial institution: "${ext}"`);
      return { score: 8, max: MAX_COMPANY_MATCH, reasons };
    }
  }

  /* Financial industry keyword fallback */
  const matched = findKeyword(company, FINANCIAL_INDUSTRY_KEYWORDS);
  if (matched) {
    reasons.push(`Financial industry keyword: "${matched}"`);
    return { score: 4, max: MAX_COMPANY_MATCH, reasons };
  }

  reasons.push(`Non-target company: "${profile.currentCompany}"`);
  return { score: 0, max: MAX_COMPANY_MATCH, reasons };
}

/* ===================================================================
   DIMENSION 3: ACTIVITY AND HIRING (max 25)
   =================================================================== */

/**
 * Score the profile's recent activity and hiring signals.
 * @param {Object} profile - ProfileData object.
 * @returns {{score: number, max: number, reasons: string[]}}
 */
function scoreActivityAndHiring(profile) {
  const reasons = [];
  let points = 0;

  const activity = profile.activity || {};
  const hiring = profile.hiringSignals || {};

  /* --- Recent activity scoring --- */
  if (activity.hasRecentActivity && activity.mostRecentPost) {
    const daysAgo = parseDaysAgo(activity.mostRecentPost);

    if (daysAgo !== null) {
      if (daysAgo <= ACTIVITY_VERY_RECENT_DAYS) {
        points += 12;
        reasons.push(`Very active: posted ${activity.mostRecentPost} ago`);
      } else if (daysAgo <= ACTIVITY_RECENT_DAYS) {
        points += 8;
        reasons.push(`Recently active: posted ${activity.mostRecentPost} ago`);
      } else if (daysAgo <= ACTIVITY_SOMEWHAT_RECENT_DAYS) {
        points += 4;
        reasons.push(`Somewhat active: posted ${activity.mostRecentPost} ago`);
      } else {
        reasons.push(`Old activity: ${activity.mostRecentPost} ago`);
      }
    } else {
      /* Has activity flag but unparseable date — give moderate credit */
      points += 4;
      reasons.push('Recent activity detected (date unparseable)');
    }
  } else {
    reasons.push('No recent activity detected');
  }

  /* --- Hiring signals scoring --- */
  if (hiring.hasHiringSignals) {
    points += 13;
    const kws = (hiring.matchedKeywords || []).slice(0, 3).join(', ');
    reasons.push(`Hiring signals: ${kws}`);
  } else if (activity.hasRecentActivity) {
    points += 3;
    reasons.push('Active but no hiring signals');
  }

  return { score: cap(points, MAX_ACTIVITY_HIRING), max: MAX_ACTIVITY_HIRING, reasons };
}

/* ===================================================================
   DIMENSION 4: APPROACHABILITY (max 20)
   =================================================================== */

/**
 * Score how approachable the profile is based on connection count,
 * degree, and profile completeness.
 * @param {Object} profile - ProfileData object.
 * @returns {{score: number, max: number, reasons: string[]}}
 */
function scoreApproachability(profile) {
  const reasons = [];
  let points = 0;

  /* --- Connection count analysis --- */
  const connCount = profile.connectionCount;

  if (connCount === null || connCount === undefined) {
    points += 3;
    reasons.push('Connection count unknown (middle estimate)');
  } else if (connCount < 100) {
    points += 2;
    reasons.push(`Low connection count (${connCount}) — barely active`);
  } else if (connCount <= 500) {
    points += 6;
    reasons.push(`Moderate connections (${connCount}) — active, not overwhelmed`);
  } else if (connCount <= 2000) {
    points += 8;
    reasons.push(`Well-networked (${connCount}${profile.is500Plus ? '+' : ''}) — likely accepts requests`);
  } else if (connCount <= 5000) {
    points += 5;
    reasons.push(`Very popular (${connCount}) — may be harder to reach`);
  } else {
    points += 3;
    reasons.push(`Extremely high connections (${connCount}+) — likely flooded`);
  }

  /* Handle 500+ flag when count is exactly 500 */
  if (profile.is500Plus && connCount === 500) {
    /* We only know they have 500+, assume well-networked range */
    points = Math.max(points, 7);
  }

  /* --- Connection degree --- */
  const degree = profile.connectionDegree;

  if (degree === 1) {
    points += 8;
    reasons.push('1st degree — already connected, can message directly');
  } else if (degree === 2) {
    points += 6;
    reasons.push('2nd degree — can send connection request');
  } else if (degree === 3) {
    points += 2;
    reasons.push('3rd degree — harder to connect');
  } else {
    points += 2;
    reasons.push('Connection degree unknown (assume distant)');
  }

  /* --- Profile completeness bonus --- */
  const confidence = profile.confidence || {};
  const highFields = ['name', 'company', 'location'].filter(
    (f) => confidence[f] === 'high'
  ).length;

  if (highFields === 3) {
    points += 4;
    reasons.push('Complete profile (name, company, location all high-confidence)');
  } else if (highFields >= 1) {
    points += highFields;
    reasons.push(`Partial profile completeness (${highFields}/3 key fields)`);
  }

  return { score: cap(points, MAX_APPROACHABILITY), max: MAX_APPROACHABILITY, reasons };
}

/* ===================================================================
   DIMENSION 5: CONNECTION LEVERAGE (max 15)
   =================================================================== */

/**
 * Score alumni match and mutual connections.
 * @param {Object} profile - ProfileData object.
 * @returns {{score: number, max: number, reasons: string[]}}
 */
function scoreConnectionLeverage(profile) {
  const reasons = [];
  let points = 0;

  /* --- Alumni match --- */
  const edu = profile.education || {};
  if (edu.isAlumni) {
    points += 8;
    reasons.push(`Alumni match: ${edu.schoolMatch || 'confirmed'}`);
  }

  /* --- Mutual connections --- */
  const mutual = profile.mutualConnections || 0;

  if (mutual >= 5) {
    points += 7;
    reasons.push(`${mutual} mutual connections — strong shared network`);
  } else if (mutual >= 3) {
    points += 5;
    reasons.push(`${mutual} mutual connections`);
  } else if (mutual >= 1) {
    points += 3;
    reasons.push(`${mutual} mutual connection(s)`);
  }

  return { score: cap(points, MAX_CONNECTION_LEVERAGE), max: MAX_CONNECTION_LEVERAGE, reasons };
}

/* ===================================================================
   DIMENSION 6: INTERACTION BONUS (max 5)
   =================================================================== */

/**
 * Score synergy bonuses between dimensions.
 * @param {number} activityScore - Score from dimension 3.
 * @param {number} approachabilityScore - Score from dimension 4.
 * @param {number} leverageScore - Score from dimension 5.
 * @param {number} roleFitScore - Score from dimension 1.
 * @returns {{score: number, max: number, reasons: string[]}}
 */
function scoreInteractionBonus(activityScore, approachabilityScore, leverageScore, roleFitScore) {
  const reasons = [];
  let points = 0;

  if (activityScore >= 15 && approachabilityScore >= 12) {
    points += 3;
    reasons.push('Synergy: active AND approachable — excellent target');
  }

  if (leverageScore >= 8 && roleFitScore >= 12) {
    points += 2;
    reasons.push('Synergy: warm path AND relevant role — high conversion');
  }

  return { score: cap(points, MAX_INTERACTION_BONUS), max: MAX_INTERACTION_BONUS, reasons };
}

/* ===================================================================
   TIER ASSIGNMENT
   =================================================================== */

/**
 * Assign a tier label based on total score.
 * @param {number} totalScore - The computed total score (0–100).
 * @returns {string} Tier identifier.
 */
function assignTier(totalScore) {
  if (totalScore >= TIER_REACH_OUT_MIN) {
    return TIER_REACH_OUT;
  }
  if (totalScore >= TIER_STRONG_MIN) {
    return TIER_STRONG;
  }
  if (totalScore >= TIER_MONITOR_MIN) {
    return TIER_MONITOR;
  }
  return TIER_ARCHIVE;
}

/* ===================================================================
   TOP SIGNALS
   =================================================================== */

/**
 * Generate the top N human-readable signals for card display.
 * @param {Object} profile - ProfileData object.
 * @param {Object} breakdown - The full scoring breakdown object.
 * @returns {string[]}
 */
function generateTopSignals(profile, breakdown) {
  const candidates = [];

  /* Priority 1: Hiring */
  const hiring = profile.hiringSignals || {};
  if (hiring.hasHiringSignals) {
    candidates.push({ priority: 0, text: '🔥 Hiring signals detected' });
  }

  /* Priority 2: Activity recency */
  const activity = profile.activity || {};
  if (activity.hasRecentActivity && activity.mostRecentPost) {
    candidates.push({ priority: 1, text: `📢 Active on LinkedIn (posted ${activity.mostRecentPost} ago)` });
  }

  /* Priority 3: Alumni */
  const edu = profile.education || {};
  if (edu.isAlumni) {
    const school = edu.schoolMatch || 'shared school';
    candidates.push({ priority: 2, text: `🎓 ${school} alumni` });
  }

  /* Priority 4: Company match */
  if (breakdown.companyMatch.score >= 8) {
    const company = profile.currentCompany || 'target company';
    candidates.push({ priority: 3, text: `🏢 Works at ${company}` });
  }

  /* Priority 5: Mutual connections */
  const mutual = profile.mutualConnections || 0;
  if (mutual > 0) {
    candidates.push({ priority: 4, text: `🤝 ${mutual} mutual connections` });
  }

  /* Priority 6: Role match */
  if (breakdown.roleFit.score >= 10) {
    const reason = breakdown.roleFit.reasons[0] || 'Relevant role';
    candidates.push({ priority: 5, text: `💼 ${reason}` });
  }

  candidates.sort((a, b) => a.priority - b.priority);
  return candidates.slice(0, TOP_SIGNALS_COUNT).map((c) => c.text);
}

/* ===================================================================
   OVERALL CONFIDENCE
   =================================================================== */

/**
 * Compute overall extraction confidence.
 * @param {Object} profile - ProfileData object.
 * @returns {'high'|'medium'|'low'}
 */
function computeOverallConfidence(profile) {
  const conf = profile.confidence || {};
  const fields = ['name', 'headline', 'company', 'location', 'education', 'activity'];
  const highCount = fields.filter((f) => conf[f] === 'high').length;

  if (highCount >= 4) {
    return 'high';
  }
  if (highCount >= 2) {
    return 'medium';
  }
  return 'low';
}

/* ===================================================================
   MAIN EXPORT
   =================================================================== */

/**
 * Score a LinkedIn profile based on user preferences and extracted data.
 *
 * @param {Object} profileData - Extracted profile data (from extractor.js).
 * @param {Object} config - User configuration object.
 * @param {string[]} [config.targetRoles] - Target role titles.
 * @param {string[]} [config.targetCompanies] - Target company names.
 * @param {string} [config.targetLocation] - Target geographic area.
 * @param {string[]} [config.targetSeniority] - Target seniority levels.
 * @param {string} [config.userSchool] - User's university/school name.
 * @returns {{totalScore: number, tier: string, breakdown: Object, topSignals: string[], overallConfidence: string}}
 */
export function scoreProfile(profileData, config) {
  const profile = profileData || {};
  const safeConfig = {
    targetRoles: config?.targetRoles || [],
    targetCompanies: config?.targetCompanies || [],
    targetLocation: config?.targetLocation || '',
    targetSeniority: config?.targetSeniority || [],
    userSchool: config?.userSchool || ''
  };

  /* Score each dimension */
  const roleFit = scoreRoleFit(profile, safeConfig);
  const companyMatch = scoreCompanyMatch(profile, safeConfig);
  const activityAndHiring = scoreActivityAndHiring(profile);
  const approachability = scoreApproachability(profile);
  const connectionLeverage = scoreConnectionLeverage(profile);
  const interactionBonus = scoreInteractionBonus(
    activityAndHiring.score,
    approachability.score,
    connectionLeverage.score,
    roleFit.score
  );

  /* Compute total */
  const totalScore = cap(
    roleFit.score +
    companyMatch.score +
    activityAndHiring.score +
    approachability.score +
    connectionLeverage.score +
    interactionBonus.score,
    MAX_TOTAL_SCORE
  );

  const breakdown = {
    roleFit,
    companyMatch,
    activityAndHiring,
    approachability,
    connectionLeverage,
    interactionBonus
  };

  return {
    totalScore,
    tier: assignTier(totalScore),
    breakdown,
    topSignals: generateTopSignals(profile, breakdown),
    overallConfidence: computeOverallConfidence(profile)
  };
}
