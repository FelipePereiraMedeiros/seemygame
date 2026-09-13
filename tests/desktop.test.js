import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { isDesktopApp, invokeDesktopCommand, getCapturableWindows, setHighPriority } from '../js/desktop.js';

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
});
