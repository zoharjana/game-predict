import React, { useMemo, useState } from "react";
import "./styles.css";

const FD_API_BASE = "https://api.football-data.org/v4";
const ODDS_API_BASE = "https://api.the-odds-api.com/v4";
const FIFA_RANKING_API = "https://api.fifa.com/api/v3/fifarankings/rankings/live?gender=1&sportType=0&language=en";

let fifaRankingCachePromise = null;
let fifaRankingCache = null;

const initialFields = {
  fdApiKey: "3a68eb2a8bb944b18e82a7bd940a3bbb",
  nationQuery: "France",
  oddsApiKey: "",
  teamA: "Falcons FC",
  teamB: "Storm United",
  formA: 11,
  formB: 8,
  goalsA: 2.0,
  goalsB: 1.5,
  injuriesA: 1,
  injuriesB: 3
};

const FORM_ICON_COUNT = 10;

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function toProbability(advantage) {
  return 1 / (1 + Math.exp(-advantage));
}

function toDecimalOdds(probability) {
  const safeProb = clamp(probability, 0.01, 0.99);
  return (1 / safeProb).toFixed(2);
}

function asNumber(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function normalizeTeamName(name) {
  return (name || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function sanitizeNationalQuery(query) {
  let cleaned = (query || "").trim().replace(/\s+/g, " ");
  cleaned =
    cleaned
      .split(/\bvs\b|\bv\b|\//i)
      .map((part) => part.trim())
      .filter(Boolean)[0] || cleaned;
  cleaned = cleaned.replace(/national\s+team/gi, "").replace(/\bteam\b/gi, "").trim();
  return cleaned;
}

function normalizeFetchError(error) {
  const message = String((error && error.message) || "");

  if (error && error.name === "AbortError") {
    return new Error("Request timed out. Please check your network and try again.");
  }

  if (message.includes("Request failed (429)") || message.includes("1015")) {
    return new Error("Rate limited by the data provider. Please wait 1-2 minutes and retry.");
  }

  if (error instanceof TypeError || message.toLowerCase().includes("failed to fetch")) {
    return new Error("Network/CORS issue while contacting the provider. Try running from a local server and retry.");
  }

  return error instanceof Error ? error : new Error("Unknown network error.");
}

async function fetchJsonViaProxies(fullUrl) {
  const proxies = [
    `https://api.allorigins.win/raw?url=${encodeURIComponent(fullUrl)}`,
    `https://corsproxy.io/?${encodeURIComponent(fullUrl)}`
  ];

  const errors = [];
  for (const proxyUrl of proxies) {
    try {
      return await fetchJson(proxyUrl);
    } catch (error) {
      errors.push(error);
    }
  }

  throw errors[errors.length - 1] || new Error("Proxy fallback failed.");
}

async function fetchJson(url) {
  const timeoutMs = 12000;
  const retries = 1;
  let lastError = null;

  for (let attempt = 0; attempt <= retries; attempt += 1) {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const response = await fetch(url, {
        signal: controller.signal,
        cache: "no-store"
      });

      if (!response.ok) {
        throw new Error(`Request failed (${response.status})`);
      }

      const raw = await response.text();
      try {
        return JSON.parse(raw);
      } catch (_error) {
        throw new Error("Unexpected response format from data provider.");
      }
    } catch (error) {
      lastError = error;
      if (attempt < retries) {
        await new Promise((resolve) => setTimeout(resolve, 300 * (attempt + 1)));
      }
    } finally {
      clearTimeout(timeoutId);
    }
  }

  throw normalizeFetchError(lastError);
}

async function fetchFD(path, apiKey) {
  const url = `${FD_API_BASE}${path}`;
  const timeoutMs = 12000;
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(url, {
      signal: controller.signal,
      cache: "no-store",
      headers: { "X-Auth-Token": apiKey }
    });

    if (!response.ok) {
      throw new Error(`Request failed (${response.status})`);
    }

    const raw = await response.text();
    try {
      return JSON.parse(raw);
    } catch (_error) {
      throw new Error("Unexpected response format from football-data.org.");
    }
  } catch (error) {
    throw normalizeFetchError(error);
  } finally {
    clearTimeout(timeoutId);
  }
}

function formatDateLabel(value) {
  if (!value) {
    return "--.--.--";
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }

  const day = String(date.getDate()).padStart(2, "0");
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const year = String(date.getFullYear()).slice(-2);
  return `${day}.${month}.${year}`;
}

function normalizeFifaTeamName(name) {
  return normalizeTeamName(name)
    .replace(/\bnational\b/g, "")
    .replace(/\bteam\b/g, "")
    .replace(/\bfc\b/g, "")
    .replace(/\bmen's\b/g, "")
    .replace(/\bmen\b/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function buildFifaNameVariants(name) {
  const normalized = normalizeFifaTeamName(name);
  const variants = new Set([normalized]);

  const aliases = {
    usa: ["united states", "united states of america"],
    uae: ["united arab emirates"],
    "south korea": ["korea republic"],
    "north korea": ["dpr korea"],
    "ivory coast": ["cote d ivoire", "cote divoire"],
    "czech republic": ["czechia"],
    "dr congo": ["congo democratic republic", "democratic republic of congo"],
    russia: ["russian federation"],
    turkey: ["turkiye"],
    iran: ["iran islamic republic of"]
  };

  Object.entries(aliases).forEach(([key, values]) => {
    if (normalized === key || normalized.includes(key) || key.includes(normalized)) {
      values.forEach((value) => variants.add(value));
    }
  });

  if (normalized.includes("united states")) {
    variants.add("usa");
  }
  if (normalized.includes("korea republic")) {
    variants.add("south korea");
  }
  if (normalized.includes("cote d ivoire") || normalized.includes("cote divoire")) {
    variants.add("ivory coast");
  }

  return Array.from(variants).filter(Boolean);
}

function formatFifaRank(rankEntry) {
  if (!rankEntry || !Number.isFinite(rankEntry.rank)) {
    return null;
  }

  const points = Number.isFinite(rankEntry.points) ? `, ${rankEntry.points.toFixed(2)} pts` : "";
  return `FIFA #${rankEntry.rank}${points}`;
}

function formatTeamWithRank(name, rankEntry) {
  const rankLabel = formatFifaRank(rankEntry);
  if (!rankLabel) {
    return name;
  }

  return `${name} (${rankLabel})`;
}

function fifaRankStrength(rank) {
  const safeRank = clamp(asNumber(rank, 0), 1, 300);
  return 1 / Math.sqrt(safeRank);
}

function buildFifaRankLookup(results) {
  const lookup = new Map();

  (results || []).forEach((entry) => {
    const rank = asNumber(entry.Rank, null);
    if (rank === null) {
      return;
    }

    const teamName = normalizeFifaTeamName(entry.TeamName || "");
    if (!teamName) {
      return;
    }

    const rankEntry = {
      rank,
      points: asNumber(entry.TotalPoints, null),
      movement: asNumber(entry.RankingMovement, 0),
      teamName: entry.TeamName || "",
      confederation: entry.ConfederationName || ""
    };

    lookup.set(teamName, rankEntry);

    buildFifaNameVariants(entry.TeamName || "").forEach((variant) => {
      if (!lookup.has(variant)) {
        lookup.set(variant, rankEntry);
      }
    });
  });

  return lookup;
}

function findFifaRankForTeam(teamName, lookup) {
  if (!teamName || !(lookup instanceof Map)) {
    return null;
  }

  const variants = buildFifaNameVariants(teamName);
  for (const variant of variants) {
    if (lookup.has(variant)) {
      return lookup.get(variant);
    }
  }

  const normalized = normalizeFifaTeamName(teamName);
  for (const [key, value] of lookup.entries()) {
    if (key.includes(normalized) || normalized.includes(key)) {
      return value;
    }
  }

  return null;
}

async function fetchFifaRankLookup() {
  if (fifaRankingCache) {
    return fifaRankingCache;
  }

  if (!fifaRankingCachePromise) {
    fifaRankingCachePromise = (async () => {
      const payload = await fetchJsonViaProxies(FIFA_RANKING_API);
      const lookup = buildFifaRankLookup(payload.Results || payload.results || []);
      fifaRankingCache = lookup;
      return lookup;
    })().catch((error) => {
      fifaRankingCachePromise = null;
      throw error;
    });
  }

  return fifaRankingCachePromise;
}

function getOutcomeFromPerspective(goalsFor, goalsAgainst) {
  if (goalsFor > goalsAgainst) {
    return "W";
  }
  if (goalsFor < goalsAgainst) {
    return "L";
  }
  return "D";
}

function parseEventDate(event) {
  const raw = event.dateEvent || event.strTimestamp;
  const date = new Date(raw || "");
  if (Number.isNaN(date.getTime())) {
    return 0;
  }
  return date.getTime();
}

function normalizeMatchEvent(event, teamId) {
  const home = event.strHomeTeam || "Home";
  const away = event.strAwayTeam || "Away";
  const homeScore = asNumber(event.intHomeScore, null);
  const awayScore = asNumber(event.intAwayScore, null);

  if (homeScore === null || awayScore === null) {
    return null;
  }

  const isHome = String(event.idHomeTeam) === String(teamId);
  const goalsFor = isHome ? homeScore : awayScore;
  const goalsAgainst = isHome ? awayScore : homeScore;

  return {
    idEvent: event.idEvent,
    sortTs: parseEventDate(event),
    dateLabel: formatDateLabel(event.dateEvent || event.strTimestamp),
    fixtureLabel: `${home} vs ${away}`,
    scoreLabel: `${homeScore} - ${awayScore}`,
    leagueName: event.strLeague || event.strLeagueAlternate || "",
    goalsFor,
    goalsAgainst,
    outcome: getOutcomeFromPerspective(goalsFor, goalsAgainst),
    homeTeam: home,
    awayTeam: away,
    homeTeamId: String(event.idHomeTeam || ""),
    awayTeamId: String(event.idAwayTeam || "")
  };
}

function isOfficialCompetitionEvent(event) {
  const league = normalizeTeamName(event.strLeague || event.leagueName || "");
  const eventName = normalizeTeamName(event.strEvent || event.strEventAlternate || event.fixtureLabel || "");
  const combined = `${league} ${eventName}`;
  return !combined.includes("friendly");
}

function matchesTeam(event, teamId, teamNameNorm) {
  const homeId = String(event.idHomeTeam || "");
  const awayId = String(event.idAwayTeam || "");
  if (String(teamId) && (homeId === String(teamId) || awayId === String(teamId))) {
    return true;
  }

  const homeName = normalizeTeamName(event.strHomeTeam || "");
  const awayName = normalizeTeamName(event.strAwayTeam || "");
  return homeName === teamNameNorm || awayName === teamNameNorm;
}

function extractLeagueIds(team) {
  const ids = [];
  for (let i = 1; i <= 7; i += 1) {
    const key = i === 1 ? "idLeague" : `idLeague${i}`;
    if (team[key]) {
      ids.push(String(team[key]));
    }
  }
  return Array.from(new Set(ids));
}

function buildSeasonCandidates(baseYear, depth = 5) {
  const seasons = [];
  for (let offset = 0; offset <= depth; offset += 1) {
    const year = baseYear - offset;
    seasons.push(String(year));
    seasons.push(`${year - 1}-${year}`);
    seasons.push(`${year}-${year + 1}`);
  }
  return Array.from(new Set(seasons));
}

function expectedGoalsToScore(goals) {
  if (goals < 0.75) {
    return 0;
  }
  if (goals < 1.35) {
    return 1;
  }
  if (goals < 2.05) {
    return 2;
  }
  if (goals < 2.75) {
    return 3;
  }
  return 4;
}

function buildInsights(values, metrics, ranks) {
  const insights = [];

  if (values.formA > values.formB + 2) {
    insights.push(`${values.teamA} carries stronger recent form.`);
  } else if (values.formB > values.formA + 2) {
    insights.push(`${values.teamB} has the momentum in recent matches.`);
  } else {
    insights.push("Recent form is close, which increases draw pressure.");
  }

  if (values.goalsA > values.goalsB + 0.4) {
    insights.push(`${values.teamA} shows higher attacking output.`);
  } else if (values.goalsB > values.goalsA + 0.4) {
    insights.push(`${values.teamB} is creating more scoring volume.`);
  }

  if (ranks.home && ranks.away) {
    if (ranks.home.rank < ranks.away.rank) {
      insights.push(`${values.teamA} has the better FIFA ranking.`);
    } else if (ranks.away.rank < ranks.home.rank) {
      insights.push(`${values.teamB} has the better FIFA ranking.`);
    } else {
      insights.push("Both teams are level on FIFA ranking.");
    }
  }

  if (values.injuriesA !== values.injuriesB) {
    const side = values.injuriesA > values.injuriesB ? values.teamA : values.teamB;
    insights.push(`${side} is carrying a heavier injury burden.`);
  }

  if (metrics.confidenceScore > 0.7) {
    insights.push("Model confidence is high due to clear metric separation.");
  } else if (metrics.confidenceScore < 0.45) {
    insights.push("Prediction volatility is elevated; upset risk is meaningful.");
  }

  return insights;
}

function badgeClass(outcome) {
  if (outcome === "W") {
    return "result-badge result-win";
  }
  if (outcome === "L") {
    return "result-badge result-loss";
  }
  return "result-badge result-draw";
}

function createEmptyFormEntries(size = FORM_ICON_COUNT) {
  return Array.from({ length: size }, (_value, index) => ({
    key: `empty-${index}`,
    result: "-",
    tooltip: "No official match data available"
  }));
}

function buildFormEntries(rows, size = FORM_ICON_COUNT) {
  const entries = (rows || []).slice(0, size).map((row, index) => ({
    key: String(row.idEvent || `${row.dateLabel}-${row.fixtureLabel}-${index}`),
    result: row.outcome,
    tooltip: `${row.dateLabel} | ${row.fixtureLabel} | ${row.scoreLabel} | ${row.outcome}`
  }));

  while (entries.length < size) {
    entries.push({
      key: `empty-${entries.length}`,
      result: "-",
      tooltip: "No official match data available"
    });
  }

  return entries;
}

function formPointsFromEntries(entries) {
  return (entries || []).reduce((total, entry) => {
    if (entry.result === "W") {
      return total + 3;
    }
    if (entry.result === "D") {
      return total + 1;
    }
    return total;
  }, 0);
}

function calculateStatsFromRows(rows, sampleSize = FORM_ICON_COUNT) {
  const sample = (rows || []).slice(0, sampleSize);
  if (sample.length === 0) {
    return { formPoints: 14, avgGoals: 1.2 };
  }

  const formEntries = buildFormEntries(sample, sampleSize);
  const formPoints = formPointsFromEntries(formEntries);
  const goalsTotal = sample.reduce((total, row) => total + asNumber(row.goalsFor, 0), 0);

  return {
    formPoints: clamp(formPoints, 0, 30),
    avgGoals: clamp(goalsTotal / sample.length, 0, 6)
  };
}

function formIconClass(result) {
  if (result === "W") {
    return "form-icon form-win";
  }
  if (result === "L") {
    return "form-icon form-loss";
  }
  if (result === "D") {
    return "form-icon form-draw";
  }
  return "form-icon form-empty";
}

function isLikelyNationalTeam(team, queryLower) {
  const teamName = normalizeTeamName(team.strTeam || "");
  const league = normalizeTeamName(team.strLeague || "");
  const alternate = normalizeTeamName(team.strAlternate || "");
  const keywords = normalizeTeamName(team.strKeywords || "");

  const isIntlCompetition =
    league.includes("world cup") ||
    league.includes("international") ||
    league.includes("nations league") ||
    league.includes("qualifying") ||
    league.includes("friendly") ||
    league.includes("euro") ||
    league.includes("copa") ||
    league.includes("africa cup") ||
    league.includes("asian cup") ||
    league.includes("gold cup");

  return (
    teamName === queryLower ||
    isIntlCompetition ||
    alternate.includes("national") ||
    league.includes("national") ||
    keywords.includes("national") ||
    teamName.includes(queryLower)
  );
}

function normalizeFDMatch(match, teamId) {
  const homeScore = match.score?.fullTime?.home ?? null;
  const awayScore = match.score?.fullTime?.away ?? null;

  if (homeScore === null || awayScore === null) {
    return null;
  }

  const isHome = String(match.homeTeam?.id) === String(teamId);
  const goalsFor = isHome ? homeScore : awayScore;
  const goalsAgainst = isHome ? awayScore : homeScore;
  const date = new Date(match.utcDate || "");

  return {
    idEvent: String(match.id),
    sortTs: Number.isNaN(date.getTime()) ? 0 : date.getTime(),
    dateLabel: formatDateLabel(match.utcDate),
    fixtureLabel: `${match.homeTeam?.name || "Home"} vs ${match.awayTeam?.name || "Away"}`,
    scoreLabel: `${homeScore} - ${awayScore}`,
    leagueName: match.competition?.name || "",
    goalsFor,
    goalsAgainst,
    outcome: getOutcomeFromPerspective(goalsFor, goalsAgainst),
    homeTeam: match.homeTeam?.name || "Home",
    awayTeam: match.awayTeam?.name || "Away",
    homeTeamId: String(match.homeTeam?.id || ""),
    awayTeamId: String(match.awayTeam?.id || "")
  };
}

function normalizeFDFixture(match) {
  return {
    idEvent: String(match.id),
    dateEvent: match.utcDate ? match.utcDate.split("T")[0] : "",
    strTimestamp: match.utcDate || "",
    strHomeTeam: match.homeTeam?.name || "TBD",
    strAwayTeam: match.awayTeam?.name || "TBD",
    idHomeTeam: String(match.homeTeam?.id || ""),
    idAwayTeam: String(match.awayTeam?.id || "")
  };
}

// Competitions available on the free tier grouped by priority
const FD_COMPETITION_GROUPS = [
  ["WC", "EC"],                     // national teams
  ["PL", "BL1", "SA", "FL1", "PD"], // top 5 leagues
  ["CL", "ELC", "DED", "PPL"]      // cups + other leagues
];

async function findTeamFD(query, apiKey) {
  const queryNorm = normalizeTeamName(query);

  function matchTeam(t) {
    const name = normalizeTeamName(t.name || "");
    const short = normalizeTeamName(t.shortName || "");
    const tla = (t.tla || "").toLowerCase();
    return (
      name === queryNorm ||
      short === queryNorm ||
      tla === queryNorm ||
      name.includes(queryNorm) ||
      queryNorm.includes(name)
    );
  }

  for (const group of FD_COMPETITION_GROUPS) {
    const results = await Promise.allSettled(
      group.map((comp) => fetchFD(`/competitions/${comp}/teams`, apiKey))
    );

    for (const result of results) {
      if (result.status !== "fulfilled") {
        continue;
      }
      const match = (result.value.teams || []).find(matchTeam);
      if (match) {
        return match;
      }
    }
  }

  // Fallback: infer team from scheduled matches when competition team lists are incomplete.
  const today = new Date();
  const dateFrom = today.toISOString().slice(0, 10);
  const horizon = new Date(today);
  horizon.setDate(horizon.getDate() + 365);
  const dateTo = horizon.toISOString().slice(0, 10);
  const matchesPayload = await fetchFD(
    `/matches?status=SCHEDULED&dateFrom=${dateFrom}&dateTo=${dateTo}`,
    apiKey
  );

  const inferred = (matchesPayload.matches || []).find((m) => {
    const home = normalizeTeamName(m.homeTeam?.name || "");
    const away = normalizeTeamName(m.awayTeam?.name || "");
    return home === queryNorm || away === queryNorm || home.includes(queryNorm) || away.includes(queryNorm);
  });

  if (inferred?.homeTeam && normalizeTeamName(inferred.homeTeam.name || "").includes(queryNorm)) {
    return inferred.homeTeam;
  }
  if (inferred?.awayTeam) {
    return inferred.awayTeam;
  }

  throw new Error(`No team found for "${query}". Try a full team or country name.`);
}

async function fetchTeamMatchesFD(teamId, apiKey) {
  if (!teamId) {
    return [];
  }

  const payload = await fetchFD(
    `/teams/${encodeURIComponent(teamId)}/matches?status=FINISHED&limit=10`,
    apiKey
  );

  return (payload.matches || [])
    .map((match) => normalizeFDMatch(match, teamId))
    .filter(Boolean)
    .sort((a, b) => b.sortTs - a.sortTs)
    .slice(0, 10);
}

function extractHeadToHead(homeRows, awayRows, homeName, awayName, homeId, awayId) {
  const unique = new Map();
  const combined = [...homeRows, ...awayRows];
  const homeNorm = normalizeTeamName(homeName);
  const awayNorm = normalizeTeamName(awayName);

  combined.forEach((row) => {
    const a = normalizeTeamName(row.homeTeam);
    const b = normalizeTeamName(row.awayTeam);
    const homeVsAwayByName =
      (a === homeNorm && b === awayNorm) || (a === awayNorm && b === homeNorm);
    const homeVsAwayById =
      (row.homeTeamId === String(homeId) && row.awayTeamId === String(awayId)) ||
      (row.homeTeamId === String(awayId) && row.awayTeamId === String(homeId));

    if (!homeVsAwayByName && !homeVsAwayById) {
      return;
    }

    if (!unique.has(row.idEvent)) {
      const isHomePerspective = a === homeNorm || row.homeTeamId === String(homeId);
      const [left, right] = row.scoreLabel.split(" - ").map((x) => Number(x));
      const goalsFor = isHomePerspective ? left : right;
      const goalsAgainst = isHomePerspective ? right : left;
      unique.set(row.idEvent, {
        ...row,
        outcome: getOutcomeFromPerspective(goalsFor, goalsAgainst)
      });
    }
  });

  return Array.from(unique.values()).slice(0, 10);
}

function pickBestBookmakerOdds(event) {
  const bookmakerResults = [];

  (event.bookmakers || []).forEach((bookmaker) => {
    const h2h = (bookmaker.markets || []).find((market) => market.key === "h2h");
    if (!h2h) {
      return;
    }

    const homeTeamNorm = normalizeTeamName(event.home_team);
    const awayTeamNorm = normalizeTeamName(event.away_team);

    const home = h2h.outcomes.find((outcome) => normalizeTeamName(outcome.name) === homeTeamNorm);
    const away = h2h.outcomes.find((outcome) => normalizeTeamName(outcome.name) === awayTeamNorm);
    const draw = h2h.outcomes.find((outcome) => normalizeTeamName(outcome.name) === "draw");

    if (!home || !away || !draw) {
      return;
    }

    const homePrice = asNumber(home.price, null);
    const drawPrice = asNumber(draw.price, null);
    const awayPrice = asNumber(away.price, null);

    if (homePrice === null || drawPrice === null || awayPrice === null) {
      return;
    }

    const overround = 1 / homePrice + 1 / drawPrice + 1 / awayPrice;
    bookmakerResults.push({
      title: bookmaker.title,
      home: homePrice.toFixed(2),
      draw: drawPrice.toFixed(2),
      away: awayPrice.toFixed(2),
      overround
    });
  });

  if (bookmakerResults.length === 0) {
    return null;
  }

  bookmakerResults.sort((a, b) => a.overround - b.overround);
  return bookmakerResults[0];
}

function fixtureMatchScore(event, homeTeam, awayTeam) {
  const eHome = normalizeTeamName(event.home_team);
  const eAway = normalizeTeamName(event.away_team);
  const targetHome = normalizeTeamName(homeTeam);
  const targetAway = normalizeTeamName(awayTeam);

  let score = 0;
  if (eHome === targetHome) {
    score += 3;
  } else if (eHome.includes(targetHome) || targetHome.includes(eHome)) {
    score += 1;
  }

  if (eAway === targetAway) {
    score += 3;
  } else if (eAway.includes(targetAway) || targetAway.includes(eAway)) {
    score += 1;
  }

  return score;
}

export default function App() {
  const [fields, setFields] = useState(initialFields);
  const [homeFormEntries, setHomeFormEntries] = useState(createEmptyFormEntries(FORM_ICON_COUNT));
  const [awayFormEntries, setAwayFormEntries] = useState(createEmptyFormEntries(FORM_ICON_COUNT));
  const [loadedFixtures, setLoadedFixtures] = useState([]);
  const [selectedFixture, setSelectedFixture] = useState("0");
  const [apiStatus, setApiStatus] = useState("Data source: football-data.org");
  const [historyStatus, setHistoryStatus] = useState("Load a fixture to view recent form and H2H.");
  const [marketOdds, setMarketOdds] = useState({
    home: "-",
    draw: "-",
    away: "-",
    meta: "Load a fixture and fetch betting odds."
  });
  const [history, setHistory] = useState({ home: [], away: [], h2h: [] });
  const [teamRanks, setTeamRanks] = useState({ home: null, away: null });
  const [activeTeams, setActiveTeams] = useState({
    homeId: null,
    awayId: null,
    homeName: "Home Team",
    awayName: "Away Team"
  });

  const prediction = useMemo(() => {
    const values = {
      teamA: fields.teamA.trim() || "Home Team",
      teamB: fields.teamB.trim() || "Away Team",
      formA: clamp(Number(fields.formA) || 0, 0, 30),
      formB: clamp(Number(fields.formB) || 0, 0, 30),
      goalsA: clamp(Number(fields.goalsA) || 0, 0, 6),
      goalsB: clamp(Number(fields.goalsB) || 0, 0, 6),
      injuriesA: clamp(Number(fields.injuriesA) || 0, 0, 11),
      injuriesB: clamp(Number(fields.injuriesB) || 0, 0, 11)
    };

    const formDelta = (values.formA - values.formB) / 30;
    const goalsDelta = (values.goalsA - values.goalsB) / 3;
    const injuryDelta = (values.injuriesB - values.injuriesA) / 11;
    const homeBoost = 0.12;
    const homeRankStrength = fifaRankStrength(teamRanks.home?.rank);
    const awayRankStrength = fifaRankStrength(teamRanks.away?.rank);
    const rankDelta = homeRankStrength - awayRankStrength;

    const advantage = formDelta * 0.48 + goalsDelta * 0.3 + injuryDelta * 0.2 + homeBoost + rankDelta * 0.28;
    const homeRaw = toProbability(advantage);
    const awayRaw = 1 - homeRaw;
    const closeness = 1 - clamp(Math.abs(homeRaw - awayRaw) * 1.8, 0, 0.95);
    const drawProb = clamp(0.14 + closeness * 0.2, 0.12, 0.32);
    const nonDrawBudget = 1 - drawProb;
    const homeProb = homeRaw * nonDrawBudget;
    const awayProb = awayRaw * nonDrawBudget;

    const xgA = clamp(values.goalsA * 0.78 + values.formA / 24 + 0.22, 0.2, 4.0);
    const xgB = clamp(values.goalsB * 0.78 + values.formB / 24, 0.2, 4.0);

    const formImpact = (values.formA - values.formB) / 60;
    const injuryImpact = (values.injuriesB - values.injuriesA) / 22;
    const rankGoalSwing = rankDelta * 0.2;
    const expectedHomeGoals = clamp(
      xgA + formImpact * 0.3 + injuryImpact * 0.16 + homeBoost * 0.5 + rankGoalSwing,
      0.1,
      4.5
    );
    const expectedAwayGoals = clamp(xgB - formImpact * 0.2 - injuryImpact * 0.12 - rankGoalSwing, 0.1, 4.5);

    const homeScore = expectedGoalsToScore(expectedHomeGoals);
    const awayScore = expectedGoalsToScore(expectedAwayGoals);
    const expectedOutcome =
      homeScore > awayScore ? "Home Win" : homeScore < awayScore ? "Away Win" : "Draw";

    const winner = homeProb >= awayProb ? values.teamA : values.teamB;
    const confidenceScore = clamp(Math.abs(homeProb - awayProb) + (0.35 - drawProb), 0, 1);
    const confidence = confidenceScore > 0.72 ? "High" : confidenceScore > 0.5 ? "Medium" : "Low";
    const risk = drawProb > 0.28 ? "High Draw Risk" : confidenceScore > 0.7 ? "Stable" : "Balanced";

    return {
      fixtureTitle: `${values.teamA} vs ${values.teamB}`,
      winnerText: `Most likely winner: ${winner}`,
      teamA: values.teamA,
      teamB: values.teamB,
      probA: Math.round(homeProb * 100),
      probD: Math.round(drawProb * 100),
      probB: Math.round(awayProb * 100),
      barA: `${(homeProb * 100).toFixed(1)}%`,
      barD: `${(drawProb * 100).toFixed(1)}%`,
      barB: `${(awayProb * 100).toFixed(1)}%`,
      oddsA: toDecimalOdds(homeProb),
      oddsD: toDecimalOdds(drawProb),
      oddsB: toDecimalOdds(awayProb),
      confidence,
      xgA: xgA.toFixed(2),
      xgB: xgB.toFixed(2),
      risk,
      expectedResult: `${homeScore} - ${awayScore} (${expectedOutcome})`,
      expectedReason: `xG ${expectedHomeGoals.toFixed(2)}-${expectedAwayGoals.toFixed(
        2
      )} after form/injury/home adjustments.`,
      homeRankLabel: formatFifaRank(teamRanks.home),
      awayRankLabel: formatFifaRank(teamRanks.away),
      fixtureLabel: `${formatTeamWithRank(values.teamA, teamRanks.home)} vs ${formatTeamWithRank(
        values.teamB,
        teamRanks.away
      )}`,
      rankSummary:
        `${values.teamA} ${formatFifaRank(teamRanks.home) || "FIFA rank n/a"} | ${values.teamB} ${
          formatFifaRank(teamRanks.away) || "FIFA rank n/a"
        }`,
      insights: buildInsights(values, { confidenceScore }, teamRanks)
    };
  }, [fields, teamRanks]);

  async function refreshMatchHistory(nextActive = activeTeams, nextFields = fields) {
    const homeName = nextFields.teamA.trim() || nextActive.homeName;
    const awayName = nextFields.teamB.trim() || nextActive.awayName;

    setHistoryStatus("Loading recent match history...");

    try {
      let resolvedHomeId = nextActive.homeId;
      let resolvedAwayId = nextActive.awayId;

      if (!resolvedHomeId) {
      const team = await findTeamFD(homeName, nextFields.fdApiKey);
      resolvedHomeId = team.id;
    }

    if (!resolvedAwayId) {
      const team = await findTeamFD(awayName, nextFields.fdApiKey);
      resolvedAwayId = team.id;
    }

    const updatedActive = {
      homeId: resolvedHomeId,
      awayId: resolvedAwayId,
      homeName,
      awayName
    };
    setActiveTeams(updatedActive);

    const [homeRows, awayRows, fifaRanks] = await Promise.all([
      fetchTeamMatchesFD(updatedActive.homeId, nextFields.fdApiKey),
      fetchTeamMatchesFD(updatedActive.awayId, nextFields.fdApiKey),
      ]);

      setTeamRanks({
        home: findFifaRankForTeam(homeName, fifaRanks),
        away: findFifaRankForTeam(awayName, fifaRanks)
      });

      const h2hRows = extractHeadToHead(
        homeRows,
        awayRows,
        homeName,
        awayName,
        updatedActive.homeId,
        updatedActive.awayId
      );

      const nextHomeFormEntries = buildFormEntries(homeRows, FORM_ICON_COUNT);
      const nextAwayFormEntries = buildFormEntries(awayRows, FORM_ICON_COUNT);
      const homeStats = calculateStatsFromRows(homeRows, FORM_ICON_COUNT);
      const awayStats = calculateStatsFromRows(awayRows, FORM_ICON_COUNT);

      setHomeFormEntries(nextHomeFormEntries);
      setAwayFormEntries(nextAwayFormEntries);
      setFields((prev) => ({
        ...prev,
        formA: homeStats.formPoints,
        formB: awayStats.formPoints,
        goalsA: Number(homeStats.avgGoals.toFixed(1)),
        goalsB: Number(awayStats.avgGoals.toFixed(1))
      }));

      setHistory({ home: homeRows, away: awayRows, h2h: h2hRows });

      const minCount = Math.min(homeRows.length, awayRows.length);
      if (minCount < 10) {
        setHistoryStatus(
          `Loaded ${homeRows.length} home and ${awayRows.length} away matches (source API returned fewer than 10).`
        );
      } else {
        setHistoryStatus("Recent form and head-to-head loaded (last 10 each).");
      }
    } catch (error) {
      setTeamRanks({ home: null, away: null });
      setHistory({ home: [], away: [], h2h: [] });
      setHistoryStatus(`History load failed: ${error.message}`);
    }
  }

  async function getRecentTeamMetrics(teamId, apiKey) {
    const rows = await fetchTeamMatchesFD(teamId, apiKey);
    const formEntries = buildFormEntries(rows, FORM_ICON_COUNT);

    if (rows.length === 0) {
      return { formPoints: 14, avgGoals: 1.2, formEntries };
    }

    const formPoints = formPointsFromEntries(formEntries);
    const goalsTotal = rows.reduce((total, row) => total + asNumber(row.goalsFor, 0), 0);

    return {
      formPoints: clamp(formPoints, 0, 30),
      avgGoals: clamp(goalsTotal / rows.length, 0, 6),
      formEntries
    };
  }

  async function applyFixture(index, fixtures = loadedFixtures) {
    const fixture = fixtures[index];
    if (!fixture) {
      return;
    }

    const nextFields = {
      ...fields,
      teamA: fixture.strHomeTeam || "Home Team",
      teamB: fixture.strAwayTeam || "Away Team"
    };

    setApiStatus(`Loading recent stats for ${nextFields.teamA} and ${nextFields.teamB}...`);

    const [homeMetrics, awayMetrics] = await Promise.all([
      getRecentTeamMetrics(fixture.idHomeTeam, fields.fdApiKey),
      getRecentTeamMetrics(fixture.idAwayTeam, fields.fdApiKey)
    ]);

    const updatedFields = {
      ...nextFields,
      formA: Math.round(homeMetrics.formPoints),
      formB: Math.round(awayMetrics.formPoints),
      goalsA: Number(homeMetrics.avgGoals.toFixed(1)),
      goalsB: Number(awayMetrics.avgGoals.toFixed(1))
    };

    setHomeFormEntries(homeMetrics.formEntries || createEmptyFormEntries(FORM_ICON_COUNT));
    setAwayFormEntries(awayMetrics.formEntries || createEmptyFormEntries(FORM_ICON_COUNT));

    const updatedActive = {
      homeId: fixture.idHomeTeam || null,
      awayId: fixture.idAwayTeam || null,
      homeName: updatedFields.teamA,
      awayName: updatedFields.teamB
    };

    setFields(updatedFields);
    setActiveTeams(updatedActive);
    await refreshMatchHistory(updatedActive, updatedFields);
    setApiStatus(`Loaded ${updatedFields.teamA} vs ${updatedFields.teamB} from football-data.org.`);
  }

  async function loadNationalFixtures() {
    const query = sanitizeNationalQuery(fields.nationQuery);
    const apiKey = fields.fdApiKey.trim();

    if (!query) {
      setApiStatus("Enter a team or club name first (example: France, Arsenal, Bayern Munich).");
      return;
    }

    if (!apiKey) {
      setApiStatus("Enter your football-data.org API key first.");
      return;
    }

    try {
      setApiStatus(`Searching for ${query}...`);
      const team = await findTeamFD(query, apiKey);
      const payload = await fetchFD(
        `/teams/${team.id}/matches?status=SCHEDULED&limit=10`,
        apiKey
      );
      const fixtures = (payload.matches || []).map(normalizeFDFixture);
      setLoadedFixtures(fixtures);
      setSelectedFixture("0");

      if (fixtures.length === 0) {
        setApiStatus(`No upcoming fixtures for ${team.name || query}. Try another team.`);
        return;
      }

      await applyFixture(0, fixtures);
    } catch (error) {
      setApiStatus(`Could not load fixtures: ${error.message}`);
    }
  }

  async function fetchOddsForCurrentFixture() {
    const apiKey = fields.oddsApiKey.trim();
    const homeTeam = fields.teamA.trim();
    const awayTeam = fields.teamB.trim();

    if (!apiKey) {
      setApiStatus("Enter your The Odds API key first.");
      return;
    }

    if (!homeTeam || !awayTeam) {
      setApiStatus("Load or enter both teams first.");
      return;
    }

    try {
      setApiStatus("Loading betting odds from The Odds API...");

      const sports = await fetchJson(`${ODDS_API_BASE}/sports/?apiKey=${encodeURIComponent(apiKey)}`);
      const soccerSports = (sports || [])
        .filter((sport) => String(sport.key || "").startsWith("soccer_"))
        .slice(0, 8);

      let bestMatch = null;

      for (const sport of soccerSports) {
        const oddsUrl = `${ODDS_API_BASE}/sports/${encodeURIComponent(
          sport.key
        )}/odds/?apiKey=${encodeURIComponent(apiKey)}&regions=eu&markets=h2h&oddsFormat=decimal`;

        const events = await fetchJson(oddsUrl);
        for (const event of events || []) {
          const score = fixtureMatchScore(event, homeTeam, awayTeam);
          if (score < 2) {
            continue;
          }

          if (!bestMatch || score > bestMatch.score) {
            bestMatch = { score, event, sportTitle: sport.title };
          }
        }

        if (bestMatch && bestMatch.score >= 6) {
          break;
        }
      }

      if (!bestMatch) {
        setMarketOdds({
          home: "-",
          draw: "-",
          away: "-",
          meta: "No matching bookmaker market found."
        });
        setApiStatus("Could not find live odds for this fixture. Try closer to kickoff or another competition.");
        return;
      }

      const bestBook = pickBestBookmakerOdds(bestMatch.event);
      if (!bestBook) {
        setMarketOdds({
          home: "-",
          draw: "-",
          away: "-",
          meta: "No complete 1X2 odds available."
        });
        setApiStatus("Fixture found, but bookmakers did not provide full 1X2 prices.");
        return;
      }

      setMarketOdds({
        home: bestBook.home,
        draw: bestBook.draw,
        away: bestBook.away,
        meta: `${bestBook.title} (${bestMatch.sportTitle})`
      });
      setApiStatus(`Loaded betting odds from ${bestBook.title}.`);
    } catch (error) {
      setApiStatus(`Could not load betting odds: ${error.message}`);
    }
  }

  function updateField(key, value) {
    setFields((prev) => ({ ...prev, [key]: value }));
  }

  return (
    <>
      <div className="noise"></div>
      <main className="page">
        <header className="hero">
          <p className="eyebrow">Experimental Match Intelligence</p>
          <h1>Predict Your Next Game</h1>
          <p className="subtitle">Blend form, scoring trends, and injuries into one fast match forecast.</p>
        </header>

        <section className="panel input-panel" aria-label="Prediction input">
          <div className="api-grid">
            <div>
              <label htmlFor="nationQuery">Team or Club</label>
              <input
                id="nationQuery"
                type="text"
                value={fields.nationQuery}
                onChange={(e) => updateField("nationQuery", e.target.value)}
              />
            </div>
            <div className="api-action-wrap">
              <button className="predict-btn" type="button" onClick={loadNationalFixtures}>
                Load Real Fixture
              </button>
            </div>
          </div>

          <div className="api-grid api-grid-secondary">
            <div>
              <label htmlFor="fixtureSelect">Upcoming Fixtures</label>
              <select
                id="fixtureSelect"
                value={selectedFixture}
                disabled={loadedFixtures.length === 0}
                onChange={async (e) => {
                  const next = e.target.value;
                  setSelectedFixture(next);
                  const index = Number(next);
                  if (Number.isFinite(index)) {
                    await applyFixture(index);
                  }
                }}
              >
                {loadedFixtures.length === 0 ? (
                  <option value="0">Load a national team first</option>
                ) : (
                  loadedFixtures.map((fixture, index) => (
                    <option key={`${fixture.idEvent || index}`} value={String(index)}>
                      {`${fixture.dateEvent || fixture.strTimestamp || "Upcoming"} - ${fixture.strHomeTeam} vs ${
                        fixture.strAwayTeam
                      }`}
                    </option>
                  ))
                )}
              </select>
            </div>
            <div>
              <p className="api-status">{apiStatus}</p>
            </div>
          </div>

          <div className="team-grid">
            <div>
              <label htmlFor="teamA">Home Team</label>
              <input id="teamA" type="text" value={fields.teamA} onChange={(e) => updateField("teamA", e.target.value)} />
            </div>
            <div>
              <label htmlFor="teamB">Away Team</label>
              <input id="teamB" type="text" value={fields.teamB} onChange={(e) => updateField("teamB", e.target.value)} />
            </div>
          </div>

          <div className="metrics-grid">
            <div>
              <label htmlFor="formA">Home Form (last 10)</label>
              <div
                id="formA"
                className="form-icons"
                role="img"
                aria-label={`Home form last ten: ${homeFormEntries.map((entry) => entry.result).join(" ")}`}
              >
                {homeFormEntries.map((entry) => (
                  <span
                    key={`home-form-${entry.key}`}
                    className={formIconClass(entry.result)}
                    data-tooltip={entry.tooltip}
                    aria-label={entry.tooltip}
                  >
                    {entry.result}
                  </span>
                ))}
              </div>
              <small>Auto-calculated from last 10 official results (W=3, D=1, L=0)</small>
            </div>
            <div>
              <label htmlFor="formB">Away Form (last 10)</label>
              <div
                id="formB"
                className="form-icons"
                role="img"
                aria-label={`Away form last ten: ${awayFormEntries.map((entry) => entry.result).join(" ")}`}
              >
                {awayFormEntries.map((entry) => (
                  <span
                    key={`away-form-${entry.key}`}
                    className={formIconClass(entry.result)}
                    data-tooltip={entry.tooltip}
                    aria-label={entry.tooltip}
                  >
                    {entry.result}
                  </span>
                ))}
              </div>
              <small>Auto-calculated from last 10 official results (W=3, D=1, L=0)</small>
            </div>
            <div>
              <label htmlFor="goalsA">Home Avg Goals</label>
              <input
                id="goalsA"
                type="number"
                min="0"
                max="6"
                step="0.1"
                value={fields.goalsA}
                onChange={(e) => updateField("goalsA", Number(e.target.value))}
              />
              <small>Per game (last 10 official matches)</small>
            </div>
            <div>
              <label htmlFor="goalsB">Away Avg Goals</label>
              <input
                id="goalsB"
                type="number"
                min="0"
                max="6"
                step="0.1"
                value={fields.goalsB}
                onChange={(e) => updateField("goalsB", Number(e.target.value))}
              />
              <small>Per game (last 10 official matches)</small>
            </div>
            <div>
              <label htmlFor="injuriesA">Home Injuries</label>
              <input
                id="injuriesA"
                type="number"
                min="0"
                max="11"
                value={fields.injuriesA}
                onChange={(e) => updateField("injuriesA", Number(e.target.value))}
              />
              <small>Likely unavailable starters</small>
            </div>
            <div>
              <label htmlFor="injuriesB">Away Injuries</label>
              <input
                id="injuriesB"
                type="number"
                min="0"
                max="11"
                value={fields.injuriesB}
                onChange={(e) => updateField("injuriesB", Number(e.target.value))}
              />
              <small>Likely unavailable starters</small>
            </div>
          </div>

          <button
            className="predict-btn"
            type="button"
            onClick={() =>
              refreshMatchHistory(
                { homeId: null, awayId: null, homeName: fields.teamA, awayName: fields.teamB },
                fields
              )
            }
          >
            Run Prediction
          </button>
        </section>

        <section className="panel output-panel" aria-live="polite">
          <div className="result-top">
            <h2>{prediction.fixtureLabel}</h2>
            <p>{prediction.winnerText}</p>
            <small>{prediction.rankSummary}</small>
          </div>

          <div className="bars" role="img" aria-label="Win probability bars">
            <div className="bar-row">
              <span>{formatTeamWithRank(prediction.teamA, teamRanks.home)}</span>
              <div className="bar-track">
                <div className="bar fill-home" style={{ width: prediction.barA }}></div>
              </div>
              <strong>{prediction.probA}%</strong>
            </div>
            <div className="bar-row">
              <span>Draw</span>
              <div className="bar-track">
                <div className="bar fill-draw" style={{ width: prediction.barD }}></div>
              </div>
              <strong>{prediction.probD}%</strong>
            </div>
            <div className="bar-row">
              <span>{formatTeamWithRank(prediction.teamB, teamRanks.away)}</span>
              <div className="bar-track">
                <div className="bar fill-away" style={{ width: prediction.barB }}></div>
              </div>
              <strong>{prediction.probB}%</strong>
            </div>
          </div>

          <div className="stats-strip">
            <article>
              <h3>Confidence</h3>
              <p>{prediction.confidence}</p>
            </article>
            <article>
              <h3>Expected Goals</h3>
              <p>
                {prediction.xgA} - {prediction.xgB}
              </p>
            </article>
            <article>
              <h3>Risk Flag</h3>
              <p>{prediction.risk}</p>
            </article>
            <article>
              <h3>Model Odds</h3>
              <p className="odds-line">
                <span>{prediction.oddsA}</span>
                <span>/</span>
                <span>{prediction.oddsD}</span>
                <span>/</span>
                <span>{prediction.oddsB}</span>
              </p>
            </article>
            <article>
              <h3>Market Odds</h3>
              <p className="odds-line">
                <span>{marketOdds.home}</span>
                <span>/</span>
                <span>{marketOdds.draw}</span>
                <span>/</span>
                <span>{marketOdds.away}</span>
              </p>
              <small id="marketMeta">{marketOdds.meta}</small>
            </article>
            <article>
              <h3>Expected Result</h3>
              <p>{prediction.expectedResult}</p>
              <small>{prediction.expectedReason}</small>
            </article>
          </div>

          <article className="insights">
            <h3>Key Drivers</h3>
            <ul>
              {prediction.insights.map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ul>
          </article>
        </section>

        <section className="panel history-panel" aria-live="polite" aria-label="Match history">
          <div className="result-top">
            <h2>Form And Head-to-Head</h2>
            <p>{historyStatus}</p>
          </div>

          <div className="history-grid">
            <article className="history-card">
              <h3>Last 10: {formatTeamWithRank(fields.teamA, teamRanks.home)}</h3>
              <div className="history-list">
                {history.home.length === 0 ? (
                  <p className="history-empty">No recent matches found.</p>
                ) : (
                  history.home.map((row) => (
                    <div className="history-row" key={`h-${row.idEvent}-${row.dateLabel}`}>
                      <span className="history-date">{row.dateLabel}</span>
                      <span className="history-fixture">{row.fixtureLabel}</span>
                      <span className="history-score">{row.scoreLabel}</span>
                      <span className={badgeClass(row.outcome)}>{row.outcome}</span>
                    </div>
                  ))
                )}
              </div>
            </article>

            <article className="history-card">
              <h3>Last 10: {formatTeamWithRank(fields.teamB, teamRanks.away)}</h3>
              <div className="history-list">
                {history.away.length === 0 ? (
                  <p className="history-empty">No recent matches found.</p>
                ) : (
                  history.away.map((row) => (
                    <div className="history-row" key={`a-${row.idEvent}-${row.dateLabel}`}>
                      <span className="history-date">{row.dateLabel}</span>
                      <span className="history-fixture">{row.fixtureLabel}</span>
                      <span className="history-score">{row.scoreLabel}</span>
                      <span className={badgeClass(row.outcome)}>{row.outcome}</span>
                    </div>
                  ))
                )}
              </div>
            </article>
          </div>

          <article className="history-card history-card-wide">
            <h3>
              Head-to-Head: {formatTeamWithRank(fields.teamA, teamRanks.home)} vs {formatTeamWithRank(
                fields.teamB,
                teamRanks.away
              )}
            </h3>
            <div className="history-list">
              {history.h2h.length === 0 ? (
                <p className="history-empty">No head-to-head matches found in recent history.</p>
              ) : (
                history.h2h.map((row) => (
                  <div className="history-row" key={`hh-${row.idEvent}-${row.dateLabel}`}>
                    <span className="history-date">{row.dateLabel}</span>
                    <span className="history-fixture">{row.fixtureLabel}</span>
                    <span className="history-score">{row.scoreLabel}</span>
                    <span className={badgeClass(row.outcome)}>{row.outcome}</span>
                  </div>
                ))
              )}
            </div>
          </article>
        </section>
      </main>
    </>
  );
}
