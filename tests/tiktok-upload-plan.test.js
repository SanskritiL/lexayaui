const { _private } = require('../publish-service/src/platforms/tiktok');

const MB = 1024 * 1024;

function expectContinuousChunks(plan, videoSize) {
  expect(plan.totalChunks).toBe(plan.chunks.length);
  expect(plan.totalChunks).toBe(Math.floor(videoSize / plan.chunkSize));
  expect(plan.chunks[0].start).toBe(0);
  expect(plan.chunks[plan.chunks.length - 1].end).toBe(videoSize - 1);

  for (let i = 0; i < plan.chunks.length; i++) {
    const chunk = plan.chunks[i];
    expect(chunk.length).toBe(chunk.end - chunk.start + 1);
    if (i > 0) {
      expect(chunk.start).toBe(plan.chunks[i - 1].end + 1);
    }
  }
}

describe('TikTok upload chunk planning', () => {
  test('uses a single whole upload for videos at or below 64 MB', () => {
    const videoSize = 64 * MB;
    const plan = _private.buildTikTokUploadPlan(videoSize);

    expect(plan).toMatchObject({ chunkSize: videoSize, totalChunks: 1 });
    expect(plan.chunks).toEqual([{ start: 0, end: videoSize - 1, length: videoSize }]);
    expectContinuousChunks(plan, videoSize);
  });

  test('splits videos just over 64 MB into valid chunks', () => {
    const videoSize = (64 * MB) + 1;
    const plan = _private.buildTikTokUploadPlan(videoSize);

    expect(plan.totalChunks).toBe(2);
    expect(plan.chunkSize).toBe(Math.floor(videoSize / 2));
    expect(plan.chunks[0].length).toBeLessThanOrEqual(64 * MB);
    expect(plan.chunks[1].length).toBeLessThanOrEqual(128 * MB);
    expectContinuousChunks(plan, videoSize);
  });

  test('rounds chunk count down and merges trailing bytes into final chunk', () => {
    const videoSize = (130 * MB) + 123;
    const plan = _private.buildTikTokUploadPlan(videoSize);

    expect(plan.chunkSize).toBe(64 * MB);
    expect(plan.totalChunks).toBe(2);
    expect(plan.chunks[0].length).toBe(64 * MB);
    expect(plan.chunks[1].length).toBe(videoSize - (64 * MB));
    expect(plan.chunks[1].length).toBeGreaterThan(64 * MB);
    expect(plan.chunks[1].length).toBeLessThanOrEqual(128 * MB);
    expectContinuousChunks(plan, videoSize);
  });

  test('does not create tiny invalid trailing chunks', () => {
    const videoSize = (192 * MB) + 1;
    const plan = _private.buildTikTokUploadPlan(videoSize);

    expect(plan.chunkSize).toBe(64 * MB);
    expect(plan.totalChunks).toBe(3);
    expect(plan.chunks.map(chunk => chunk.length)).toEqual([
      64 * MB,
      64 * MB,
      (64 * MB) + 1,
    ]);
    expectContinuousChunks(plan, videoSize);
  });

  test('preserves TikTok-supported video content types', () => {
    expect(_private.getTikTokUploadContentType('video/quicktime; charset=binary')).toBe('video/quicktime');
    expect(_private.getTikTokUploadContentType('video/webm')).toBe('video/webm');
    expect(_private.getTikTokUploadContentType('application/octet-stream')).toBe('video/mp4');
  });
});
