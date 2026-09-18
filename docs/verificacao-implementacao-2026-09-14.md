# Verificação da implementação da auditoria e da captura nativa

Revisão de 14/09/2026, sobre os arquivos atuais do checkout `G:\SeeMyGame`, incluindo alterações não commitadas. Comparação com `auditoria-2026-09-14.md` e `plano-captura-nativa.md`.

**Conclusão: implementação parcial, ainda não aprovada para concluir a auditoria ou entregar captura nativa.** Há correções reais, mas persistem problemas de autorização e controle remoto. A captura implementada é uma estrutura de controle de fontes/sessões; não existe pipeline de mídia funcional.

Nenhum código de produção foi corrigido nesta revisão. Foi reconstruído `dist` com encerramento de processos explicitamente desativado. As provas adicionais usaram objetos de conexão, mídia e input simulados; nenhum Companion, jogo, microfone ou transmissão real foi iniciado.

## Validação executada

| Verificação | Resultado | Alcance |
|---|---|---|
| `npm test` | 324 testes passaram, 26 arquivos | jsdom; há avisos de canvas/navegação não implementados |
| `cargo check --manifest-path src-tauri/Cargo.toml --locked --offline --all-targets` | Passou | Compilação, não execução da captura |
| `cargo clippy --manifest-path src-tauri/Cargo.toml --locked --offline --all-targets -- -D warnings` | Passou | O problema anterior de Clippy foi corrigido |
| `cargo fmt --manifest-path src-tauri/Cargo.toml --check` | Falhou | `build.rs`, `system.rs`, `main.rs` |
| Build estático | Passou | Executado com `KILL_DESKTOP=false`, sem `--kill` |
| Provas adicionais Node/Python | Falhas reproduzidas abaixo | Módulos reais com dependências simuladas |

Não foram realizados testes de instalador, captura/áudio reais, TURN entre máquinas, desempenho ou compatibilidade com Vanguard. Os 324 testes não comprovam essas propriedades.

## Achados que impedem aprovação

### R01 — P1 — Captura nativa não implementada de ponta a ponta

[capture.rs:75](G:/SeeMyGame/src-tauri/src/capture.rs:75) fixa `available: false`; [capture.rs:181](G:/SeeMyGame/src-tauri/src/capture.rs:181) sempre retorna erro depois da validação da fonte. Não há worker WGC/WASAPI, encoder, WebRTC nativo nem runtime empacotado no Cargo/configuração examinados.

O seletor agora encaminha a fonte correta e evita fallback automático, mas a consequência prática é que **“Transmitir janela/monitor” falha**, não que a captura funciona sem o seletor. `getNativeCaptureCapabilities` existe em `desktop.js`, porém a UI de seleção não o consulta antes de oferecer esses botões.

O documento `captura-nativa-implementacao.md` reconhece a limitação. Isso é transparente, mas não satisfaz nem o primeiro marco funcional do plano. A ausência de um runtime instalado não é o único bloqueio: falta implementar o pipeline.

### R02 — P1 — Autorização de sala ainda pode ser contornada

[room.js:230](G:/SeeMyGame/js/room.js:230) valida o PIN em `ROOM_JOIN_REQUEST` somente quando o destinatário é master. Um membro não master de uma sala com PIN aceita um pedido direto com senha incorreta, autentica o remetente e o adiciona à malha.

[room.js:290](G:/SeeMyGame/js/room.js:290) aceita `ROOM_PIN_ACCEPTED` de qualquer remetente e o insere em `authenticatedPeers`. Na prova, uma confirmação forjada fez `isPeerAuthorized` retornar verdadeiro; registrar uma conexão subsequente com esse peer o admitiu na malha.

Além disso, [room.js:298](G:/SeeMyGame/js/room.js:298) não bloqueia sincronização forjada quando o destinatário é o próprio master, e `ROOM_MEMBER_JOINED` não verifica a autoridade do emissor. O filtro posterior de `app.js` ocorre depois da mutação da lista pelo RoomManager.

**Observado nas provas:**

```json
{
  "forgedPinAccepted": { "authorized": true, "inMesh": true },
  "guestWrongPin": { "authorized": true, "inMesh": true },
  "masterForgedSyncInsertedMember": true
}
```

Correção necessária: definir admissão verificável pelo coordenador, validar autoridade antes de qualquer mutação e aplicar a mesma autorização a todos os caminhos de mídia/dados. Uma mensagem que afirma aceitação não pode conferir autorização por si só.

### R03 — P1 — Sinalização de voz ainda usa destino fornecido pelo participante

[app.js:1087](G:/SeeMyGame/js/app.js:1087) executa `peer.call(data.peerId, voiceManager.localStream)` ao receber `VOICE_SIGNAL/HOST_VOICE_ACTIVE`, sem vincular o destino à conexão autenticada ou à lista de destinatários permitidos. Um remetente que passa pelo filtro de entrada pode indicar outro destino para o microfone local. Estados de voz também usam `data.peerId`, permitindo atuar sobre outro participante.

Evidência estática; não foi enviada mídia na revisão. Corrigir a derivação de identidade e a autorização de cada destino, inclusive em caminhos de retransmissão pelo host.

### R04 — P1 — Pareamento do Companion permanece opcional e a validação de origem está incorreta

[coop-agent.py:85](G:/SeeMyGame/tools/coop-agent.py:85) usa `hostname.endswith("seemygame.com")`, aceitando também `evilseemygame.com`. A regra equivalente para Pages aceita `evilseemygame.pages.dev`. O token segue opcional e, quando ausente, a conexão já inicia autenticada em [coop-agent.py:109](G:/SeeMyGame/tools/coop-agent.py:109).

As funções reais, executadas isoladamente por AST, produziram:

| Origem | Aceita? |
|---|---|
| `https://evilseemygame.com` | Sim |
| `https://evilseemygame.pages.dev` | Sim |
| `http://tauri.localhost` | Não |
| Sem Origin | Sim |

O terceiro caso é também uma regressão para a origem desktop mostrada na imagem do usuário. Corrigir correspondência exata das origens e tornar o pareamento obrigatório com confirmação de sucesso. O JS hoje anuncia conexão antes de receber `AUTH_OK`.

### R05 — P1 — Liberação de input ainda falha em situações de emergência

Em [coop-agent.py:42](G:/SeeMyGame/tools/coop-agent.py:42), `release_all()` ignora erros de `keyUp`/`mouseUp` e limpa o registro mesmo quando a liberação falha. Simulando uma chamada que falha no canto da tela, a tecla permaneceu pressionada e o registro foi apagado:

```json
{ "physical_keys": ["w"], "tracked_keys": [] }
```

O tratamento de failsafe continua o loop, sem revogar a sessão. O ramo de teclado também captura exceções genericamente. Não há watchdog de sessão. Em [coop.js:143](G:/SeeMyGame/js/coop.js:143), `COOP_RELEASE` apenas limpa estado JS; não envia `INPUT_RESET` ao Companion, cujo socket pode continuar aberto. Isso também é usado na desconexão do peer.

É necessário encerrar/revogar a sessão, liberar inputs de modo confiável e cobrir desconexão, abandono, timeout e emergência. A prova não enviou input ao Windows.

### R06 — P2 — O contrato de mídia proposto diverge do plano e depende de uma ponte inexistente

[capture.js:72](G:/SeeMyGame/js/capture.js:72) espera `__SEEMYGAME_NATIVE_CAPTURE__.createStream`; nenhuma implementação dessa ponte foi encontrada. O app continua exigindo `MediaStream`, atribuindo `localStream` e enviando-o via `peer.call`.

Isso não implementa o envio nativo direto aos espectadores previsto no plano. Se a ponte apenas decodificar a captura no WebView para reenviá-la pelo PeerJS, será necessário recodificar no navegador, com custo adicional não validado. A decisão precisa ser explícita: implementar o transporte nativo previsto ou revisar e medir a arquitetura alternativa antes de declará-la pronta.

### R07 — P2 — Integração Tauri possui incompatibilidades ocultadas pelos mocks

O Rust serializa `session_id` em [capture.rs:32](G:/SeeMyGame/src-tauri/src/capture.rs:32), mas o JS lê `sessionId` em [capture.js:112](G:/SeeMyGame/js/capture.js:112). Simulando a resposta real do Rust, `setAudioMode` não invocou comando algum e `stop` enviou `sessionId: null`. O teste atual usa uma resposta camelCase inventada e não detecta isso. Esta falha ficará operacionalmente exposta quando o backend passar a retornar sucesso.

Em [desktop.js:130](G:/SeeMyGame/js/desktop.js:130), o listener depende de `import('@tauri-apps/api/event')`. O build apenas copia arquivos; as páginas não possuem import map para resolver esse especificador. A dependência instalada em `node_modules` não é disponibilizada automaticamente aos módulos servidos no WebView. O erro é capturado e substituído por um listener vazio, ocultando a perda de eventos. Constatação estática do pacote, sem executar o WebView.

Normalizar o contrato real, resolver imports no build e testar respostas/eventos no formato serializado pelo Rust.

### R08 — P2 — Cancelar durante o início não cancela a captura pendente

Em [capture.js:157](G:/SeeMyGame/js/capture.js:157), `start()` aguarda o provedor e depois define `live`, sem verificar se `stop()` ocorreu durante a espera.

Reprodução: iniciar com Promise pendente → chamar `stop()` → resolver o início. Resultado: `finalState: "live"`, `sessionPresent: true`, mesmo após o provedor ter sido parado. Usar geração/token de cancelamento e parar tracks que cheguem depois do cancelamento. O teste de “não fazer fallback” existente não cobre essa sequência.

### R09 — P2 — Autorização correta no protocolo de sala não libera todos os recursos legados

`ROOM_JOIN_REQUEST` correto atualiza `RoomManager.authenticatedPeers`; chat e chamadas de voz também exigem `authenticatedViewers`, mantido separadamente em `app.js`. A mensagem de sala retorna antes do caminho que atualiza esse segundo conjunto. Um participante aceito pelo protocolo de sala pode continuar bloqueado nos recursos legados até realizar uma autenticação adicional por `REQUEST_STREAM`.

Há ainda emissão de `pinAccepted` sem esse evento no registro de listeners e ausência de inscrição do app em `pinRequired`/`pinAccepted`. Consolidar o estado de autorização e testar uma entrada completa com PIN, chat, voz e vídeo, não apenas RoomManager isolado.

## Resultado por item da auditoria original

“Parcial” significa que existe melhora, mas o achado não pode ser encerrado. “Corrigido no escopo” refere-se ao caminho inspecionado, sem representar certificação de todo o recurso.

| ID | Situação | Evidência atual |
|---|---|---|
| A01 | Parcial | Chat, voz e presença passaram a usar `textContent`; CSP continua `null` e identidade/papel ainda vêm do payload |
| A02 | Parcial, bloqueante | PIN errado no master é tratado; admissão direta em outro membro e confirmação forjada continuam aceitas |
| A03 | Parcial, bloqueante | Verificação de sync no cliente melhorou; master/mensagens de presença e sinalização de voz ainda confiam em dados indevidos |
| A04 | Parcial | Há filtros novos no broadcast e voz; estados de autenticação continuam divergentes |
| A05 | Parcial, bloqueante | Origin/token adicionados, mas token opcional e regra de domínio incorreta |
| A06 | Parcial, bloqueante | Reset/failsafe adicionados; não cobrem liberação confiável e perda da sessão |
| A07 | Corrigido no escopo | PTT inicia tracks desabilitadas e reseta estado ao sair; testes passaram |
| A08 | Corrigido no caminho inspecionado | Deduplicação e envio único por peer; retransmissão desativada na malha de salas. Não houve teste real de três máquinas |
| A09 | Parcial | Handler da sala deixou de ser sobrescrito; convite desktop ainda usa origem local |
| A10 | Pendente | Duas chamadas a `initGamerFeatures`; listener do ABR ainda sem guarda idempotente |
| A11 | Corrigido no roteamento | Lousa e áudio customizado foram adicionados aos dois dispatchers; falta validação real de rede |
| A12 | Pendente | Sem gamepad virtual/handshake de capacidades; fallback não controla outra aba |
| A13 | Parcial | `keydown` ignora campos editáveis; escopo global e coordenadas do Companion permanecem |
| A14 | Parcial | DOM seguro e sourceId encaminhado; captura nativa sempre falha |
| A15 | Pendente | Recorder global, descarte dos primeiros chunks e início antes de adicionar microfone permanecem |
| A16 | Parcial | Cache com TTL/abort; inicialização do Peer continua sem aguardar TURN |
| A17 | Parcial | Amostras desconhecidas melhoraram; controlador ainda global e alvo não acompanha todas as mudanças |
| A18 | Corrigido no cálculo | Unidades de jitter corrigidas e testadas; comportamento real por navegador não validado |
| A19 | Pendente | Alta prioridade e topmost continuam forçados no startup |
| A20 | Substancialmente corrigido | Build normal não encerra processos; encerramento opcional usa caminho. Ajustar limite do prefixo para não incluir `target-outro` |
| A21 | Pendente | Reserva do ID do coordenador continua sem prova de propriedade |
| A22 | Parcial | Tamanho de texto limitado; faltam quotas centrais de canais, conexões e payloads |

O endpoint TURN não recebeu a implementação de autenticação/controle de consumo recomendada. Dependências não foram reauditadas contra bases externas nesta revisão. Não há nova evidência de compatibilidade ou conflito com anticheats.

## Resultado por etapa do plano de captura

| Etapa | Estado |
|---|---|
| 1 — Protótipo WGC → encoder → navegador remoto | Não implementado |
| 2 — Contratos, fontes e autorização | Parcial: enumeração/registro existem; contrato de sessão e autorização precisam de correção |
| 3 — Seletor e ciclo de captura | Parcial: seleção encaminhada; sem captura, sem validação do ciclo real |
| 4 — Áudio e sincronização | Não implementado |
| 5 — WebRTC nativo, preview e clipes | Não implementado; apenas interface para ponte futura |
| 6 — Pacote e testes reais | Não realizado para captura nativa |

## Ordem recomendada de conclusão

1. Corrigir R02–R05 e unificar a autorização da sala; acrescentar regressões que usem os caminhos de entrada reais.
2. Corrigir serialização/imports/cancelamento e exibir indisponibilidade nativa antes da seleção.
3. Entregar o protótipo nativo ponta a ponta, com métricas e runtime empacotado, antes de considerar o plano implementado.
4. Integrar áudio, preview, múltiplos espectadores e gravação; tratar as pendências da matriz.
5. Validar em Windows limpo, navegador remoto, TURN e jogos suportados. Atualizar a documentação apenas com resultados demonstrados.

## Addendum de correcoes - 15/09/2026

Esta secao substitui o status operacional acima para o checkout atual. O relatorio original permanece como registro historico da verificacao de 14/09.

### Corrigido e verificado no codigo

| Item | Correcao aplicada | Evidencia |
|---|---|---|
| R02/A02/A03/A04/A21 | Chave de convite derivada no ID do coordenador, admissao por handshake, conexoes publicas pendentes, validacao de remetente/conexao e rejeicao de sync/estado forjado | testes de `room.js`, `pin-auth` e `room-app` |
| R03 | Voz usa a conexao autenticada como origem/destino; relay so pelo coordenador; chamadas so apos admissao | testes de app/voz e validacao estatica |
| R04/R05 | Origin exata, token obrigatorio, capacidades negociadas, alvo de captura, reset de input, watchdog e falha segura do Companion | `py_compile`, testes de `coop` e inspecao do agente |
| R07/R08 | Contratos Rust snake/camel normalizados, listener Tauri via IPC interno e cancelamento por geracao | testes de captura/desktop |
| A10/A12/A13/A16/A17/A18/A19/A20/A22 | Inicializacao idempotente, gamepad anunciado honestamente como indisponivel, input escopado, TURN aguardado, ABR por peer, jitter em unidades corretas, prioridade/topmost opt-in, limites de voz/chat/protocolo | regressoes unitarias, build e checks abaixo |

### Validacao atual

- `npm test -- --run`: **331 testes aprovados em 26 arquivos**.
- `cargo check --manifest-path src-tauri/Cargo.toml --locked --offline --all-targets`: aprovado.
- `cargo fmt --manifest-path src-tauri/Cargo.toml --all -- --check`: aprovado.
- `node --check` nos modulos JS alterados: aprovado.
- `node tools/build-dist.js`: aprovado sem encerrar processos.
- `python -m py_compile tools/coop-agent.py`: aprovado; bytecode temporario removido.
- `git diff --check`: sem erros de whitespace; apenas avisos de conversao LF/CRLF.

### Pendencias reais restantes

1. **R01/R06 e etapas 1, 4 e 5 da captura nativa:** o worker WGC/WASAPI/encoder/WebRTC e a ponte `MediaStream` ainda nao existem no repositorio. O build informa `available: false` e nao finge que uma fonte nativa esta transmitindo.
2. **Etapa 6 da captura nativa:** falta empacotar e testar o runtime de midia em Windows limpo, com captura real, audio, codec, TURN e espectador remoto.
3. **Gamepad nativo:** permanece explicitamente indisponivel; nao foi introduzido driver virtual sem uma decisao de suporte e manutencao.
4. **Operacao externa:** ainda faltam emissao/rotacao de credenciais TURN no servidor, teste relay entre maquinas, instalador assinado, CI e validacao com jogos/anti-cheats reais.

Portanto, as pendencias de codigo auditadas foram corrigidas dentro do escopo atual, mas o plano completo de captura nativa **continua nao concluido** ate que o worker e os testes de midia real sejam entregues.
