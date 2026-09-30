import { afterEach, expect, it, vi } from 'vitest';
const ipc = vi.hoisted(() => ({ create: vi.fn(), close: vi.fn(async () => {}), ice: vi.fn(async () => {}) }));
vi.mock('../js/desktop.js', () => ({ createNativeViewerPeer: ipc.create, closeNativeViewerPeer: ipc.close, addNativeViewerIceCandidate: ipc.ice, listenNativeCaptureBridge: vi.fn(), isDesktopApp: () => false }));
vi.mock('../js/ui.js', () => ({ addOrUpdateVideoCard: vi.fn(), removeVideoCard: vi.fn() }));
import { createSessionContext } from '../js/core/session-context.js';
import { NativeMediaPlugin } from '../js/plugins/native-media-plugin.js';
afterEach(() => vi.clearAllMocks());
function fixture() {
  const session = createSessionContext(); session.getPeerId = () => 'host';
  const provider = { session: { sessionId: 'capture-a' } };
  const plugin = new NativeMediaPlugin({ session, getProvider: () => provider, isAuthorized: id => id === 'guest' });
  session.pluginManager.register(plugin); session.pluginManager.initAll();
  const conn = { peer: 'guest', open: true, send: vi.fn() };
  return { session, provider, plugin, conn };
}
it('gates direct stream negotiation by admission and capture identity', async () => {
  const { session, plugin, conn } = fixture();
  expect(plugin.broadcastTo({ ...conn, peer: 'intruder' })).toBe(false);
  session.dispatcher.dispatch({ type: 'DIRECT_STREAM_OFFER', sessionId: 'capture-a', sdp: 'offer' }, { ...conn, peer: 'intruder' });
  await plugin.answer({ sessionId: 'obsolete-capture', sdp: 'offer' }, conn);
  expect(ipc.create).not.toHaveBeenCalled();
  expect(plugin.broadcastTo(conn)).toBe(true); expect(conn.send.mock.calls[0][0].senderPeerId).toBe('host');
  await session.disposeAsync();
});
it('closes a native peer whose negotiation completes after disposal without sending an answer', async () => {
  const { session, plugin, conn } = fixture(); let finish;
  ipc.create.mockImplementation(() => new Promise(resolve => { finish = resolve; }));
  const pending = plugin.answer({ sessionId: 'capture-a', sdp: 'offer' }, conn);
  session.dispose(); finish({ sdp: 'answer' }); await pending; await session.disposeAsync();
  expect(ipc.close).toHaveBeenCalledWith('capture-a', 'guest'); expect(conn.send).not.toHaveBeenCalled();
});
