const JPEG = Buffer.from([0xff, 0xd8, 0xff]);
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const WEBP_RIFF = Buffer.from("RIFF");
const WEBP_MAGIC = Buffer.from("WEBP");

export function isAllowedImageBuffer(buffer: Buffer): boolean {
  if (buffer.length < 12) {
    return false;
  }
  if (buffer.subarray(0, 3).equals(JPEG.subarray(0, 3))) {
    return true;
  }
  if (buffer.subarray(0, 8).equals(PNG)) {
    return true;
  }
  if (
    buffer.subarray(0, 4).equals(WEBP_RIFF) &&
    buffer.subarray(8, 12).equals(WEBP_MAGIC)
  ) {
    return true;
  }
  return false;
}

const ALLOWED_MIME = new Set(["image/jpeg", "image/png", "image/webp"]);

export function isAllowedImageMime(mime: string | undefined): boolean {
  if (!mime) {
    return false;
  }
  return ALLOWED_MIME.has(mime.toLowerCase());
}
