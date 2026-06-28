import { useState, useEffect, useRef } from "react";
import "./App.css";
import songsData from "./data/songs_condensed.json";

// Type definitions
interface Song {
  title: string;
  artist: string;
  decade: string;
  genres: string[];
  previewUrl: string;
  artworkUrl: string;
}

interface Guess {
  song: Song;
  guessType: "artist" | "title";
  guessLetter: string;
  correctLetter: string;
  isCorrect: boolean;
  timeTakenMs: number;
}

function getFirstLetter(text: string): string {
  if (!text) return "";
  let clean = text.trim().toLowerCase();

  // Remove leading special characters
  clean = clean.replace(/^[^a-z0-9]+/, "");

  // Strip leading articles
  clean = clean.replace(/^(the|a|an)\s+/, "");

  // Extract first remaining alphanumeric character
  const match = clean.match(/[a-z0-9]/);
  return match ? match[0].toUpperCase() : "";
}

function App() {
  // Database state
  const [dynamicSongs, setDynamicSongs] = useState<Song[]>([]);
  const [syncStatus, setSyncStatus] = useState<
    "idle" | "checking" | "syncing" | "completed" | "error"
  >("idle");
  const [syncMessage, setSyncMessage] = useState("Database updated");

  // Game configuration state
  const [selectedDecades, setSelectedDecades] = useState<string[]>([]);
  const [selectedGenres, setSelectedGenres] = useState<string[]>([]);
  const [promptType, setPromptType] = useState<
    "artist" | "title" | "alternate"
  >("alternate");
  const [roundLength, setRoundLength] = useState<number>(10);

  // Active game stage state
  const [gameStage, setGameStage] = useState<"setup" | "playing" | "review">(
    "setup",
  );
  const [roundSongs, setRoundSongs] = useState<Song[]>([]);
  const [currentSongIndex, setCurrentSongIndex] = useState<number>(0);
  const [guesses, setGuesses] = useState<Guess[]>([]);

  // Current question states
  const [currentGuessLetter, setCurrentGuessLetter] = useState<string>("");
  const [correctLetter, setCorrectLetter] = useState<string>("");
  const [isCurrentCorrect, setIsCurrentCorrect] = useState<boolean>(false);
  const [guessLocked, setGuessLocked] = useState<boolean>(false);
  const [currentGuessType, setCurrentGuessType] = useState<"artist" | "title">(
    "artist",
  );

  // Audio state
  const [audioPlaying, setAudioPlaying] = useState<boolean>(false);
  const [audioProgress, setAudioProgress] = useState<number>(0);
  const [audioDuration, setAudioDuration] = useState<number>(0);

  const audioRef = useRef<HTMLAudioElement | null>(null);
  const questionStartTimeRef = useRef<number>(0);
  const playbackTimeoutRef = useRef<any>(null);

  // Combine static and dynamically synced local storage songs
  const allSongs: Song[] = [...(songsData.songs as Song[]), ...dynamicSongs];

  // Derive available filters dynamically
  const availableDecades = Array.from(
    new Set(allSongs.map((s) => s.decade)),
  ).sort();
  const availableGenres = Array.from(
    new Set(allSongs.flatMap((s) => s.genres)),
  ).sort();

  // 1. Initial configuration loads and dynamic songs sync
  useEffect(() => {
    // Load local storage cached songs
    const cached = localStorage.getItem("cached_dynamic_songs");
    if (cached) {
      try {
        setDynamicSongs(JSON.parse(cached));
      } catch (e) {
        console.error("Error loading cached dynamic songs:", e);
      }
    }

    // Set default decades and genres to "All" (empty array represents all)
    setSelectedDecades([]);
    setSelectedGenres([]);

    // Background fast-forward check
    runFastForwardSync();

    // Cleanup timeouts on unmount
    return () => {
      if (playbackTimeoutRef.current) {
        clearTimeout(playbackTimeoutRef.current);
      }
    };
  }, []);

  // 2. Keyboard listener for physical key presses
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (gameStage !== "playing" || guessLocked) return;

      const key = e.key.toUpperCase();
      // Only capture single alphanumeric letters/numbers
      if (key.length === 1 && /[A-Z0-9]/.test(key)) {
        e.preventDefault();
        handleMakeGuess(key);
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [gameStage, guessLocked, currentSongIndex, roundSongs, currentGuessType]);

  // 3. Audio time progress tracker
  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;

    const handleTimeUpdate = () => {
      setAudioProgress(audio.currentTime);
    };

    const handleLoadedMetadata = () => {
      setAudioDuration(audio.duration);
    };

    const handleEnded = () => {
      setAudioPlaying(false);
      setAudioProgress(0);
      if (!guessLocked && gameStage === "playing") {
        handleMakeGuess("TIMEOUT");
      }
    };

    audio.addEventListener("timeupdate", handleTimeUpdate);
    audio.addEventListener("loadedmetadata", handleLoadedMetadata);
    audio.addEventListener("ended", handleEnded);

    return () => {
      audio.removeEventListener("timeupdate", handleTimeUpdate);
      audio.removeEventListener("loadedmetadata", handleLoadedMetadata);
      audio.removeEventListener("ended", handleEnded);
    };
  }, [currentSongIndex, roundSongs, gameStage, guessLocked]);

  // Synchronize dynamic updates from Hot 100 repo
  const runFastForwardSync = async () => {
    const staticLastDate = songsData.metadata.lastUpdatedChartDate;
    setSyncStatus("checking");

    try {
      const datesResponse = await fetch(
        "https://raw.githubusercontent.com/mhollingshead/billboard-hot-100/main/valid_dates.json",
      );
      if (!datesResponse.ok) throw new Error("Could not fetch dates");

      const validDates: string[] = await datesResponse.json();
      if (!Array.isArray(validDates) || validDates.length === 0) return;

      // Sort dates ascending
      validDates.sort();
      const latestDate = validDates[validDates.length - 1];

      if (latestDate <= staticLastDate) {
        setSyncStatus("completed");
        setSyncMessage(`Database up to date: ${staticLastDate}`);
        return;
      }

      // Filter dates newer than static last date
      const missingDates = validDates.filter((d) => d > staticLastDate);

      // Safety safeguard: if there are too many missing weeks (e.g. > 12),
      // we ask the developer to run scripts/update-songs.js to avoid rate limits
      if (missingDates.length > 12) {
        console.warn(
          `Local database is missing ${missingDates.length} weeks of charts. Run "npm run update-songs" to update.`,
        );
        setSyncStatus("completed");
        setSyncMessage(`Local db outdated. Run update script.`);
        return;
      }

      setSyncStatus("syncing");
      setSyncMessage(`Syncing ${missingDates.length} weeks of hits...`);

      const storedSongs = localStorage.getItem("cached_dynamic_songs");
      let currentCache: Song[] = storedSongs ? JSON.parse(storedSongs) : [];
      const cacheKeys = new Set(
        currentCache.map(
          (s) => `${s.title.toLowerCase()}|${s.artist.toLowerCase()}`,
        ),
      );
      const staticKeys = new Set(
        (songsData.songs as Song[]).map(
          (s) => `${s.title.toLowerCase()}|${s.artist.toLowerCase()}`,
        ),
      );

      let newSongsAdded = false;

      for (const date of missingDates) {
        const chartResponse = await fetch(
          `https://raw.githubusercontent.com/mhollingshead/billboard-hot-100/main/date/${date}.json`,
        );
        if (!chartResponse.ok) continue;

        const chartData = await chartResponse.json();
        if (!chartData || !Array.isArray(chartData.data)) continue;

        // Filter chart entries for popularity: peak_position <= 20
        const popularEntries = chartData.data.filter(
          (e: any) => e.peak_position <= 20,
        );

        for (const entry of popularEntries) {
          const songKey = `${entry.song.toLowerCase()}|${entry.artist.toLowerCase()}`;
          if (cacheKeys.has(songKey) || staticKeys.has(songKey)) continue;

          // Query iTunes Search API (throttled/limited calls at runtime)
          const query = `${entry.song} ${entry.artist}`;
          const itunesRes = await fetch(
            `https://itunes.apple.com/search?term=${encodeURIComponent(query)}&entity=song&limit=1`,
          );
          if (!itunesRes.ok) continue;

          const itunesData = await itunesRes.json();
          if (itunesData.results && itunesData.results.length > 0) {
            const track = itunesData.results[0];
            const newSong: Song = {
              title: entry.song,
              artist: entry.artist,
              decade: `${Math.floor(parseInt(track.releaseDate.substring(0, 4), 10) / 10) * 10}s`,
              genres: [track.primaryGenreName],
              previewUrl: track.previewUrl,
              artworkUrl: track.artworkUrl100,
            };
            currentCache.push(newSong);
            cacheKeys.add(songKey);
            newSongsAdded = true;
          }
        }
      }

      if (newSongsAdded) {
        localStorage.setItem(
          "cached_dynamic_songs",
          JSON.stringify(currentCache),
        );
        setDynamicSongs(currentCache);
      }

      setSyncStatus("completed");
      setSyncMessage(`Synced to ${latestDate}`);
    } catch (e) {
      console.error("Fast-Forward Sync error:", e);
      setSyncStatus("error");
      setSyncMessage("Sync connection failed");
    }
  };

  // Filter and start a game round
  const handleStartGame = () => {
    let pool = [...allSongs];

    // Filter by decades
    if (selectedDecades.length > 0) {
      pool = pool.filter((s) => selectedDecades.includes(s.decade));
    }

    // Filter by genres
    if (selectedGenres.length > 0) {
      pool = pool.filter((s) =>
        s.genres.some((g) => selectedGenres.includes(g)),
      );
    }

    if (pool.length === 0) {
      alert(
        "No songs match your filters! Try selecting more decades or genres.",
      );
      return;
    }

    // Shuffle pool
    const shuffled = [...pool].sort(() => Math.random() - 0.5);
    const selected = shuffled.slice(0, Math.min(roundLength, shuffled.length));

    // Setup active game round
    setRoundSongs(selected);
    setCurrentSongIndex(0);
    setGuesses([]);
    setGameStage("playing");

    // Start the first song
    prepareQuestion(selected[0]);
  };

  const prepareQuestion = (song: Song) => {
    setGuessLocked(false);
    setCurrentGuessLetter("");
    setAudioPlaying(false);
    setAudioProgress(0);

    // Clear any pending audio playback timeout
    if (playbackTimeoutRef.current) {
      clearTimeout(playbackTimeoutRef.current);
    }

    // Determine guess type: artist or title
    let type: "artist" | "title" = "artist";
    if (promptType === "artist") {
      type = "artist";
    } else if (promptType === "title") {
      type = "title";
    } else {
      // Both mode: choose randomly for each song
      type = Math.random() < 0.5 ? "artist" : "title";
    }

    const answer = type === "artist" ? song.artist : song.title;
    const firstLetter = getFirstLetter(answer);

    setCurrentGuessType(type);
    setCorrectLetter(firstLetter);

    // Setup audio player
    if (audioRef.current) {
      audioRef.current.pause();
    }
    const audio = new Audio(song.previewUrl);
    audio.volume = 0.8;
    audioRef.current = audio;

    // Set fallback start time (in case of immediate guess before playback starts)
    questionStartTimeRef.current = Date.now() + 1500;

    // Play after a 1.5s delay to let the user process the guess type
    playbackTimeoutRef.current = setTimeout(() => {
      audio
        .play()
        .then(() => setAudioPlaying(true))
        .catch((e) => console.error("Audio auto-play failed:", e));

      // Start response timer when the audio actually begins playing
      questionStartTimeRef.current = Date.now();
    }, 1500);
  };

  const handleMakeGuess = (letter: string) => {
    if (guessLocked) return;

    // Clear any pending playback timeout
    if (playbackTimeoutRef.current) {
      clearTimeout(playbackTimeoutRef.current);
    }

    const timeTaken = Math.max(0, Date.now() - questionStartTimeRef.current);
    const correct = letter === correctLetter;

    setCurrentGuessLetter(letter);
    setIsCurrentCorrect(correct);
    setGuessLocked(true);
    setAudioPlaying(false);

    if (audioRef.current) {
      audioRef.current.pause();
    }

    const newGuess: Guess = {
      song: roundSongs[currentSongIndex],
      guessType: currentGuessType,
      guessLetter: letter,
      correctLetter: correctLetter,
      isCorrect: correct,
      timeTakenMs: timeTaken,
    };

    setGuesses((prev) => [...prev, newGuess]);
  };

  const handleTogglePlay = () => {
    const audio = audioRef.current;
    if (!audio) return;

    if (audioPlaying) {
      audio.pause();
      setAudioPlaying(false);
    } else {
      audio
        .play()
        .then(() => setAudioPlaying(true))
        .catch((e) => console.error("Audio play failed:", e));
    }
  };

  const handleScrubAudio = (e: React.ChangeEvent<HTMLInputElement>) => {
    const audio = audioRef.current;
    if (!audio) return;
    const time = parseFloat(e.target.value);
    audio.currentTime = time;
    setAudioProgress(time);
  };

  const handleNextSong = () => {
    const nextIndex = currentSongIndex + 1;
    if (nextIndex < roundSongs.length) {
      setCurrentSongIndex(nextIndex);
      prepareQuestion(roundSongs[nextIndex]);
    } else {
      // End of round
      if (audioRef.current) {
        audioRef.current.pause();
        audioRef.current = null;
      }
      setGameStage("review");
    }
  };

  const handleQuitGame = () => {
    if (playbackTimeoutRef.current) {
      clearTimeout(playbackTimeoutRef.current);
    }
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current = null;
    }
    setGameStage("setup");
  };

  // Helper toggle filters
  const toggleDecade = (dec: string) => {
    setSelectedDecades((prev) =>
      prev.includes(dec) ? prev.filter((d) => d !== dec) : [...prev, dec],
    );
  };

  const toggleGenre = (gen: string) => {
    setSelectedGenres((prev) =>
      prev.includes(gen) ? prev.filter((g) => g !== gen) : [...prev, gen],
    );
  };

  // Stats calculation
  const correctCount = guesses.filter((g) => g.isCorrect).length;
  const scorePercent =
    guesses.length > 0 ? Math.round((correctCount / guesses.length) * 100) : 0;
  const avgTimeSec =
    guesses.length > 0
      ? (
          guesses.reduce((sum, g) => sum + g.timeTakenMs, 0) /
          guesses.length /
          1000
        ).toFixed(2)
      : "0.00";

  return (
    <>
      {/* 1. Header Area */}
      <header className="app-header">
        <h1 className="logo-title">Name That Tune Trainer</h1>
        <div className="sync-badge">
          <span
            className={`dot ${syncStatus === "syncing" ? "syncing" : syncStatus === "completed" ? "green" : ""}`}
          ></span>
          <span>{syncMessage}</span>
        </div>
      </header>

      {/* 2. Main Content Screens */}
      {gameStage === "setup" && (
        <main className="glass-panel">
          <h2>Game Setup</h2>
          <p style={{ color: "var(--text-secondary)", marginBottom: "24px" }}>
            Configure your filters below. Shuffled songs are pooled from{" "}
            {allSongs.length} available tracks.
          </p>

          <div className="form-section">
            <span className="form-label">Select Decades (Optional)</span>
            <div className="chip-grid">
              {availableDecades.map((dec) => (
                <button
                  key={dec}
                  onClick={() => toggleDecade(dec)}
                  className={`chip-btn ${selectedDecades.includes(dec) ? "active" : ""}`}
                >
                  {dec}
                </button>
              ))}
            </div>
          </div>

          <div className="form-section">
            <span className="form-label">Select Genres (Optional)</span>
            <div className="chip-grid">
              {availableGenres.map((gen) => (
                <button
                  key={gen}
                  onClick={() => toggleGenre(gen)}
                  className={`chip-btn genre ${selectedGenres.includes(gen) ? "active" : ""}`}
                >
                  {gen}
                </button>
              ))}
            </div>
          </div>

          <div className="form-section">
            <span className="form-label">Prompt Configuration</span>
            <div className="radio-group">
              <button
                className={`chip-btn ${promptType === "artist" ? "active" : ""}`}
                onClick={() => setPromptType("artist")}
              >
                Guess Artist
              </button>
              <button
                className={`chip-btn ${promptType === "title" ? "active" : ""}`}
                onClick={() => setPromptType("title")}
              >
                Guess Title
              </button>
              <button
                className={`chip-btn ${promptType === "alternate" ? "active" : ""}`}
                onClick={() => setPromptType("alternate")}
              >
                Alternate Both
              </button>
            </div>
          </div>

          <div className="form-section">
            <span className="form-label">Round Size</span>
            <div className="slider-container">
              <input
                type="range"
                min="5"
                max="50"
                step="5"
                value={roundLength}
                onChange={(e) => setRoundLength(parseInt(e.target.value, 10))}
              />
              <span className="slider-value">{roundLength}</span>
            </div>
          </div>

          <button className="cta-btn" onClick={handleStartGame}>
            Start Round
          </button>
        </main>
      )}

      {gameStage === "playing" && (
        <main className="glass-panel">
          <div className="game-stats-header">
            <span>
              SONG {currentSongIndex + 1} OF {roundSongs.length}
            </span>
            <span>
              SCORE: <span className="score-value">{correctCount}</span>/
              {guesses.length}
            </span>
          </div>

          <div className="game-progress-bar">
            <div
              className="game-progress-fill"
              style={{
                width: `${(currentSongIndex / roundSongs.length) * 100}%`,
              }}
            ></div>
          </div>

          <div className="visualizer-container">
            {[...Array(12)].map((_, i) => (
              <div
                key={i}
                className={`visualizer-bar ${audioPlaying ? "active" : ""}`}
              ></div>
            ))}
          </div>

          {!guessLocked && (
            <div className="clip-progress-container">
              <div className="clip-progress-bar">
                <div
                  className="clip-progress-fill"
                  style={{
                    width: `${(audioProgress / (audioDuration || 30)) * 100}%`,
                  }}
                ></div>
              </div>
              <div className="clip-time-display">
                {Math.max(0, Math.ceil((audioDuration || 30) - audioProgress))}s
                remaining
              </div>
            </div>
          )}

          <div className="prompt-text">
            Guess the{" "}
            <span className={`prompt-highlight ${currentGuessType}`}>
              {currentGuessType === "artist" ? "ARTIST" : "SONG TITLE"}
            </span>
          </div>
          <div className="prompt-target">
            Starts with: {guessLocked ? correctLetter : "?"}
          </div>

          <div className="keyboard-grid">
            {[
              "A",
              "B",
              "C",
              "D",
              "E",
              "F",
              "G",
              "H",
              "I",
              "J",
              "K",
              "L",
              "M",
              "N",
              "O",
              "P",
              "Q",
              "R",
              "S",
              "T",
              "U",
              "V",
              "W",
              "X",
              "Y",
              "Z",
            ].map((char) => {
              const isSelected = currentGuessLetter === char;
              let classSuffix = "";
              if (guessLocked && isSelected) {
                classSuffix = isCurrentCorrect
                  ? "selected-correct"
                  : "selected-incorrect";
              }

              return (
                <button
                  key={char}
                  disabled={guessLocked}
                  onClick={() => handleMakeGuess(char)}
                  className={`key-btn ${classSuffix}`}
                >
                  {char}
                </button>
              );
            })}
          </div>

          {guessLocked && (
            <div
              className={`reveal-card ${isCurrentCorrect ? "correct" : "incorrect"}`}
            >
              <img
                src={roundSongs[currentSongIndex].artworkUrl}
                alt="Album artwork"
                className="album-art"
              />
              <div className="reveal-details">
                <span
                  className={`reveal-status ${isCurrentCorrect ? "correct-text" : "incorrect-text"}`}
                >
                  {isCurrentCorrect
                    ? "✓ Correct Answer"
                    : currentGuessLetter === "TIMEOUT"
                      ? `✗ Time Out (Correct Letter was ${correctLetter})`
                      : `✗ Incorrect (Correct Letter was ${correctLetter})`}
                </span>
                <h3 className="reveal-title">
                  {roundSongs[currentSongIndex].title}
                </h3>
                <p className="reveal-artist">
                  {roundSongs[currentSongIndex].artist}
                </p>

                <div className="player-controls">
                  <button className="play-pause-btn" onClick={handleTogglePlay}>
                    {audioPlaying ? (
                      <svg
                        width="18"
                        height="18"
                        viewBox="0 0 24 24"
                        fill="currentColor"
                      >
                        <path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z" />
                      </svg>
                    ) : (
                      <svg
                        width="18"
                        height="18"
                        viewBox="0 0 24 24"
                        fill="currentColor"
                      >
                        <path d="M8 5v14l11-7z" />
                      </svg>
                    )}
                  </button>
                  <input
                    type="range"
                    min="0"
                    max={audioDuration || 30}
                    value={audioProgress}
                    onChange={handleScrubAudio}
                    className="player-scrubber"
                  />
                </div>
              </div>
            </div>
          )}

          <div style={{ marginTop: "30px", display: "flex", gap: "16px" }}>
            <button
              className="chip-btn"
              onClick={handleQuitGame}
              style={{ width: "40%" }}
            >
              Quit Game
            </button>
            {guessLocked && (
              <button
                className="cta-btn"
                onClick={handleNextSong}
                style={{ width: "60%", marginTop: 0 }}
              >
                {currentSongIndex + 1 === roundSongs.length
                  ? "Show Results"
                  : "Next Song"}
              </button>
            )}
          </div>
        </main>
      )}

      {gameStage === "review" && (
        <main className="glass-panel" style={{ maxWidth: "780px" }}>
          <h2>Round Completed!</h2>

          <div className="stats-container">
            <div className="stats-circle-container">
              <svg className="stats-circle-svg">
                <circle className="stats-circle-bg" cx="70" cy="70" r="60" />
                <circle
                  className="stats-circle-fill"
                  cx="70"
                  cy="70"
                  r="60"
                  stroke={
                    scorePercent >= 70
                      ? "var(--color-correct)"
                      : "var(--accent-purple)"
                  }
                  strokeDasharray={`${(scorePercent / 100) * 377} 377`}
                />
              </svg>
              <div className="stats-circle-text">{scorePercent}%</div>
            </div>

            <div className="text-stats">
              <div className="stat-item">
                <div className="stat-val">
                  {correctCount} / {guesses.length}
                </div>
                <div className="stat-lbl">Correct Answers</div>
              </div>
              <div className="stat-item">
                <div className="stat-val">{avgTimeSec}s</div>
                <div className="stat-lbl">Avg Response Time</div>
              </div>
            </div>
          </div>

          <h3>Question Log</h3>
          <div style={{ overflowX: "auto" }}>
            <table className="history-table">
              <thead>
                <tr>
                  <th>Song Info</th>
                  <th>Type</th>
                  <th>Guess</th>
                  <th>Correct</th>
                  <th>Result</th>
                </tr>
              </thead>
              <tbody>
                {guesses.map((g, idx) => (
                  <tr key={idx}>
                    <td>
                      <div className="cell-flex">
                        <img
                          src={g.song.artworkUrl}
                          alt=""
                          className="table-art"
                        />
                        <div>
                          <div className="cell-song-title">{g.song.title}</div>
                          <div className="cell-song-artist">
                            {g.song.artist}
                          </div>
                        </div>
                      </div>
                    </td>
                    <td
                      style={{
                        textTransform: "capitalize",
                        color: "var(--text-secondary)",
                      }}
                    >
                      {g.guessType}
                    </td>
                    <td
                      className="cell-letter"
                      style={{
                        color: g.isCorrect
                          ? "var(--color-correct)"
                          : "var(--color-incorrect)",
                      }}
                    >
                      {g.guessLetter === "TIMEOUT" ? "-" : g.guessLetter}
                    </td>
                    <td className="cell-letter">{g.correctLetter}</td>
                    <td>
                      <span
                        className={`status-icon ${g.isCorrect ? "correct" : "incorrect"}`}
                      >
                        {g.isCorrect ? "✓" : "✗"}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="action-row">
            <button className="chip-btn" onClick={handleQuitGame}>
              Back to Setup
            </button>
            <button
              className="cta-btn"
              style={{ marginTop: 0 }}
              onClick={handleStartGame}
            >
              Play Again
            </button>
          </div>
        </main>
      )}

      {/* 3. Footer Area */}
      <footer className="app-footer">
        <p>Name That Tune Trainer • Client-side serverless application</p>
        <p style={{ marginTop: "4px" }}>
          Data derived from Billboard Hot 100. Playback powered by{" "}
          <a href="https://itunes.apple.com" target="_blank" rel="noreferrer">
            iTunes Search API
          </a>
          .
        </p>
      </footer>
    </>
  );
}

export default App;
