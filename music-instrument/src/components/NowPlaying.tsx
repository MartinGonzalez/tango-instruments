import { useState, useEffect, useRef, useCallback } from "react";
import { useInstrumentApi, useHostEvent, UIRoot, UIButton, UIEmptyState } from "tango-api";
import { setCurrentTrack } from "../index.tsx";
import type { PlayerState, TrackInfo, PlaybackState } from "../types.ts";

// --- Styles ---

const STYLES = `
.np-root {
  position: relative;
  height: 100%;
  overflow: hidden;
  display: flex;
  flex-direction: column;
}

.np-bg {
  position: absolute;
  inset: 0;
  opacity: 0.3;
  transition: background-color 1s ease;
  -webkit-mask-image: linear-gradient(
    to bottom,
    rgba(0,0,0,0.8) 0%,
    rgba(0,0,0,0.5) 50%,
    rgba(0,0,0,0.2) 100%
  );
  mask-image: linear-gradient(
    to bottom,
    rgba(0,0,0,0.8) 0%,
    rgba(0,0,0,0.5) 50%,
    rgba(0,0,0,0.2) 100%
  );
}

.np-content {
  position: relative;
  z-index: 1;
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 32px 24px;
  gap: 20px;
}

.np-artwork {
  width: 280px;
  height: 280px;
  border-radius: 14px;
  overflow: hidden;
  box-shadow: 0 12px 40px rgba(0,0,0,0.6);
  flex-shrink: 0;
}

.np-artwork img {
  width: 100%;
  height: 100%;
  object-fit: cover;
  display: block;
}

.np-artwork-placeholder {
  width: 100%;
  height: 100%;
  background: rgba(255,255,255,0.05);
  display: flex;
  align-items: center;
  justify-content: center;
}

.np-meta {
  text-align: center;
  max-width: 280px;
}

.np-track {
  font-size: 17px;
  font-weight: 700;
  color: var(--tui-text, #e5e7eb);
  line-height: 1.3;
  margin-bottom: 4px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.np-artist {
  font-size: 13px;
  color: var(--tui-text-secondary, #9ca3af);
  margin-bottom: 2px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.np-album {
  font-size: 11px;
  color: var(--tui-text-secondary, #9ca3af);
  opacity: 0.7;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.np-seek {
  display: flex;
  align-items: center;
  gap: 10px;
  width: 100%;
  max-width: 320px;
}

.np-time {
  font-size: 10px;
  color: var(--tui-text-secondary, #9ca3af);
  font-variant-numeric: tabular-nums;
  min-width: 34px;
  text-align: center;
}

.np-slider {
  flex: 1;
  -webkit-appearance: none;
  appearance: none;
  height: 4px;
  border-radius: 2px;
  background: rgba(255,255,255,0.15);
  cursor: pointer;
  outline: none;
}

.np-slider::-webkit-slider-thumb {
  -webkit-appearance: none;
  appearance: none;
  width: 14px;
  height: 14px;
  border-radius: 50%;
  background: var(--tui-text, #e5e7eb);
  cursor: pointer;
  transition: transform 0.1s;
}

.np-slider::-webkit-slider-thumb:hover {
  transform: scale(1.2);
}

.np-controls {
  display: flex;
  align-items: center;
  gap: 20px;
}

.np-ctrl-btn {
  background: none;
  border: none;
  color: var(--tui-text, #e5e7eb);
  cursor: pointer;
  padding: 10px;
  border-radius: 50%;
  transition: background 0.15s;
  display: flex;
  align-items: center;
  justify-content: center;
}

.np-ctrl-btn:hover {
  background: rgba(255,255,255,0.1);
}

.np-ctrl-btn.np-play {
  padding: 14px;
  background: rgba(255,255,255,0.1);
}

.np-ctrl-btn.np-play:hover {
  background: rgba(255,255,255,0.18);
}
`;

// --- SVG Icons ---

function PrevIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
      <path d="M6 6h2v12H6V6zm3.5 6 8.5 6V6l-8.5 6z" />
    </svg>
  );
}

function NextIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
      <path d="M16 6h2v12h-2V6zM6 18l8.5-6L6 6v12z" />
    </svg>
  );
}

function PlayIcon() {
  return (
    <svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor">
      <path d="M8 5v14l11-7L8 5z" />
    </svg>
  );
}

function PauseIcon() {
  return (
    <svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor">
      <path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z" />
    </svg>
  );
}

function MusicNoteIcon() {
  return (
    <svg width="48" height="48" viewBox="0 0 24 24" fill="currentColor" opacity="0.2">
      <path d="M12 3v10.55c-.59-.34-1.27-.55-2-.55C7.79 13 6 14.79 6 17s1.79 4 4 4 4-1.79 4-4V7h4V3h-6z" />
    </svg>
  );
}

// --- Helpers ---

function formatTime(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${s.toString().padStart(2, "0")}`;
}

// --- Component ---

export function NowPlaying() {
  const api = useInstrumentApi();
  const [state, setState] = useState<PlayerState>("stopped");
  const [track, setTrack] = useState<TrackInfo | null>(null);
  const [position, setPosition] = useState(0);
  const [duration, setDuration] = useState(0);
  const isDragging = useRef(false);
  const [dragPosition, setDragPosition] = useState(0);
  const [loaded, setLoaded] = useState(false);

  // Tell backend we're visible on mount, invisible on unmount
  useEffect(() => {
    api.actions.call("setVisible", { visible: true }).catch(() => {});
    return () => {
      api.actions.call("setVisible", { visible: false }).catch(() => {});
    };
  }, []);

  // Initial fetch
  useEffect(() => {
    (async () => {
      try {
        const result = await api.actions.call<{}, { playback: PlaybackState }>(
          "getNowPlaying",
          {}
        );
        setState(result.playback.state);
        if (result.playback.track) {
          const t = result.playback.track;
          setTrack(t);
          setPosition(t.position);
          setDuration(t.duration);
          setCurrentTrack({ name: t.name, artist: t.artist, album: t.album });
        }
      } catch {
        // Music.app likely not running
      }
      setLoaded(true);
    })();
  }, []);

  // Listen to backend events
  useHostEvent("instrument.event", (payload: { event: string; payload?: unknown }) => {
    const data = payload.payload as Record<string, unknown> | undefined;

    switch (payload.event) {
      case "music.stateChanged":
        if (data?.state) setState(data.state as PlayerState);
        break;

      case "music.trackChanged":
        if (data?.track) {
          const t = data.track as TrackInfo;
          setTrack(t);
          setPosition(t.position);
          setDuration(t.duration);
          setCurrentTrack({ name: t.name, artist: t.artist, album: t.album });
        }
        break;

      case "music.positionUpdate":
        if (!isDragging.current && data) {
          setPosition(data.position as number);
          setDuration(data.duration as number);
        }
        break;

      case "music.stopped":
        setState("stopped");
        setTrack(null);
        setPosition(0);
        setDuration(0);
        setCurrentTrack(null);
        break;
    }
  });

  // Controls
  const handlePlayPause = useCallback(async () => {
    await api.actions.call("playPause", {});
  }, [api]);

  const handleNext = useCallback(async () => {
    await api.actions.call("nextTrack", {});
  }, [api]);

  const handlePrevious = useCallback(async () => {
    await api.actions.call("previousTrack", {});
  }, [api]);

  const handleSeekStart = useCallback(() => {
    isDragging.current = true;
    setDragPosition(position);
  }, [position]);

  const handleSeekInput = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    setDragPosition(parseFloat(e.target.value));
  }, []);

  const handleSeekEnd = useCallback(async () => {
    isDragging.current = false;
    setPosition(dragPosition);
    await api.actions.call("seekTo", { position: dragPosition });
  }, [api, dragPosition]);

  const handleOpenMusic = useCallback(async () => {
    await api.actions.call("openMusic", {});
  }, [api]);

  if (!loaded) return null;

  const dominantColor = track?.dominantColor ?? "#1e1e1e";
  const displayPosition = isDragging.current ? dragPosition : position;

  // Empty state: nothing playing
  if (!track) {
    return (
      <UIRoot>
        <style>{STYLES}</style>
        <div className="np-root">
          <div className="np-content">
            <UIEmptyState text={state === "stopped" ? "No track playing" : "Loading..."} />
            {state === "stopped" && (
              <UIButton label="Open Music" variant="secondary" onClick={handleOpenMusic} />
            )}
          </div>
        </div>
      </UIRoot>
    );
  }

  return (
    <UIRoot style={{ height: "100%" }}>
      <style>{STYLES}</style>
      <div className="np-root">
        {/* Dominant color background */}
        <div className="np-bg" style={{ backgroundColor: dominantColor }} />

        <div className="np-content">
          {/* Artwork */}
          <div className="np-artwork">
            {track.artworkBase64 ? (
              <img src={track.artworkBase64} alt={`${track.album} artwork`} />
            ) : (
              <div className="np-artwork-placeholder">
                <MusicNoteIcon />
              </div>
            )}
          </div>

          {/* Metadata */}
          <div className="np-meta">
            <div className="np-track">{track.name}</div>
            <div className="np-artist">{track.artist}</div>
            <div className="np-album">{track.album}</div>
          </div>

          {/* Seek bar */}
          <div className="np-seek">
            <span className="np-time">{formatTime(displayPosition)}</span>
            <input
              type="range"
              className="np-slider"
              min={0}
              max={duration || 1}
              step={0.5}
              value={displayPosition}
              onMouseDown={handleSeekStart}
              onTouchStart={handleSeekStart}
              onChange={handleSeekInput}
              onMouseUp={handleSeekEnd}
              onTouchEnd={handleSeekEnd}
            />
            <span className="np-time">{formatTime(duration)}</span>
          </div>

          {/* Controls */}
          <div className="np-controls">
            <button className="np-ctrl-btn" onClick={handlePrevious} title="Previous">
              <PrevIcon />
            </button>
            <button className="np-ctrl-btn np-play" onClick={handlePlayPause} title={state === "playing" ? "Pause" : "Play"}>
              {state === "playing" ? <PauseIcon /> : <PlayIcon />}
            </button>
            <button className="np-ctrl-btn" onClick={handleNext} title="Next">
              <NextIcon />
            </button>
          </div>
        </div>
      </div>
    </UIRoot>
  );
}
