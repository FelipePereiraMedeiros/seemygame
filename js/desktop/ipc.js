
/** ipc: commands receive explicit compatibility ports; no page initialization. */
export function isDesktopApp() {
    return typeof window !== 'undefined' && (
        Boolean(window.__TAURI_INTERNALS__) ||
        Boolean(window.__TAURI__)
    );
}

export async function invokeDesktopCommand(cmd, args = {}, { omitArgs = false } = {}) {
    if (typeof window === 'undefined') {
        throw new Error('Ambiente de navegador/janela não disponível');
    }
    if (window.__TAURI_INTERNALS__ && typeof window.__TAURI_INTERNALS__.invoke === 'function') {
        return omitArgs
            ? window.__TAURI_INTERNALS__.invoke(cmd)
            : window.__TAURI_INTERNALS__.invoke(cmd, args);
    }
    if (window.__TAURI__?.core && typeof window.__TAURI__.core.invoke === 'function') {
        return omitArgs
            ? window.__TAURI__.core.invoke(cmd)
            : window.__TAURI__.core.invoke(cmd, args);
    }
    throw new Error(`Ambiente desktop Tauri não detectado para invocar "${cmd}"`);
}
