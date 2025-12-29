import { S3Client, PutObjectCommand, DeleteObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { createClient } from '@supabase/supabase-js';

console.log('========== UPLOAD-VIDEO API INIT ==========');

// R2 Configuration
const R2_ACCOUNT_ID = '20ed24d883ada4e35ecd4e48ae90ab27';
const R2_BUCKET = process.env.R2_BUCKET_NAME || 'lexaya-videos';

console.log('[R2 CONFIG] Account ID:', R2_ACCOUNT_ID);
console.log('[R2 CONFIG] Bucket:', R2_BUCKET);
console.log('[R2 CONFIG] Access Key ID:', process.env.R2_ACCESS_KEY_ID ? 'SET (' + process.env.R2_ACCESS_KEY_ID.substring(0, 8) + '...)' : 'NOT SET');
console.log('[R2 CONFIG] Secret Access Key:', process.env.R2_SECRET_ACCESS_KEY ? 'SET' : 'NOT SET');
console.log('[R2 CONFIG] Supabase URL:', process.env.SUPABASE_URL ? 'SET' : 'NOT SET');
console.log('[R2 CONFIG] Supabase Service Key:', process.env.SUPABASE_SERVICE_KEY ? 'SET' : 'NOT SET');

let r2Client;
try {
    r2Client = new S3Client({
        region: 'auto',
        endpoint: `https://${R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
        credentials: {
            accessKeyId: process.env.R2_ACCESS_KEY_ID || '',
            secretAccessKey: process.env.R2_SECRET_ACCESS_KEY || '',
        },
    });
    console.log('[R2 CONFIG] S3Client created successfully');
} catch (e) {
    console.error('[R2 CONFIG] Failed to create S3Client:', e.message);
}

// Supabase for auth verification
const supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_KEY
);

export default async function handler(req, res) {
    console.log('========== UPLOAD-VIDEO REQUEST ==========');
    console.log('[REQUEST] Method:', req.method);
    console.log('[REQUEST] Body:', JSON.stringify(req.body));

    // CORS
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST, DELETE, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

    if (req.method === 'OPTIONS') {
        console.log('[REQUEST] OPTIONS preflight, returning 200');
        return res.status(200).end();
    }

    // Check if R2 client is configured
    if (!r2Client) {
        console.error('[ERROR] R2 client not initialized');
        return res.status(500).json({ error: 'R2 storage not configured' });
    }

    if (!process.env.R2_ACCESS_KEY_ID || !process.env.R2_SECRET_ACCESS_KEY) {
        console.error('[ERROR] R2 credentials missing');
        return res.status(500).json({ error: 'R2 credentials not configured' });
    }

    // Verify auth for all methods
    const authHeader = req.headers.authorization;
    console.log('[AUTH] Header present:', !!authHeader);

    if (!authHeader?.startsWith('Bearer ')) {
        console.log('[AUTH] Missing or invalid authorization header');
        return res.status(401).json({ error: 'Missing authorization' });
    }

    const token = authHeader.replace('Bearer ', '');
    console.log('[AUTH] Verifying token...');

    const { data: { user }, error: authError } = await supabase.auth.getUser(token);

    if (authError || !user) {
        console.log('[AUTH] Token verification failed:', authError?.message);
        return res.status(401).json({ error: 'Invalid token' });
    }

    console.log('[AUTH] User verified:', user.id);

    // DELETE - Remove video from R2
    if (req.method === 'DELETE') {
        try {
            const { key } = req.body;

            if (!key) {
                return res.status(400).json({ error: 'Missing key' });
            }

            // Security: Only allow deleting files in user's folder
            if (!key.startsWith(`${user.id}/`)) {
                return res.status(403).json({ error: 'Not authorized to delete this file' });
            }

            console.log('[R2] Deleting:', key);

            await r2Client.send(new DeleteObjectCommand({
                Bucket: R2_BUCKET,
                Key: key,
            }));

            console.log('[R2] Deleted successfully:', key);
            return res.status(200).json({ success: true, deleted: key });

        } catch (error) {
            console.error('[R2] Delete error:', error);
            return res.status(500).json({ error: error.message });
        }
    }

    // POST - Get presigned upload URL
    if (req.method === 'POST') {
        console.log('[POST] Processing upload URL request...');
        try {
            const { fileName, contentType } = req.body;
            console.log('[POST] fileName:', fileName, 'contentType:', contentType);

            if (!fileName || !contentType) {
                console.log('[POST] Missing fileName or contentType');
                return res.status(400).json({ error: 'Missing fileName or contentType' });
            }

            // Generate unique file path
            const timestamp = Date.now();
            const safeName = fileName.replace(/[^a-zA-Z0-9.-]/g, '_');
            const key = `${user.id}/${timestamp}_${safeName}`;

            console.log('[POST] Generated key:', key);
            console.log('[POST] Creating PutObjectCommand...');

            // Generate presigned URL for direct upload
            const command = new PutObjectCommand({
                Bucket: R2_BUCKET,
                Key: key,
                ContentType: contentType,
            });

            console.log('[POST] Getting signed URL...');
            const uploadUrl = await getSignedUrl(r2Client, command, { expiresIn: 3600 });
            console.log('[POST] Signed URL generated, length:', uploadUrl.length);

            // Public URL - R2 public bucket URL from Cloudflare dashboard
            const R2_PUBLIC_URL = process.env.R2_PUBLIC_URL || 'https://pub-d8491ccfbb3a45e2bb038d9ae60a1957.r2.dev';
            const publicUrl = `${R2_PUBLIC_URL}/${key}`;

            console.log('[POST] Success! Public URL:', publicUrl);

            return res.status(200).json({
                uploadUrl,
                key,
                publicUrl,
                bucket: R2_BUCKET
            });

        } catch (error) {
            console.error('[POST] Error:', error.message);
            console.error('[POST] Stack:', error.stack);
            return res.status(500).json({ error: error.message });
        }
    }

    return res.status(405).json({ error: 'Method not allowed' });
}
