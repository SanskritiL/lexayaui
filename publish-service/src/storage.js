const { S3Client, PutObjectCommand, DeleteObjectCommand } = require('@aws-sdk/client-s3');
const { getSignedUrl } = require('@aws-sdk/s3-request-presigner');

// R2 / S3-compatible storage (default — works as drop-in for your current setup)
function getR2Client() {
  const accountId = process.env.R2_ACCOUNT_ID || '20ed24d883ada4e35ecd4e48ae90ab27';
  return new S3Client({
    region: 'auto',
    endpoint: `https://${accountId}.r2.cloudflarestorage.com`,
    credentials: {
      accessKeyId: (process.env.R2_ACCESS_KEY_ID || '').trim(),
      secretAccessKey: (process.env.R2_SECRET_ACCESS_KEY || '').trim(),
    },
  });
}

function getR2Bucket() {
  return (process.env.R2_BUCKET_NAME || 'lexaya-videos').trim();
}

function getR2PublicUrl() {
  return (process.env.R2_PUBLIC_URL || 'https://pub-d8491ccfbb3a45e2bb038d9ae60a1957.r2.dev').trim();
}

async function generateUploadUrl(fileName, contentType, userId) {
  const timestamp = Date.now();
  const safeName = fileName.replace(/[^a-zA-Z0-9.-]/g, '_');
  const key = `${userId}/${timestamp}_${safeName}`;

  const client = getR2Client();
  const command = new PutObjectCommand({
    Bucket: getR2Bucket(),
    Key: key,
    ContentType: contentType,
  });

  const uploadUrl = await getSignedUrl(client, command, { expiresIn: 3600 });
  const publicUrl = `${getR2PublicUrl()}/${key}`;

  return { uploadUrl, key, publicUrl };
}

async function deleteFile(key) {
  const client = getR2Client();
  await client.send(new DeleteObjectCommand({
    Bucket: getR2Bucket(),
    Key: key,
  }));
}

module.exports = { generateUploadUrl, deleteFile, getR2Client, getR2Bucket, getR2PublicUrl };
