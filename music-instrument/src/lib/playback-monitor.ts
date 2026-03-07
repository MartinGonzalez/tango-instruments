import { parseBool, parsePollPlayback } from "./applescript.ts";
import { buildArtworkCacheKey } from "./artwork.ts";
import type { PlayerState, TrackInfo } from "../types.ts";

type EmitFn = (event: { event: string; payload: unknown }) => void;
type RunScriptFn = (script: string) => Promise<string>;
type GetArtworkFn = (
  name: string,
  artist: string,
  album: string
) => Promise<{ base64: string | null; dominantColor: string | null }>;

const POLL_PLAYING_MS = 1000;
const POLL_IDLE_MS = 5000;

export class PlaybackMonitor {
  private intervalId: ReturnType<typeof setTimeout> | null = null;
  private lastState: PlayerState = "stopped";
  private lastTrackKey: string | null = null;
  private _active = false;

  constructor(
    private emit: EmitFn,
    private runScript: RunScriptFn,
    private getArtwork: GetArtworkFn
  ) {}

  /** When inactive, skips position updates and polls at idle rate */
  setActive(active: boolean): void {
    if (this._active === active) return;
    this._active = active;
    // Restart the scheduling loop so the new poll rate takes effect immediately
    if (this.intervalId) {
      clearTimeout(this.intervalId);
      this.schedulePoll();
    }
  }

  start(): void {
    if (this.intervalId) return;
    this.schedulePoll();
  }

  stop(): void {
    if (this.intervalId) {
      clearTimeout(this.intervalId);
      this.intervalId = null;
    }
  }

  private schedulePoll(): void {
    const delay = (this._active && this.lastState === "playing") ? POLL_PLAYING_MS : POLL_IDLE_MS;
    this.intervalId = setTimeout(async () => {
      await this.pollOnce();
      if (this.intervalId !== null) {
        this.schedulePoll();
      }
    }, delay);
  }

  async pollOnce(): Promise<void> {
    try {
      // Check if Music.app is running
      const runningRaw = await this.runScript('application "Music" is running');
      if (!parseBool(runningRaw)) {
        if (this.lastState !== "stopped") {
          this.lastState = "stopped";
          this.lastTrackKey = null;
          this.emit({ event: "music.stopped", payload: {} });
        }
        return;
      }

      // Single batched call: state + track + position
      const pollScript = `tell application "Music"
  set s to player state as string
  if s is "stopped" then return "stopped|||STOPPED"
  set t to current track
  set p to player position
  return s & "|||" & (name of t) & "|||" & (artist of t) & "|||" & (album of t) & "|||" & (duration of t) & "|||" & p
end tell`;
      const pollRaw = await this.runScript(pollScript);
      const { state, track: trackData } = parsePollPlayback(pollRaw);

      // Emit state change
      if (state !== this.lastState) {
        this.lastState = state;
        this.emit({ event: "music.stateChanged", payload: { state } });
      }

      if (!trackData) return;

      // Check for track change
      const trackKey = buildArtworkCacheKey(trackData.name, trackData.artist, trackData.album);
      if (trackKey !== this.lastTrackKey) {
        this.lastTrackKey = trackKey;
        const artwork = await this.getArtwork(trackData.name, trackData.artist, trackData.album);
        const track: TrackInfo = {
          name: trackData.name,
          artist: trackData.artist,
          album: trackData.album,
          duration: trackData.duration,
          position: trackData.position,
          artworkBase64: artwork.base64,
          dominantColor: artwork.dominantColor,
        };
        this.emit({ event: "music.trackChanged", payload: { track } });
      }

      // Emit position update only while playing AND instrument is visible
      if (state === "playing" && this._active) {
        this.emit({
          event: "music.positionUpdate",
          payload: { position: trackData.position, duration: trackData.duration },
        });
      }
      // DEBUG: uncomment to verify _active flag
      // console.log(`[PlaybackMonitor] pollOnce done — _active=${this._active}, state=${state}`);
    } catch {
      if (this.lastState !== "stopped") {
        this.lastState = "stopped";
        this.lastTrackKey = null;
        this.emit({ event: "music.stopped", payload: {} });
      }
    }
  }
}
