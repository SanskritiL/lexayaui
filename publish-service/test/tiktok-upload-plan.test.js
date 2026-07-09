const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { ReadableStream } = require('node:stream/web');

const {
  buildTikTokUploadPlan,
  createChunkSource,
  isRetryableTikTokUploadFailure,
  readTikTokUploadErrorCode,
  TIKTOK_MAX_CHUNK_SIZE,
  TIKTOK_MAX_FINAL_CHUNK_SIZE,
} = require('../src/platforms/tiktok')._private;

test('uses a whole upload for files at or below TikTok max chunk size', () => {
  const plan = buildTikTokUploadPlan(TIKTOK_MAX_CHUNK_SIZE);

  assert.equal(plan.chunkSize, TIKTOK_MAX_CHUNK_SIZE);
  assert.equal(plan.totalChunks, 1);
  assert.deepEqual(plan.chunks, [{
    start: 0,
    end: TIKTOK_MAX_CHUNK_SIZE - 1,
    length: TIKTOK_MAX_CHUNK_SIZE,
  }]);
});

test('splits files just over max chunk size into two valid chunks', () => {
  const videoSize = TIKTOK_MAX_CHUNK_SIZE + 1;
  const plan = buildTikTokUploadPlan(videoSize);

  assert.equal(plan.totalChunks, 2);
  assert.ok(plan.chunkSize <= TIKTOK_MAX_CHUNK_SIZE);
  assert.ok(plan.chunks[0].length <= TIKTOK_MAX_CHUNK_SIZE);
  assert.ok(plan.chunks[1].length <= TIKTOK_MAX_CHUNK_SIZE);
  assert.equal(plan.chunks[1].end, videoSize - 1);
});

test('uses the largest decimal chunk size for large files', () => {
  const videoSize = 500 * 1024 * 1024;
  const plan = buildTikTokUploadPlan(videoSize);
  const last = plan.chunks.at(-1);

  assert.equal(plan.chunkSize, TIKTOK_MAX_CHUNK_SIZE);
  assert.equal(plan.totalChunks, Math.floor(videoSize / TIKTOK_MAX_CHUNK_SIZE));
  assert.ok(last.length <= TIKTOK_MAX_FINAL_CHUNK_SIZE);
  assert.equal(last.end, videoSize - 1);
});

test('reads exact chunk lengths from a stream without losing byte order', async () => {
  const body = new ReadableStream({
    start(controller) {
      controller.enqueue(Buffer.from('abc'));
      controller.enqueue(Buffer.from('defgh'));
      controller.enqueue(Buffer.from('ijk'));
      controller.close();
    },
  });
  const source = createChunkSource(body);

  assert.equal((await source.read(4)).toString(), 'abcd');
  assert.equal((await source.read(3)).toString(), 'efg');
  assert.equal((await source.read(4)).toString(), 'hijk');
});

test('reads exact chunk lengths from a file without losing byte order', async (t) => {
  const filePath = path.join(os.tmpdir(), `tiktok-upload-test-${Date.now()}`);
  await fs.writeFile(filePath, 'abcdefghijk');
  t.after(async () => {
    await fs.unlink(filePath).catch(() => {});
  });

  const source = createChunkSource({ filePath });
  t.after(async () => {
    if (source.close) await source.close();
  });

  assert.equal((await source.read(4)).toString(), 'abcd');
  assert.equal((await source.read(3)).toString(), 'efg');
  assert.equal((await source.read(4)).toString(), 'hijk');
}
);

test('retries TikTok upload server and request-id failures', () => {
  const requestIdError = JSON.stringify({ code: 50001, message: 'missing or invalid request id' });

  assert.equal(readTikTokUploadErrorCode(requestIdError), 50001);
  assert.equal(isRetryableTikTokUploadFailure(500, requestIdError), true);
  assert.equal(isRetryableTikTokUploadFailure(400, requestIdError), true);
  assert.equal(isRetryableTikTokUploadFailure(429, '{}'), true);
  assert.equal(isRetryableTikTokUploadFailure(400, '{"code":10002}'), false);
});
