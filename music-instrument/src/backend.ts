import {
  defineBackend,
  type InstrumentBackendContext,
  type InstrumentBackgroundRefreshContext,
} from "tango-api/backend";
import {
  runOsascript,
  Scripts,
  parsePlayerState,
  parseBool,
  parseCurrentTrack,
  parsePlaylistRows,
  parseTrackRows,
} from "./lib/applescript.ts";
import { getArtwork, getTrackThumbnail } from "./lib/artwork.ts";
import { PlaybackMonitor } from "./lib/playback-monitor.ts";
import type { PlaybackState, TrackInfo } from "./types.ts";

let monitor: PlaybackMonitor | null = null;

async function onStart(ctx: InstrumentBackendContext): Promise<void> {
  if (monitor) {
    monitor.stop();
  }
  monitor = new PlaybackMonitor(
    (e) => ctx.emit(e),
    runOsascript,
    getArtwork
  );
  monitor.start();
}

async function onStop(): Promise<void> {
  if (monitor) {
    monitor.stop();
    monitor = null;
  }
}

async function onBackgroundRefresh(ctx: InstrumentBackgroundRefreshContext): Promise<void> {
  try {
    const running = parseBool(await runOsascript(Scripts.isRunning));
    if (!running) {
      ctx.logger.info("Background refresh: Music app not running");
      return;
    }
    const state = parsePlayerState(await runOsascript(Scripts.playerState));
    const trackRaw = await runOsascript(Scripts.currentTrack);
    const track = parseCurrentTrack(trackRaw);
    ctx.logger.info(`Background refresh: state=${state}, track=${track?.name ?? "none"}`);
    ctx.emit({ event: "music.backgroundStatus", payload: { state, track: track?.name ?? null } });
  } catch (err) {
    ctx.logger.warn("Background refresh failed", String(err));
  }
}

export default defineBackend({
  kind: "tango.instrument.backend.v2",
  onStart,
  onStop,
  onBackgroundRefresh,
  actions: {
    getStatus: {
      input: { type: "object", properties: {} },
      output: {
        type: "object",
        properties: {
          running: { type: "boolean" },
          state: { type: "string" },
        },
      },
      handler: async () => {
        try {
          const running = parseBool(await runOsascript(Scripts.isRunning));
          if (!running) return { running: false, state: "stopped" };
          const state = parsePlayerState(await runOsascript(Scripts.playerState));
          return { running: true, state };
        } catch {
          return { running: false, state: "stopped" };
        }
      },
    },

    getPlaylists: {
      input: { type: "object", properties: {} },
      output: {
        type: "object",
        properties: {
          playlists: { type: "array" },
        },
      },
      handler: async () => {
        try {
          const raw = await runOsascript(Scripts.playlists);
          const playlists = parsePlaylistRows(raw);
          return { playlists };
        } catch {
          return { playlists: [] };
        }
      },
    },

    getPlaylistTracks: {
      input: {
        type: "object",
        properties: {
          playlist: { type: "string" },
          offset: { type: "number" },
          limit: { type: "number" },
        },
        required: ["playlist"],
      },
      output: {
        type: "object",
        properties: {
          tracks: { type: "array" },
          total: { type: "number" },
        },
      },
      handler: async (_ctx, input?: { playlist?: string; offset?: number; limit?: number }) => {
        if (!input?.playlist) return { tracks: [], total: 0 };
        const offset = input.offset ?? 0;
        const limit = input.limit ?? 50;
        const playlist = input.playlist;

        try {
          const totalRaw = await runOsascript(Scripts.playlistTrackCount(playlist));
          const total = parseInt(totalRaw.trim(), 10) || 0;
          if (total === 0) return { tracks: [], total: 0 };

          const start = offset + 1;
          const end = Math.min(offset + limit, total);
          if (start > total) return { tracks: [], total };

          const raw = await runOsascript(Scripts.playlistTracks(playlist, start, end));
          const tracks = parseTrackRows(raw, offset);
          return { tracks, total };
        } catch {
          return { tracks: [], total: 0 };
        }
      },
    },

    getNowPlaying: {
      input: { type: "object", properties: {} },
      output: {
        type: "object",
        properties: {
          playback: {},
        },
      },
      handler: async (): Promise<{ playback: PlaybackState }> => {
        try {
          const running = parseBool(await runOsascript(Scripts.isRunning));
          if (!running) return { playback: { state: "stopped", track: null } };

          const stateRaw = await runOsascript(Scripts.playerState);
          const state = parsePlayerState(stateRaw);

          const trackRaw = await runOsascript(Scripts.currentTrack);
          const trackData = parseCurrentTrack(trackRaw);

          if (!trackData) return { playback: { state, track: null } };

          const artwork = await getArtwork(trackData.name, trackData.artist, trackData.album);
          const track: TrackInfo = {
            ...trackData,
            artworkBase64: artwork.base64,
            dominantColor: artwork.dominantColor,
          };

          return { playback: { state, track } };
        } catch {
          return { playback: { state: "stopped", track: null } };
        }
      },
    },

    playPause: {
      input: { type: "object", properties: {} },
      output: {
        type: "object",
        properties: { state: { type: "string" } },
      },
      handler: async () => {
        try {
          await runOsascript(Scripts.playPause);
          const state = parsePlayerState(await runOsascript(Scripts.playerState));
          return { state };
        } catch {
          return { state: "stopped" };
        }
      },
    },

    nextTrack: {
      input: { type: "object", properties: {} },
      output: {
        type: "object",
        properties: { state: { type: "string" } },
      },
      handler: async () => {
        try {
          await runOsascript(Scripts.nextTrack);
          return { state: "playing" };
        } catch {
          return { state: "stopped" };
        }
      },
    },

    previousTrack: {
      input: { type: "object", properties: {} },
      output: {
        type: "object",
        properties: { state: { type: "string" } },
      },
      handler: async () => {
        try {
          await runOsascript(Scripts.previousTrack);
          return { state: "playing" };
        } catch {
          return { state: "stopped" };
        }
      },
    },

    seekTo: {
      input: {
        type: "object",
        properties: { position: { type: "number" } },
        required: ["position"],
      },
      output: {
        type: "object",
        properties: { position: { type: "number" } },
      },
      handler: async (_ctx, input?: { position?: number }) => {
        const pos = input?.position ?? 0;
        try {
          await runOsascript(Scripts.seekTo(pos));
          return { position: pos };
        } catch {
          return { position: 0 };
        }
      },
    },

    playTrackInPlaylist: {
      input: {
        type: "object",
        properties: {
          playlist: { type: "string" },
          trackIndex: { type: "number" },
        },
        required: ["playlist", "trackIndex"],
      },
      output: {
        type: "object",
        properties: { success: { type: "boolean" } },
      },
      handler: async (_ctx, input?: { playlist?: string; trackIndex?: number }) => {
        if (!input?.playlist || !input?.trackIndex) return { success: false };
        try {
          await runOsascript(Scripts.playTrackInPlaylist(input.playlist, input.trackIndex));
          return { success: true };
        } catch {
          return { success: false };
        }
      },
    },

    getAlbumArtwork: {
      input: {
        type: "object",
        properties: {
          playlist: { type: "string" },
          trackIndex: { type: "number" },
          cacheKey: { type: "string" },
        },
        required: ["playlist", "trackIndex", "cacheKey"],
      },
      output: {
        type: "object",
        properties: {
          thumbnail: { type: "string" },
          cacheKey: { type: "string" },
        },
      },
      handler: async (_ctx, input?: { playlist?: string; trackIndex?: number; cacheKey?: string }) => {
        if (!input?.playlist || !input?.trackIndex || !input?.cacheKey) {
          return { thumbnail: null, cacheKey: "" };
        }
        const thumbnail = await getTrackThumbnail(input.playlist, input.trackIndex, input.cacheKey);
        return { thumbnail, cacheKey: input.cacheKey };
      },
    },

    openMusic: {
      input: { type: "object", properties: {} },
      output: {
        type: "object",
        properties: { success: { type: "boolean" } },
      },
      handler: async () => {
        try {
          await runOsascript(Scripts.openMusic);
          return { success: true };
        } catch {
          return { success: false };
        }
      },
    },

    setVisible: {
      input: {
        type: "object",
        properties: { visible: { type: "boolean" } },
        required: ["visible"],
      },
      output: { type: "object", properties: { ok: { type: "boolean" } } },
      handler: async (_ctx, input?: { visible?: boolean }) => {
        const active = input?.visible ?? false;
        console.log(`[music-instrument] setVisible: active=${active}, monitor=${!!monitor}`);
        if (monitor) {
          monitor.setActive(active);
        }
        return { ok: true };
      },
    },
  },
});
