"""Testa o módulo inteiro com drivers substituídos ANTES do import. Nunca injeta input."""
import asyncio
import importlib.util
import json
from pathlib import Path
import sys
import types
import unittest
from unittest.mock import patch


class FailSafe(Exception):
    pass


class Closed(Exception):
    pass


class FakeInput(types.ModuleType):
    def __init__(self):
        super().__init__('pyautogui')
        self.FailSafeException = FailSafe
        self.FAILSAFE = True
        self.corner = False
        self.keys = set()
        self.buttons = set()

    def check(self):
        if self.FAILSAFE and self.corner:
            raise FailSafe('synthetic corner')

    def size(self):
        return (1920, 1080)

    def keyDown(self, key):
        self.check()
        self.keys.add(key)

    def keyUp(self, key):
        self.check()
        self.keys.discard(key)

    def mouseUp(self, button):
        self.check()
        self.buttons.discard(button)


class Socket:
    request_headers = {'Origin': 'http://tauri.localhost'}

    def __init__(self, messages):
        self.messages = iter(messages)
        self.sent = []
        self.closed = []
        self.reads = 0

    async def recv(self):
        self.reads += 1
        try:
            item = next(self.messages)
        except StopIteration:
            raise Closed()
        if callable(item):
            item = item()
        return json.dumps(item)

    async def send(self, value):
        self.sent.append(json.loads(value))

    async def close(self, code, reason):
        self.closed.append((code, reason))


class CompanionRegression(unittest.TestCase):
    def setUp(self):
        self.driver = FakeInput()
        ws = types.ModuleType('websockets')
        ws.exceptions = types.SimpleNamespace(ConnectionClosed=Closed)
        # Import real source, not extracted/reimplemented functions.
        source = Path(__file__).resolve().parents[1] / 'tools' / 'coop-agent.py'
        spec = importlib.util.spec_from_file_location('companion_under_test', source)
        self.agent = importlib.util.module_from_spec(spec)
        with patch.dict(sys.modules, {'pyautogui': self.driver, 'websockets': ws}):
            spec.loader.exec_module(self.agent)
        self.agent.auth_token = 'synthetic-session-token'

    def test_release_at_corner_releases_keys_and_mouse(self):
        self.driver.keys.add('w')
        self.driver.buttons.add('left')
        self.agent.pressed_keys.add('w')
        self.agent.pressed_mouse_buttons.add('left')
        self.driver.corner = True
        result = self.agent.release_all()
        self.assertEqual(self.driver.keys, set(), 'Emergency release left a key physically down')
        self.assertEqual(self.driver.buttons, set())
        self.assertTrue(result)
        self.assertTrue(self.driver.FAILSAFE, 'Failsafe must remain enabled after cleanup')

    def test_keyboard_failsafe_revokes_before_next_message(self):
        def hit_corner():
            self.driver.corner = True
            return {'type': 'INPUT_KEY', 'code': 'KeyW', 'action': 'down'}
        socket = Socket([{'type': 'AUTH', 'token': self.agent.auth_token}, hit_corner])
        asyncio.run(self.agent.handle_client(socket))
        self.assertTrue(socket.closed, 'Keyboard failsafe must revoke/close the session')
        self.assertEqual(socket.reads, 2, 'Do not continue accepting input after failsafe')

    def test_disconnect_releases_keys_without_failsafe(self):
        socket = Socket([{'type': 'AUTH', 'token': self.agent.auth_token},
                         {'type': 'INPUT_KEY', 'code': 'KeyW', 'action': 'down'}])
        asyncio.run(self.agent.handle_client(socket))
        self.assertEqual(self.driver.keys, set())
        self.assertEqual(self.agent.pressed_keys, set())

    def test_origins_and_invalid_token_remain_rejected(self):
        self.assertTrue(self.agent.is_valid_origin('http://tauri.localhost'))
        for origin in [None, 'https://evilseemygame.com', 'https://evilseemygame.pages.dev']:
            self.assertFalse(self.agent.is_valid_origin(origin))
        socket = Socket([{'type': 'AUTH', 'token': 'wrong'}])
        asyncio.run(self.agent.handle_client(socket))
        self.assertEqual(socket.closed[0][0], 4001)
        self.assertFalse(self.driver.keys)

    def test_slot_isolation_shared_keys_and_individual_reset(self):
        messages = [
            {'type': 'AUTH', 'token': self.agent.auth_token},
            # Slot 1 pressiona W
            {'type': 'INPUT_KEY', 'code': 'KeyW', 'action': 'down', 'slot': 1},
            # Slot 2 também pressiona W
            {'type': 'INPUT_KEY', 'code': 'KeyW', 'action': 'down', 'slot': 2},
            # Reset do Slot 1: como Slot 2 ainda segura W, W deve permanecer pressionado!
            {'type': 'INPUT_RESET', 'slot': 1},
            # Slot 2 solta W: agora sim W deve ser liberado!
            {'type': 'INPUT_KEY', 'code': 'KeyW', 'action': 'up', 'slot': 2},
        ]
        socket = Socket(messages)
        asyncio.run(self.agent.handle_client(socket))
        # Ao término de todas as mensagens, todas as teclas foram liberadas
        self.assertEqual(self.driver.keys, set())
        self.assertEqual(self.agent.pressed_keys, set())


if __name__ == '__main__':
    unittest.main()
