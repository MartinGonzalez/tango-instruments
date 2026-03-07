import { runOsascript, Scripts } from "./applescript.ts";

const ARTWORK_PATH = "/tmp/tango-music-artwork";
const ARTWORK_1PX_PATH = "/tmp/tango-music-artwork-1px.bmp";
const THUMB_PATH = "/tmp/tango-music-thumb";

let cachedKey: string | null = null;
let cachedBase64: string | null = null;
let cachedColor: string | null = null;

// Thumbnail cache: album key → small base64 data URI
const thumbCache = new Map<string, string | null>();

export function buildArtworkCacheKey(name: string, artist: string, album: string): string {
  return `${name}-${artist}-${album}`;
}

export function extractDominantColorFromBmp(data: Uint8Array): string {
  // BMP pixel data offset is at bytes 10-13 (little-endian uint32)
  const offset = data[10] | (data[11] << 8) | (data[12] << 16) | (data[13] << 24);
  // BMP stores pixels in BGR order
  const b = data[offset];
  const g = data[offset + 1];
  const r = data[offset + 2];
  return `#${hex(r)}${hex(g)}${hex(b)}`;
}

function hex(n: number): string {
  return n.toString(16).padStart(2, "0");
}

export async function getArtwork(
  name: string,
  artist: string,
  album: string
): Promise<{ base64: string | null; dominantColor: string | null }> {
  const key = buildArtworkCacheKey(name, artist, album);
  if (key === cachedKey) {
    return { base64: cachedBase64, dominantColor: cachedColor };
  }

  try {
    // Extract artwork to temp file
    const result = await runOsascript(Scripts.extractArtwork(ARTWORK_PATH));
    if (result.trim() === "NO_ARTWORK") {
      cachedKey = key;
      cachedBase64 = null;
      cachedColor = null;
      return { base64: null, dominantColor: null };
    }

    // Read artwork as base64
    const file = Bun.file(ARTWORK_PATH);
    const bytes = new Uint8Array(await file.arrayBuffer());
    const base64 = Buffer.from(bytes).toString("base64");

    // Detect format from magic bytes
    const isJpeg = bytes[0] === 0xff && bytes[1] === 0xd8;
    const mime = isJpeg ? "image/jpeg" : "image/png";
    const dataUri = `data:${mime};base64,${base64}`;

    // Extract dominant color via sips (resize to 1x1 BMP)
    let dominantColor: string | null = null;
    try {
      const sips = Bun.spawn(
        ["sips", "-z", "1", "1", ARTWORK_PATH, "-s", "format", "bmp", "--out", ARTWORK_1PX_PATH],
        { stdout: "pipe", stderr: "pipe" }
      );
      await sips.exited;
      const bmpBytes = new Uint8Array(await Bun.file(ARTWORK_1PX_PATH).arrayBuffer());
      dominantColor = extractDominantColorFromBmp(bmpBytes);
    } catch {
      // Fallback: no dominant color
    }

    cachedKey = key;
    cachedBase64 = dataUri;
    cachedColor = dominantColor;
    return { base64: dataUri, dominantColor };
  } catch {
    cachedKey = key;
    cachedBase64 = null;
    cachedColor = null;
    return { base64: null, dominantColor: null };
  }
}

// Serial queue: only one thumbnail extraction at a time to avoid temp file races
let thumbQueue: Promise<void> = Promise.resolve();

/**
 * Get a small thumbnail (80x80 JPEG) for a track by playlist + index.
 * Caches per artist+album so tracks in the same album share one thumbnail.
 * Serialized to prevent concurrent writes to the same temp file.
 */
export function getTrackThumbnail(
  playlist: string,
  trackIndex: number,
  cacheKey: string
): Promise<string | null> {
  if (thumbCache.has(cacheKey)) return Promise.resolve(thumbCache.get(cacheKey) ?? null);

  const job = thumbQueue.then(() => extractThumbnail(playlist, trackIndex, cacheKey));
  thumbQueue = job.then(() => {}, () => {}); // swallow errors for queue chain
  return job;
}

async function extractThumbnail(
  playlist: string,
  trackIndex: number,
  cacheKey: string
): Promise<string | null> {
  // Double-check cache (another queued job may have filled it)
  if (thumbCache.has(cacheKey)) return thumbCache.get(cacheKey) ?? null;

  try {
    const escapedPlaylist = playlist.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
    const script = `tell application "Music"
  set t to track ${trackIndex} of playlist "${escapedPlaylist}"
  if (count of artworks of t) is 0 then return "NO_ARTWORK"
  set artData to raw data of artwork 1 of t
  set fRef to (open for access POSIX file "${THUMB_PATH}" with write permission)
  set eof fRef to 0
  write artData to fRef
  close access fRef
  return "OK"
end tell`;
    const result = await runOsascript(script);
    if (result.trim() !== "OK") {
      thumbCache.set(cacheKey, null);
      return null;
    }

    // Resize to 80x80 JPEG thumbnail
    const thumbOut = `${THUMB_PATH}-sm.jpg`;
    const sips = Bun.spawn(
      ["sips", "-z", "80", "80", THUMB_PATH, "-s", "format", "jpeg", "--out", thumbOut],
      { stdout: "pipe", stderr: "pipe" }
    );
    await sips.exited;

    const bytes = new Uint8Array(await Bun.file(thumbOut).arrayBuffer());
    const b64 = Buffer.from(bytes).toString("base64");
    const dataUri = `data:image/jpeg;base64,${b64}`;
    thumbCache.set(cacheKey, dataUri);
    return dataUri;
  } catch {
    thumbCache.set(cacheKey, null);
    return null;
  }
}
