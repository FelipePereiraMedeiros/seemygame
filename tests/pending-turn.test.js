import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

describe('Pendência: credenciais TURN privadas exigem autenticação', () => {
  let handler;
  let upstream;
  beforeEach(async () => {
    vi.resetModules();
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('TURN_ALLOWED_ORIGINS', 'https://seemygame.com');
    vi.stubEnv('METERED_DOMAIN', 'provider.invalid');
    vi.stubEnv('METERED_API_KEY', 'synthetic-test-key');
    upstream = vi.fn(async () => ({ ok: true, json: async () => [
      { urls: 'turn:relay.invalid', username: 'synthetic-user', credential: 'synthetic-secret' }
    ] }));
    vi.stubGlobal('fetch', upstream);
    handler = (await import('../api/turn.js')).default;
  });
  afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); vi.restoreAllMocks(); });

  it.each([
    { origin: 'https://seemygame.com' },
    { origin: 'https://seemygame.com', authorization: 'Bearer invalid-test-token' }
  ])('não entrega credenciais a requisição não autenticada, mesmo com Origin permitido: %j', async headers => {
    const res = { statusCode: 200, body: undefined, setHeader: vi.fn(),
      status(code) { this.statusCode = code; return this; },
      json(body) { this.body = body; return this; } };
    await handler({ method: 'GET', headers, socket: { remoteAddress: '192.0.2.1' } }, res);
    expect.soft([401, 403]).toContain(res.statusCode);
    expect.soft(res.body?.iceServers).toBeUndefined();
    expect(upstream).not.toHaveBeenCalled();
  });

  it('mantém bloqueio de origem indevida antes de consultar o provedor', async () => {
    const res = { setHeader: vi.fn(), status: vi.fn().mockReturnThis(), json: vi.fn() };
    await handler({ method: 'GET', headers: { origin: 'https://evilseemygame.com' } }, res);
    expect(res.status).toHaveBeenCalledWith(403);
    expect(upstream).not.toHaveBeenCalled();
  });
});
