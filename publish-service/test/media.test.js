const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const test = require('node:test');
const { ReadableStream } = require('node:stream/web');

const { fetchMediaFile, fetchMediaStream } = require('../src/media');

test('fetchMediaStream prefers response content length over stale metadata size', async (t) => {
  const originalFetch = global.fetch;
  const originalWarn = console.warn;
  const warnings = [];
  const body = new ReadableStream({
    start(controller) {
      controller.enqueue(Buffer.from('abc'));
      controller.close();
    },
  });

  t.after(() => {
    global.fetch = originalFetch;
    console.warn = originalWarn;
  });

  console.warn = (...args) => warnings.push(args);
  global.fetch = async (url, options = {}) => {
    assert.equal(url, 'https://media.example/video.mp4');
    assert.notEqual(options.method, 'HEAD');
    return new Response(body, {
      status: 200,
      headers: {
        'content-length': '3',
        'content-type': 'video/mp4',
      },
    });
  };

  const media = await fetchMediaStream({
    video_url: 'https://media.example/video.mp4',
    metadata: {
      file_size_bytes: 10,
      content_type: 'video/mp4',
      media_type: 'video',
    },
  });

  assert.equal(media.size, 3);
  assert.equal(media.contentType, 'video/mp4');
  assert.equal(media.body, body);
  assert.equal(warnings.length, 1);
});

test('fetchMediaFile writes a complete verified download and cleans it up', async (t) => {
  const originalFetch = global.fetch;
  const body = new ReadableStream({
    start(controller) {
      controller.enqueue(Buffer.from('abcde'));
      controller.close();
    },
  });

  t.after(() => {
    global.fetch = originalFetch;
  });

  global.fetch = async (url, options = {}) => {
    assert.equal(url, 'https://media.example/video.mp4');
    assert.notEqual(options.method, 'HEAD');
    return new Response(body, {
      status: 200,
      headers: {
        'content-length': '5',
        'content-type': 'video/mp4',
      },
    });
  };

  const media = await fetchMediaFile({
    video_url: 'https://media.example/video.mp4',
    metadata: {
      file_size_bytes: 5,
      content_type: 'video/mp4',
      media_type: 'video',
    },
  }, { attempts: 1 });

  assert.equal(media.size, 5);
  assert.equal(media.contentType, 'video/mp4');
  assert.equal((await fs.readFile(media.filePath)).toString(), 'abcde');

  await media.cleanup();
  await assert.rejects(fs.access(media.filePath));
});
