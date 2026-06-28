# Name That Tune Trainer

A modern, serverless client-side web application designed to help users practice for "Name That Tune" trivia.

## Background & Trivia Rules

In "Name That Tune" trivia, the host prompts participants to guess either the **song title** or the **artist/band**.

- A song is played from the very beginning.
- Teams must enter the **first letter** of their answer (skipping articles like "a", "an", or "the").
- Once a guess is locked in, it cannot be changed.

This application acts as a personal trainer for this format, matching first-letter entries against normalized song metadata.

## Tech Stack

- **Frontend**: React (Vite + TypeScript)
- **Styling**: Pure CSS (Variables, Glassmorphism, Dark Theme)
- **APIs Used**:
  - [mhollingshead/billboard-hot-100](https://github.com/mhollingshead/billboard-hot-100) (Historical Hot 100 chart data)
  - iTunes Search/Lookup API (Public, no authentication preview playback and artwork extraction)

## Architecture & Database Pipeline

For a complete breakdown of the application architecture, database strategy (three-tier pipeline), answer matching rules, and UI design, please refer to the [System Design Document](DESIGN.md).

## Getting Started

_(Instructions to be updated as codebase is built out)_

1.  Install dependencies:
    ```bash
    npm install
    ```
2.  Run the development server:
    ```bash
    npm run dev
    ```

## Database Management Scripts

- `scripts/parse-charts.js`: Scrapes and compiles raw Billboard Hot 100 history.
- `scripts/enrich-database.js`: Fetches metadata from iTunes for any new songs.
- `scripts/condense-database.js`: Generates the lightweight client database.

## TODO & Roadmap

- [x] **Spotify Playback Mode Integration**: Integrated the Spotify Web Playback SDK / Connect API to support full-length audio tracks. This provides users with an option to toggle between iTunes 30-second audio previews (which can start midway through a track) and Spotify's full track streaming (which guarantees playback starting from the true beginning of the song).
- [ ] **External Spotify Device Control Mode**: Support a playback mode that redirects play, pause, and seek commands to an external active Spotify Connect device (such as a smart speaker, TV, desktop client, or phone app) via the Spotify Player API, rather than rendering audio locally inside the browser tab via the Web Playback SDK.
- [ ] **Automated Database Updates via GitHub Actions**: Configure a scheduled GitHub Action workflow (cron) that executes the unified `update-songs.js` pipeline weekly. The workflow would check for new Billboard chart outputs, scrape iTunes metadata for missing songs, rebuild the condensed database, and commit/push updates back to the repository automatically.
