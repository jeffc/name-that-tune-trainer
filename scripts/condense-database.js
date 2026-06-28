import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const RAW_FILE = path.join(__dirname, '../database/raw_songs.json');
const CONDENSED_FILE = path.join(__dirname, '../src/data/songs_condensed.json');

// Default target popularity criteria for the client database
// (Can be tighter than parse-charts.js, but must be within the subset)
const TARGET_PEAK_LIMIT = 20;
const TARGET_WEEKS_LIMIT = 16;

function getDecade(releaseDateStr, lastChartDateStr) {
  // Try to parse the year from iTunes releaseDate first
  if (releaseDateStr) {
    const match = releaseDateStr.match(/^(\d{4})/);
    if (match) {
      const year = parseInt(match[1], 10);
      const decadeStart = Math.floor(year / 10) * 10;
      return `${decadeStart}s`;
    }
  }
  // Fallback to the Billboard chart date year
  if (lastChartDateStr) {
    const match = lastChartDateStr.match(/^(\d{4})/);
    if (match) {
      const year = parseInt(match[1], 10);
      const decadeStart = Math.floor(year / 10) * 10;
      return `${decadeStart}s`;
    }
  }
  return 'Unknown';
}

function run() {
  console.log(`Loading raw database from: ${RAW_FILE}...`);

  if (!fs.existsSync(RAW_FILE)) {
    console.error(`Error: ${RAW_FILE} does not exist. Run enrich-database.js first.`);
    process.exit(1);
  }

  try {
    const rawData = JSON.parse(fs.readFileSync(RAW_FILE, 'utf-8'));
    const rawSongs = rawData.songs || [];
    
    console.log(`Loaded ${rawSongs.length} raw songs. Applying client filters and condensing...`);

    const condensedSongs = [];
    let excludedNoItunes = 0;
    let excludedFilter = 0;

    for (const song of rawSongs) {
      // 1. Exclude songs that failed iTunes lookup (they have no previewUrl)
      if (!song.itunes || !song.itunes.previewUrl) {
        excludedNoItunes++;
        continue;
      }

      // 2. Apply target popularity filters (in case we want to restrict the client database further)
      if (song.peak_position > TARGET_PEAK_LIMIT && song.weeks_on_chart < TARGET_WEEKS_LIMIT) {
        excludedFilter++;
        continue;
      }

      // 3. Map to condensed structure
      const decade = getDecade(song.itunes.releaseDate, song.last_chart_date);
      const genres = song.itunes.primaryGenreName ? [song.itunes.primaryGenreName] : [];

      condensedSongs.push({
        title: song.title,
        artist: song.artist,
        decade: decade,
        genres: genres,
        previewUrl: song.itunes.previewUrl,
        artworkUrl: song.itunes.artworkUrl100
      });
    }

    // Ensure target output directory exists
    const outputDir = path.dirname(CONDENSED_FILE);
    if (!fs.existsSync(outputDir)) {
      fs.mkdirSync(outputDir, { recursive: true });
    }

    const outputData = {
      metadata: {
        lastUpdatedChartDate: rawData.metadata ? rawData.metadata.lastUpdatedChartDate : 'Unknown',
        filterCriteria: {
          peak_position_lte: TARGET_PEAK_LIMIT,
          weeks_on_chart_gte: TARGET_WEEKS_LIMIT
        },
        totalSongs: condensedSongs.length
      },
      songs: condensedSongs
    };

    fs.writeFileSync(CONDENSED_FILE, JSON.stringify(outputData, null, 2), 'utf-8');
    
    console.log('\n--- CONDENSATION COMPLETE ---');
    console.log(`Total raw songs processed: ${rawSongs.length}`);
    console.log(`Excluded (no iTunes match): ${excludedNoItunes}`);
    console.log(`Excluded (did not meet final filters): ${excludedFilter}`);
    console.log(`Successfully generated condensed client database: ${condensedSongs.length} songs`);
    console.log(`Output saved to: ${CONDENSED_FILE}`);

  } catch (error) {
    console.error('Error running condense-database script:', error);
    process.exit(1);
  }
}

run();
