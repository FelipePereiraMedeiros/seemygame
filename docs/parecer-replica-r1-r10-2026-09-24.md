# Parecer sobre a réplica — 24/09/2026

Referência examinada: commit `bdab0f3`, posterior à revalidação de `c99dc7b`. Não encontrei um documento novo de réplica; avaliei a implementação desse commit. Nenhum código de produção alterado nesta análise.

## O que foi atendido

- **R1/R2:** handlers nativos de áudio/codec agora aguardam o backend, restauram o seletor na rejeição e evitam anunciar sucesso nesse caminho. Ajustes de bitrate não reenviam codec/áudio rejeitados. A pendência específica da revisão anterior foi atendida no fluxo normal; não há novo E2E de negociação nesta rodada.
- **R6:** uma trilha de destino Web Audio mantém a topologia estável para áudio tardio. Isso elimina, nesse caminho, o reinício e a concatenação de gravações incompatíveis. O fallback limpa o histórico ao reiniciar, alternativa válida para evitar mistura, mas com perda deliberada do replay anterior que deve ser informada.
- **R10:** corrigidos argumentos/payload do teste; há teste de keydown autorizado, revogação, keyup e rejeição posterior. Foi adicionada liberação de teclas por slot no navegador e solicitação de reset ao companion.

## Pendências encontradas na nova implementação

### P1 — mixer pode continuar gravando áudio removido do stream

Referências: `js/clipping.js:103`, `js/clipping.js:120`, `js/app.js:708`.

O mixer cria uma origem a partir de outro MediaStream contendo a trilha original. Só observa `addtrack`, sem observar `removetrack`. Remover a trilha da origem não a remove desse outro stream nem desconecta o AudioNode. O fluxo de “Apenas vídeo” preserva `capturedSystemAudioTrack` ativa e a remove de `localStream`; nessa situação o replay pode continuar gravando o som que foi desativado na interface.

Reprodução controlada com o módulo real e mocks: após remover áudio da origem, `oldAudioStillConnected=true`, trilha `live` e nenhum listener `removetrack`. É evidência de ciclo de vida; não foi produzido arquivo real nesta rodada.

Correção: mapear nós por trilha, tratar remoção/ended, desconectar fontes antigas e prevenir conexões duplicadas ao readicionar uma trilha. Testar áudio presente → none → áudio, verificando silêncio real do clipe no intervalo desativado.

### P2 — AudioContext inicial pode permanecer suspenso

Referência: `js/clipping.js:98`.

O contexto é criado e conectado, mas `resume()` aparece apenas no handler de áudio adicionado posteriormente. Se começar suspenso e o áudio já existir, a gravação permanece sem processamento de áudio até ocorrer outro evento que o retome. A reprodução controlada confirmou que `start()` conserva o estado suspended.

Correção: tratar ativação inicial, estado suspenso e falha de resume, com recuperação por gesto quando necessária. Testar áudio presente desde o início e contexto inicialmente suspenso; validar áudio efetivo, não apenas `isRecording`.

### P2 — revogação de um jogador interfere em outros

Referências: `js/coop.js:567`, `tools/coop-agent.py:244`.

No navegador, se dois slots mantêm a mesma tecla, revogar um deles emite keyup e remove a tecla global sem verificar o outro slot. No companion, `{type: 'INPUT_RESET', slot}` não é um reset por slot: o Python ignora slot e chama `release_all()`. Portanto a correção libera entradas retidas, mas também pode interromper controles dos participantes ainda autorizados.

Correção: definir semântica compartilhada de teclas e reset por jogador no protocolo, ou assumir/documentar reset global deliberado na transição. Testar dois slots mantendo a mesma tecla e revogação individual com companion conectado.

## Validação e conclusão

- **50 testes passaram em 4 arquivos:** review-audit-fixes, clipping, coop e tuning.
- Duas verificações controladas em Node confirmaram ausência de resume inicial e permanência da conexão de áudio após removetrack.
- Não reexecutei Rust: este commit não modifica Rust. Não executei instalação ou E2E de mídia real.

A réplica atende os pontos anteriores de UI e substitui corretamente a estratégia problemática do clipping. R6 ainda não deve ser encerrado devido ao ciclo de vida do mixer, especialmente a privacidade do áudio removido. R10 melhorou, mas precisa validar isolamento entre jogadores. R3–R5/R7–R9 não receberam mudanças relevantes neste commit e mantêm as conclusões/limitações da revisão anterior.
