export type PlayerState = "playing" | "paused" | "stopped";

export type TrackInfo = {
  name: string;
  artist: string;
  album: string;
  duration: number;
  position: number;
  artworkBase64: string | null;
  dominantColor: string | null;
};

export type PlaylistInfo = {
  name: string;
  trackCount: number;
};

export type PlaylistTrack = {
  index: number;
  name: string;
  artist: string;
  album: string;
  duration: number;
};

export type PlaybackState = {
  state: PlayerState;
  track: TrackInfo | null;
};
