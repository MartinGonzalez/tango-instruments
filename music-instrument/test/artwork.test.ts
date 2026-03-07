import { describe, test, expect } from "bun:test";
import { extractDominantColorFromBmp, buildArtworkCacheKey } from "../src/lib/artwork.ts";

// BMP file format for a 1x1 pixel:
// - 14 bytes BMP header
// - 40 bytes DIB header (BITMAPINFOHEADER)
// - Pixel data at offset 54 (stored as BGR)
function make1x1Bmp(r: number, g: number, b: number): Uint8Array {
  const fileSize = 58; // 54 header + 4 (1 pixel BGR + 1 padding byte)
  const buf = new Uint8Array(fileSize);

  // BMP header
  buf[0] = 0x42; buf[1] = 0x4d; // "BM"
  buf[2] = fileSize; buf[3] = 0; buf[4] = 0; buf[5] = 0; // file size
  buf[10] = 54; // pixel data offset

  // DIB header (BITMAPINFOHEADER)
  buf[14] = 40; // header size
  buf[18] = 1; // width = 1
  buf[22] = 1; // height = 1
  buf[26] = 1; // color planes
  buf[28] = 24; // bits per pixel

  // Pixel data (BGR order)
  buf[54] = b;
  buf[55] = g;
  buf[56] = r;
  buf[57] = 0; // row padding

  return buf;
}

describe("extractDominantColorFromBmp", () => {
  test("reads white pixel", () => {
    const bmp = make1x1Bmp(255, 255, 255);
    expect(extractDominantColorFromBmp(bmp)).toBe("#ffffff");
  });

  test("reads black pixel", () => {
    const bmp = make1x1Bmp(0, 0, 0);
    expect(extractDominantColorFromBmp(bmp)).toBe("#000000");
  });

  test("reads red pixel", () => {
    const bmp = make1x1Bmp(255, 0, 0);
    expect(extractDominantColorFromBmp(bmp)).toBe("#ff0000");
  });

  test("reads arbitrary color", () => {
    const bmp = make1x1Bmp(0x2a, 0x4f, 0x6b);
    expect(extractDominantColorFromBmp(bmp)).toBe("#2a4f6b");
  });

  test("reads teal color", () => {
    const bmp = make1x1Bmp(0, 128, 128);
    expect(extractDominantColorFromBmp(bmp)).toBe("#008080");
  });
});

describe("buildArtworkCacheKey", () => {
  test("builds key from track info", () => {
    expect(buildArtworkCacheKey("Song", "Artist", "Album")).toBe("Song-Artist-Album");
  });

  test("handles empty fields", () => {
    expect(buildArtworkCacheKey("Song", "", "")).toBe("Song--");
  });
});
