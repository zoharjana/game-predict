const API_BASE = "https://www.thesportsdb.com/api/v1/json";
const API_KEY = process.env.SPORTSDB_API_KEY || "3";
const REQUEST_TIMEOUT_MS = 15000;
const SPORTS_MODE_TODAY = "today";
const SPORTS_MODE_LIVE = "live";

function getTodayLocalIsoDate() {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function toIsoDate(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function getNearbyDates() {
  const now = new Date();
  const oneDayMs = 24 * 60 * 60 * 1000;
  return [
    toIsoDate(new Date(now.getTime() - oneDayMs)),
    toIsoDate(now),
    toIsoDate(new Date(now.getTime() + oneDayMs))
  ];
}

function formatKickoff(event) {
  if (event.strTime) {
    return event.strTime;
  }

  if (event.strTimestamp) {
    const date = new Date(event.strTimestamp);
    if (!Number.isNaN(date.getTime())) {
      return date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", hour12: false });
    }
  }

  return "TBD";
}

function toNumberOrNull(value) {
  if (value === null || value === undefined || value === "") {
    return null;
  }

  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function normalizeLeague(event) {
  return event.strLeague || event.strLeagueAlternate || "Unknown League";
}

async function fetchJson(pathWithQuery) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    const url = `${API_BASE}/${API_KEY}/${pathWithQuery}`;
    const response = await fetch(url, { signal: controller.signal });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status} from ${url}`);
    }

    const body = await response.json();
    return body;
  } finally {
    clearTimeout(timeoutId);
  }
}

async function getSportsList() {
  const configuredSports = process.env.SPORTS_LIST;
  if (configuredSports) {
    return configuredSports
      .split(",")
      .map((sport) => sport.trim())
      .filter(Boolean);
  }

  return ["Soccer"];
}

async function getEventsForSport(date, sport) {
  const query = `eventsday.php?d=${encodeURIComponent(date)}&s=${encodeURIComponent(sport)}`;
  const data = await fetchJson(query);
  const events = Array.isArray(data?.events) ? data.events : [];

  return events.map((event) => ({
    sport,
    league: normalizeLeague(event),
    kickoff: formatKickoff(event),
    timestamp: event.strTimestamp || "",
    home: event.strHomeTeam || "Home",
    away: event.strAwayTeam || "Away",
    status: event.strStatus || "Scheduled",
    homeScore: toNumberOrNull(event.intHomeScore),
    awayScore: toNumberOrNull(event.intAwayScore)
  }));
}

async function getLiveEventsForSport(sport) {
  try {
    const query = `livescore.php?s=${encodeURIComponent(sport)}`;
    const data = await fetchJson(query);
    const events = Array.isArray(data?.events) ? data.events : [];

    return events.map((event) => ({
      sport,
      league: normalizeLeague(event),
      kickoff: formatKickoff(event),
      timestamp: event.strTimestamp || "",
      home: event.strHomeTeam || "Home",
      away: event.strAwayTeam || "Away",
      status: event.strStatus || "LIVE",
      homeScore: toNumberOrNull(event.intHomeScore),
      awayScore: toNumberOrNull(event.intAwayScore)
    }));
  } catch (_error) {
    const dates = getNearbyDates();
    const collected = [];
    for (const date of dates) {
      const events = await getEventsForSport(date, sport);
      for (const event of events) {
        collected.push(event);
      }
    }

    const liveStatuses = new Set(["1H", "HT", "2H", "ET", "BT", "P", "SUSP", "LIVE"]);

    return collected.filter((event) => {
      const status = String(event.status || "").toUpperCase().trim();
      if (!status) {
        return false;
      }

      if (liveStatuses.has(status)) {
        return true;
      }

      return /^\d{1,3}(\+\d+)?'$/.test(status);
    });
  }
}

function buildScoreLabel(match) {
  if (match.homeScore === null || match.awayScore === null) {
    return "-:-";
  }

  return `${match.homeScore}-${match.awayScore}`;
}

function buildMinuteLabel(match) {
  const status = String(match.status || "").toUpperCase().trim();
  if (!status) {
    return "--";
  }

  if (/^\d{1,3}(\+\d+)?'$/.test(status)) {
    return status;
  }

  if (status !== "1H" && status !== "2H" && status !== "ET") {
    return status;
  }

  const kickoff = new Date(match.timestamp || "");
  if (Number.isNaN(kickoff.getTime())) {
    return status;
  }

  const elapsed = Math.max(0, Math.floor((Date.now() - kickoff.getTime()) / 60000));
  if (!Number.isFinite(elapsed)) {
    return status;
  }

  if (elapsed > 130) {
    return status;
  }

  return `${elapsed}' (${status})`;
}

function groupEventsByLeague(events) {
  const eventsByLeague = new Map();

  for (const event of events) {
    const key = `${event.sport} | ${event.league}`;
    if (!eventsByLeague.has(key)) {
      eventsByLeague.set(key, []);
    }
    eventsByLeague.get(key).push(event);
  }

  return eventsByLeague;
}

function printResults(date, eventsByLeague, mode) {
  const leagues = Array.from(eventsByLeague.keys()).sort((a, b) => a.localeCompare(b));
  const totalGames = Array.from(eventsByLeague.values()).reduce((sum, games) => sum + games.length, 0);

  console.log(`Date: ${date}`);
  console.log(`Leagues: ${leagues.length}`);
  console.log(`Games: ${totalGames}`);
  console.log("-");

  for (const leagueKey of leagues) {
    console.log(`\n${leagueKey}`);
    const matches = eventsByLeague.get(leagueKey) || [];

    for (const match of matches) {
      if (mode === SPORTS_MODE_LIVE) {
        const score = buildScoreLabel(match);
        const minute = buildMinuteLabel(match);
        console.log(`  ${minute} | ${match.home} ${score} ${match.away} | ${match.status}`);
      } else {
        console.log(`  ${match.kickoff} | ${match.home} vs ${match.away} | ${match.status}`);
      }
    }
  }

  if (leagues.length === 0) {
    console.log("No games found for the selected date.");
  }
}

async function main() {
  const mode = String(process.env.SPORTS_MODE || SPORTS_MODE_TODAY).toLowerCase();
  const date = process.env.SPORTS_DATE || getTodayLocalIsoDate();

  console.log("Fetching sports list...");
  const sports = await getSportsList();

  if (sports.length === 0) {
    console.log("No sports were returned by the API.");
    return;
  }

  const maxSports = Number(process.env.MAX_SPORTS || 0);
  const selectedSports = Number.isFinite(maxSports) && maxSports > 0 ? sports.slice(0, maxSports) : sports;

  if (mode === SPORTS_MODE_LIVE) {
    console.log(`Checking live games for ${selectedSports.length} sports...`);
  } else {
    console.log(`Checking ${selectedSports.length} sports for ${date}...`);
  }

  const allEvents = [];
  const failedSports = [];

  for (const sport of selectedSports) {
    try {
      const events =
        mode === SPORTS_MODE_LIVE ? await getLiveEventsForSport(sport) : await getEventsForSport(date, sport);

      if (events.length > 0) {
        allEvents.push(...events);
      }
    } catch (error) {
      failedSports.push({ sport, message: error instanceof Error ? error.message : String(error) });
    }
  }

  const eventsByLeague = groupEventsByLeague(allEvents);
  const resultDate = mode === SPORTS_MODE_LIVE ? "LIVE" : date;
  printResults(resultDate, eventsByLeague, mode);

  if (failedSports.length > 0) {
    console.log("\nSome sports failed to load:");
    for (const failure of failedSports) {
      console.log(`  ${failure.sport}: ${failure.message}`);
    }
  }
}

main().catch((error) => {
  console.error("Failed to fetch games.");
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
