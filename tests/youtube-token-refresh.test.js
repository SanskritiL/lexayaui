const { _private } = require('../publish-service/src/platforms/youtube');

describe('YouTube token refresh', () => {
  const originalFetch = global.fetch;
  const originalEnv = { ...process.env };

  beforeEach(() => {
    jest.spyOn(console, 'error').mockImplementation(() => {});
    process.env.YOUTUBE_CLIENT_ID = 'youtube-client-id';
    process.env.YOUTUBE_CLIENT_SECRET = 'youtube-client-secret';
    global.fetch = jest.fn();
  });

  afterEach(() => {
    global.fetch = originalFetch;
    process.env = { ...originalEnv };
    jest.restoreAllMocks();
  });

  test('exchanges a refresh token for a new YouTube access token', async () => {
    global.fetch.mockResolvedValue({
      ok: true,
      status: 200,
      text: async () => JSON.stringify({
        access_token: 'new-youtube-access-token',
        expires_in: 3600,
      }),
    });

    const result = await _private.refreshYouTubeToken('old-youtube-refresh-token');

    expect(result.access_token).toBe('new-youtube-access-token');
    expect(global.fetch).toHaveBeenCalledWith(
      'https://oauth2.googleapis.com/token',
      expect.objectContaining({
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: expect.any(URLSearchParams),
      }),
    );

    const body = global.fetch.mock.calls[0][1].body;
    expect(body.get('grant_type')).toBe('refresh_token');
    expect(body.get('refresh_token')).toBe('old-youtube-refresh-token');
    expect(body.get('client_id')).toBe('youtube-client-id');
    expect(body.get('client_secret')).toBe('youtube-client-secret');
  });

  test('fails before calling Google when app credentials are missing', async () => {
    delete process.env.YOUTUBE_CLIENT_SECRET;

    await expect(_private.refreshYouTubeToken('old-youtube-refresh-token'))
      .rejects.toThrow('YouTube token refresh is not configured');

    expect(global.fetch).not.toHaveBeenCalled();
  });

  test('asks for reconnect when Google rejects the refresh token', async () => {
    global.fetch.mockResolvedValue({
      ok: false,
      status: 400,
      text: async () => JSON.stringify({
        error: 'invalid_grant',
        error_description: 'Token has been expired or revoked.',
      }),
    });

    await expect(_private.refreshYouTubeToken('expired-youtube-refresh-token'))
      .rejects.toThrow('YouTube token expired. Please reconnect your YouTube account.');
  });

  test('updates the connected account when the stored access token is expired', async () => {
    global.fetch.mockResolvedValue({
      ok: true,
      status: 200,
      text: async () => JSON.stringify({
        access_token: 'fresh-access-token',
        expires_in: 3600,
      }),
    });

    const update = jest.fn(() => ({ eq: jest.fn().mockResolvedValue({}) }));
    const supabase = { from: jest.fn(() => ({ update })) };
    const account = {
      id: 'account-id',
      access_token: 'old-access-token',
      refresh_token: 'refresh-token',
      token_expires_at: new Date(Date.now() - 1000).toISOString(),
    };

    const accessToken = await _private.getValidYouTubeAccessToken(account, supabase);

    expect(accessToken).toBe('fresh-access-token');
    expect(update).toHaveBeenCalledWith(expect.objectContaining({
      access_token: 'fresh-access-token',
      token_expires_at: expect.any(String),
    }));
  });
});
