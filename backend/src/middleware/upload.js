const multer = require('multer');
const path = require('path');
const crypto = require('crypto');

// SVG excluded — can contain <script> tags (stored XSS)
const ALLOWED_TYPES = {
  'image/jpeg':       'jpg',
  'image/png':        'png',
  'image/gif':        'gif',
  'image/webp':       'webp',
  'video/mp4':        'mp4',
  'video/webm':       'webm',
  'audio/mpeg':       'mp3',
  'audio/ogg':        'ogg',
  'audio/wav':        'wav',
  'audio/webm':       'webm',
  'application/pdf':  'pdf',
  'text/plain':       'txt',
};

// Derive safe extension from MIME type — never trust client-supplied filename
const safeExtension = (mimetype) => ALLOWED_TYPES[mimetype] ?? 'bin';

const storage = multer.memoryStorage();

const fileFilter = (req, file, cb) => {
  if (ALLOWED_TYPES[file.mimetype]) {
    cb(null, true);
  } else {
    cb(new Error(`File type not allowed: ${file.mimetype}`), false);
  }
};

const upload = multer({
  storage,
  fileFilter,
  limits: { fileSize: 25 * 1024 * 1024 }, // 25 MB
});

module.exports = { upload, safeExtension };
