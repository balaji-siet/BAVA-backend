const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const MAX_IMAGE_SIZE_BYTES = 5 * 1024 * 1024; // 5 MB

const UPLOAD_DIR = path.join(__dirname, '../../uploads/feedback');

function ensureUploadDir() {
  if (!fs.existsSync(UPLOAD_DIR)) {
    fs.mkdirSync(UPLOAD_DIR, { recursive: true });
  }
}

/**
 * Detect image type based on magic bytes.
 * Returns 'jpeg' | 'png' | 'webp' | null
 */
function detectImageType(buffer) {
  if (!buffer || buffer.length < 12) return null;

  // JPEG: FF D8 FF
  if (buffer[0] === 0xFF && buffer[1] === 0xD8 && buffer[2] === 0xFF) {
    return 'jpg';
  }

  // PNG: 89 50 4E 47 0D 0A 1A 0A
  if (
    buffer[0] === 0x89 && buffer[1] === 0x50 && buffer[2] === 0x4E && buffer[3] === 0x47 &&
    buffer[4] === 0x0D && buffer[5] === 0x0A && buffer[6] === 0x1A && buffer[7] === 0x0A
  ) {
    return 'png';
  }

  // WEBP: RIFF .... WEBP
  if (
    buffer[0] === 0x52 && buffer[1] === 0x49 && buffer[2] === 0x46 && buffer[3] === 0x46 &&
    buffer[8] === 0x57 && buffer[9] === 0x45 && buffer[10] === 0x42 && buffer[11] === 0x50
  ) {
    return 'webp';
  }

  return null;
}

/**
 * Inspect buffer for dangerous scripts, HTML, SVG, or executable signatures.
 */
function isDangerousContent(buffer) {
  if (!buffer || buffer.length === 0) return true;

  // Check for DOS/Windows executable header (MZ)
  if (buffer[0] === 0x4D && buffer[1] === 0x5A) return true;
  // Check for Linux ELF header (7F 45 4C 46)
  if (buffer[0] === 0x7F && buffer[1] === 0x45 && buffer[2] === 0x4C && buffer[3] === 0x46) return true;

  const sample = buffer.subarray(0, Math.min(buffer.length, 1024)).toString('utf8').toLowerCase();
  if (
    sample.includes('<script') ||
    sample.includes('<html') ||
    sample.includes('<!doctype') ||
    sample.includes('<svg') ||
    sample.includes('<?php') ||
    sample.includes('javascript:')
  ) {
    return true;
  }

  return false;
}

/**
 * Process base64 or raw buffer image data, validate format and size, and save to uploads folder.
 * Returns { success: true, photoUrl: string } or { success: false, error: string }
 */
function processAndStoreImage(imageData) {
  if (!imageData) {
    return { success: true, photoUrl: '' };
  }

  let buffer;
  if (Buffer.isBuffer(imageData)) {
    buffer = imageData;
  } else if (typeof imageData === 'string') {
    // Strip data URI header if present (e.g. data:image/jpeg;base64,...)
    const base64Index = imageData.indexOf(';base64,');
    let cleanBase64 = imageData;
    if (base64Index !== -1) {
      cleanBase64 = imageData.substring(base64Index + 8);
    } else if (imageData.startsWith('data:') && imageData.includes(',')) {
      cleanBase64 = imageData.substring(imageData.indexOf(',') + 1);
    }
    try {
      buffer = Buffer.from(cleanBase64.trim(), 'base64');
    } catch (e) {
      return { success: false, error: 'Malformed base64 image data' };
    }
  } else {
    return { success: false, error: 'Invalid image data type' };
  }

  if (buffer.length === 0) {
    return { success: false, error: 'Empty image file' };
  }

  if (buffer.length > MAX_IMAGE_SIZE_BYTES) {
    return { success: false, statusCode: 413, error: 'Photo is too large. Please choose an image under 5 MB.' };
  }

  if (isDangerousContent(buffer)) {
    return { success: false, statusCode: 415, error: 'Unsupported or unsafe file format. Allowed: JPEG, PNG, WEBP.' };
  }

  const ext = detectImageType(buffer);
  if (!ext) {
    return { success: false, statusCode: 415, error: 'Invalid image format. Allowed formats: JPEG, PNG, WEBP.' };
  }

  try {
    ensureUploadDir();
    const filename = `${Date.now()}_${crypto.randomBytes(12).toString('hex')}.${ext}`;
    const filePath = path.join(UPLOAD_DIR, filename);

    fs.writeFileSync(filePath, buffer);

    return {
      success: true,
      photoUrl: `/uploads/feedback/${filename}`
    };
  } catch (fsErr) {
    console.warn('Filesystem write fallback, storing optimized data URI:', fsErr.message);
    const mime = ext === 'jpg' ? 'image/jpeg' : (ext === 'png' ? 'image/png' : 'image/webp');
    return {
      success: true,
      photoUrl: `data:${mime};base64,${buffer.toString('base64')}`
    };
  }
}

module.exports = {
  processAndStoreImage,
  detectImageType,
  isDangerousContent,
  MAX_IMAGE_SIZE_BYTES,
  UPLOAD_DIR
};
