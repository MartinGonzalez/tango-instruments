import { describe, test, expect } from "bun:test";
import {
  parsePlayerState,
  parseCurrentTrack,
  parsePlaylists,
  parsePlaylistTracks,
  parsePlaylistRows,
  parseTrackRows,
  parsePollPlayback,
  parseBool,
} from "../src/lib/applescript.ts";

describe("parsePlayerState", () => {
  test("maps playing", () => {
    expect(parsePlayerState("playing")).toBe("playing");
  });

  test("maps paused", () => {
    expect(parsePlayerState("paused")).toBe("paused");
  });

  test("maps stopped", () => {
    expect(parsePlayerState("stopped")).toBe("stopped");
  });

  test("unknown defaults to stopped", () => {
    expect(parsePlayerState("garbage")).toBe("stopped");
    expect(parsePlayerState("")).toBe("stopped");
  });
});

describe("parseBool", () => {
  test("parses true", () => {
    expect(parseBool("true")).toBe(true);
    expect(parseBool("true\n")).toBe(true);
  });

  test("parses false", () => {
    expect(parseBool("false")).toBe(false);
    expect(parseBool("")).toBe(false);
  });
});

describe("parseCurrentTrack", () => {
  test("parses delimited track info", () => {
    const raw = "Bohemian Rhapsody|||Queen|||A Night at the Opera|||354.5|||120.3";
    const result = parseCurrentTrack(raw);
    expect(result).toEqual({
      name: "Bohemian Rhapsody",
      artist: "Queen",
      album: "A Night at the Opera",
      duration: 354.5,
      position: 120.3,
    });
  });

  test("returns null for STOPPED", () => {
    expect(parseCurrentTrack("STOPPED")).toBeNull();
    expect(parseCurrentTrack("STOPPED\n")).toBeNull();
  });

  test("returns null for empty string", () => {
    expect(parseCurrentTrack("")).toBeNull();
  });

  test("handles track with special characters", () => {
    const raw = "Don't Stop Me Now|||Queen|||Jazz|||211.0|||0.0";
    const result = parseCurrentTrack(raw);
    expect(result!.name).toBe("Don't Stop Me Now");
  });
});

// --- New row-based parsers ---

describe("parsePlaylistRows", () => {
  test("parses row-delimited playlists", () => {
    const raw = "Library|||1500<<<>>>Recently Added|||25<<<>>>My, Favorite Songs|||10";
    const result = parsePlaylistRows(raw);
    expect(result).toEqual([
      { name: "Library", trackCount: 1500 },
      { name: "Recently Added", trackCount: 25 },
      { name: "My, Favorite Songs", trackCount: 10 },
    ]);
  });

  test("handles single playlist", () => {
    const result = parsePlaylistRows("Chill|||42");
    expect(result).toEqual([{ name: "Chill", trackCount: 42 }]);
  });

  test("handles NONE", () => {
    expect(parsePlaylistRows("NONE")).toEqual([]);
  });

  test("handles empty input", () => {
    expect(parsePlaylistRows("")).toEqual([]);
  });

  test("handles commas in playlist names", () => {
    const raw = "Rock, Pop & More|||100";
    const result = parsePlaylistRows(raw);
    expect(result[0].name).toBe("Rock, Pop & More");
  });
});

describe("parseTrackRows", () => {
  test("parses row-delimited tracks", () => {
    const raw = "Song A|||Artist 1|||Album X|||180.0<<<>>>Song B|||Artist 2|||Album Y|||240.5";
    const result = parseTrackRows(raw, 0);
    expect(result).toEqual([
      { index: 1, name: "Song A", artist: "Artist 1", album: "Album X", duration: 180.0 },
      { index: 2, name: "Song B", artist: "Artist 2", album: "Album Y", duration: 240.5 },
    ]);
  });

  test("applies offset to index", () => {
    const result = parseTrackRows("Song|||Artist|||Album|||180", 10);
    expect(result[0].index).toBe(11);
  });

  test("handles NONE", () => {
    expect(parseTrackRows("NONE", 0)).toEqual([]);
  });

  test("handles empty input", () => {
    expect(parseTrackRows("", 0)).toEqual([]);
  });

  test("handles commas in track names", () => {
    const raw = "Hello, Goodbye|||Beatles|||Album|||200";
    const result = parseTrackRows(raw, 0);
    expect(result[0].name).toBe("Hello, Goodbye");
  });
});

describe("parsePollPlayback", () => {
  test("parses playing state with track", () => {
    const raw = "playing|||Song|||Artist|||Album|||200|||42.5";
    const result = parsePollPlayback(raw);
    expect(result.state).toBe("playing");
    expect(result.track).toEqual({
      name: "Song",
      artist: "Artist",
      album: "Album",
      duration: 200,
      position: 42.5,
    });
  });

  test("parses stopped state", () => {
    const raw = "stopped|||STOPPED";
    const result = parsePollPlayback(raw);
    expect(result.state).toBe("stopped");
    expect(result.track).toBeNull();
  });

  test("handles empty input", () => {
    const result = parsePollPlayback("");
    expect(result.state).toBe("stopped");
    expect(result.track).toBeNull();
  });

  test("parses paused state with track", () => {
    const raw = "paused|||Song|||Artist|||Album|||180|||60";
    const result = parsePollPlayback(raw);
    expect(result.state).toBe("paused");
    expect(result.track!.name).toBe("Song");
    expect(result.track!.position).toBe(60);
  });
});

// --- Legacy parsers (kept for backward compat) ---

describe("parsePlaylists (legacy csv)", () => {
  test("parses playlist names and counts", () => {
    const result = parsePlaylists("Library, Recently Added", "1500, 25");
    expect(result).toEqual([
      { name: "Library", trackCount: 1500 },
      { name: "Recently Added", trackCount: 25 },
    ]);
  });

  test("handles empty input", () => {
    expect(parsePlaylists("", "")).toEqual([]);
  });
});

describe("parsePlaylistTracks (legacy csv)", () => {
  test("parses track data", () => {
    const result = parsePlaylistTracks("Song A, Song B", "Artist 1, Artist 2", "Album X, Album Y", "180.0, 240.5", 0);
    expect(result).toHaveLength(2);
    expect(result[0].name).toBe("Song A");
  });

  test("handles empty input", () => {
    expect(parsePlaylistTracks("", "", "", "", 0)).toEqual([]);
  });
});
