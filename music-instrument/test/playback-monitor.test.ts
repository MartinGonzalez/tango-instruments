import { describe, test, expect, afterEach } from "bun:test";
import { PlaybackMonitor } from "../src/lib/playback-monitor.ts";
import type { PlayerState } from "../src/types.ts";

type EmittedEvent = { event: string; payload: unknown };

function createMockEmit() {
  const events: EmittedEvent[] = [];
  const emit = (e: EmittedEvent) => events.push(e);
  return { emit, events };
}

type ScriptHandler = (script: string) => Promise<string>;

// Order matters: more specific patterns first
function createMockRunner(handlers: [string, string][]): ScriptHandler {
  return async (script: string): Promise<string> => {
    for (const [pattern, response] of handlers) {
      if (script.includes(pattern)) return response;
    }
    throw new Error(`Unexpected script: ${script.slice(0, 80)}`);
  };
}

function createMockArtwork() {
  return async () => ({ base64: null, dominantColor: null });
}

// The pollOnce method sends two scripts:
// 1. 'application "Music" is running' → matches "is running"
// 2. Batched poll script containing "set s to player state" → matches "set s to"
function playingMock(trackLine: string): [string, string][] {
  return [
    ["is running", "true"],
    ["set s to", `playing|||${trackLine}`],
  ];
}

function pausedMock(trackLine: string): [string, string][] {
  return [
    ["is running", "true"],
    ["set s to", `paused|||${trackLine}`],
  ];
}

describe("PlaybackMonitor", () => {
  let monitor: PlaybackMonitor;

  afterEach(() => {
    monitor?.stop();
  });

  test("emits music.stateChanged when state transitions from stopped to playing", async () => {
    const { emit, events } = createMockEmit();
    const runner = createMockRunner(playingMock("Song|||Artist|||Album|||180|||0"));
    monitor = new PlaybackMonitor(emit, runner, createMockArtwork());

    await monitor.pollOnce();

    const stateEvents = events.filter((e) => e.event === "music.stateChanged");
    expect(stateEvents.length).toBe(1);
    expect((stateEvents[0].payload as { state: PlayerState }).state).toBe("playing");
  });

  test("emits music.trackChanged when track changes", async () => {
    const { emit, events } = createMockEmit();
    const runner = createMockRunner(playingMock("Song A|||Artist|||Album|||180|||10"));
    monitor = new PlaybackMonitor(emit, runner, createMockArtwork());

    await monitor.pollOnce();

    const trackEvents = events.filter((e) => e.event === "music.trackChanged");
    expect(trackEvents.length).toBe(1);
    const track = (trackEvents[0].payload as { track: { name: string } }).track;
    expect(track.name).toBe("Song A");
  });

  test("emits music.positionUpdate when playing and active", async () => {
    const { emit, events } = createMockEmit();
    const runner = createMockRunner(playingMock("Song|||Artist|||Album|||200|||42.5"));
    monitor = new PlaybackMonitor(emit, runner, createMockArtwork());
    monitor.setActive(true);

    await monitor.pollOnce();

    const posEvents = events.filter((e) => e.event === "music.positionUpdate");
    expect(posEvents.length).toBe(1);
    const payload = posEvents[0].payload as { position: number; duration: number };
    expect(payload.position).toBe(42.5);
    expect(payload.duration).toBe(200);
  });

  test("emits music.stopped when Music.app is not running", async () => {
    const { emit, events } = createMockEmit();
    const runner = createMockRunner([["is running", "false"]]);
    monitor = new PlaybackMonitor(emit, runner, createMockArtwork());

    monitor["lastState"] = "playing";
    await monitor.pollOnce();

    const stopEvents = events.filter((e) => e.event === "music.stopped");
    expect(stopEvents.length).toBe(1);
  });

  test("does not emit stateChanged when state stays the same", async () => {
    const { emit, events } = createMockEmit();
    const runner = createMockRunner(playingMock("Song|||Artist|||Album|||180|||0"));
    monitor = new PlaybackMonitor(emit, runner, createMockArtwork());

    monitor["lastState"] = "playing";
    monitor["lastTrackKey"] = "Song-Artist-Album";

    await monitor.pollOnce();

    const stateEvents = events.filter((e) => e.event === "music.stateChanged");
    expect(stateEvents.length).toBe(0);
  });

  test("does not emit trackChanged when same track is playing", async () => {
    const { emit, events } = createMockEmit();
    const runner = createMockRunner(playingMock("Song|||Artist|||Album|||180|||50"));
    monitor = new PlaybackMonitor(emit, runner, createMockArtwork());

    monitor["lastState"] = "playing";
    monitor["lastTrackKey"] = "Song-Artist-Album";

    await monitor.pollOnce();

    const trackEvents = events.filter((e) => e.event === "music.trackChanged");
    expect(trackEvents.length).toBe(0);
  });

  test("emits music.stateChanged on pause", async () => {
    const { emit, events } = createMockEmit();
    const runner = createMockRunner(pausedMock("Song|||Artist|||Album|||180|||60"));
    monitor = new PlaybackMonitor(emit, runner, createMockArtwork());
    monitor["lastState"] = "playing";
    monitor["lastTrackKey"] = "Song-Artist-Album";

    await monitor.pollOnce();

    const stateEvents = events.filter((e) => e.event === "music.stateChanged");
    expect(stateEvents.length).toBe(1);
    expect((stateEvents[0].payload as { state: PlayerState }).state).toBe("paused");
  });

  test("does not emit positionUpdate when paused", async () => {
    const { emit, events } = createMockEmit();
    const runner = createMockRunner(pausedMock("Song|||Artist|||Album|||180|||60"));
    monitor = new PlaybackMonitor(emit, runner, createMockArtwork());
    monitor["lastState"] = "paused";
    monitor["lastTrackKey"] = "Song-Artist-Album";

    await monitor.pollOnce();

    const posEvents = events.filter((e) => e.event === "music.positionUpdate");
    expect(posEvents.length).toBe(0);
  });

  test("does not emit positionUpdate when playing but inactive", async () => {
    const { emit, events } = createMockEmit();
    const runner = createMockRunner(playingMock("Song|||Artist|||Album|||200|||42.5"));
    monitor = new PlaybackMonitor(emit, runner, createMockArtwork());
    // _active defaults to false
    monitor["lastState"] = "playing";
    monitor["lastTrackKey"] = "Song-Artist-Album";

    await monitor.pollOnce();

    const posEvents = events.filter((e) => e.event === "music.positionUpdate");
    expect(posEvents.length).toBe(0);
  });

  test("start and stop manage the interval", () => {
    const { emit } = createMockEmit();
    const runner = createMockRunner([["is running", "false"]]);
    monitor = new PlaybackMonitor(emit, runner, createMockArtwork());

    monitor.start();
    expect(monitor["intervalId"]).not.toBeNull();

    monitor.stop();
    expect(monitor["intervalId"]).toBeNull();
  });
});
