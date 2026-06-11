const fields = {
  nationQuery: document.getElementById("nationQuery"),
  oddsApiKey: document.getElementById("oddsApiKey"),
  teamA: document.getElementById("teamA"),
  teamB: document.getElementById("teamB"),
  formA: document.getElementById("formA"),
  formB: document.getElementById("formB"),
  goalsA: document.getElementById("goalsA"),
  goalsB: document.getElementById("goalsB"),
  injuriesA: document.getElementById("injuriesA"),
  injuriesB: document.getElementById("injuriesB")
};

const output = {
  fixtureSelect: document.getElementById("fixtureSelect"),
  apiStatus: document.getElementById("apiStatus"),
  fixtureTitle: document.getElementById("fixtureTitle"),
  winnerText: document.getElementById("winnerText"),
  labelA: document.getElementById("labelA"),
  labelB: document.getElementById("labelB"),
  barA: document.getElementById("barA"),
  barD: document.getElementById("barD"),
  barB: document.getElementById("barB"),
  probA: document.getElementById("probA"),
  probD: document.getElementById("probD"),
  probB: document.getElementById("probB"),
  oddsA: document.getElementById("oddsA"),
  oddsD: document.getElementById("oddsD"),
  oddsB: document.getElementById("oddsB"),
  marketOddsA: document.getElementById("marketOddsA"),
  marketOddsD: document.getElementById("marketOddsD"),
  marketOddsB: document.getElementById("marketOddsB"),
  marketMeta: document.getElementById("marketMeta"),
  expectedResult: document.getElementById("expectedResult"),
  expectedReason: document.getElementById("expectedReason"),
  historyStatus: document.getElementById("historyStatus"),
  homeHistoryTitle: document.getElementById("homeHistoryTitle"),
  awayHistoryTitle: document.getElementById("awayHistoryTitle"),
  h2hTitle: document.getElementById("h2hTitle"),
  homeHistoryList: document.getElementById("homeHistoryList"),
  awayHistoryList: document.getElementById("awayHistoryList"),
  h2hList: document.getElementById("h2hList"),
  confidence: document.getElementById("confidence"),
  xgA: document.getElementById("xgA"),
  xgB: document.getElementById("xgB"),
  risk: document.getElementById("risk"),
  insightList: document.getElementById("insightList")
};

const API_BASES = [
  "https://www.thesportsdb.com/api/v1/json/3",
  "https://www.thesportsdb.com/api/v1/json/123"
];
const ODDS_API_BASE = "https://api.the-odds-api.com/v4";
let loadedFixtures = [];
let activeTeams = {
  homeId: null,
  awayId: null,
  homeName: "Home Team",
  awayName: "Away Team"
};

function setApiStatus(message) {
  output.apiStatus.textContent = message;
}

function setHistoryStatus(message) {
  output.historyStatus.textContent = message;
}

function setMarketOdds(values, meta) {
  output.marketOddsA.textContent = values.home;
  output.marketOddsD.textContent = values.draw;
  output.marketOddsB.textContent = values.away;
  output.marketMeta.textContent = meta;
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

      const contentType = response.headers.get("content-type") || "";
      if (!contentType.toLowerCase().includes("application/json")) {
        throw new Error("Unexpected response format from data provider.");
      }

      return response.json();
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

async function fetchSportsDb(path) {
  const errors = [];

  for (const base of API_BASES) {
    try {
      return await fetchJson(`${base}${path}`);
    } catch (error) {
      errors.push(error);
    }
  }

  throw errors[errors.length - 1] || new Error("Could not reach TheSportsDB.");
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
      key: bookmaker.key,
      title: bookmaker.title,
      lastUpdate: bookmaker.last_update,
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

async function fetchOddsForCurrentFixture() {
  const apiKey = fields.oddsApiKey.value.trim();
  const homeTeam = fields.teamA.value.trim();
  const awayTeam = fields.teamB.value.trim();

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
      setMarketOdds({ home: "-", draw: "-", away: "-" }, "No matching bookmaker market found.");
      setApiStatus("Could not find live odds for this fixture. Try closer to kickoff or another competition.");
      return;
    }

    const bestBook = pickBestBookmakerOdds(bestMatch.event);
    if (!bestBook) {
      setMarketOdds({ home: "-", draw: "-", away: "-" }, "No complete 1X2 odds available.");
      setApiStatus("Fixture found, but bookmakers did not provide full 1X2 prices.");
      return;
    }

    setMarketOdds(
      { home: bestBook.home, draw: bestBook.draw, away: bestBook.away },
      `${bestBook.title} (${bestMatch.sportTitle})`
    );
    setApiStatus(`Loaded betting odds from ${bestBook.title}.`);
  } catch (error) {
    setApiStatus(`Could not load betting odds: ${error.message}`);
  }
}

function asNumber(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
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

function badgeClass(outcome) {
  if (outcome === "W") {
    return "result-badge result-win";
  }
  if (outcome === "L") {
    return "result-badge result-loss";
  }
  return "result-badge result-draw";
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

function parseEventDate(event) {
  const raw = event.dateEvent || event.strTimestamp;
  const date = new Date(raw || "");
  if (Number.isNaN(date.getTime())) {
    return 0;
  }
  return date.getTime();
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
    const value = team[key];
    if (value) {
      ids.push(String(value));
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

async function getTeamDetails(teamId) {
  const payload = await fetchSportsDb(`/lookupteam.php?id=${encodeURIComponent(teamId)}`);
  return payload.teams && payload.teams[0] ? payload.teams[0] : null;
}

function renderHistoryRows(container, rows, emptyMessage) {
  container.innerHTML = "";

  if (!rows || rows.length === 0) {
    const p = document.createElement("p");
    p.className = "history-empty";
    p.textContent = emptyMessage;
    container.appendChild(p);
    return;
  }

  rows.forEach((row) => {
    const wrapper = document.createElement("div");
    wrapper.className = "history-row";

    const date = document.createElement("span");
    date.className = "history-date";
    date.textContent = row.dateLabel;

    const fixture = document.createElement("span");
    fixture.className = "history-fixture";
    fixture.textContent = row.fixtureLabel;

    const score = document.createElement("span");
    score.className = "history-score";
    score.textContent = row.scoreLabel;

    const badge = document.createElement("span");
    badge.className = badgeClass(row.outcome);
    badge.textContent = row.outcome;

    wrapper.appendChild(date);
    wrapper.appendChild(fixture);
    wrapper.appendChild(score);
    wrapper.appendChild(badge);
    container.appendChild(wrapper);
  });
}

async function resolveTeamId(teamName) {
  const payload = await fetchSportsDb(`/searchteams.php?t=${encodeURIComponent(teamName)}`);
  const teams = (payload.teams || []).filter((team) => team.strSport === "Soccer");
  if (teams.length === 0) {
    return null;
  }

  const target = normalizeTeamName(teamName);
  const exact = teams.find((team) => normalizeTeamName(team.strTeam) === target);
  return (exact || teams[0]).idTeam;
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

  const seedEvents = seed.results || [];
  seedEvents.forEach((event) => {
    const row = normalizeMatchEvent(event, teamId);
    if (!row) {
      return;
    }
    unique.set(String(row.idEvent || `${row.dateLabel}-${row.fixtureLabel}`), row);
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

async function refreshMatchHistory() {
  const homeName = fields.teamA.value.trim() || activeTeams.homeName;
  const awayName = fields.teamB.value.trim() || activeTeams.awayName;

  output.homeHistoryTitle.textContent = `Last 10: ${homeName}`;
  output.awayHistoryTitle.textContent = `Last 10: ${awayName}`;
  output.h2hTitle.textContent = `Head-to-Head: ${homeName} vs ${awayName}`;

  setHistoryStatus("Loading recent match history...");

  try {
    const resolvedHomeId = activeTeams.homeId || (await resolveTeamId(homeName));
    const resolvedAwayId = activeTeams.awayId || (await resolveTeamId(awayName));

    activeTeams = {
      homeId: resolvedHomeId,
      awayId: resolvedAwayId,
      homeName,
      awayName
    };

    const [homeRows, awayRows] = await Promise.all([
      fetchTeamMatches(activeTeams.homeId),
      fetchTeamMatches(activeTeams.awayId)
    ]);

    const h2hRows = extractHeadToHead(
      homeRows,
      awayRows,
      homeName,
      awayName,
      activeTeams.homeId,
      activeTeams.awayId
    );

    renderHistoryRows(output.homeHistoryList, homeRows, "No recent matches found.");
    renderHistoryRows(output.awayHistoryList, awayRows, "No recent matches found.");
    renderHistoryRows(output.h2hList, h2hRows, "No head-to-head matches found in recent history.");

    const minCount = Math.min(homeRows.length, awayRows.length);
    if (minCount < 10) {
      setHistoryStatus(
        `Loaded ${homeRows.length} home and ${awayRows.length} away matches (source API returned fewer than 10).`
      );
    } else {
      setHistoryStatus("Recent form and head-to-head loaded (last 10 each).");
    }
  } catch (error) {
    renderHistoryRows(output.homeHistoryList, [], "Could not load home team history.");
    renderHistoryRows(output.awayHistoryList, [], "Could not load away team history.");
    renderHistoryRows(output.h2hList, [], "Could not load head-to-head history.");
    setHistoryStatus(`History load failed: ${error.message}`);
  }
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

function sanitizeNationalQuery(query) {
  let cleaned = (query || "").trim().replace(/\s+/g, " ");

  cleaned = cleaned
    .split(/\bvs\b|\bv\b|\//i)
    .map((part) => part.trim())
    .filter(Boolean)[0] || cleaned;

  cleaned = cleaned.replace(/national\s+team/gi, "").replace(/\bteam\b/gi, "").trim();
  return cleaned;
}

async function findNationalTeam(query) {
  const cleanedQuery = sanitizeNationalQuery(query);
  const payload = await fetchSportsDb(`/searchteams.php?t=${encodeURIComponent(cleanedQuery)}`);
  const allTeams = payload.teams || [];

  if (allTeams.length === 0) {
    throw new Error(`No teams found for "${cleanedQuery}". Try a country name like France or Mexico.`);
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

  throw new Error(`No national team matched "${cleanedQuery}". Try a country name only.`);
}

async function getRecentTeamMetrics(teamId) {
  const payload = await fetchSportsDb(`/eventslast.php?id=${encodeURIComponent(teamId)}`);
  const events = payload.results || [];

  let points = 0;
  let goalsForTotal = 0;
  let counted = 0;

  events.slice(0, 5).forEach((event) => {
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

    if (goalsFor > goalsAgainst) {
      points += 3;
    } else if (goalsFor === goalsAgainst) {
      points += 1;
    }
  });

  if (counted === 0) {
    return { formPoints: 7, avgGoals: 1.2 };
  }

  return {
    formPoints: clamp(points, 0, 15),
    avgGoals: clamp(goalsForTotal / counted, 0, 6)
  };
}

function populateFixtureOptions(fixtures) {
  output.fixtureSelect.innerHTML = "";
  if (fixtures.length === 0) {
    const option = document.createElement("option");
    option.textContent = "No upcoming fixtures found";
    option.value = "";
    output.fixtureSelect.appendChild(option);
    output.fixtureSelect.disabled = true;
    return;
  }

  fixtures.forEach((fixture, index) => {
    const option = document.createElement("option");
    const dateLabel = fixture.dateEvent || fixture.strTimestamp || "Upcoming";
    option.value = String(index);
    option.textContent = `${dateLabel} - ${fixture.strHomeTeam} vs ${fixture.strAwayTeam}`;
    output.fixtureSelect.appendChild(option);
  });

  output.fixtureSelect.disabled = false;
}

async function applyFixture(index) {
  const fixture = loadedFixtures[index];
  if (!fixture) {
    return;
  }

  fields.teamA.value = fixture.strHomeTeam || "Home Team";
  fields.teamB.value = fixture.strAwayTeam || "Away Team";
  activeTeams.homeId = fixture.idHomeTeam || null;
  activeTeams.awayId = fixture.idAwayTeam || null;
  activeTeams.homeName = fields.teamA.value;
  activeTeams.awayName = fields.teamB.value;

  setApiStatus(`Loading recent stats for ${fields.teamA.value} and ${fields.teamB.value}...`);

  const [homeMetrics, awayMetrics] = await Promise.all([
    getRecentTeamMetrics(fixture.idHomeTeam),
    getRecentTeamMetrics(fixture.idAwayTeam)
  ]);

  fields.formA.value = String(Math.round(homeMetrics.formPoints));
  fields.formB.value = String(Math.round(awayMetrics.formPoints));
  fields.goalsA.value = homeMetrics.avgGoals.toFixed(1);
  fields.goalsB.value = awayMetrics.avgGoals.toFixed(1);

  runPrediction();
  await refreshMatchHistory();
  setApiStatus(`Loaded ${fixture.strHomeTeam} vs ${fixture.strAwayTeam} from TheSportsDB.`);
}

async function loadNationalFixtures() {
  const originalQuery = fields.nationQuery.value.trim();
  const query = sanitizeNationalQuery(originalQuery);
  if (!query) {
    setApiStatus("Enter a national team name first (example: France, Brazil, Japan).");
    return;
  }

  try {
    setApiStatus(`Searching national team data for ${query}...`);
    const team = await findNationalTeam(query);
    const payload = await fetchSportsDb(`/eventsnext.php?id=${encodeURIComponent(team.idTeam)}`);
    loadedFixtures = payload.events || [];

    populateFixtureOptions(loadedFixtures);

    if (loadedFixtures.length === 0) {
      setApiStatus(`No upcoming fixtures found for ${team.strTeam}. Try another team.`);
      return;
    }

    await applyFixture(0);
  } catch (error) {
    setApiStatus(`Could not load API data: ${error.message}`);

    if (String(error.message || "").toLowerCase().includes("network/cors")) {
      setHistoryStatus("Tip: serve this page with a local server (example: python -m http.server 5173). ");
    }
  }
}

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

function runPrediction() {
  const values = {
    teamA: fields.teamA.value.trim() || "Home Team",
    teamB: fields.teamB.value.trim() || "Away Team",
    formA: clamp(Number(fields.formA.value) || 0, 0, 15),
    formB: clamp(Number(fields.formB.value) || 0, 0, 15),
    goalsA: clamp(Number(fields.goalsA.value) || 0, 0, 6),
    goalsB: clamp(Number(fields.goalsB.value) || 0, 0, 6),
    injuriesA: clamp(Number(fields.injuriesA.value) || 0, 0, 11),
    injuriesB: clamp(Number(fields.injuriesB.value) || 0, 0, 11)
  };

  const formDelta = (values.formA - values.formB) / 15;
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

  const xgA = clamp(values.goalsA * 0.78 + values.formA / 12 + 0.22, 0.2, 4.0);
  const xgB = clamp(values.goalsB * 0.78 + values.formB / 12, 0.2, 4.0);

  // Adjust expected goals from all tracked stats before mapping to an expected scoreline.
  const formImpact = (values.formA - values.formB) / 30;
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

  const metrics = { confidenceScore };
  const insights = buildInsights(values, metrics);

  output.fixtureTitle.textContent = `${values.teamA} vs ${values.teamB}`;
  output.winnerText.textContent = `Most likely winner: ${winner}`;
  output.labelA.textContent = values.teamA;
  output.labelB.textContent = values.teamB;

  output.barA.style.width = `${(homeProb * 100).toFixed(1)}%`;
  output.barD.style.width = `${(drawProb * 100).toFixed(1)}%`;
  output.barB.style.width = `${(awayProb * 100).toFixed(1)}%`;

  output.probA.textContent = `${Math.round(homeProb * 100)}%`;
  output.probD.textContent = `${Math.round(drawProb * 100)}%`;
  output.probB.textContent = `${Math.round(awayProb * 100)}%`;
  output.oddsA.textContent = toDecimalOdds(homeProb);
  output.oddsD.textContent = toDecimalOdds(drawProb);
  output.oddsB.textContent = toDecimalOdds(awayProb);

  output.confidence.textContent = confidence;
  output.xgA.textContent = xgA.toFixed(2);
  output.xgB.textContent = xgB.toFixed(2);
  output.risk.textContent = risk;
  output.expectedResult.textContent = `${homeScore} - ${awayScore} (${expectedOutcome})`;
  output.expectedReason.textContent = `xG ${expectedHomeGoals.toFixed(2)}-${expectedAwayGoals.toFixed(
    2
  )} after form/injury/home adjustments.`;

  output.insightList.innerHTML = "";
  insights.forEach((item) => {
    const li = document.createElement("li");
    li.textContent = item;
    output.insightList.appendChild(li);
  });
}

document.getElementById("predictBtn").addEventListener("click", runPrediction);
document.getElementById("loadApiBtn").addEventListener("click", loadNationalFixtures);
document.getElementById("loadOddsBtn").addEventListener("click", fetchOddsForCurrentFixture);
output.fixtureSelect.addEventListener("change", async (event) => {
  const index = Number(event.target.value);
  if (Number.isFinite(index)) {
    try {
      await applyFixture(index);
    } catch (error) {
      setApiStatus(`Failed to apply fixture: ${error.message}`);
    }
  }
});

runPrediction();
refreshMatchHistory();
