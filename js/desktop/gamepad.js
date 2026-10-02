import { invokeDesktopCommand } from './ipc.js';
/** gamepad: commands receive explicit compatibility ports; no page initialization. */
export function isNativeGamepadAvailable() {
    return typeof window !== 'undefined' && Boolean(
        typeof window.__TAURI_INTERNALS__?.invoke === 'function' ||
        typeof window.__TAURI__?.core?.invoke === 'function'
    );
}

export function plugVirtualGamepad(slot) {
    return invokeDesktopCommand('plug_virtual_gamepad', { slot: Number(slot) });
}

export function updateVirtualGamepad(slot, report) {
    return invokeDesktopCommand('update_virtual_gamepad', { slot: Number(slot), report });
}

export function unplugVirtualGamepad(slot) {
    return invokeDesktopCommand('unplug_virtual_gamepad', { slot: Number(slot) });
}

export function unplugAllVirtualGamepads() {
    return invokeDesktopCommand('unplug_all_virtual_gamepads', {}, { omitArgs: true });
}

export function testGamepadVibration(gamepadIndex, strongMagnitude, weakMagnitude, durationMs) {
    return invokeDesktopCommand('test_gamepad_vibration', {
        gamepadIndex: Number(gamepadIndex),
        strongMagnitude: Number(strongMagnitude),
        weakMagnitude: Number(weakMagnitude),
        durationMs: Number(durationMs)
    });
}

export function getXInputGamepads() {
    return invokeDesktopCommand('get_xinput_gamepads', {}, { omitArgs: true });
}

export function checkVirtualGamepadDriver() {
    return invokeDesktopCommand('check_gamepad_driver_status', {}, { omitArgs: true });
}

export function installViGEmDriver() {
    return invokeDesktopCommand('install_vigem_driver', {}, { omitArgs: true });
}
