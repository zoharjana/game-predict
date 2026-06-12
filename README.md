# Game Prediction Page (React)

A React + Vite match prediction interface with live national-team fixtures, market odds support, and history blocks.

## Features

- Team-vs-team prediction inputs and model probabilities
- Expected result scoreline from all tracked stats
- Real fixture loading for national teams via TheSportsDB
- Optional real bookmaker odds via The Odds API
- Last games and head-to-head section
- Responsive layout for desktop and mobile

## Tech Stack

- React 18
- Vite 5
- GitHub Pages (via GitHub Actions)

## Local Development

Install dependencies:

npm install

Run locally on port 5173:

npm run dev

Production build test:

npm run build

Preview production build:

npm run preview

## Project Structure

- src/main.jsx: React entry point
- src/App.jsx: App logic and UI
- src/styles.css: App styling
- vite.config.js: GitHub Pages base path config
- .github/workflows/deploy-pages.yml: Pages deployment workflow

## APIs

Current fixture/history source:

- TheSportsDB public API

Optional market odds source:

- The Odds API (requires key)

## GitHub Pages URL

This repository is configured for:

https://zoharjana.github.io/game-predict/
