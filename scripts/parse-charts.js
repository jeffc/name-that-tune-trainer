import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const BILLBOARD_ALL_URL =
  "https://raw.githubusercontent.com/mhollingshead/billboard-hot-100/main/all.json";
const OUTPUT_DIR = path.join(__dirname, "../database");
const OUTPUT_FILE = path.join(OUTPUT_DIR, "billboard_songs.json");

// Define default popularity criteria for filtering
const PEAK_LIMIT = 20;
const WEEKS_LIMIT = 16;

function getSongKey(title, artist) {
  const normTitle = title.toLowerCase().replace(/[^a-z0-9]/g, "");
  const normArtist = artist.toLowerCase().replace(/[^a-z0-9]/g, "");
  return `${normTitle}|${normArtist}`;
}

function getFirstLetter(text) {
  if (!text) return "";
  let clean = text.trim().toLowerCase();
  clean = clean.replace(/^[^a-z0-9]+/, "");
  clean = clean.replace(/^(the|a|an)\s+/, "");
  const match = clean.match(/[a-z0-9]/);
  return match ? match[0].toUpperCase() : "";
}

function isValidA2Z(text) {
  const first = getFirstLetter(text);
  return /^[A-Z]$/.test(first);
}

async function run() {
  console.log(
    `Fetching all Billboard Hot 100 history from: ${BILLBOARD_ALL_URL}...`,
  );

  try {
    const response = await fetch(BILLBOARD_ALL_URL);
    if (!response.ok) {
      throw new Error(`Failed to fetch Billboard data: ${response.statusText}`);
    }

    console.log("Download completed. Parsing JSON...");
    const allCharts = await response.json();

    const songMap = new Map();
    let latestChartDate = "";

    // Normalize processing depending on whether all.json is an array or object
    let chartsIterable = [];
    if (Array.isArray(allCharts)) {
      chartsIterable = allCharts;
    } else {
      chartsIterable = Object.entries(allCharts).map(([date, data]) => ({
        date,
        data,
      }));
    }

    console.log(`Processing ${chartsIterable.length} weeks of charts...`);

    for (const chart of chartsIterable) {
      const { date, data } = chart;
      if (!date || !Array.isArray(data)) continue;

      if (date > latestChartDate) {
        latestChartDate = date;
      }

      for (const entry of data) {
        const title = entry.song || entry.title;
        const artist = entry.artist;
        if (!title || !artist) continue;

        // Skip songs where the first letter of normalized title OR artist is not A-Z
        if (!isValidA2Z(title) || !isValidA2Z(artist)) continue;

        const peakPosition =
          entry.peak_position !== undefined
            ? parseInt(entry.peak_position, 10)
            : parseInt(entry.this_week, 10);
        const weeksOnChart =
          entry.weeks_on_chart !== undefined
            ? parseInt(entry.weeks_on_chart, 10)
            : 1;

        const key = getSongKey(title, artist);
        const existing = songMap.get(key);

        if (existing) {
          existing.peak_position = Math.min(
            existing.peak_position,
            peakPosition,
          );
          existing.weeks_on_chart = Math.max(
            existing.weeks_on_chart,
            weeksOnChart,
          );
          if (date > existing.last_chart_date) {
            existing.last_chart_date = date;
          }
        } else {
          songMap.set(key, {
            title,
            artist,
            peak_position: peakPosition,
            weeks_on_chart: weeksOnChart,
            last_chart_date: date,
          });
        }
      }
    }

    console.log(`Found ${songMap.size} unique songs in total Hot 100 history.`);

    // Filter by criteria
    const filteredSongs = [];
    for (const song of songMap.values()) {
      if (
        song.peak_position <= PEAK_LIMIT ||
        song.weeks_on_chart >= WEEKS_LIMIT
      ) {
        filteredSongs.push(song);
      }
    }

    // Sort by last chart date descending
    filteredSongs.sort((a, b) =>
      b.last_chart_date.localeCompare(a.last_chart_date),
    );

    // Ensure output directory exists
    if (!fs.existsSync(OUTPUT_DIR)) {
      fs.mkdirSync(OUTPUT_DIR, { recursive: true });
    }

    const outputData = {
      metadata: {
        lastUpdatedChartDate: latestChartDate,
        filterCriteria: {
          peak_position_lte: PEAK_LIMIT,
          weeks_on_chart_gte: WEEKS_LIMIT,
        },
        totalSongs: filteredSongs.length,
      },
      songs: filteredSongs,
    };

    fs.writeFileSync(OUTPUT_FILE, JSON.stringify(outputData, null, 2), "utf-8");
    console.log(
      `Successfully wrote ${filteredSongs.length} popular songs to ${OUTPUT_FILE}`,
    );
    console.log(`Latest processed chart date: ${latestChartDate}`);
  } catch (error) {
    console.error("Error running parse-charts script:", error);
    process.exit(1);
  }
}

run();
