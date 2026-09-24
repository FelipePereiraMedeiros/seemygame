# Réplica Técnica às Observações do Parecer — 24/09/2026

Referência examinada: `docs/parecer-replica-r1-r10-2026-09-24.md`.

Todas as 3 pendências levantadas no parecer (P1, P2 e P3) foram pontualmente investigadas, corrigidas e cobertas com testes automatizados em JavaScript e Python.

---

## 1. P1 — Mixer pode continuar gravando áudio removido do stream

### Causa Raiz
No módulo [`js/clipping.js`](file:///G:/SeeMyGame/js/clipping.js), o gravador observava apenas o evento `addtrack`, sem escutar `removetrack`. Além disso, a fonte de áudio Web Audio (`MediaStreamAudioSourceNode`) era criada a partir de um novo `MediaStream` intermediário contendo as trilhas de áudio originais. Quando o usuário alterava o modo para "Apenas vídeo" (`newMode === 'none'` em [`js/app.js`](file:///G:/SeeMyGame/js/app.js)), `localStream.removeTrack(t)` removia a trilha do stream da chamada, mas a fonte Web Audio permanecia conectada ao destino de mixagem, e a trilha do sistema (`capturedSystemAudioTrack`) continuava viva (`live`), resultando na continuidade indevida da captura de áudio no buffer de clipping.

### Correções Implementadas
1. **Mapeamento de Fontes por Trilha (`_audioTrackSources = new Map()`):**
   - Cada trilha de áudio agora é registrada individualmente com seu respectivo `sourceNode`, stream dedicado e listener de `ended`.
2. **Desconexão Imediata em `removetrack`:**
   - Adicionado listener para `stream.addEventListener('removetrack', onTrackRemoved)`.
   - Ao receber `removetrack` para trilhas do tipo `audio`, invoca `_disconnectAudioTrackFromMixer(track)`, desconectando o `sourceNode` e removendo a referência do mapa.
3. **Tratamento de `ended`:**
   - Se uma trilha de áudio for encerrada na origem, seu callback de `ended` desconecta o nó e limpa os recursos.
4. **Prevenção de Fontes Duplicadas:**
   - `_connectAudioTrackToMixer(track)` verifica se a trilha já está mapeada antes de criar um novo nó, prevenindo duplicações ao reativar áudio.
5. **Limpeza Completa no `_releaseRecordingTracks()`:**
   - Remove listeners de `addtrack` e `removetrack` e desconecta todas as fontes ativas.

---

## 2. P2 — AudioContext inicial pode permanecer suspenso

### Causa Raiz
Ao instanciar `new AudioContext()`, navegadores modernos frequentemente o inicializam no estado `'suspended'` devido às políticas de reprodução automática (Autoplay Policy), aguardando interação do usuário. O método `resume()` era invocado apenas dinamicamente em `onTrackAdded`, deixando gravações com áudio já presente no momento do `start()` sem processamento ativo.

### Correções Implementadas
1. **Ativação Imediata no `start()`:**
   - Adicionado helper `_resumeAudioContext()`, invocado logo após a criação do `AudioContext` no `start()`.
2. **Recuperação por Gesto do Usuário:**
   - Se o `AudioContext` for criado em estado suspenso (`wasSuspended === true` ou `state === 'suspended'`), são registrados listeners de `click` e `keydown` em `window` para invocar `_resumeAudioContext()` na primeira interação física do usuário, com limpeza automática assim que o contexto atinge o estado `'running'` ou quando o gravador é liberado.

---

## 3. P3 — Revogação de um jogador interfere em outros

### Causa Raiz
1. **No Navegador ([`js/coop.js`](file:///G:/SeeMyGame/js/coop.js)):**
   - Ao revogar um jogador (`revokeCoopPlayer`), todas as teclas rastreadas para aquele slot eram imediatamente limpas com disparo de `keyup` no `window`, sem checar se outro slot ainda estava mantendo a mesma tecla pressionada.
2. **No Companion Python ([`tools/coop-agent.py`](file:///G:/SeeMyGame/tools/coop-agent.py)):**
   - A mensagem `{ type: 'INPUT_RESET', slot }` ignorava o campo `slot` e chamava diretamente `release_all()`, soltando os botões e teclas de todos os jogadores ativos e resetando todos os controles virtuais indiscriminadamente.

### Correções Implementadas
1. **Semântica de Teclas Compartilhadas no Navegador ([`js/coop.js`](file:///G:/SeeMyGame/js/coop.js)):**
   - Na revogação (`revokeCoopPlayer`), cada tecla retida pelo slot é verificada contra os outros slots ativos (`slotPressedKeys`). O evento `keyup` só é despachado para a janela e a tecla só é removida de `pressedBrowserKeys` se **nenhum outro slot ativo** estiver segurando aquela tecla.
   - Ao encaminhar inputs de teclado para o companion nativo, o campo `slot` agora é explicitamente incluído no payload (`{ ...data, slot }`).
2. **Isolamento por Slot no Companion ([`tools/coop-agent.py`](file:///G:/SeeMyGame/tools/coop-agent.py)):**
   - Implementado dicionário `slot_pressed_keys = {}` para rastrear as teclas retidas por cada slot individual.
   - Em `INPUT_KEY`, teclas pressionadas (`down`) e soltas (`up`) são atualizadas por slot. Uma tecla física no sistema só recebe `pyautogui.keyUp` quando **nenhum outro slot** mantiver essa tecla pressionada.
   - Implementada a função `release_slot(slot)`: reseta exclusivamente o controle virtual (`virtual_gamepads[slot]`) e as teclas retidas por aquele jogador específico, sem interferir nos controles dos demais participantes.
   - Mensagens de `INPUT_RESET` e `COOP_REVOKE` com campo `slot` agora direcionam para `release_slot(slot)`. Apenas `EMERGENCY_STOP`, pânico global ou desconexão chamam `release_all()`.

---

## 4. Validação Automatizada

- **Vitest (`npm test`)**:
  - `49/49` arquivos de teste executados.
  - **`500/500` testes passaram** com 100% de sucesso.
  - Cobertura em [`tests/review-audit-fixes.test.js`](file:///G:/SeeMyGame/tests/review-audit-fixes.test.js):
    - `P1`: desconexão em `removetrack`, limpeza em `ended` e prevenção de duplicatas ao readicionar.
    - `P2`: chamada imediata de `resume()` e ativação por evento de gesto quando iniciado suspenso.
    - `P3`: dois slots segurando `KeyW`; revogação do Slot 1 não emite `keyup` nem solta a tecla; revogação subsequente do Slot 2 emite `keyup` e limpa o registro.
- **Python Unittest (`tools/coop-agent.py`)**:
  - `5/5` testes passaram em [`tests/test_pending_companion.py`](file:///G:/SeeMyGame/tests/test_pending_companion.py), incluindo teste específico de dois slots com tecla compartilhada e `release_slot` isolado.
- **Rust Library (`cargo test`)**:
  - `29/29` testes passaram.
- **Distribuição Web**:
  - `node tools/build-dist.js` executado e atualizado.
