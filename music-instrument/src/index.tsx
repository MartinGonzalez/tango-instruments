import { useState, useEffect } from "react";
import { defineReactInstrument } from "tango-api";
import { PlaylistsSidebar } from "./components/PlaylistsSidebar.tsx";
import { SongList } from "./components/SongList.tsx";
import { NowPlaying } from "./components/NowPlaying.tsx";

// --- Shared state: selected playlist (module-level pub/sub) ---

let sharedPlaylist: string | null = null;
const playlistListeners: Set<() => void> = new Set();

export function setSelectedPlaylist(name: string | null) {
  sharedPlaylist = name;
  playlistListeners.forEach((fn) => fn());
}

export function useSelectedPlaylist() {
  const [playlist, setPlaylist] = useState(sharedPlaylist);
  useEffect(() => {
    const handler = () => setPlaylist(sharedPlaylist);
    playlistListeners.add(handler);
    return () => {
      playlistListeners.delete(handler);
    };
  }, []);
  return playlist;
}

// --- Shared state: currently playing track ---

type CurrentTrackRef = { name: string; artist: string; album: string } | null;
let sharedCurrentTrack: CurrentTrackRef = null;
const trackListeners: Set<() => void> = new Set();

export function setCurrentTrack(track: CurrentTrackRef) {
  sharedCurrentTrack = track;
  trackListeners.forEach((fn) => fn());
}

export function useCurrentTrack() {
  const [track, setTrack] = useState(sharedCurrentTrack);
  useEffect(() => {
    const handler = () => setTrack(sharedCurrentTrack);
    trackListeners.add(handler);
    return () => {
      trackListeners.delete(handler);
    };
  }, []);
  return track;
}

// --- Instrument definition ---

export default defineReactInstrument({
  defaults: {
    visible: {
      sidebar: true,
      first: true,
      second: true,
    },
  },
  panels: {
    sidebar: PlaylistsSidebar,
    first: SongList,
    second: NowPlaying,
  },
});
