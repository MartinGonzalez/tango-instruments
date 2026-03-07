import { useState, useEffect } from "react";
import {
  useInstrumentApi,
  useHostEvent,
  UIRoot,
  UISection,
  UIList,
  UIListItem,
  UIButton,
  UIEmptyState,
} from "tango-api";
import { setSelectedPlaylist } from "../index.tsx";
import type { PlaylistInfo } from "../types.ts";

export function PlaylistsSidebar() {
  const api = useInstrumentApi();
  const [playlists, setPlaylists] = useState<PlaylistInfo[]>([]);
  const [activePlaylist, setActivePlaylist] = useState<string | null>(null);
  const [musicRunning, setMusicRunning] = useState(true);
  const [loading, setLoading] = useState(true);

  async function fetchPlaylists() {
    try {
      const status = await api.actions.call<{}, { running: boolean }>("getStatus", {});
      if (!status.running) {
        setMusicRunning(false);
        setPlaylists([]);
        setLoading(false);
        return;
      }
      setMusicRunning(true);
      const result = await api.actions.call<{}, { playlists: PlaylistInfo[] }>("getPlaylists", {});
      setPlaylists(result.playlists);
    } catch {
      setPlaylists([]);
    }
    setLoading(false);
  }

  useEffect(() => {
    fetchPlaylists();
  }, []);

  useHostEvent("instrument.event", (payload: { event: string }) => {
    if (payload.event === "music.stopped") {
      setMusicRunning(false);
    } else if (payload.event === "music.stateChanged") {
      if (!musicRunning) {
        setMusicRunning(true);
        fetchPlaylists();
      }
    }
  });

  function handleSelect(name: string) {
    setActivePlaylist(name);
    setSelectedPlaylist(name);
  }

  async function handleOpenMusic() {
    await api.actions.call("openMusic", {});
    // Give Music.app a moment to launch, then refresh
    setTimeout(() => fetchPlaylists(), 2000);
  }

  if (loading) {
    return (
      <UIRoot>
        <UISection title="Music">
          <p style={{ opacity: 0.5, fontSize: 12, padding: 12 }}>Loading...</p>
        </UISection>
      </UIRoot>
    );
  }

  if (!musicRunning) {
    return (
      <UIRoot>
        <UISection title="Music">
          <UIEmptyState text="Music.app is not running" />
          <div style={{ padding: "0 12px" }}>
            <UIButton label="Open Music" variant="primary" onClick={handleOpenMusic} />
          </div>
        </UISection>
      </UIRoot>
    );
  }

  return (
    <UIRoot>
      <UISection title="Library">
        <UIList>
          {playlists.map((p) => (
            <UIListItem
              key={p.name}
              title={p.name}
              subtitle={`${p.trackCount} tracks`}
              active={activePlaylist === p.name}
              onClick={() => handleSelect(p.name)}
            />
          ))}
        </UIList>
        {playlists.length === 0 && (
          <UIEmptyState text="No playlists found" />
        )}
      </UISection>
    </UIRoot>
  );
}
