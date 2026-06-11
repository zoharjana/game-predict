# Game Prediction Page

A bold, single-page match prediction interface built with vanilla HTML, CSS, and JavaScript.

## Features

- Team-vs-team prediction input
- Real fixture loading for national teams via TheSportsDB
- Real bookmaker odds loading via The Odds API
- Win/Draw/Win probability bars
- Confidence and risk indicators
- Expected goals estimate
- Key-driver insights
- Responsive layout for desktop and mobile

## Run locally

Open `index.html` directly in your browser, or use a lightweight local server.

Example with Python:

```bash
python -m http.server 5173
```

Then open `http://localhost:5173`.

## Files

- `index.html` - page structure
- `styles.css` - visual design and responsive behavior
- `script.js` - prediction model and UI updates

## Notes

The prediction model is heuristic-based (not ML-trained) and meant as a practical starting point you can tune with your own weighting logic or API data.

## Real API Usage (National Teams)

1. Enter a national team name in the `National Team` field (examples: France, Argentina, Japan).
2. Click `Load Real Fixture`.
3. Pick an upcoming fixture from the dropdown.
4. The app auto-fills both teams and recent form/goals, then runs prediction.

Current source in this project:

- TheSportsDB public API (`searchteams`, `eventsnext`, `eventslast` endpoints)

Other strong APIs for production use:

- API-Football (RapidAPI): broad coverage and good fixture depth for international competitions
- football-data.org: official-style competition data with national team tournaments
- Sportmonks Football API: detailed paid tier with deep historical and odds integrations

## Real Betting Odds Setup

This project now fetches live `1X2` betting odds from bookmakers using The Odds API.

1. Get an API key from `https://the-odds-api.com`.
2. Load a real fixture in the app.
3. Paste your key into `The Odds API Key`.
4. Click `Load Betting Odds`.

The app will show:

- Home / Draw / Away market odds (decimal)
- Which bookmaker provided the displayed market

Security note:

- In this static demo, the API key is used in-browser.
- For private production usage, move odds calls to a backend proxy so the key is not exposed client-side.
