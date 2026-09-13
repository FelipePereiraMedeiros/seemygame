#!/usr/bin/env python3
"""
SeeMyGame - Co-op Native Companion Agent (Windows)
--------------------------------------------------
Servidor WebSocket local que recebe os comandos do Player 2
enviados via WebRTC pelo SeeMyGame e os simula diretamente no
Windows com latência mínima.

Permite que seu amigo controle jogos nativos de PC (Steam,
emuladores, jogos de luta/co-op) como se estivesse sentado ao seu lado!

Dependências:
    pip install websockets pyautogui
"""

import asyncio
import json
import sys

try:
    import websockets
except ImportError:
    print("ERRO: Pacote 'websockets' não instalado. Execute: pip install websockets")
    sys.exit(1)

try:
    import pyautogui
    pyautogui.FAILSAFE = False  # Permite mover para os cantos da tela sem erro
    pyautogui.PAUSE = 0.001     # Sem atraso artificial entre comandos
    HAVE_PYAUTOGUI = True
except ImportError:
    HAVE_PYAUTOGUI = False
    print("AVISO: 'pyautogui' não encontrado. Execute: pip install pyautogui para suporte completo.")

PORT = 9876
HOST = "127.0.0.1"

# Mapeamento de teclas Web (KeyboardEvent.code) para nomes do PyAutoGUI
KEY_MAP = {
    "KeyW": "w", "KeyA": "a", "KeyS": "s", "KeyD": "d",
    "ArrowUp": "up", "ArrowDown": "down", "ArrowLeft": "left", "ArrowRight": "right",
    "Space": "space", "Enter": "enter", "Escape": "esc", "Tab": "tab",
    "ShiftLeft": "shiftleft", "ShiftRight": "shiftright",
    "ControlLeft": "ctrlleft", "ControlRight": "ctrlright",
    "KeyJ": "j", "KeyK": "k", "KeyL": "l", "KeyU": "u", "KeyI": "i", "KeyO": "o",
    "KeyZ": "z", "KeyX": "x", "KeyC": "c", "KeyV": "v"
}

async def handle_client(websocket):
    print(f"[Co-op Agent] Navegador conectado! Player 2 pronto para controlar.")
    screen_w, screen_h = pyautogui.size() if HAVE_PYAUTOGUI else (1920, 1080)

    try:
        async for message in websocket:
            try:
                data = json.loads(message)
                msg_type = data.get("type")

                # 1. Teclado
                if msg_type == "INPUT_KEY" and HAVE_PYAUTOGUI:
                    code = data.get("code")
                    action = data.get("action")
                    key = KEY_MAP.get(code, data.get("key", "").lower())

                    if key:
                        try:
                            if action == "down":
                                pyautogui.keyDown(key)
                            elif action == "up":
                                pyautogui.keyUp(key)
                        except Exception:
                            pass

                # 2. Mouse
                elif msg_type == "INPUT_MOUSE" and HAVE_PYAUTOGUI:
                    action = data.get("action")
                    if action == "move":
                        target_x = int(data.get("x", 0) * screen_w)
                        target_y = int(data.get("y", 0) * screen_h)
                        pyautogui.moveTo(target_x, target_y)
                    elif action == "down":
                        btn = "left" if data.get("button", 0) == 0 else "right"
                        pyautogui.mouseDown(button=btn)
                    elif action == "up":
                        btn = "left" if data.get("button", 0) == 0 else "right"
                        pyautogui.mouseUp(button=btn)

            except Exception as parse_err:
                pass

    except websockets.exceptions.ConnectionClosed:
        print("[Co-op Agent] Navegador desconectado.")

async def main():
    print("=" * 60)
    print("🎮 SeeMyGame - Co-op Companion Agent (Player 2 para PC)")
    print("=" * 60)
    print(f"Iniciando escuta local em ws://{HOST}:{PORT}")
    print("Abra o SeeMyGame no navegador para pareamento automático.")
    print("Pressione Ctrl + C no terminal para encerrar.")
    print("=" * 60)

    async with websockets.serve(handle_client, HOST, PORT):
        await asyncio.Future()

if __name__ == "__main__":
    try:
        asyncio.run(main())
    except KeyboardInterrupt:
        print("\nAgente Co-op encerrado.")
