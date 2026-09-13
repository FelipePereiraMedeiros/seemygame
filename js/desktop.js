/**
 * SeeMyGame - Módulo de Integração com o App Desktop Nativo (Tauri v2 / Rust)
 */

export function isDesktopApp() {
    return typeof window !== 'undefined' && (
        Boolean(window.__TAURI_INTERNALS__) ||
        Boolean(window.__TAURI__)
    );
}

export async function invokeDesktopCommand(cmd, args = {}) {
    if (typeof window === 'undefined') {
        throw new Error('Ambiente de navegador/janela não disponível');
    }
    if (window.__TAURI_INTERNALS__ && typeof window.__TAURI_INTERNALS__.invoke === 'function') {
        return window.__TAURI_INTERNALS__.invoke(cmd, args);
    }
    if (window.__TAURI__?.core && typeof window.__TAURI__.core.invoke === 'function') {
        return window.__TAURI__.core.invoke(cmd, args);
    }
    throw new Error(`Ambiente desktop Tauri não detectado para invocar "${cmd}"`);
}

/**
 * Obtém lista de janelas e jogos ativos enumerados pela API Win32 em Rust
 * @returns {Promise<Array<{id: string, title: string, process_name: string, is_minimized: boolean}>>}
 */
export async function getCapturableWindows() {
    if (!isDesktopApp()) return [];
    try {
        const windows = await invokeDesktopCommand('list_capturable_windows');
        return Array.isArray(windows) ? windows : [];
    } catch (err) {
        console.warn('[Desktop] Falha ao obter janelas capturáveis:', err);
        return [];
    }
}

/**
 * Solicita ao Rust elevar a prioridade de processo para HIGH_PRIORITY_CLASS
 * @returns {Promise<boolean>}
 */
export async function setHighPriority() {
    if (!isDesktopApp()) return false;
    try {
        const result = await invokeDesktopCommand('set_high_priority');
        return Boolean(result);
    } catch (err) {
        console.warn('[Desktop] Falha ao definir alta prioridade:', err);
        return false;
    }
}
