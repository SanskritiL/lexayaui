const crypto = require('crypto');
const { S3Client, PutObjectCommand } = require('@aws-sdk/client-s3');
const { getSignedUrl } = require('@aws-sdk/s3-request-presigner');

const MAX_UPLOAD_BYTES = 500 * 1024 * 1024;
const ALLOWED_CONTENT_TYPES = new Set([
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/gif',
  'video/mp4',
  'video/quicktime',
  'video/mov',
]);

let r2Client = null;

function getR2Client() {
  if (r2Client) return r2Client;

  const accountId = process.env.R2_ACCOUNT_ID;
  const endpoint = process.env.R2_ENDPOINT || (accountId ? `https://${accountId}.r2.cloudflarestorage.com` : null);
  const accessKeyId = process.env.R2_ACCESS_KEY_ID;
  const secretAccessKey = process.env.R2_SECRET_ACCESS_KEY;

  if (!endpoint || !accessKeyId || !secretAccessKey) {
    throw new Error('R2_ENDPOINT or R2_ACCOUNT_ID plus R2 credentials are required');
  }

  r2Client = new S3Client({
    region: 'auto',
    endpoint,
    credentials: { accessKeyId, secretAccessKey },
  });
  return r2Client;
}

async function createR2Upload({ userId, fileName, contentType, fileSizeBytes }) {
  const bucket = process.env.R2_BUCKET_NAME;
  const publicBaseUrl = process.env.R2_PUBLIC_URL;

  if (!bucket || !publicBaseUrl) {
    throw new Error('R2_BUCKET_NAME and R2_PUBLIC_URL are required');
  }

  const size = Number(fileSizeBytes);
  if (!Number.isFinite(size) || size <= 0) {
    const err = new Error('fileSizeBytes must be a positive number');
    err.statusCode = 400;
    throw err;
  }
  if (size > MAX_UPLOAD_BYTES) {
    const err = new Error('File is too large. Max upload size is 500 MB.');
    err.statusCode = 413;
    throw err;
  }
  if (!ALLOWED_CONTENT_TYPES.has(contentType)) {
    const err = new Error('Unsupported file type');
    err.statusCode = 400;
    throw err;
  }

  const extension = getSafeExtension(fileName, contentType);
  const key = `${userId}/${new Date().toISOString().slice(0, 10)}/${crypto.randomUUID()}${extension}`;
  const command = new PutObjectCommand({
    Bucket: bucket,
    Key: key,
    ContentType: contentType,
    ContentLength: size,
  });

  const uploadUrl = await getSignedUrl(getR2Client(), command, { expiresIn: 15 * 60 });
  const publicUrl = `${publicBaseUrl.replace(/\/$/, '')}/${key}`;

  return {
    uploadUrl,
    key,
    publicUrl,
    maxBytes: MAX_UPLOAD_BYTES,
    expiresInSeconds: 15 * 60,
  };
}

function getSafeExtension(fileName, contentType) {
  const cleanName = String(fileName || '').toLowerCase();
  const match = cleanName.match(/\.[a-z0-9]{1,8}$/);
  if (match) return match[0];

  if (contentType === 'image/jpeg') return '.jpg';
  if (contentType === 'image/png') return '.png';
  if (contentType === 'image/webp') return '.webp';
  if (contentType === 'image/gif') return '.gif';
  if (contentType === 'video/quicktime' || contentType === 'video/mov') return '.mov';
  return '.mp4';
}

module.exports = { createR2Upload, MAX_UPLOAD_BYTES };
