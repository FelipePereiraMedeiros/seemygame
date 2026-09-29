/**
 * SeeMyGame - WhiteboardPlugin (Isolated Feature Plugin)
 * 
 * Encapsula o ciclo de vida da lousa colaborativa vetorial (Excalidraw-style),
 * registro de mensagens P2P na rede e listeners de canvas.
 */

import { BasePlugin } from './base-plugin.js';
import { whiteboardManager } from '../whiteboard.js';

export class WhiteboardPlugin extends BasePlugin {
  constructor(options = {}) {
    super('whiteboard', options);
    this.manager = options.manager || whiteboardManager;
    this._dispatcherUnsubs = [];
  }

  setupListeners() {
    const dispatcher = this.context?.dispatcher;
    const shouldRelay = () => !this.context?.isRoomMode?.() && (this.context?.getViewersCount?.() > 0);
    const broadcast = (data, excludePeer) => this.context?.broadcastDataMessage?.(data, excludePeer);

    if (dispatcher) {
      this._dispatcherUnsubs.push(
        dispatcher.register('WHITEBOARD_ELEMENT_ADD', (data, sourceConn) => {
          const exists = this.manager.elements.some(el => el.id === data.element?.id);
          if (!exists && data.element) {
            this.manager.addElement(data.element, false);
            if (shouldRelay()) broadcast(data, sourceConn?.peer);
          }
        }, { description: 'Whiteboard: Element Add' })
      );

      this._dispatcherUnsubs.push(
        dispatcher.register('WHITEBOARD_ELEMENT_UPDATE', (data, sourceConn) => {
          if (data.element) {
            this.manager.updateElement(data.element, false);
            if (shouldRelay()) broadcast(data, sourceConn?.peer);
          }
        }, { description: 'Whiteboard: Element Update' })
      );

      this._dispatcherUnsubs.push(
        dispatcher.register('WHITEBOARD_ELEMENT_DELETE', (data, sourceConn) => {
          const exists = this.manager.elements.some(el => el.id === data.elementId);
          if (exists) {
            this.manager.removeElement(data.elementId, false);
            if (shouldRelay()) broadcast(data, sourceConn?.peer);
          }
        }, { description: 'Whiteboard: Element Delete' })
      );

      this._dispatcherUnsubs.push(
        dispatcher.register('WHITEBOARD_CLEAR', (data, sourceConn) => {
          if (this.manager.elements.length > 0) {
            this.manager.clear(false);
            if (shouldRelay()) broadcast(data, sourceConn?.peer);
          }
        }, { description: 'Whiteboard: Clear' })
      );

      this._dispatcherUnsubs.push(
        dispatcher.register('WHITEBOARD_CURSOR', (data, sourceConn) => {
          this.manager.updateRemoteCursor(sourceConn?.peer || 'remote-peer', {
            x: data.x,
            y: data.y,
            userName: data.userName,
            color: data.color
          });
          if (shouldRelay()) broadcast(data, sourceConn?.peer);
        }, { description: 'Whiteboard: Cursor Movement' })
      );

      this._dispatcherUnsubs.push(
        dispatcher.register('WHITEBOARD_REQUEST_SYNC', (data, sourceConn) => {
          if (sourceConn && sourceConn.open) {
            const elements = this.manager.elements;
            if (elements && elements.length > 0) {
              if (elements.length <= 25) {
                sourceConn.send({ type: 'WHITEBOARD_SYNC', elements });
              } else {
                const CHUNK_SIZE = 20;
                const syncId = 'wb_sync_' + Date.now();
                for (let i = 0; i < elements.length; i += CHUNK_SIZE) {
                  const chunk = elements.slice(i, i + CHUNK_SIZE);
                  try {
                    sourceConn.send({
                      type: 'WHITEBOARD_SYNC_BATCH',
                      syncId,
                      elements: chunk,
                      batchIndex: Math.floor(i / CHUNK_SIZE),
                      totalBatches: Math.ceil(elements.length / CHUNK_SIZE),
                      isFinal: i + CHUNK_SIZE >= elements.length
                    });
                  } catch (_) {}
                }
              }
            }
          }
        }, { description: 'Whiteboard: Request Sync' })
      );

      this._dispatcherUnsubs.push(
        dispatcher.register('WHITEBOARD_SYNC', (data) => {
          this.manager.setElements(data.elements);
        }, { description: 'Whiteboard: Full Sync' })
      );

      this._dispatcherUnsubs.push(
        dispatcher.register('WHITEBOARD_SYNC_BATCH', (data) => {
          if (data.batchIndex === 0) {
            this.manager.elements = [];
          }
          if (Array.isArray(data.elements)) {
            data.elements.forEach(el => this.manager.addElement(el, false));
          }
        }, { description: 'Whiteboard: Batch Sync' })
      );
    }

    this.registerCleanup(() => {
      this._dispatcherUnsubs.forEach(unsub => unsub());
      this._dispatcherUnsubs = [];
    });
  }

  destroy() {
    super.destroy();
    // Limpa referências ativas no manager para liberar GC
    this.manager.onElementCreated = null;
    this.manager.onElementUpdated = null;
    this.manager.onElementDeleted = null;
    this.manager.onBoardCleared = null;
    this.manager.onCursorMoved = null;
    this.manager.onToolChanged = null;
  }
}

export const whiteboardPlugin = new WhiteboardPlugin();
