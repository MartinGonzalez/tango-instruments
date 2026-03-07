import { useState, useEffect, useRef } from "react";
import {
  useInstrumentApi,
  UIRoot,
  UISection,
  UIButton,
  UIEmptyState,
  UIPanelHeader,
} from "tango-api";
import { useSelectedPlaylist, useCurrentTrack } from "../index.tsx";
import type { PlaylistTrack } from "../types.ts";

const STYLES = `
.sl-track {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 6px 8px;
  border-radius: 6px;
  cursor: pointer;
  transition: background 0.12s;
}

.sl-track:hover {
  background: rgba(255,255,255,0.05);
}

.sl-track.sl-active {
  background: rgba(217, 119, 87, 0.15);
}

.sl-track.sl-active .sl-name {
  color: #d97757;
}

.sl-thumb {
  width: 36px;
  height: 36px;
  border-radius: 4px;
  overflow: hidden;
  flex-shrink: 0;
  background: rgba(255,255,255,0.05);
}

.sl-thumb img {
  width: 100%;
  height: 100%;
  object-fit: cover;
  display: block;
}

.sl-thumb-placeholder {
  width: 100%;
  height: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
}

.sl-info {
  flex: 1;
  min-width: 0;
}

.sl-name {
  font-size: 13px;
  font-weight: 500;
  color: var(--tui-text, #e5e7eb);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.sl-sub {
  font-size: 11px;
  color: var(--tui-text-secondary, #9ca3af);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.sl-dur {
  font-size: 11px;
  color: var(--tui-text-secondary, #9ca3af);
  font-variant-numeric: tabular-nums;
  flex-shrink: 0;
}

.sl-list {
  display: flex;
  flex-direction: column;
  gap: 2px;
}
`;

function MiniNoteIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" opacity="0.2">
      <path d="M12 3v10.55c-.59-.34-1.27-.55-2-.55C7.79 13 6 14.79 6 17s1.79 4 4 4 4-1.79 4-4V7h4V3h-6z" />
    </svg>
  );
}

function formatDuration(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${s.toString().padStart(2, "0")}`;
}

export function SongList() {
  const api = useInstrumentApi();
  const playlist = useSelectedPlaylist();
  const currentTrack = useCurrentTrack();
  const [tracks, setTracks] = useState<PlaylistTrack[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [offset, setOffset] = useState(0);
  const LIMIT = 50;

  // Album artwork cache: "artist-album" → base64 data URI
  const [artworks, setArtworks] = useState<Record<string, string | null>>({});
  const fetchedAlbumsRef = useRef(new Set<string>());

  async function fetchTracks(playlistName: string, newOffset: number) {
    setLoading(true);
    try {
      const result = await api.actions.call<
        { playlist: string; offset: number; limit: number },
        { tracks: PlaylistTrack[]; total: number }
      >("getPlaylistTracks", { playlist: playlistName, offset: newOffset, limit: LIMIT });

      if (newOffset === 0) {
        setTracks(result.tracks);
      } else {
        setTracks((prev) => [...prev, ...result.tracks]);
      }
      setTotal(result.total);
      setOffset(newOffset + result.tracks.length);

      // Fetch thumbnails for unique albums in this batch
      fetchArtworksForTracks(playlistName, result.tracks);
    } catch {
      if (newOffset === 0) setTracks([]);
    }
    setLoading(false);
  }

  function fetchArtworksForTracks(playlistName: string, newTracks: PlaylistTrack[]) {
    const toFetch = new Map<string, number>();
    for (const t of newTracks) {
      const key = `${t.artist}-${t.album}`;
      if (!toFetch.has(key) && !fetchedAlbumsRef.current.has(key)) {
        toFetch.set(key, t.index);
        fetchedAlbumsRef.current.add(key);
      }
    }

    for (const [key, trackIndex] of toFetch) {
      api.actions
        .call<
          { playlist: string; trackIndex: number; cacheKey: string },
          { thumbnail: string | null; cacheKey: string }
        >("getAlbumArtwork", { playlist: playlistName, trackIndex, cacheKey: key })
        .then((result) => {
          if (result.thumbnail) {
            setArtworks((prev) => ({ ...prev, [result.cacheKey]: result.thumbnail }));
          }
        })
        .catch(() => {});
    }
  }

  useEffect(() => {
    if (playlist) {
      setTracks([]);
      setOffset(0);
      setTotal(0);
      setArtworks({});
      fetchedAlbumsRef.current.clear();
      fetchTracks(playlist, 0);
    }
  }, [playlist]);

  async function handlePlayTrack(track: PlaylistTrack) {
    if (!playlist) return;
    await api.actions.call("playTrackInPlaylist", {
      playlist,
      trackIndex: track.index,
    });
  }

  if (!playlist) {
    return (
      <UIRoot>
        <UISection>
          <UIEmptyState text="Select a playlist from the sidebar" />
        </UISection>
      </UIRoot>
    );
  }

  return (
    <UIRoot>
      <style>{STYLES}</style>
      <UIPanelHeader
        title={playlist}
        subtitle={total > 0 ? `${total} tracks` : undefined}
      />
      <UISection>
        <div className="sl-list">
          {tracks.map((t) => {
            const albumKey = `${t.artist}-${t.album}`;
            const thumb = artworks[albumKey];
            const isPlaying =
              currentTrack &&
              currentTrack.name === t.name &&
              currentTrack.artist === t.artist &&
              currentTrack.album === t.album;

            return (
              <div
                key={`${t.index}-${t.name}`}
                className={`sl-track${isPlaying ? " sl-active" : ""}`}
                onClick={() => handlePlayTrack(t)}
              >
                <div className="sl-thumb">
                  {thumb ? (
                    <img src={thumb} alt="" />
                  ) : (
                    <div className="sl-thumb-placeholder">
                      <MiniNoteIcon />
                    </div>
                  )}
                </div>
                <div className="sl-info">
                  <div className="sl-name">{t.name}</div>
                  <div className="sl-sub">{t.artist} — {t.album}</div>
                </div>
                <span className="sl-dur">{formatDuration(t.duration)}</span>
              </div>
            );
          })}
        </div>
        {loading && (
          <p style={{ opacity: 0.5, fontSize: 12, padding: "8px 0" }}>Loading...</p>
        )}
        {!loading && tracks.length < total && (
          <div style={{ padding: "8px 0" }}>
            <UIButton
              label="Load more"
              variant="ghost"
              onClick={() => fetchTracks(playlist, offset)}
            />
          </div>
        )}
        {!loading && tracks.length === 0 && (
          <UIEmptyState text="No tracks in this playlist" />
        )}
      </UISection>
    </UIRoot>
  );
}
