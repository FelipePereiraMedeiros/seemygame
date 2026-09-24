# Revisão de código — 24/09/2026

## Parecer

O projeto avançou em funcionalidades e cobertura, mas a reconfiguração durante a transmissão introduziu regressões importantes de privacidade, negociação de mídia e recuperação de falhas. Não recomendo liberar essa funcionalidade como está. Os testes atuais passam, porém não exercitam as transições que concentram os problemas abaixo.

Revisão do estado em `34e34e1`, com comparação desde `be1374d`: 47 arquivos modificados, 4.516 inserções e 161 exclusões. Foram examinados os caminhos de captura/worker, bridges, receptor nativo, sinalização/salas, configuração da interface, clipping, voz, co-op, instalação e testes. As alterações locais em `js/discord-ui.js`, `js/ui.js` e `js/voice.js` surgidas durante a análise também foram lidas e preservadas. Este documento não altera a implementação.

Os achados são derivados do código, exceto quando indicada verificação adicional. Não houve reprodução E2E de cada cenário nem novo benchmark de latência nesta rodada.

## Achados prioritários

### R1 — P1: desligar áudio pode continuar transmitindo o som do sistema

Referências: `src-tauri/src/capture.rs:658`, `src-tauri/src/media.rs:1148`.

`reconfigure_native_capture` conserva a porta de áudio do worker anterior ao alterar `audio_mode`. A construção do pipeline decide criar `wasapi2src loopback=true` apenas pela presença dessa porta; não exige um modo de áudio ativo. Portanto, iniciar com áudio e mudar para `none` conserva a captura e o envio de som, embora o estado retornado indique áudio desativado. A troca para `mic`, mapeada para ausência de áudio nativo, também merece esse cuidado.

Na direção inversa, começar sem áudio deixa a porta ausente: mudar para `system` não cria o ramo de áudio nem negocia uma nova trilha com os espectadores.

**Correção:** tratar a topologia de áudio explicitamente, interrompendo efetivamente a origem quando desativada e criando/negociando a trilha quando ativada. Até isso existir, impedir a troca durante a sessão ou executar uma reinicialização completa e controlada.

**Teste:** iniciar `system`, selecionar `none` e verificar ausência de captura/pacotes e silêncio no espectador; repetir `process → none`, `system → mic` e `none → system`. Verificar dados reais, não somente o campo `audioMode` retornado.

### R2 — P1: troca de codec reinicia o encoder sem atualizar bridges e SDP

Referências: `src-tauri/src/capture.rs:670`, `src-tauri/src/webrtc_bridge.rs:137`, `js/app.js:2680`.

A reconfiguração pode trocar H.264 por AV1/HEVC e reutiliza as mesmas portas. Entretanto, as bridges existentes conservam caps RTP, depayloader e payloader definidos com o codec anterior. As conexões dos espectadores também não são renegociadas; `STREAM_CONFIG_UPDATED` apenas atualiza a informação exibida. O novo RTP deixa de corresponder ao pipeline e ao SDP existentes.

**Correção:** separar parâmetros ajustáveis em execução de mudanças que exigem reconstrução da bridge e renegociação de todas as conexões.

**Teste:** trocar H.264 ↔ AV1 com dois espectadores ativos; confirmar codec negociado, avanço de frames decodificados e recuperação de todos os espectadores. Exercitar também codec indisponível.

### R3 — P1: falha na reconfiguração deixa sessão marcada como ativa sem worker

Referências: `src-tauri/src/capture.rs:658`, `src-tauri/src/capture.rs:704`, `src-tauri/src/capture.rs:568`.

O worker é removido da sessão e encerrado antes de validar/iniciar seu substituto. Se `start_with_ports` falhar, a função retorna sem restaurar o anterior ou mudar o estado `live`. O monitor de saúde encerra sua verificação quando não encontra worker, sem converter esse caso em erro. Novas reconfigurações são rejeitadas porque `session.worker` está vazio.

**Correção:** validação prévia, transação com rollback quando viável e transição explícita para erro/parado quando a recuperação falhar. Propagar a falha à interface.

**Teste:** injetar falha de inicialização após encerramento do worker; exigir rollback funcional ou estado de erro consistente, limpeza dos recursos e possibilidade de iniciar novamente.

### R4 — P2: arrastar bitrate dispara vários reinícios completos

Referências: `js/app.js:514`, `js/app.js:586`, `src-tauri/src/capture.rs:704`.

Cada evento `input` do slider chama a reconfiguração, sem debounce ou consolidação. No nativo isso encerra e inicia um processo GStreamer; não é alteração direta da propriedade do encoder. Uma interação pode provocar uma sequência de interrupções e trabalho com valores já ultrapassados. O caminho de inicialização também aguarda 150 ms por tentativa.

**Correção:** aplicar no término da interação ou consolidar alterações, serializar operações e descartar estados intermediários. Para ajuste realmente contínuo, manter o pipeline e alterar propriedades suportadas.

**Teste:** disparar dezenas de eventos durante uma chamada pendente e exigir aplicação apenas do estado final, sem reinícios por evento.

### R5 — P2: alterar qualidade sem transmitir anuncia uma transmissão inexistente

Referências: `js/app.js:529`, `js/room.js:607`.

`applyLiveBitrateChange` chama `roomManager.setLocalStreaming(true, ...)` sempre que existe sala, mesmo sem `localStream` ou captura nativa ativa. Alterar preset/bitrate enquanto o usuário está apenas na sala publica esse membro como transmissor, levando outros participantes a tentar assistir a uma transmissão que não existe.

**Correção:** persistir a preferência separadamente e publicar estado de transmissão apenas quando uma captura estiver realmente ativa.

**Teste:** mudar preset e bitrate em membro ocioso/espectador e verificar que nenhum anúncio `ROOM_STREAM_PUBLISHED` é enviado e que `streaming` permanece falso.

### R6 — P2: áudio tardio modifica o conjunto de trilhas do MediaRecorder ativo

Referência: `js/clipping.js:88`.

O listener `addtrack` adiciona a nova trilha ao stream que já está sendo gravado. A especificação determina que adicionar/remover trilhas interrompe a gravação com `InvalidModificationError`. O debounce inicial de 150 ms no caminho direto reduz a exposição, mas não garante que o áudio chegue antes do início. Reiniciar depois pode perder o histórico do buffer.

**Correção:** manter topologia estável durante a gravação ou encerrar/reiniciar segmentos deliberadamente, preservando sua inicialização e histórico de modo compatível com exportação.

**Teste:** em navegador real, iniciar vídeo e adicionar áudio depois de 500 ms; verificar continuidade, erros, presença de áudio e decodificação do arquivo exportado. Mocks de MediaRecorder não validam essa regra.

Fonte: [W3C — MediaStream Recording](https://www.w3.org/TR/mediastream-recording/).

### R7 — P2: stop do clipping não remove o listener da origem

Referências: `js/clipping.js:157`, `js/clipping.js:399`.

`stop()` atribui `this.stream = null` antes de `_releaseRecordingTracks()`, que depende justamente desse stream para remover `addtrack`. A origem antiga conserva o callback e referências ao stream isolado; eventos posteriores podem modificar registros do gravador depois de uma parada ou nova sessão.

**Correção:** remover os listeners antes de apagar a referência, com limpeza idempotente e proteção por geração.

**Teste:** iniciar/parar repetidamente; emitir `addtrack` na origem antiga e exigir que nenhum recurso da gravação atual seja alterado.

### R8 — P2: receptor nativo usa propriedade inexistente na fila

Referência: `src-tauri/src/native_viewer.rs:349`.

`queue.set_property("drop-oldest", true)` usa uma propriedade que não existe em `queue`. A inspeção do GStreamer instalado confirmou que o descarte é configurado por `leaky`. O erro acontece na construção do ramo dinâmico de vídeo, podendo causar panic quando a mídia chega; criar a instância ou gerar SDP não percorre necessariamente esse caminho.

**Correção:** configurar a propriedade suportada, com tipo correto, e testar chegada efetiva de mídia. O receptor nativo ainda não tem consumidor integrado no frontend além do wrapper de IPC, portanto este achado não explica automaticamente stutters do receptor web atual.

**Teste:** negociar uma sessão e entregar RTP válido até apresentar ao menos um frame; exigir ausência de panic/erro de pipeline.

### R9 — P2: instalação assistida do driver depende de arquivo ausente do pacote

Referências: `src-tauri/src/gamepad.rs:310`, `src-tauri/tauri.conf.json`.

O comando procura `tools/install-vigem.ps1` nos ancestrais do executável. O bundle declara somente `native-media` como recurso; o hook de instalação não fornece esse script. Funcionar dentro do repositório não valida o botão na instalação final, que tende a retornar “script não encontrado”.

**Correção:** empacotar o recurso necessário e resolvê-lo pelo diretório de recursos da aplicação, com tratamento explícito da elevação e do resultado.

**Teste:** instalar o NSIS em ambiente sem checkout e sem driver; acionar o fluxo pelo aplicativo instalado.

### R10 — P2: reduzir o modo co-op não revoga slots incompatíveis

Referências: `js/coop.js:203`, `js/coop.js:212`, `js/coop.js:519`, `js/app.js:416`.

Os setters de limite de jogadores e modo party apenas atualizam flags. A revogação ocorre ao desligar totalmente o co-op. Assim, mudar de quatro para dois jogadores mantém os slots extras autorizados; sair de party pode manter o participante remoto no slot reservado ao host. A validação de inputs consulta as atribuições antigas em `coopSlots`, sem aplicar os novos limites.

**Correção:** reconciliar e revogar slots incompatíveis na transição, zerando inputs pendentes e notificando os participantes removidos.

**Teste:** aprovar P1 remoto/P3/P4, reduzir o modo e enviar inputs desses peers; exigir rejeição, liberação de controles e estado consistente em todos os membros.

## Cobertura e maturidade das funcionalidades

- `RelayManager` está testado isoladamente, mas `js/relay.js` não é importado pelo fluxo de produção. Não considerar a árvore de retransmissão de mídia entregue nem atribuir a ela redução de carga do host. Retransmitir mensagens de sala não equivale a retransmitir mídia.
- `startNativeViewer` aparece no wrapper desktop e nos testes, sem uso integrado no fluxo principal. Sua existência não demonstra que o espectador atual usa renderização nativa.
- As mudanças locais de voz corrigem a aceitação de um MediaStream como argumento e tentam iniciar reprodução explicitamente. A promessa de `play()` continua podendo falhar por política de autoplay; conferir áudio audível em navegador real, não somente criação do elemento.
- O foco dos testes precisa incluir transições e produto empacotado. Asserções de argumentos, SDP e mocks são úteis, mas não comprovam silêncio após desativação, continuidade de gravação ou apresentação de vídeo.

## Validação realizada

- `npm test`: **47 arquivos e 488 testes aprovados**. Há avisos de limitações do jsdom para canvas/navegação; essa execução não equivale a validação visual ou de mídia real.
- `cargo test --manifest-path src-tauri/Cargo.toml --lib --offline`, com o runtime GStreamer no PATH: **29 testes aprovados**, incluindo testes de negociação e conversão existentes.
- `gst-inspect-1.0.exe queue`: confirma ausência de `drop-oldest` e existência de `leaky`.
- Os comandos IPC protegidos por `cfg(not(test))`, incluindo a reconfiguração, não são exercitados diretamente pelos testes de biblioteca.
- Não foram executados nesta rodada: benchmark sob carga, E2E completo com espectadores, compilação/instalação NSIS e verificação visual da landing page. Alterações simultâneas no workspace limitam a associação dos testes a um snapshot imutável.

## Ordem recomendada

1. Corrigir R1 e adicionar regressão que verifique silêncio real ao desativar áudio.
2. Tornar a reconfiguração transacional e distinguir ajustes de bitrate de mudanças de codec/topologia (R2–R4).
3. Corrigir estados da sala e revogação de permissões (R5/R10).
4. Validar clipping com navegador e arquivos realmente decodificados (R6/R7).
5. Completar receptor nativo e instalação fora do checkout (R8/R9).
6. Depois de estabilizar esses fluxos, repetir A/B sob carga com build release e configuração fixa. Associar cada resultado ao commit/binário e não misturar execuções durante alterações no código.

Esses achados não demonstram uma causa única dos stutters históricos. Os reinícios disparados pela interface são uma fonte concreta de interrupções durante ajustes; para stutters em configuração fixa, ainda é necessário correlacionar captura, filas, encode, rede, decode e apresentação numa mesma execução.
