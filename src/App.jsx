import React, { useMemo, useState } from "react";
import "./styles.css";

const API_BASES = [
  "https://www.thesportsdb.com/api/v1/json/3",
  "https://www.thesportsdb.com/api/v1/json/123"
];
const ODDS_API_BASE = "https://api.the-odds-api.com/v4";

const initialFields = {
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

async function fetchSportsDbViaProxy(fullUrl) {
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

  throw errors[errors.length - 1] || new Error("CORS proxy fallback failed.");
}

async function fetchSportsDb(path) {
  const errors = [];

  for (const base of API_BASES) {
    const fullUrl = `${base}${path}`;

    try {
      return await fetchJson(fullUrl);
    } catch (error) {
      errors.push(error);

      // On browser CORS failures, try trusted read-through proxies for public data endpoints.
      const msg = String((error && error.message) || "").toLowerCase();
      if (msg.includes("network/cors") || msg.includes("failed to fetch")) {
        try {
          return await fetchSportsDbViaProxy(fullUrl);
        } catch (proxyError) {
          errors.push(proxyError);
        }
      }
    }
  }

  throw errors[errors.length - 1] || new Error("Could not reach TheSportsDB.");
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
    outcome: getOutcomeFromPerspective(goalsFor, goalsAgainst),
    homeTeam: home,
    awayTeam: away,
    homeTeamId: String(event.idHomeTeam || ""),
    awayTeamId: String(event.idAwayTeam || "")
  };
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

function buildInsights(values, metrics) {
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
    tooltip: "No match data available"
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
      tooltip: "No match data available"
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

async function findNationalTeam(query) {
  const cleanedQuery = sanitizeNationalQuery(query);
  const payload = await fetchSportsDb(`/searchteams.php?t=${encodeURIComponent(cleanedQuery)}`);
  const allTeams = payload.teams || [];

  if (allTeams.length === 0) {
    throw new Error(`No teams found for ${cleanedQuery}. Try a country name like France or Mexico.`);
  }

  const soccerTeams = allTeams.filter((team) => {
    const sport = String(team.strSport || "").toLowerCase();
    return sport.includes("soccer") || sport.includes("football");
  });
  const candidates = soccerTeams.length > 0 ? soccerTeams : allTeams;

  const queryLower = normalizeTeamName(cleanedQuery);
  const exactNational = candidates.find(
    (team) => normalizeTeamName(team.strTeam) === queryLower && isLikelyNationalTeam(team, queryLower)
  );
  if (exactNational) {
    return exactNational;
  }

  const nationalMatch = candidates.find((team) => isLikelyNationalTeam(team, queryLower));
  if (nationalMatch) {
    return nationalMatch;
  }

  const fuzzy = candidates.find((team) => {
    const name = normalizeTeamName(team.strTeam || "");
    return name.includes(queryLower) || queryLower.includes(name);
  });

  if (fuzzy) {
    return fuzzy;
  }

  throw new Error(`No national team matched ${cleanedQuery}. Try a country name only.`);
}

async function getTeamDetails(teamId) {
  const payload = await fetchSportsDb(`/lookupteam.php?id=${encodeURIComponent(teamId)}`);
  return payload.teams && payload.teams[0] ? payload.teams[0] : null;
}

async function fetchTeamMatches(teamId) {
  if (!teamId) {
    return [];
  }

  const seed = await fetchSportsDb(`/eventslast.php?id=${encodeURIComponent(teamId)}`);
  const team = await getTeamDetails(teamId);
  const teamNameNorm = normalizeTeamName((team && team.strTeam) || "");
  const leagueIds = team ? extractLeagueIds(team) : [];
  const seasons = buildSeasonCandidates(new Date().getFullYear(), 5);
  const unique = new Map();

  (seed.results || []).forEach((event) => {
    const row = normalizeMatchEvent(event, teamId);
    if (row) {
      unique.set(String(row.idEvent || `${row.dateLabel}-${row.fixtureLabel}`), row);
    }
  });

  for (const season of seasons) {
    for (const leagueId of leagueIds) {
      let events = [];
      try {
        const seasonPayload = await fetchSportsDb(
          `/eventsseason.php?id=${encodeURIComponent(leagueId)}&s=${encodeURIComponent(season)}`
        );
        events = seasonPayload.events || [];
      } catch (_error) {
        events = [];
      }

      events
        .filter((event) => matchesTeam(event, teamId, teamNameNorm))
        .forEach((event) => {
          const row = normalizeMatchEvent(event, teamId);
          if (!row) {
            return;
          }
          const key = String(row.idEvent || `${row.dateLabel}-${row.fixtureLabel}`);
          if (!unique.has(key)) {
            unique.set(key, row);
          }
        });

      if (unique.size >= 10) {
        break;
      }
    }

    if (unique.size >= 10) {
      break;
    }
  }

  return Array.from(unique.values())
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
  const [apiStatus, setApiStatus] = useState("Data source: TheSportsDB public API");
  const [historyStatus, setHistoryStatus] = useState("Load a fixture to view recent form and H2H.");
  const [marketOdds, setMarketOdds] = useState({
    home: "-",
    draw: "-",
    away: "-",
    meta: "Load a fixture and fetch betting odds."
  });
  const [history, setHistory] = useState({ home: [], away: [], h2h: [] });
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

    const advantage = formDelta * 0.55 + goalsDelta * 0.35 + injuryDelta * 0.25 + homeBoost;
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
    const expectedHomeGoals = clamp(xgA + formImpact * 0.35 + injuryImpact * 0.2 + homeBoost * 0.6, 0.1, 4.5);
    const expectedAwayGoals = clamp(xgB - formImpact * 0.25 - injuryImpact * 0.15, 0.1, 4.5);

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
      insights: buildInsights(values, { confidenceScore })
    };
  }, [fields]);

  async function refreshMatchHistory(nextActive = activeTeams, nextFields = fields) {
    const homeName = nextFields.teamA.trim() || nextActive.homeName;
    const awayName = nextFields.teamB.trim() || nextActive.awayName;

    setHistoryStatus("Loading recent match history...");

    try {
      let resolvedHomeId = nextActive.homeId;
      let resolvedAwayId = nextActive.awayId;

      if (!resolvedHomeId) {
        const team = await findNationalTeam(homeName);
        resolvedHomeId = team.idTeam;
      }

      if (!resolvedAwayId) {
        const team = await findNationalTeam(awayName);
        resolvedAwayId = team.idTeam;
      }

      const updatedActive = {
        homeId: resolvedHomeId,
        awayId: resolvedAwayId,
        homeName,
        awayName
      };
      setActiveTeams(updatedActive);

      const [homeRows, awayRows] = await Promise.all([
        fetchTeamMatches(updatedActive.homeId),
        fetchTeamMatches(updatedActive.awayId)
      ]);

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
      const nextHomeFormPoints = formPointsFromEntries(nextHomeFormEntries);
      const nextAwayFormPoints = formPointsFromEntries(nextAwayFormEntries);

      setHomeFormEntries(nextHomeFormEntries);
      setAwayFormEntries(nextAwayFormEntries);
      setFields((prev) => ({ ...prev, formA: nextHomeFormPoints, formB: nextAwayFormPoints }));

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
      setHistory({ home: [], away: [], h2h: [] });
      setHistoryStatus(`History load failed: ${error.message}`);
    }
  }

  async function getRecentTeamMetrics(teamId) {
    const payload = await fetchSportsDb(`/eventslast.php?id=${encodeURIComponent(teamId)}`);
    const events = payload.results || [];
    const quickRows = [];

    let points = 0;
    let goalsForTotal = 0;
    let counted = 0;

    events.slice(0, 10).forEach((event) => {
      const homeScore = asNumber(event.intHomeScore, null);
      const awayScore = asNumber(event.intAwayScore, null);

      if (homeScore === null || awayScore === null) {
        return;
      }

      const isHome = String(event.idHomeTeam) === String(teamId);
      const goalsFor = isHome ? homeScore : awayScore;
      const goalsAgainst = isHome ? awayScore : homeScore;

      goalsForTotal += goalsFor;
      counted += 1;

      const row = normalizeMatchEvent(event, teamId);
      if (row) {
        quickRows.push(row);
      }

      if (goalsFor > goalsAgainst) {
        points += 3;
      } else if (goalsFor === goalsAgainst) {
        points += 1;
      }
    });

    const formEntries = buildFormEntries(quickRows, FORM_ICON_COUNT);

    if (counted === 0) {
      return { formPoints: 14, avgGoals: 1.2, formEntries };
    }

    return {
      formPoints: clamp(points, 0, 30),
      avgGoals: clamp(goalsForTotal / counted, 0, 6),
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
      getRecentTeamMetrics(fixture.idHomeTeam),
      getRecentTeamMetrics(fixture.idAwayTeam)
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
    setApiStatus(`Loaded ${updatedFields.teamA} vs ${updatedFields.teamB} from TheSportsDB.`);
  }

  async function loadNationalFixtures() {
    const query = sanitizeNationalQuery(fields.nationQuery);
    if (!query) {
      setApiStatus("Enter a national team name first (example: France, Brazil, Japan).");
      return;
    }

    try {
      setApiStatus(`Searching national team data for ${query}...`);
      const team = await findNationalTeam(query);
      const payload = await fetchSportsDb(`/eventsnext.php?id=${encodeURIComponent(team.idTeam)}`);
      const fixtures = payload.events || [];
      setLoadedFixtures(fixtures);
      setSelectedFixture("0");

      if (fixtures.length === 0) {
        setApiStatus(`No upcoming fixtures found for ${team.strTeam}. Try another team.`);
        return;
      }

      await applyFixture(0, fixtures);
    } catch (error) {
      setApiStatus(`Could not load API data: ${error.message}`);
      if (String(error.message || "").toLowerCase().includes("network/cors")) {
        setHistoryStatus("Tip: serve this page with a local server (example: python -m http.server 5173).");
      }
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
          <h1>Predict Your Next Clash</h1>
          <p className="subtitle">Blend form, scoring trends, and injuries into one fast match forecast.</p>
        </header>

        <section className="panel input-panel" aria-label="Prediction input">
          <div className="api-grid">
            <div>
              <label htmlFor="nationQuery">National Team</label>
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

          <div className="api-grid api-grid-secondary">
            <div>
              <label htmlFor="oddsApiKey">The Odds API Key</label>
              <input
                id="oddsApiKey"
                type="password"
                value={fields.oddsApiKey}
                onChange={(e) => updateField("oddsApiKey", e.target.value)}
                placeholder="Paste your API key"
              />
              <small>Get one from the-odds-api.com</small>
            </div>
            <div className="api-action-wrap">
              <button className="predict-btn" type="button" onClick={fetchOddsForCurrentFixture}>
                Load Betting Odds
              </button>
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
                    title={entry.tooltip}
                  >
                    {entry.result}
                  </span>
                ))}
              </div>
              <small>Auto-calculated from last 10 results (W=3, D=1, L=0)</small>
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
                    title={entry.tooltip}
                  >
                    {entry.result}
                  </span>
                ))}
              </div>
              <small>Auto-calculated from last 10 results (W=3, D=1, L=0)</small>
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
              <small>Per game</small>
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
              <small>Per game</small>
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
            <h2>{prediction.fixtureTitle}</h2>
            <p>{prediction.winnerText}</p>
          </div>

          <div className="bars" role="img" aria-label="Win probability bars">
            <div className="bar-row">
              <span>{prediction.teamA}</span>
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
              <span>{prediction.teamB}</span>
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
              <h3>Last 10: {fields.teamA}</h3>
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
              <h3>Last 10: {fields.teamB}</h3>
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
              Head-to-Head: {fields.teamA} vs {fields.teamB}
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
