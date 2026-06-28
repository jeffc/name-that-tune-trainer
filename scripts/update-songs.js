import { fork } from 'child_process';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PARSE_SCRIPT = path.join(__dirname, 'parse-charts.js');
const ENRICH_SCRIPT = path.join(__dirname, 'enrich-database.js');
const CONDENSE_SCRIPT = path.join(__dirname, 'condense-database.js');

function runScript(scriptPath, args = []) {
  return new Promise((resolve, reject) => {
    console.log(`\n==================================================`);
    console.log(`RUNNING: node ${path.basename(scriptPath)} ${args.join(' ')}`);
    console.log(`==================================================`);
    
    const child = fork(scriptPath, args, { stdio: 'inherit' });
    
    child.on('close', (code) => {
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(`Script ${path.basename(scriptPath)} exited with code ${code}`));
      }
    });
    
    child.on('error', (err) => {
      reject(err);
    });
  });
}

async function run() {
  const args = process.argv.slice(2);
  
  try {
    // 1. Scrape & parse charts (generates billboard_songs.json)
    await runScript(PARSE_SCRIPT);
    
    // 2. Fetch iTunes metadata for new tracks (updates raw_songs.json)
    await runScript(ENRICH_SCRIPT, args);
    
    // If running in --dry-run mode, we stop here since enrich-database exits.
    if (args.includes('--dry-run')) {
      console.log('\nDry run completed successfully.');
      return;
    }
    
    // 3. Condense data into client bundle assets (generates songs_condensed.json)
    await runScript(CONDENSE_SCRIPT);
    
    console.log('\n==================================================');
    console.log('SUCCESS: All steps completed successfully!');
    console.log('==================================================');
    
  } catch (error) {
    console.error(`\nFAILED: Song update pipeline aborted.`);
    console.error(error.message);
    process.exit(1);
  }
}

run();
