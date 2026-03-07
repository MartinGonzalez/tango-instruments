import type { PlayerState, PlaylistInfo, PlaylistTrack } from "../types.ts";

const DELIMITER = "|||";
const ROW_DELIMITER = "<<<>>>";

// --- Parsing functions (pure, testable) ---

export function parsePlayerState(raw: string): PlayerState {
  const trimmed = raw.trim();
  if (trimmed === "playing") return "playing";
  if (trimmed === "paused") return "paused";
  return "stopped";
}

export function parseBool(raw: string): boolean {
  return raw.trim() === "true";
}

export function parseCurrentTrack(
  raw: string
): { name: string; artist: string; album: string; duration: number; position: number } | null {
  const trimmed = raw.trim();
  if (!trimmed || trimmed === "STOPPED") return null;

  const parts = trimmed.split(DELIMITER);
  if (parts.length < 5) return null;

  return {
    name: parts[0],
    artist: parts[1],
    album: parts[2],
    duration: parseFloat(parts[3]) || 0,
    position: parseFloat(parts[4]) || 0,
  };
}

/**
 * Parse playlists returned as row-delimited lines: "name|||count"
 */
export function parsePlaylistRows(raw: string): PlaylistInfo[] {
  const trimmed = raw.trim();
  if (!trimmed || trimmed === "NONE") return [];
  const lines = trimmed.split(ROW_DELIMITER);
  const result: PlaylistInfo[] = [];
  for (const line of lines) {
    const parts = line.split(DELIMITER);
    if (parts.length < 2) continue;
    const name = parts[0].trim();
    if (!name) continue;
    result.push({
      name,
      trackCount: parseInt(parts[1], 10) || 0,
    });
  }
  return result;
}

/**
 * Parse track rows: "name|||artist|||album|||duration"
 */
export function parseTrackRows(raw: string, offset: number): PlaylistTrack[] {
  const trimmed = raw.trim();
  if (!trimmed || trimmed === "NONE") return [];
  const lines = trimmed.split(ROW_DELIMITER);
  const result: PlaylistTrack[] = [];
  for (let i = 0; i < lines.length; i++) {
    const parts = lines[i].split(DELIMITER);
    if (parts.length < 4) continue;
    result.push({
      index: offset + i + 1,
      name: parts[0].trim(),
      artist: parts[1].trim(),
      album: parts[2].trim(),
      duration: parseFloat(parts[3]) || 0,
    });
  }
  return result;
}

// Keep old parsers for backward compat with existing tests
export function parsePlaylists(namesRaw: string, countsRaw: string): PlaylistInfo[] {
  const names = splitCsvLine(namesRaw);
  const counts = splitCsvLine(countsRaw);
  const len = Math.min(names.length, counts.length);
  const result: PlaylistInfo[] = [];
  for (let i = 0; i < len; i++) {
    if (!names[i]) continue;
    result.push({ name: names[i], trackCount: parseInt(counts[i], 10) || 0 });
  }
  return result;
}

export function parsePlaylistTracks(
  namesRaw: string,
  artistsRaw: string,
  albumsRaw: string,
  durationsRaw: string,
  offset: number
): PlaylistTrack[] {
  const names = splitCsvLine(namesRaw);
  const artists = splitCsvLine(artistsRaw);
  const albums = splitCsvLine(albumsRaw);
  const durations = splitCsvLine(durationsRaw);
  if (!names[0]) return [];
  const len = Math.min(names.length, artists.length, albums.length, durations.length);
  const result: PlaylistTrack[] = [];
  for (let i = 0; i < len; i++) {
    result.push({
      index: offset + i + 1,
      name: names[i],
      artist: artists[i],
      album: albums[i],
      duration: parseFloat(durations[i]) || 0,
    });
  }
  return result;
}

function splitCsvLine(raw: string): string[] {
  const trimmed = raw.trim();
  if (!trimmed) return [];
  return trimmed.split(", ").map((s) => s.trim());
}

// --- osascript execution ---

export async function runOsascript(script: string): Promise<string> {
  const proc = Bun.spawn(["osascript", "-e", script], {
    stdout: "pipe",
    stderr: "pipe",
  });
  const stdout = await new Response(proc.stdout).text();
  const exitCode = await proc.exited;
  if (exitCode !== 0) {
    const stderr = await new Response(proc.stderr).text();
    throw new Error(`osascript failed (${exitCode}): ${stderr.trim()}`);
  }
  return stdout;
}

// --- Script builders ---

export const Scripts = {
  isRunning: `application "Music" is running`,

  playerState: `tell application "Music" to get player state as string`,

  // Single batched call: state + track info + position in one osascript invocation
  pollPlayback: `tell application "Music"
  set s to player state as string
  if s is "stopped" then return "stopped${DELIMITER}STOPPED"
  set t to current track
  set p to player position
  return s & "${DELIMITER}" & (name of t) & "${DELIMITER}" & (artist of t) & "${DELIMITER}" & (album of t) & "${DELIMITER}" & (duration of t) & "${DELIMITER}" & p
end tell`,

  currentTrack: `tell application "Music"
  if player state is stopped then return "STOPPED"
  set t to current track
  set p to player position
  return (name of t) & "${DELIMITER}" & (artist of t) & "${DELIMITER}" & (album of t) & "${DELIMITER}" & (duration of t) & "${DELIMITER}" & p
end tell`,

  playPause: `tell application "Music" to playpause`,
  nextTrack: `tell application "Music" to next track`,
  previousTrack: `tell application "Music" to previous track`,
  openMusic: `tell application "Music" to activate`,

  seekTo: (position: number) =>
    `tell application "Music" to set player position to ${position}`,

  // Uses "every playlist" to get ALL playlists (library, user, smart, etc.)
  // Returns row-delimited format to avoid comma issues in names
  playlists: `tell application "Music"
  set pls to every playlist
  set output to ""
  repeat with p in pls
    set tCount to count of tracks of p
    if tCount > 0 then
      set output to output & (name of p) & "${DELIMITER}" & tCount & "${ROW_DELIMITER}"
    end if
  end repeat
  if output is "" then return "NONE"
  return text 1 thru -${ROW_DELIMITER.length + 1} of output
end tell`,

  playlistTrackCount: (playlist: string) =>
    `tell application "Music" to get count of tracks of playlist "${escapeAppleScript(playlist)}"`,

  // Returns row-delimited tracks to avoid comma issues
  playlistTracks: (playlist: string, start: number, end: number) => `tell application "Music"
  set trks to tracks ${start} thru ${end} of playlist "${escapeAppleScript(playlist)}"
  set output to ""
  repeat with t in trks
    set output to output & (name of t) & "${DELIMITER}" & (artist of t) & "${DELIMITER}" & (album of t) & "${DELIMITER}" & (duration of t) & "${ROW_DELIMITER}"
  end repeat
  if output is "" then return "NONE"
  return text 1 thru -${ROW_DELIMITER.length + 1} of output
end tell`,

  playTrackInPlaylist: (playlist: string, index: number) =>
    `tell application "Music" to play track ${index} of playlist "${escapeAppleScript(playlist)}"`,

  extractArtwork: (destPath: string) => `tell application "Music"
  set t to current track
  if (count of artworks of t) is 0 then return "NO_ARTWORK"
  set artData to raw data of artwork 1 of t
  set fRef to (open for access POSIX file "${destPath}" with write permission)
  set eof fRef to 0
  write artData to fRef
  close access fRef
  return "OK"
end tell`,
};

/**
 * Parse the batched pollPlayback result.
 * Format: "state|||name|||artist|||album|||duration|||position"
 * Or: "stopped|||STOPPED"
 */
export function parsePollPlayback(raw: string): {
  state: PlayerState;
  track: { name: string; artist: string; album: string; duration: number; position: number } | null;
} {
  const trimmed = raw.trim();
  if (!trimmed) return { state: "stopped", track: null };

  const parts = trimmed.split(DELIMITER);
  const state = parsePlayerState(parts[0]);

  if (parts.length < 6 || parts[1] === "STOPPED") {
    return { state, track: null };
  }

  return {
    state,
    track: {
      name: parts[1],
      artist: parts[2],
      album: parts[3],
      duration: parseFloat(parts[4]) || 0,
      position: parseFloat(parts[5]) || 0,
    },
  };
}

function escapeAppleScript(str: string): string {
  return str.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}
