# Name That Tune Trainer - System Design Document

This document outlines the proposed design and architecture for the **Name That Tune Trainer** application.

---

## 1. Technical Stack & Architecture

We propose a **Client-Side Single Page Application (SPA)** built with:
*   **Frontend Framework**: React (via Vite + TypeScript) for robust component-based UI and reactive state management.
*   **Styling**: Modern Vanilla CSS with CSS Variables for themes, flexbox/grid for layouts, and glassmorphic designs with smooth transitions.
*   **State Management**: React Context / Hooks for managing trivia round states, history logs, and user settings.
*   **Storage**: `localStorage` to persist custom settings, custom song lists, and high scores/history across sessions.
*   **Deployment**: Can be built as static HTML/CSS/JS files and served from GitHub Pages, Vercel, Netlify, or run locally without any backend server.

```mermaid
graph TD
    A[Browser Client] --> B(React UI State)
    B --> C[Setup Screen]
    B --> D[Gameplay Screen]
    B --> E[Review Screen]
    B --> F[Audio Engine]
    B --> G[Local Storage]
    F -->|No-auth Previews| H[iTunes Search API]
    F -->|Authenticated Full Tracks| I[Spotify Web SDK / Web API]
```

---

## 2. Playback Options: iTunes vs. Spotify

A core technical challenge is playing copyrighted music without a dedicated backend server. We have evaluated two major approaches:

| Feature | iTunes Search API (Recommended) | Spotify Web API & SDK |
| :--- | :--- | :--- |
| **Authentication** | **None** (Public endpoints) | Developer API Key, OAuth User Login |
| **Cost / Access** | **Free** for all users | Requires **Spotify Premium** account |
| **Playback Content**| 30-second audio previews (AAC format) | Full-length songs |
| **Browser Support**| Native `<audio>` element (extremely fast) | Spotify Web Playback SDK (needs integration) |
| **Artwork/Metadata**| High-resolution cover art included | High-resolution cover art included |
| **Setup Overhead** | **Zero** setup | High overhead (requires redirects, tokens) |

### Recommendation: iTunes Search API
For a trivia trainer, the **first 10–30 seconds** of a song are all that is needed. Using the iTunes Search API allows the application to remain a zero-dependency, serverless client-side app that anyone can open and use immediately. We can query the API dynamically during gameplay using the song's title and artist to obtain the preview URL and cover art.

---

## 3. Answer Matching Engine (The First-Letter Rule)

The core mechanic of "Name That Tune" trivia requires teams to submit the **first letter** of the requested answer (Artist or Title), skipping articles ("a", "an", "the").

### Normalization Algorithm
When comparing user input to the correct answer, the matching engine will:
1.  Convert the string to lowercase.
2.  Strip leading whitespace and special characters (e.g., `"..."`, `"`", `(`).
3.  Remove leading articles: `^a\s+`, `^an\s+`, `^the\s+`.
4.  Extract the first remaining alphanumeric character.

**Examples:**
*   `"The Beatles"` $\rightarrow$ `"beatles"` $\rightarrow$ **B**
*   `"A Hard Day's Night"` $\rightarrow$ `"hard day's night"` $\rightarrow$ **H**
*   `"...Baby One More Time"` $\rightarrow$ `"baby one more time"` $\rightarrow$ **B**
*   `"An Old Fashioned Love Song"` $\rightarrow$ `"old fashioned love song"` $\rightarrow$ **O**

---

## 4. Song Database Strategy

Since no external server is required, we need a reliable way to generate and update the song database without external LLM dependencies.

### 1. Three-Tier Database Architecture

To enable offline testing of parsing, deduplication, and popularity filtering without triggering any external iTunes Search API requests, we will implement a three-tier database pipeline:

```mermaid
graph TD
    A[Billboard Charts Repo] -->|scripts/parse-charts.js| B[(database/billboard_songs.json)]
    B -->|scripts/enrich-database.js| C[(database/raw_songs.json)]
    C -->|scripts/condense-database.js| D[(src/data/songs_condensed.json)]
    D -->|Bundled| E[Client Browser]
    
    F[Browser Sync Engine] -->|Fast-Forward Sync & iTunes| G[Local Storage Cache]
    E --> H[Active Game Pool]
    G --> H
```

#### Tier A: Raw Billboard Songs List (`database/billboard_songs.json`)
*   **Purpose**: A checked-in list of *every* unique song that has charted on the Billboard Hot 100, alongside its lifetime cumulative peak position and weeks on chart. Contains **zero API metadata**.
*   **Benefits**: Allows debugging parser boundaries, deduplication logic, and popularity thresholds entirely offline in milliseconds without hitting rate limits.
*   **Structure**:
    ```json
    {
      "metadata": {
        "lastUpdatedChartDate": "2026-06-20"
      },
      "songs": [
        {
          "title": "Billie Jean",
          "artist": "Michael Jackson",
          "peak_position": 1,
          "weeks_on_chart": 24
        }
      ]
    }
    ```

#### Tier B: Raw Enriched Database (`database/raw_songs.json`)
*   **Purpose**: The checked-in, complete database containing the raw iTunes API lookup responses for songs. We only run API queries for songs that are new to this layer.
*   **Structure**:
    ```json
    {
      "songs": [
        {
          "title": "Billie Jean",
          "artist": "Michael Jackson",
          "peak_position": 1,
          "weeks_on_chart": 24,
          "itunes": {
            "trackId": 268896500,
            "primaryGenreName": "Pop",
            "releaseDate": "1982-11-30T00:00:00Z",
            "previewUrl": "https://audio-ssl.itunes.apple.com/...aac.p.m4a",
            "artworkUrl100": "https://is1-ssl.mzstatic.com/...100x100bb.jpg"
          }
        }
      ]
    }
    ```

#### Tier C: Condensed Client Database (`src/data/songs_condensed.json`)
*   **Purpose**: The lightweight, bundled file served to the client browser, containing only essential properties.
*   **Structure**:
    ```json
    {
      "metadata": {
        "lastUpdatedChartDate": "2026-06-20"
      },
      "songs": [
        {
          "title": "Billie Jean",
          "artist": "Michael Jackson",
          "decade": "1980s",
          "genres": ["Pop"],
          "previewUrl": "https://audio-ssl.itunes.apple.com/...aac.p.m4a",
          "artworkUrl": "https://is1-ssl.mzstatic.com/...100x100bb.jpg"
        }
      ]
    }
    ```

---

## 2. Database Scripts

#### A. Chart Parser (`scripts/parse-charts.js`)
*   **Input**: Downloads/scrapes the raw weekly Billboard JSON chart files from the GitHub archive dataset.
*   **Output**: Deduplicates the song list and outputs the updated `database/billboard_songs.json`.
*   **Behavior**: Zero API requests. Safe to run, modify, and inspect repeatedly during development.

#### B. Database Enricher (`scripts/enrich-database.js`)
*   **Input**: Reads `database/billboard_songs.json` and `database/raw_songs.json`.
*   **Behavior**:
    1.  Compares the two files and isolates any songs that exist in the Billboard list but lack iTunes metadata in `raw_songs.json`.
    2.  For these new songs, it queries the iTunes Search API (throttled to 2,000 queries/hour) to fetch full track metadata.
    3.  Appends the results to `database/raw_songs.json` and saves it.
*   **Benefit**: Saves money and rate-limit allocations by never querying songs we have already resolved.

#### C. Database Condenser (`scripts/condense-database.js`)
*   **Input**: Reads `database/raw_songs.json`.
*   **Behavior**:
    1.  Filters songs based on the current active popularity filters (e.g. `peak_position <= 20` or `weeks_on_chart >= 16`).
    2.  Condenses the payload by extracting only key fields (`title`, `artist`, `decade`, `genres`, `previewUrl`, `artworkUrl`).
    3.  Writes the outcome to `src/data/songs_condensed.json` for the client build.

---

## 3. Browser Client Runtime "Fast-Forward" (Serverless Sync)
When a user opens the application, it syncs the condensed database with new weekly charts:
1.  **State Check**: Reads `lastUpdatedChartDate` from the client's `songs_condensed.json` and loads `localStorage.cached_dynamic_songs`.
2.  **Date Comparison**: Fetches `valid_dates.json` from the Billboard dataset repo.
3.  **Process Updates**: For any weeks newer than the static database:
    *   Downloads the missing weekly JSON chart files.
    *   Filters songs using the active popularity criteria.
    *   Deduplicates them against the static database and `localStorage`.
4.  **Fetch & Cache**: Queries the iTunes Search API for these new songs, maps them to the **condensed** format, and caches them in `localStorage.cached_dynamic_songs`.
5.  **Merge Pool**: Combines static condensed songs with cached updates during gameplay.

*   **Result**: Development and testing are 100% safe, fast, and local, while the client application remains extremely lightweight.

> [!NOTE]
> **Handling Boundary-Spanning Songs**:
> Because the weekly Billboard Hot 100 JSON files store *cumulative* statistics for each song (meaning every entry includes the song's lifetime `peak_position` and lifetime `weeks_on_chart` up to that date), the sync engine does not need to download historical weekly files to evaluate songs whose chart runs span across the pre-processed and new data.
>
> If a song starts charting before the built-in database was compiled (e.g., week 10) and continues afterward, the new weekly files downloaded by the browser will list the song with its cumulative weeks (e.g., week 11, 12, etc.). The moment it meets the popularity threshold, the sync engine detects it, finds it missing from the built-in list, and enriches/caches it.

---

## 5. UI/UX Design & Screens

We aim for a sleek, premium, dark-mode-first aesthetic with fluid micro-animations.

```mermaid
journey
    title User Gameplay Journey
    section Game Setup
      Configure round: Easy
      Select decades: 80s & 90s: Easy
      Select genres: Rock & Pop: Easy
    section Active Round
      System prompts "Guess the ARTIST": Easy
      Song begins playing: Easy
      User presses physical key or UI button: Easy
      Reveal answer, cover art, play/pause controls: Easy
      Next song: Easy
    section Review
      Show final score: Easy
      Show round log table: Easy
      Option to replay or change settings: Easy
```

### 1. Setup Screen
*   **Decades Selector**: Multiselect buttons (60s, 70s, 80s, 90s, 00s, 10s, 20s).
*   **Genres Selector**: Multiselect chips (Pop, Rock, Hip Hop, Country, Electronic, R&B, etc.).
*   **Prompt Filter**: Guess Title, Guess Artist, or Alternate.
*   **Round Length**: Slider/inputs (10, 20, 50, Custom).
*   **Start Button**: Pulse animation.

### 2. Gameplay Screen
*   **Header**: Progress bar (e.g., "Song 4 of 10"), Current Score (e.g., "Score: 3/3").
*   **Central Card**: Glassmorphism panel displaying:
    *   Prompt: `"GUESS THE ARTIST"` or `"GUESS THE SONG TITLE"` (large, pulsing text).
    *   Visualizer: A subtle, looping CSS wave animation that pulses while music is playing.
*   **Input Interface**:
    *   A-Z grid of circular buttons for tap/click interfaces.
    *   Physical keyboard listener (pressing a key immediately registers it).
*   **Feedback Overlay (Post-Answer)**:
    *   Correct/Incorrect banner (Green/Red glow).
    *   Song Reveal: Large album artwork, Song Title, and Artist name.
    *   Audio Playback Controls: Standard play/pause and scrub bar for the preview.
    *   "Next Song" button.

### 3. Review Screen
*   **Summary Stats**: Circular score ring (e.g., "80% Correct"), average reaction speed.
*   **History Table**: A clean table showing:
    *   Artwork preview.
    *   Song & Artist.
    *   Guess Type (Title vs Artist).
    *   User's Guess (e.g., **M**) vs Correct Answer (e.g., **M** - Michael Jackson).
    *   Status Icon (Check/Cross).
    *   Mini play button to re-listen.
*   **Call-to-Actions**: "Play Again" (same settings) or "Back to Setup".
