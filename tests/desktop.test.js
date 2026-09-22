import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { 
    isDesktopApp, 
    invokeDesktopCommand, 
    getCapturableWindows, 
    setHighPriority, 
    toggleAlwaysOnTop, 
    isAlwaysOnTop,
    createNativeViewerPeer,
    addNativeViewerIceCandidate,
    closeNativeViewerPeer
} from '../js/desktop.js';

describe('Módulo: desktop.js (Tauri v2 / Rust Integration)', () => {
    const originalTauri = window.__TAURI_INTERNALS__;

    beforeEach(() => {
        delete window.__TAURI_INTERNALS__;
        delete window.__TAURI__;
    });

    afterEach(() => {
        if (originalTauri) {
            window.__TAURI_INTERNALS__ = originalTauri;
        } else {
            delete window.__TAURI_INTERNALS__;
        }
        delete window.__TAURI__;
    });

    it('deve identificar ambiente web padrão como não-desktop', () => {
        expect(isDesktopApp()).toBe(false);
    });

    it('deve identificar ambiente desktop quando window.__TAURI_INTERNALS__ estiver presente', () => {
        window.__TAURI_INTERNALS__ = { invoke: vi.fn() };
        expect(isDesktopApp()).toBe(true);
    });

    it('deve lançar erro ao tentar invocar comando fora do ambiente desktop', async () => {
        await expect(invokeDesktopCommand('test_cmd')).rejects.toThrow('Ambiente desktop Tauri não detectado');
    });

    it('deve chamar __TAURI_INTERNALS__.invoke com o comando e argumentos corretos', async () => {
        const mockInvoke = vi.fn().mockResolvedValue({ success: true });
        window.__TAURI_INTERNALS__ = { invoke: mockInvoke };

        const res = await invokeDesktopCommand('custom_cmd', { foo: 'bar' });
        expect(mockInvoke).toHaveBeenCalledWith('custom_cmd', { foo: 'bar' });
        expect(res).toEqual({ success: true });
    });

    it('getCapturableWindows deve retornar array vazio em ambiente web', async () => {
        const list = await getCapturableWindows();
        expect(list).toEqual([]);
    });

    it('getCapturableWindows deve invocar list_capturable_windows e retornar a lista de janelas em desktop', async () => {
        const mockWindows = [
            { id: '1234', title: 'Counter-Strike 2', process_name: 'cs2.exe', is_minimized: false },
            { id: '5678', title: 'Discord', process_name: 'Discord.exe', is_minimized: false }
        ];
        window.__TAURI_INTERNALS__ = {
            invoke: vi.fn().mockResolvedValue(mockWindows)
        };

        const list = await getCapturableWindows();
        expect(list).toHaveLength(2);
        expect(list[0].title).toBe('Counter-Strike 2');
        expect(list[0].process_name).toBe('cs2.exe');
    });

    it('setHighPriority deve invocar set_high_priority e retornar true', async () => {
        window.__TAURI_INTERNALS__ = {
            invoke: vi.fn().mockResolvedValue(true)
        };

        const result = await setHighPriority();
        expect(result).toBe(true);
    });

    it('setHighPriority deve retornar false em caso de falha', async () => {
        window.__TAURI_INTERNALS__ = {
            invoke: vi.fn().mockRejectedValue(new Error('Permission denied'))
        };

        const result = await setHighPriority();
        expect(result).toBe(false);
    });

    it('toggleAlwaysOnTop deve invocar toggle_always_on_top e alternar estado', async () => {
        window.__TAURI_INTERNALS__ = {
            invoke: vi.fn().mockResolvedValue(true)
        };

        const res = await toggleAlwaysOnTop();
        expect(window.__TAURI_INTERNALS__.invoke).toHaveBeenCalledWith('toggle_always_on_top', {});
        expect(res).toBe(true);
    });

    it('toggleAlwaysOnTop deve retornar false em ambiente web', async () => {
        const res = await toggleAlwaysOnTop();
        expect(res).toBe(false);
    });

    it('isAlwaysOnTop deve invocar is_always_on_top e retornar booleano', async () => {
        window.__TAURI_INTERNALS__ = {
            invoke: vi.fn().mockResolvedValue(false)
        };

        const res = await isAlwaysOnTop();
        expect(window.__TAURI_INTERNALS__.invoke).toHaveBeenCalledWith('is_always_on_top', {});
        expect(res).toBe(false);
    });

    it('createNativeViewerPeer deve invocar create_native_viewer_peer com parâmetros corretos', async () => {
        window.__TAURI_INTERNALS__ = {
            invoke: vi.fn().mockResolvedValue({ type: 'answer', sdp: 'v=0...' })
        };
        const res = await createNativeViewerPeer('session-1', 'viewer-a', 'v=0\r\no=...');
        expect(window.__TAURI_INTERNALS__.invoke).toHaveBeenCalledWith('create_native_viewer_peer', {
            sessionId: 'session-1',
            viewerId: 'viewer-a',
            offerSdp: 'v=0\r\no=...'
        });
        expect(res.type).toBe('answer');
    });

    it('createNativeViewerPeer deve propagar iceServers se fornecido', async () => {
        window.__TAURI_INTERNALS__ = {
            invoke: vi.fn().mockResolvedValue({ type: 'answer', sdp: 'v=0...' })
        };
        const res = await createNativeViewerPeer('session-1', 'viewer-a', 'v=0\r\no=...', ['turn:user:pass@turn.example.com:3478']);
        expect(window.__TAURI_INTERNALS__.invoke).toHaveBeenCalledWith('create_native_viewer_peer', {
            sessionId: 'session-1',
            viewerId: 'viewer-a',
            offerSdp: 'v=0\r\no=...',
            iceServers: ['turn:user:pass@turn.example.com:3478']
        });
        expect(res.type).toBe('answer');
    });

    it('addNativeViewerIceCandidate deve invocar add_native_viewer_ice_candidate com tipos corretos', async () => {
        window.__TAURI_INTERNALS__ = {
            invoke: vi.fn().mockResolvedValue(null)
        };
        await addNativeViewerIceCandidate('session-1', 'viewer-a', '0', 'candidate:1 1 UDP ...');
        expect(window.__TAURI_INTERNALS__.invoke).toHaveBeenCalledWith('add_native_viewer_ice_candidate', {
            sessionId: 'session-1',
            viewerId: 'viewer-a',
            mlineIndex: 0,
            candidate: 'candidate:1 1 UDP ...'
        });
    });

    it('closeNativeViewerPeer deve invocar close_native_viewer_peer', async () => {
        window.__TAURI_INTERNALS__ = {
            invoke: vi.fn().mockResolvedValue(null)
        };
        await closeNativeViewerPeer('session-1', 'viewer-a');
        expect(window.__TAURI_INTERNALS__.invoke).toHaveBeenCalledWith('close_native_viewer_peer', {
            sessionId: 'session-1',
            viewerId: 'viewer-a'
        });
    });

    it('installViGEmDriver deve invocar install_vigem_driver no desktop', async () => {
        const { installViGEmDriver, checkVirtualGamepadDriver } = await import('../js/desktop.js');
        window.__TAURI_INTERNALS__ = {
            invoke: vi.fn().mockImplementation((cmd) => {
                if (cmd === 'install_vigem_driver') return Promise.resolve('Driver instalado');
                if (cmd === 'check_gamepad_driver_status') return Promise.resolve({ vigem_available: true, active_slots: [] });
                return Promise.resolve(null);
            })
        };
        const status = await checkVirtualGamepadDriver();
        expect(status.vigem_available).toBe(true);

        const res = await installViGEmDriver();
        expect(res).toBe('Driver instalado');
        expect(window.__TAURI_INTERNALS__.invoke).toHaveBeenCalledWith('install_vigem_driver');
    });

    it('startNativeViewer deve invocar start_native_viewer no desktop', async () => {
        const { startNativeViewer, addNativeViewerCandidate, stopNativeViewer } = await import('../js/desktop.js');
        window.__TAURI_INTERNALS__ = {
            invoke: vi.fn().mockImplementation((cmd) => {
                if (cmd === 'start_native_viewer') return Promise.resolve({ type: 'answer', sdp: 'v=0...' });
                if (cmd === 'add_native_viewer_candidate') return Promise.resolve();
                if (cmd === 'stop_native_viewer') return Promise.resolve();
                return Promise.resolve(null);
            })
        };
        const answer = await startNativeViewer('host-42', 'v=0 offer', ['stun:stun.l.google.com:19302'], true);
        expect(answer.type).toBe('answer');
        expect(window.__TAURI_INTERNALS__.invoke).toHaveBeenCalledWith('start_native_viewer', {
            hostId: 'host-42',
            offerSdp: 'v=0 offer',
            iceServers: ['stun:stun.l.google.com:19302'],
            openDedicatedWindow: true
        });

        await addNativeViewerCandidate(0, 'candidate:123');
        expect(window.__TAURI_INTERNALS__.invoke).toHaveBeenCalledWith('add_native_viewer_candidate', {
            mlineIndex: 0,
            candidate: 'candidate:123'
        });

        await stopNativeViewer();
        expect(window.__TAURI_INTERNALS__.invoke).toHaveBeenCalledWith('stop_native_viewer');
    });
});

