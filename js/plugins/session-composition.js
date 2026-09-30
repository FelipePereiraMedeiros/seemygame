import { SoundboardManager } from '../soundboard.js';
import { TacticalPingManager } from '../ping.js';
import { ClipRecorderRegistry } from '../clipping.js';
import {
  createWhiteboardPlugin,
  createSoundboardPlugin,
  createTacticalPingPlugin,
  createReactionsPlugin,
  createClippingPlugin
} from './factories.js';
import { bindWhiteboardUI } from '../whiteboard-ui.js';
import { bindClipEditor } from '../clipping/editor-controller.js';
import { NativeMediaPlugin } from './native-media-plugin.js';

export function registerSessionFeatures(session, {
  role,
  broadcastDataMessage = () => {},
  getViewersCount = () => 0,
  getDisplayName = () => 'Jogador',
  showToast = () => {},
  chatManager = null,
  getPeerId = () => null,
  getRole = () => 'viewer',
  includeClipping = false,
  getCaptureProvider = () => null,
  isAuthorizedPeer = () => false
} = {}) {
  const plugins = [
    createWhiteboardPlugin(),
    createSoundboardPlugin({ manager: new SoundboardManager({ audioScope: session.audioScope }) }),
    createTacticalPingPlugin({ manager: new TacticalPingManager({ audioScope: session.audioScope }) }),
    createReactionsPlugin()
  ];
  if (includeClipping) plugins.push(createClippingPlugin({ recorder: new ClipRecorderRegistry({ audioScope: session.audioScope }) }));
  plugins.push(new NativeMediaPlugin({ session, getProvider: getCaptureProvider, isAuthorized: isAuthorizedPeer,
    onClip: sourceId => session.pluginManager.get('clipping')?.recorder.exportClip(null, sourceId)
  }));
  for (const plugin of plugins) session.pluginManager.register(plugin);

  session.pluginManager.initAll({
    role,
    broadcastDataMessage,
    getViewersCount,
    getDisplayName,
    isRoomMode: () => role === 'room',
    audioScope: session.audioScope,
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
  const soundboard = session.pluginManager.get('soundboard');
  const clipping = session.pluginManager.get('clipping');
  const clipEditor = clipping && typeof document !== 'undefined' ? bindClipEditor(session, {
    recorder: clipping.recorder, soundboardManager: soundboard?.manager,
    showToast, broadcastDataMessage, getPeerId
  }) : null;
  return { plugins, whiteboard, whiteboardUI, soundboard, ping, reactions, clipping, clipEditor, nativeMedia: session.pluginManager.get('native-media') };
}
