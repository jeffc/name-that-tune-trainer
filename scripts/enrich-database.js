import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const BILLBOARD_FILE = path.join(__dirname, '../database/billboard_songs.json');
const RAW_FILE = path.join(__dirname, '../database/raw_songs.json');

function getSongKey(title, artist) {
  const normTitle = title.toLowerCase().replace(/[^a-z0-9]/g, '');
  const normArtist = artist.toLowerCase().replace(/[^a-z0-9]/g, '');
  return `${normTitle}|${normArtist}`;
}

async function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function run() {
  // Parse command line arguments
  const args = process.argv.slice(2);
  const limitIndex = args.indexOf('--limit');
  const dryRun = args.includes('--dry-run');
  let limit = 20; // Default safe limit for testing
  
  if (limitIndex !== -1 && args[limitIndex + 1]) {
    limit = parseInt(args[limitIndex + 1], 10);
  }
  
  if (args.includes('--all')) {
    limit = Infinity;
    console.log('WARNING: Running in --all mode. This will query all missing songs. Rate limiting will apply.');
  }

  // Check if billboard_songs.json exists
  if (!fs.existsSync(BILLBOARD_FILE)) {
    console.error(`Error: ${BILLBOARD_FILE} does not exist. Run parse-charts.js first.`);
    process.exit(1);
  }

  const billboardData = JSON.parse(fs.readFileSync(BILLBOARD_FILE, 'utf-8'));
  const candidateSongs = billboardData.songs || [];
  
  // Load existing raw_songs.json if it exists
  let rawData = { songs: [] };
  if (fs.existsSync(RAW_FILE)) {
    try {
      rawData = JSON.parse(fs.readFileSync(RAW_FILE, 'utf-8'));
      if (!Array.isArray(rawData.songs)) {
        rawData.songs = [];
      }
    } catch (e) {
      console.warn('Warning: Could not parse existing raw_songs.json, starting fresh.', e);
    }
  }

  // Map already processed songs (either found or not found)
  const processedKeys = new Set(rawData.songs.map(s => getSongKey(s.title, s.artist)));
  
  // Find songs that need enrichment
  const missingSongs = candidateSongs.filter(s => !processedKeys.has(getSongKey(s.title, s.artist)));
  
  console.log(`Total popular songs in Billboard index: ${candidateSongs.length}`);
  console.log(`Already processed songs in raw database: ${processedKeys.size}`);
  console.log(`Songs needing enrichment: ${missingSongs.length}`);

  if (missingSongs.length === 0) {
    console.log('No new songs need enrichment.');
    process.exit(0);
  }

  const targetCount = Math.min(limit, missingSongs.length);

  if (dryRun) {
    const ESTIMATED_MS_PER_QUERY = 2000; // 1800ms sleep + ~200ms network latency
    const targetTimeMs = targetCount * ESTIMATED_MS_PER_QUERY;
    const remainingTimeMs = missingSongs.length * ESTIMATED_MS_PER_QUERY;

    const formatDuration = (ms) => {
      const hours = Math.floor(ms / 3600000);
      const mins = Math.floor((ms % 3600000) / 60000);
      const secs = Math.floor((ms % 60000) / 1000);
      const parts = [];
      if (hours > 0) parts.push(`${hours}h`);
      if (mins > 0) parts.push(`${mins}m`);
      if (secs > 0 || parts.length === 0) parts.push(`${secs}s`);
      return parts.join(' ');
    };

    console.log('\n--- DRY RUN MODE ---');
    console.log(`Current batch limit: ${limit === Infinity ? 'All remaining' : limit}`);
    console.log(`Songs to enrich in this run: ${targetCount}`);
    console.log(`Estimated time for this run: ~${formatDuration(targetTimeMs)}`);
    console.log(`Estimated time to enrich ALL remaining songs: ~${formatDuration(remainingTimeMs)}`);
    console.log('No API calls were made. Run without "--dry-run" to fetch.');
    process.exit(0);
  }

  console.log(`Starting enrichment for ${targetCount} songs...`);

  let successCount = 0;
  let notFoundCount = 0;
  const startTime = Date.now();

  // Helper to save database incrementally
  const saveDatabase = () => {
    try {
      rawData.metadata = {
        lastUpdatedChartDate: billboardData.metadata.lastUpdatedChartDate,
        totalSongs: rawData.songs.length
      };
      fs.writeFileSync(RAW_FILE, JSON.stringify(rawData, null, 2), 'utf-8');
    } catch (err) {
      console.error('Error writing raw_songs.json incrementally:', err.message);
    }
  };

  for (let i = 0; i < targetCount; i++) {
    const song = missingSongs[i];
    const query = `${song.title} ${song.artist}`;
    const url = `https://itunes.apple.com/search?term=${encodeURIComponent(query)}&entity=song&limit=1`;
    
    // Calculate progress and estimated time remaining
    const progress = (((i) / targetCount) * 100).toFixed(1);
    let etaString = 'calculating...';
    if (i > 0) {
      const elapsed = Date.now() - startTime;
      const avgTimePerQuery = elapsed / i;
      const remaining = targetCount - i;
      const estTimeMs = remaining * avgTimePerQuery;
      const estMin = Math.floor(estTimeMs / 60000);
      const estSec = Math.floor((estTimeMs % 60000) / 1000);
      etaString = estMin > 0 ? `${estMin}m ${estSec}s` : `${estSec}s`;
    }

    console.log(`[${i + 1}/${targetCount}] (${progress}%) ETA: ${etaString} | Searching: "${song.title}" by ${song.artist}...`);

    try {
      let attempts = 0;
      let result = null;
      
      while (attempts < 3) {
        try {
          const response = await fetch(url);
          
          if (response.status === 403 || response.status === 429) {
            console.warn(`\n[WARNING] Rate limit encountered (HTTP ${response.status}). Pausing execution for 35 seconds to back off...`);
            await sleep(35000);
            attempts++;
            continue;
          }
          
          if (!response.ok) {
            throw new Error(`HTTP error ${response.status}`);
          }
          
          result = await response.json();
          break; // success
        } catch (fetchErr) {
          attempts++;
          if (attempts >= 3) {
            throw fetchErr;
          }
          console.warn(`   -> Retry attempt ${attempts} due to error: ${fetchErr.message}. Waiting 5 seconds...`);
          await sleep(5000);
        }
      }
      
      if (result && result.results && result.results.length > 0) {
        const itunes = result.results[0];
        
        rawData.songs.push({
          title: song.title,
          artist: song.artist,
          peak_position: song.peak_position,
          weeks_on_chart: song.weeks_on_chart,
          last_chart_date: song.last_chart_date,
          itunes: {
            trackId: itunes.trackId,
            primaryGenreName: itunes.primaryGenreName,
            releaseDate: itunes.releaseDate,
            previewUrl: itunes.previewUrl,
            artworkUrl100: itunes.artworkUrl100
          }
        });
        successCount++;
      } else {
        console.log(`   -> NOT FOUND in iTunes.`);
        rawData.songs.push({
          title: song.title,
          artist: song.artist,
          peak_position: song.peak_position,
          weeks_on_chart: song.weeks_on_chart,
          last_chart_date: song.last_chart_date,
          itunes: null,
          notFound: true
        });
        notFoundCount++;
      }
      
      // Save incrementally after each successful request to prevent data loss on interruption
      saveDatabase();
      
    } catch (err) {
      console.error(`   -> Failed to enrich "${query}":`, err.message);
      // Wait longer on critical failure
      await sleep(3000);
    }
    
    // Add delay between requests to remain safely under the rate limit (~1,800/hour cap)
    await sleep(1800);
  }

  console.log(`\nEnrichment round completed.`);
  console.log(`Saved ${successCount} new matches and marked ${notFoundCount} as not found.`);
  console.log(`Total database now stands at ${rawData.songs.length} entries.`);
}

run();
