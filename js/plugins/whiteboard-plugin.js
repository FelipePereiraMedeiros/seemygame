/**
 * SeeMyGame - WhiteboardPlugin (Isolated Feature Plugin)
 * 
 * Encapsula o ciclo de vida da lousa colaborativa vetorial (Excalidraw-style),
 * registro de mensagens P2P na rede e listeners de canvas.
 */

import { BasePlugin } from './base-plugin.js';
import { whiteboardManager } from '../whiteboard.js';
import { isSafeWhiteboardElement } from '../whiteboard/shared.js';

export class WhiteboardPlugin extends BasePlugin {
  constructor(options = {}) {
    super('whiteboard', options);
    this.manager = options.manager || whiteboardManager;
    this.ownsManager = Boolean(options.manager);
    this._dispatcherUnsubs = [];
  }

  setupListeners() {
    const dispatcher = this.context?.dispatcher;
    const shouldRelay = () => !this.context?.isRoomMode?.() && (this.context?.getViewersCount?.() > 0);
    const broadcast = (data, excludePeer) => this.context?.broadcastDataMessage?.(data, excludePeer);

    if (dispatcher) {
      const incomingChunks = new Map();
      const MAX_CONCURRENT_CHUNKS = 25;
      const CHUNK_TTL_MS = 60000;

      const pruneExpiredChunks = () => {
        const now = Date.now();
        for (const [id, entry] of incomingChunks.entries()) {
          if (now - entry.timestamp > CHUNK_TTL_MS) incomingChunks.delete(id);
        }
      };

      this._dispatcherUnsubs.push(
        dispatcher.register('WHITEBOARD_ELEMENT_CHUNK', (data, sourceConn) => {
          if (!data || !data.chunkId || typeof data.index !== 'number' || typeof data.total !== 'number') return;
          if (data.total <= 0 || data.total > 200 || data.index < 0 || data.index >= data.total) return;
          if (typeof data.chunk !== 'string' || data.chunk.length > 65536) return;

          pruneExpiredChunks();
          let entry = incomingChunks.get(data.chunkId);
          if (!entry) {
            if (incomingChunks.size >= MAX_CONCURRENT_CHUNKS) return;
            entry = { total: data.total, received: new Map(), meta: data.meta, isUpdate: data.isUpdate, timestamp: Date.now() };
            incomingChunks.set(data.chunkId, entry);
          }
          entry.received.set(data.index, data.chunk);
          if (entry.received.size === entry.total) {
            incomingChunks.delete(data.chunkId);
            let fullDataUrl = '';
            for (let i = 0; i < entry.total; i++) {
              fullDataUrl += (entry.received.get(i) || '');
            }
            if (fullDataUrl.length > 5 * 1024 * 1024) return;
            const fullElement = { ...entry.meta, dataUrl: fullDataUrl };
            if (!isSafeWhiteboardElement(fullElement)) return;

            if (entry.isUpdate) {
              this.manager.updateElement(fullElement, false);
            } else {
              const exists = this.manager.elements.some(el => el.id === fullElement.id);
              if (!exists) {
                this.manager.addElement(fullElement, false);
                if (shouldRelay()) broadcast({ type: 'WHITEBOARD_ELEMENT_ADD', element: fullElement }, sourceConn?.peer);
              }
            }
          }
        }, { description: 'Whiteboard: Element Chunk' })
      );

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
            if (!elements || elements.length === 0) return;

            const MAX_BATCH_BYTES = 48 * 1024;
            const regularElements = [];
            const largeImageElements = [];

            for (const el of elements) {
              if (el?.type === 'image' && el.dataUrl && el.dataUrl.length > 30000) {
                largeImageElements.push(el);
              } else {
                regularElements.push(el);
              }
            }

            let regularTotalBytes = 0;
            try { regularTotalBytes = JSON.stringify(regularElements).length; } catch (_) {}

            if (largeImageElements.length === 0 && regularTotalBytes < MAX_BATCH_BYTES) {
              sourceConn.send({ type: 'WHITEBOARD_SYNC', elements: regularElements });
            } else {
              const syncId = 'wb_sync_' + Date.now();
              const batches = [];
              let currentBatch = [];
              let currentBytes = 0;

              for (const el of regularElements) {
                const elBytes = JSON.stringify(el).length;
                if (currentBatch.length > 0 && (currentBytes + elBytes) > MAX_BATCH_BYTES) {
                  batches.push(currentBatch);
                  currentBatch = [el];
                  currentBytes = elBytes;
                } else {
                  currentBatch.push(el);
                  currentBytes += elBytes;
                }
              }
              if (currentBatch.length > 0) batches.push(currentBatch);

              const totalBatches = batches.length;
              for (let i = 0; i < totalBatches; i++) {
                try {
                  sourceConn.send({
                    type: 'WHITEBOARD_SYNC_BATCH',
                    syncId,
                    elements: batches[i],
                    batchIndex: i,
                    totalBatches,
                    isFinal: i === totalBatches - 1 && largeImageElements.length === 0
                  });
                } catch (_) {}
              }

              for (const imgEl of largeImageElements) {
                const CHUNK_SIZE = 30000;
                const chunkId = 'wb_sync_img_' + Date.now() + '_' + Math.random().toString(36).slice(2, 7);
                const dataUrl = imgEl.dataUrl;
                const total = Math.ceil(dataUrl.length / CHUNK_SIZE);
                const meta = { ...imgEl };
                delete meta.dataUrl;
                for (let i = 0; i < total; i++) {
                  try {
                    sourceConn.send({
                      type: 'WHITEBOARD_ELEMENT_CHUNK',
                      chunkId,
                      index: i,
                      total,
                      chunk: dataUrl.slice(i * CHUNK_SIZE, (i + 1) * CHUNK_SIZE),
                      meta,
                      isUpdate: false
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
    if (this.ownsManager) this.manager.dispose?.();
  }
}

export const whiteboardPlugin = new WhiteboardPlugin();
