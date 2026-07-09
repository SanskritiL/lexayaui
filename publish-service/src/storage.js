const crypto = require('crypto');
const { S3Client, HeadObjectCommand, PutObjectCommand } = require('@aws-sdk/client-s3');
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

async function createR2Upload({ userId, fileName, contentType, fileSizeBytes, fileSha256 }) {
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
  const fingerprint = getSafeSha256(fileSha256);
  const key = fingerprint
    ? `${userId}/media/${fingerprint}${extension}`
    : `${userId}/${new Date().toISOString().slice(0, 10)}/${crypto.randomUUID()}${extension}`;
  const publicUrl = `${publicBaseUrl.replace(/\/$/, '')}/${key}`;

  if (fingerprint) {
    const existing = await getExistingObject({ bucket, key, size, contentType });
    if (existing) {
      return {
        uploadUrl: null,
        key,
        publicUrl,
        maxBytes: MAX_UPLOAD_BYTES,
        expiresInSeconds: 0,
        existing: true,
      };
    }
  }

  const command = new PutObjectCommand({
    Bucket: bucket,
    Key: key,
    ContentType: contentType,
    ContentLength: size,
  });

  const uploadUrl = await getSignedUrl(getR2Client(), command, { expiresIn: 15 * 60 });

  return {
    uploadUrl,
    key,
    publicUrl,
    maxBytes: MAX_UPLOAD_BYTES,
    expiresInSeconds: 15 * 60,
    existing: false,
  };
}

async function verifyR2Upload({ userId, key, fileSizeBytes, contentType }) {
  const bucket = process.env.R2_BUCKET_NAME;
  if (!bucket) {
    throw new Error('R2_BUCKET_NAME is required');
  }

  const objectKey = String(key || '');
  if (!objectKey || !objectKey.startsWith(`${userId}/`)) {
    const err = new Error('Invalid upload key');
    err.statusCode = 400;
    throw err;
  }

  const expectedSize = Number(fileSizeBytes);
  if (!Number.isFinite(expectedSize) || expectedSize <= 0) {
    const err = new Error('fileSizeBytes must be a positive number');
    err.statusCode = 400;
    throw err;
  }

  const result = await getR2Client().send(new HeadObjectCommand({ Bucket: bucket, Key: objectKey }));
  const actualSize = Number(result.ContentLength || 0);
  const actualType = String(result.ContentType || '').split(';')[0].trim().toLowerCase();
  const expectedType = String(contentType || '').split(';')[0].trim().toLowerCase();

  if (actualSize !== expectedSize) {
    const err = new Error(`Upload verification failed: expected ${expectedSize} bytes, found ${actualSize}`);
    err.statusCode = 409;
    throw err;
  }

  if (expectedType && actualType && actualType !== expectedType) {
    const err = new Error(`Upload verification failed: expected ${expectedType}, found ${actualType}`);
    err.statusCode = 409;
    throw err;
  }

  return {
    ok: true,
    key: objectKey,
    size: actualSize,
    contentType: result.ContentType || null,
  };
}

async function getExistingObject({ bucket, key, size, contentType }) {
  try {
    const result = await getR2Client().send(new HeadObjectCommand({ Bucket: bucket, Key: key }));
    if (Number(result.ContentLength) !== size) return false;
    if (result.ContentType && result.ContentType !== contentType) return false;
    return true;
  } catch (err) {
    const statusCode = err?.$metadata?.httpStatusCode;
    if (statusCode === 404 || err?.name === 'NotFound') return false;
    throw err;
  }
}

function getSafeSha256(value) {
  const hash = String(value || '').toLowerCase();
  return /^[a-f0-9]{64}$/.test(hash) ? hash : '';
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

module.exports = { createR2Upload, verifyR2Upload, MAX_UPLOAD_BYTES };
