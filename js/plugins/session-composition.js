import {
  createWhiteboardPlugin,
  createSoundboardPlugin,
  createTacticalPingPlugin,
  createReactionsPlugin,
  createClippingPlugin
} from './factories.js';
import { bindWhiteboardUI } from '../whiteboard-ui.js';

export function registerSessionFeatures(session, {
  role,
  broadcastDataMessage = () => {},
  getViewersCount = () => 0,
  getDisplayName = () => 'Jogador',
  showToast = () => {},
  chatManager = null,
  getPeerId = () => null,
  getRole = () => 'viewer',
  includeClipping = false
} = {}) {
  const plugins = [
    createWhiteboardPlugin(),
    createSoundboardPlugin(),
    createTacticalPingPlugin(),
    createReactionsPlugin()
  ];
  if (includeClipping) plugins.push(createClippingPlugin());
  for (const plugin of plugins) session.pluginManager.register(plugin);

  session.pluginManager.initAll({
    role,
    broadcastDataMessage,
    getViewersCount,
    getDisplayName,
    isRoomMode: () => role === 'room',
    showToast
  });

  const whiteboard = session.pluginManager.get('whiteboard');
  const ping = session.pluginManager.get('tactical-ping');
  const reactions = session.pluginManager.get('reactions');
  const getElement = (id) => typeof document !== 'undefined' ? document.getElementById(id) : null;
  whiteboard?.manager.setCanvas?.(getElement('whiteboard-canvas'));
  ping?.bindCanvas(getElement('ping-canvas'));
  reactions?.bindDOM(
    getElement('reactions-overlay'),
    getElement('reactions-dock')
  );
  const whiteboardUI = bindWhiteboardUI(whiteboard?.manager, {
    broadcast: broadcastDataMessage,
    chatManager,
    peerId: getPeerId,
    displayName: getDisplayName,
    role: getRole,
    showToast
  });
  session.registerCleanup(() => whiteboardUI.destroy());
  return { plugins, whiteboard, whiteboardUI, soundboard: session.pluginManager.get('soundboard'), ping, reactions, clipping: session.pluginManager.get('clipping') };
}
