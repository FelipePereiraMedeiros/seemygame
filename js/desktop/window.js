import { isDesktopApp } from './ipc.js';
import { invokeDesktopCommand } from './ipc.js';
/** window: commands receive explicit compatibility ports; no page initialization. */
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

export async function toggleAlwaysOnTop() {
    if (!isDesktopApp()) return false;
    try {
        const result = await invokeDesktopCommand('toggle_always_on_top');
        return Boolean(result);
    } catch (err) {
        console.warn('[Desktop] Falha ao alternar always-on-top:', err);
        return false;
    }
}

export async function isAlwaysOnTop() {
    if (!isDesktopApp()) return false;
    try {
        const result = await invokeDesktopCommand('is_always_on_top');
        return Boolean(result);
    } catch (err) {
        console.warn('[Desktop] Falha ao consultar always-on-top:', err);
        return false;
    }
}

export async function logDiagnostic(message) {
    if (!isDesktopApp()) return;
    try {
        await invokeDesktopCommand('log_diagnostic', { message: String(message) });
    } catch (_) {}
}
