const assert = require('node:assert/strict');
const test = require('node:test');

const {
  confirmTikTokPublish,
  describeTikTokFailReason,
} = require('../src/platforms/tiktok')._private;

function stubStatusResponses(statuses) {
  const original = globalThis.fetch;
  const calls = [];

  globalThis.fetch = async (url, options) => {
    calls.push(JSON.parse(options.body).publish_id);
    const next = statuses.shift();
    if (next instanceof Error) throw next;
    return {
      text: async () => JSON.stringify({ data: next, error: { code: 'ok' } }),
    };
  };

  return { calls, restore: () => { globalThis.fetch = original; } };
}

test('reports success once TikTok settles the upload', async (t) => {
  const stub = stubStatusResponses([
    { status: 'PROCESSING_UPLOAD' },
    { status: 'SEND_TO_USER_INBOX' },
  ]);
  t.after(stub.restore);

  const result = await confirmTikTokPublish('token', 'publish-1');

  assert.equal(result.status, 'success');
  assert.equal(result.publish_id, 'publish-1');
  assert.deepEqual(stub.calls, ['publish-1', 'publish-1']);
});

test('surfaces a processing rejection instead of reporting success', async (t) => {
  const stub = stubStatusResponses([
    { status: 'PROCESSING_UPLOAD' },
    { status: 'FAILED', fail_reason: 'duration_check_failed' },
  ]);
  t.after(stub.restore);

  await assert.rejects(
    () => confirmTikTokPublish('token', 'publish-2'),
    /between 3 seconds and 10 minutes/
  );
});

test('does not fail the upload when status checks themselves are flaky', async (t) => {
  const stub = stubStatusResponses([
    new Error('socket hang up'),
    { status: 'PUBLISH_COMPLETE' },
  ]);
  t.after(stub.restore);

  const result = await confirmTikTokPublish('token', 'publish-3');

  assert.equal(result.status, 'success');
});

test('falls back to pending when processing never settles', async (t) => {
  const stub = stubStatusResponses(
    Array.from({ length: 10 }, () => ({ status: 'PROCESSING_UPLOAD' }))
  );
  t.after(stub.restore);

  const result = await confirmTikTokPublish('token', 'publish-4');

  assert.equal(result.status, 'pending');
  assert.match(result.note, /still processing/);
});

test('describes unknown fail reasons without losing the raw code', () => {
  assert.match(describeTikTokFailReason('file_format_check_failed'), /MP4/);
  assert.match(describeTikTokFailReason('some_new_reason'), /some_new_reason/);
  assert.match(describeTikTokFailReason(null), /could not process/);
});
