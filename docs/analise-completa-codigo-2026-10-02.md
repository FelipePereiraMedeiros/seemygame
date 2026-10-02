# Análise do código do SeeMyGame — 02/10/2026

## Parecer

A arquitetura tem uma base útil: sessões próprias, composição de plugins, separação dos engines, validação de envelopes e processamento nativo de mídia. Entretanto, o estado examinado contém falhas de autorização, criação de conexões e encerramento de recursos que impedem considerar os fluxos principais estabilizados. A prioridade é corrigir esses contratos antes de investir em novas otimizações de latência ou expansão de funcionalidades.

Os problemas mais importantes são o envio do microfone do Viewer a um peer não selecionado, a criação recursiva da malha com três participantes, a duplicação de chamadas no Streamer e a continuidade de mídia depois de a conexão de dados perder autorização.

Esta análise considera o checkout **main**, baseado no commit **9a9f03d**, incluindo alterações locais. O checkout recebeu edições concorrentes durante a revisão; os resultados abaixo identificam a execução registrada e uma rechecagem posterior. Não são uma certificação de uma revisão Git imutável.

## Escopo e método

Foram examinados os contratos e caminhos principais de páginas/entries/sessões, admissão e protocolo, plugins, captura browser/nativa, áudio e voz, Co-op, lousa, replay, telemetria, TURN, servidor local, build e CI. As bibliotecas vendorizadas de Three.js não receberam uma auditoria interna linha por linha.

Além da leitura, foram executadas as verificações oficiais do repositório, testes Rust e Python, E2E em navegador e sondas locais com assertions. As sondas não contatam produção e não usam um microfone físico. Elas usam peers e streams controlados para demonstrar a execução dos caminhos defeituosos.

Não foram aplicadas correções ao código da aplicação. Foram criados este relatório, scripts de reprodução e registros de execução. O build produziu `dist` e regenerou páginas conforme os templates presentes no checkout.

**Prioridades:** P1 = corrigir antes de liberar os fluxos afetados; P2 = defeito funcional, proteção incompleta ou risco operacional que deve entrar no próximo ciclo de correções. Não foi demonstrado um incidente P0.

## Achados reproduzidos

### A01 — P1: Viewer responde a chamadas de voz de qualquer peer com seu microfone

**Local:** [viewer-session.js:250](C:/Users/Diogo/SeeMyGame/js/session/viewer-session.js:250), [session-handlers.js:133](C:/Users/Diogo/SeeMyGame/js/protocol/session-handlers.js:133).

O listener de `call` encaminha qualquer chamada com metadata `VOICE_CHAT` para `answerVoiceCall`, sem confrontar `call.peer` com `targetHostId` e a conexão admitida. O handler responde com `voiceManager.localStream` quando o usuário está na voz.

**Reprodução:** host selecionado `trusted-host`; chamada de `unrelated-peer`; o objeto representando o microfone ativo foi passado a `call.answer`. A condição é o atacante conhecer o Peer ID do Viewer e conseguir chamá-lo; ele não precisa estar na conexão de dados selecionada.

**Impacto:** divulgação de áudio a outro peer. Chamadas de vídeo não solicitadas também são aceitas no mesmo listener, podendo inserir cartões e substituir o estado `activeCall`.

**Correção:** rejeitar chamadas de peers sem conexão de dados esperada e autorização; aplicar a verificação antes de responder, inclusive para voz. Testar que um peer estranho nunca recebe uma trilha local.

### A02 — P1: malha da sala cria conexões recursivamente antes do primeiro `open`

**Local:** [room-session.js:262](C:/Users/Diogo/SeeMyGame/js/session/room-session.js:262), [admission.js:35](C:/Users/Diogo/SeeMyGame/js/room/admission.js:35).

`connectMeshMembers` só considera conexões cujo `.open` já é verdadeiro. Um membro anunciado pelo coordenador já consta em `authenticatedPeers`; registrar sua nova conexão chama `promoteConnection`, que emite `membersUpdated` sincronamente. Isso reentra em `connectMeshMembers` enquanto a conexão anterior ainda não abriu e cria outra conexão ao mesmo membro.

**Reprodução:** a sonda limitou o cenário a sete tentativas para evitar esgotamento. O E2E oficial com três participantes produziu `Cannot create so many PeerConnections` e terminou com timeout de 20 segundos na confirmação de membros.

**Impacto:** sala com terceiro participante falha, consome conexões e pode comprometer todas as transmissões do contexto do navegador.

**Correção:** reservar o peer antes de iniciar a conexão, distinguir conexão em construção de conexão aberta e impedir promoção/eventos reentrantes. Retirar a reserva somente quando houver sucesso, falha ou cancelamento definitivo.

### A03 — P1: handshake normal de sala aberta duplica a chamada de mídia

**Local:** [streamer-session.js:197](C:/Users/Diogo/SeeMyGame/js/session/streamer-session.js:197), [streamer-session.js:294](C:/Users/Diogo/SeeMyGame/js/session/streamer-session.js:294).

Com a transmissão ativa e sem PIN, o `open` da DataConnection chama `callViewerWithStream`. O Viewer envia `REQUEST_STREAM` após abrir a conexão, provocando outra chamada. `callViewerWithStream` não verifica uma chamada existente antes de `peer.call` e sobrescreve a entrada do mapa.

**Reprodução:** uma única conexão de espectador, seguida de `open → REQUEST_STREAM`, criou duas chamadas, com apenas uma entrada em `activeCalls`.

**Impacto:** consumo adicional de encoder/upload e estados concorrentes. O fechamento de uma chamada antiga pode também afetar a telemetria ou o cartão pertencente à nova chamada.

**Correção:** tornar a criação idempotente por viewer, incluindo a fase de negociação. Se houver substituição, fechar a chamada anterior e vincular os callbacks à identidade da chamada atual.

### A04 — P1: desconexão de dados revoga a autorização sem fechar a mídia

**Local:** [streamer-session.js:271](C:/Users/Diogo/SeeMyGame/js/session/streamer-session.js:271).

O callback `close` remove o viewer, revoga o AdmissionGate e apaga `activeCalls`, mas não chama `close` na chamada correspondente. DataConnection e MediaConnection são recursos independentes.

**Reprodução:** depois do fechamento da DataConnection, as duas chamadas criadas na sonda continuaram abertas e deixaram de ser rastreadas no mapa. O `registerCleanup(release)` da chamada encerra tuning/telemetria, mas não fecha a MediaConnection.

**Impacto:** a revogação de acesso não interrompe necessariamente a entrega de áudio/vídeo. Recursos abandonados continuam até um encerramento posterior do peer ou da própria mídia.

**Correção:** fechar as chamadas do viewer antes de retirar as referências, tratando também `error` e substituição de DataConnection. Verificar que perder admissão efetivamente interrompe mídia e Co-op.

### A05 — P2: atualização de lousa contorna a validação aplicada à inclusão

**Local:** [document.js:120](C:/Users/Diogo/SeeMyGame/js/whiteboard/document.js:120), [whiteboard-plugin.js:66](C:/Users/Diogo/SeeMyGame/js/plugins/whiteboard-plugin.js:66).

`addElement` usa `isSafeWhiteboardElement`; `updateElement` substitui um elemento existente após conferir apenas o ID. Mensagens `WHITEBOARD_ELEMENT_UPDATE` chegam diretamente a essa operação.

**Reprodução:** um desenho válido foi substituído por `{type:'pencil', points:[null,null]}`. O validador rejeitou o objeto, mas a atualização o persistiu; a renderização desse desenho lançou `TypeError`.

**Impacto:** um membro admitido pode inserir estado que quebra sucessivas renderizações. O isolamento de exceções do dispatcher não desfaz o estado já gravado.

**Correção:** validar e normalizar antes de qualquer mutação, incluindo atualizações reconstruídas de chunks. Renderizar somente objetos aprovados e evitar persistência parcial quando houver falha.

### A06 — P2: negar o microfone deixa a captura de tela da Room ativa e sem proprietário

**Local:** [room-session.js:533](C:/Users/Diogo/SeeMyGame/js/session/room-session.js:533).

A função obtém a tela, depois pede microfone. A variável `stream` fica dentro do `try`; o `catch` não para suas trilhas. Como `localStream` só é atribuído após o pedido de microfone, a sessão não mantém uma referência à captura de browser adquirida antes da falha.

**Reprodução:** `getDisplayMedia` retornou uma trilha; `getUserMedia` rejeitou; tanto a falha quanto `app.dispose()` deixaram a contagem de `track.stop()` em zero.

**Impacto:** captura continua depois de a interface informar que não conseguiu iniciar. Isso não demonstrou envio remoto dessa tela, mas deixa indicador e recursos ativos.

**Correção:** manter o stream adquirido acessível ao rollback e encerrar tela/microfone/provider em todo erro ou cancelamento anterior à publicação.

### A07 — P2: “Parar compartilhamento” do navegador não encerra o estado do Streamer

**Local:** [streamer-session.js:319](C:/Users/Diogo/SeeMyGame/js/session/streamer-session.js:319).

O Streamer não instala o listener de `ended` na trilha de vídeo que existe na Room.

**Reprodução:** após o evento `ended`, `localStream` permaneceu preenchido. A proteção de `startCapture` passa a impedir nova captura porque interpreta essa referência como transmissão ativa.

**Impacto:** interface e chamadas permanecem em estado de transmissão, e retomar exige uma ação extra de parada ou recarga.

**Correção:** vincular o encerramento da trilha ao dono daquela geração de captura e chamar o fluxo de parada completo uma única vez.

### A08 — P2: fallback de ID ocupado tenta novamente o mesmo ID

**Local:** [streamer-session.js:160](C:/Users/Diogo/SeeMyGame/js/session/streamer-session.js:160), [streamer-session.js:186](C:/Users/Diogo/SeeMyGame/js/session/streamer-session.js:186).

A recuperação de `unavailable-id` chama `initStreamerPeer(null)`, mas `customId || streamerState.customId` volta a escolher o ID ocupado. O peer anterior também não é destruído nesse ramo.

**Reprodução:** quatro tentativas sucessivas escolheram exatamente `occupied-custom-id`, mesmo após três erros de ID indisponível.

**Impacto:** repetição de peers/tentativas e ausência do fallback aleatório prometido ao usuário.

**Correção:** representar explicitamente a tentativa aleatória, destruir a tentativa anterior e limitar retries por inicialização.

### A09 — P2: botão “Pedir Controle” do cartão do Viewer não tem callback

**Local:** [viewer-session.js:278](C:/Users/Diogo/SeeMyGame/js/session/viewer-session.js:278), [video-cards.js:389](C:/Users/Diogo/SeeMyGame/js/ui/video-cards.js:389).

A criação do cartão do Viewer omite `onCoopClick`. O componente cria o botão e só instala `onclick` quando recebe esse callback. A atualização de estado Co-op não instala a ação ausente.

**Reprodução:** receber um stream criou `btn-coop-trusted-host` com `onclick === null`.

**Impacto:** a ação oferecida nesse cartão não solicita Co-op. A mesma omissão precisa ser verificada nos cartões nativos e da Room; a sonda confirma especificamente o caminho PeerJS do Viewer.

**Correção:** passar a ação do controlador da sessão ao componente, com alternância entre solicitar e liberar o host correto.

### A10 — P2: identidade do envelope não autentica o autor do chat

**Local:** [session-handlers.js:25](C:/Users/Diogo/SeeMyGame/js/protocol/session-handlers.js:25), [chat.js:107](C:/Users/Diogo/SeeMyGame/js/chat.js:107).

O transporte valida `senderPeerId` contra a conexão, mas o handler armazena `data.message.senderId`, `senderName`, `role` e `isSystem` fornecidos pelo peer. Sanitização textual não resolve falsificação de identidade.

**Reprodução:** um envelope autenticado como `guest` persistiu uma mensagem com autor `host` e papel `host`.

**Impacto:** mensagens podem se apresentar como host ou sistema, comprometendo a confiança nas instruções exibidas.

**Correção:** atribuir identidade e papel a partir da conexão/membership. Para relay, preservar autoria por um contrato verificável, sem confiar em um campo arbitrário do payload.

### A11 — P2: sincronização inicial da lousa fragmenta por quantidade, não por bytes

**Local:** [whiteboard-plugin.js:107](C:/Users/Diogo/SeeMyGame/js/plugins/whiteboard-plugin.js:107), [shared.js:19](C:/Users/Diogo/SeeMyGame/js/room/shared.js:19).

Até 25 elementos são enviados em um único `WHITEBOARD_SYNC`; acima disso, os batches têm 20 elementos. Uma única imagem pode exceder o limite de 256 KiB da Room. O envio inicial de imagens usa chunks na UI, mas esse mecanismo não é usado na resposta de sincronização.

**Reprodução:** uma imagem com 300 mil caracteres foi aceita na lousa e respondeu com um único `WHITEBOARD_SYNC`, rejeitável pelo limite de bytes da sala.

**Impacto:** quem entra depois pode não receber imagens já presentes, embora tenha recebido normalmente novas imagens fragmentadas.

**Correção:** usar limites em bytes e o mesmo protocolo de fragmentação para inclusão, atualização, relay e sincronização; montar a sincronização completa antes de substituir o documento.

### A12 — P2: nomes iguais removem membros ativos com sessões diferentes

**Local:** [message-handlers.js:100](C:/Users/Diogo/SeeMyGame/js/room/message-handlers.js:100).

A detecção de relog considera uma correspondência de nome customizado suficiente para remover o membro anterior, independentemente da identidade da sessão ou da saúde da conexão.

**Reprodução:** dois peers com `clientSessionId` diferentes e nome `Player`; o primeiro permaneceu conectado, mas deixou de constar nos membros autorizados.

**Impacto:** colisão normal de nomes ou uso intencional do nome de outro participante remove sua presença/admissão.

**Correção:** não usar nome de exibição como credencial de reconexão. Exigir um mecanismo de retomada ligado à sessão, ou admitir ambos com nomes iguais.

### A13 — P2: fallback HTTPS inclui OpenRelay, contrariando a política documentada

**Local:** [config.js:79](C:/Users/Diogo/SeeMyGame/js/config.js:79), [config.js:192](C:/Users/Diogo/SeeMyGame/js/config.js:192).

`getStaticFallbackIceServers` sempre devolve `DEFAULT_ICE_SERVERS`, incluindo três entradas TURN públicas. `isProductionWebOrigin` e o conjunto STUN não são usados nesse retorno. A API impede fallback OpenRelay em produção, mas o cliente o aplica por conta própria.

**Reprodução:** em `https://seemygame.vercel.app`, o fallback devolveu três entradas TURN públicas.

**Impacto:** a configuração efetiva não corresponde ao README e à política da API; falha na autenticação/configuração do TURN privado fica mascarada por outra dependência de relay. Não há vazamento de uma credencial privada nessa sonda.

**Correção:** alinhar explicitamente o fallback de produção à política desejada e testar HTTPS, desktop e desenvolvimento.

### A14 — P2: servidor local expõe o checkout pela rede

**Local:** [serve.mjs:44](C:/Users/Diogo/SeeMyGame/tools/serve.mjs:44), [serve.mjs:67](C:/Users/Diogo/SeeMyGame/tools/serve.mjs:67).

O servidor escuta em `0.0.0.0`, serve arquivos da raiz inteira do repositório e responde com CORS `*`, sem filtro para dotfiles.

**Reprodução:** um servidor iniciado somente pela sonda respondeu `200` a `/.git/HEAD`, com CORS aberto. Nenhum segredo foi solicitado ou impresso.

**Impacto:** máquinas que alcançam a porta podem ler arquivos internos disponíveis sob a raiz. Arquivos de credenciais eventualmente colocados ali também estariam no escopo da exposição.

**Correção:** servir uma lista de assets ou `dist`, bloquear dotfiles/diretórios internos e usar loopback por padrão, com uma opção explícita para testes em LAN. O teste deve demonstrar a recusa de `.git` e arquivos não públicos.

### A15 — P2: URL malformada encerra o servidor local

**Local:** [serve.mjs:41](C:/Users/Diogo/SeeMyGame/tools/serve.mjs:41).

`decodeURIComponent` roda sem tratamento de erro no callback HTTP.

**Reprodução:** `GET /%ZZ` encerrou o processo controlado com código 1 e `URIError: URI malformed`.

**Impacto:** uma única requisição derruba a sessão local que serve a aplicação.

**Correção:** responder 400 a caminhos inválidos e manter o processo vivo. Revisar também a contenção de caminhos com `path.relative`, pois `startsWith(root)` não distingue a raiz de um diretório irmão com o mesmo prefixo.

## Achados estáticos adicionais

Estes itens têm um caminho concreto no código, mas não receberam uma reprodução dedicada de falha física ou de carga nesta revisão.

| Prioridade | Local | Problema e ação necessária |
| --- | --- | --- |
| P2 | [whiteboard-plugin.js:25](C:/Users/Diogo/SeeMyGame/js/plugins/whiteboard-plugin.js:25) | `incomingChunks` não limita transferências, índices, `total`, bytes agregados ou duração. O timestamp é armazenado e não expira a entrada. Separar transferências por peer, aplicar cotas e TTL e validar o objeto reconstruído antes de atualizar. |
| P2 | [document.js:124](C:/Users/Diogo/SeeMyGame/js/whiteboard/document.js:124) | Cada update adiciona um snapshot de todos os elementos ao undo. O histórico não tem cota de entradas/bytes. Muitas atualizações remotas podem crescer a memória indefinidamente. Consolidar operações e limitar o histórico. |
| P2 | [room-session.js:519](C:/Users/Diogo/SeeMyGame/js/session/room-session.js:519) | Voz acessa `session.messageHandlers`, mas a atribuição ocorre em `roomState.messageHandlers`. Assim, o binding de chamadas criadas nesse loop e o fechamento do mapa ao sair da voz não são executados. Usar um único proprietário e testar entrada/saída sem conexões restantes. |
| P2 | [fanout.rs:26](C:/Users/Diogo/SeeMyGame/src-tauri/src/capture/fanout.rs:26) | O thread de vídeo começa antes do bind/setup de áudio. Se o áudio falhar, `?` retorna antes de construir `RtpFanout`; seu `Drop` não roda, e o thread de vídeo retém `running=true`. Reservar ambos os recursos antes de iniciar threads ou usar rollback RAII desde a primeira aquisição. |
| P2 | [message-handlers.js:78](C:/Users/Diogo/SeeMyGame/js/room/message-handlers.js:78), [streamer-session.js:224](C:/Users/Diogo/SeeMyGame/js/session/streamer-session.js:224) | Validação de PIN não impõe limite/cooldown de tentativas na conexão. Um PIN numérico curto pode ser testado repetidamente sem abrir novos peers. Limitar falhas por conexão/peer e aplicar política de revogação/backoff. |

## Resultado das verificações

Ambiente: Node **24.14.0**, npm **11.9.0**, Cargo **1.98.1**, Windows, dependências já presentes no workspace.

| Verificação | Resultado registrado | Interpretação |
| --- | --- | --- |
| `npm run check:modules` | Passou: 162 módulos autorais, 419 imports/exports | Grafo e parsing válidos; não prova correção dos fluxos. |
| `npm run check:html` | Passou | Templates e páginas estavam sincronizados na execução. |
| `npm run check:css` | Passou | Imports resolvidos em ordem de cascata. |
| `npm run test:smoke` | Passou: 156 módulos | Imports não iniciaram rede, áudio, timers ou listeners de página. |
| Vitest completo, com relatório JSON | **900 aprovados / 42 falhas**, 93 arquivos; um arquivo falhou na coleta | O pipeline `verify` não passou. |
| `npm run build:dist`, separado | Passou | Produz assets; não transforma testes falhando em validação bem-sucedida. |
| `npm run test:e2e:sessions` | Streamer/Viewer com PIN e chat passou; Room com terceiro participante falhou | Confirma A02 num navegador real com WebRTC/DataChannel. |
| `npm run test:e2e:whiteboard` | Passou nos cenários executados | Confirma ações de UI cobertas; não exercita payload malformado nem imagem grande no late join. |
| `npm run native:smoke` | Passou | Compilação do caminho de comandos Rust/Tauri. |
| `cargo test --locked --offline --lib` | **39 aprovados, 0 falhas, 2 ignorados** | Os dois ignorados são benchmarks de captura/cadência com requisitos físicos. |
| `cargo fmt -- --check` | Não passou: diferenças de formatação | Não é erro de execução; deve entrar no gate de manutenção. |
| Python Companion | **5 aprovados** | Regressões existentes de autenticação/cleanup/failsafe. |
| Sondas de comportamento | **12 cenários confirmados**, cobrindo A01–A13; A03/A04 compartilham uma sonda | Assertions demonstram o comportamento defeituoso atual, não que tenha sido corrigido. |
| Sonda do servidor | **2 cenários confirmados** | A14 e A15, exclusivamente no processo iniciado pela sonda. |
| Rechecagem de SSH após edição concorrente | **4 aprovados** | A falha de coleta inicial desse arquivo deixou de reproduzir após a correção externa do mock. |

### Classificação das falhas de teste

- **34 falhas de `whiteboard.test.js`:** o canvas falso não implementa `addEventListener`, agora usado pelo engine. Falham no setup; não representam 34 bugs independentes de produção.
- **5 falhas de `whiteboard-streaming.test.js`:** o contexto falso não implementa `translate`. O E2E de UI passou; é necessário atualizar esses doubles e então verificar as assertions que hoje não executam.
- **2 falhas de `pending-replay.test.js`:** FFmpeg devolveu `3221225785` também ao decodificar a fixture de controle. Essa execução não permite concluir que o remux do replay está errado; primeiro é necessário um binário funcional e depois repetir a validação de frames.
- **1 timeout no teste de 10 mil atualizações do gamepad 3D:** excedeu 5 segundos nas execuções completas. Falta distinguir limitação do runner de regressão de performance medindo isoladamente sob condições controladas.
- **Falha de coleta de `e2e-ssh-reverse.test.js`:** o mock original omitia `default` do módulo Node. O arquivo foi alterado por outra atividade durante a revisão; a rechecagem posterior dos quatro testes passou. O relatório completo anterior permanece preservado como registro histórico.

## Avaliação da arquitetura, desempenho e manutenção

### Pontos que funcionam na base atual

- `SessionContext` oferece descarte idempotente, cancelamento e acompanhamento de liberações assíncronas. Sessões possuem dispatcher, event bus e serviços próprios.
- Parsing, templates, CSS e import smoke têm verificações específicas, evitando que a suíte funcional seja o único gate.
- O dispatcher valida envelope/tamanho e isola exceções síncronas e assíncronas. Isso é útil, desde que os handlers não persistam objetos inválidos antes da exceção.
- Rust valida IDs opacos de fontes e sessões, usa RTP em loopback e tem encerramento via `Drop` em diversos componentes. Os testes incluem negociação e pipelines reais de mídia sintética.
- Métricas separam coleta, apresentação e diagnóstico; possuem guards de reset de contadores e evitam polls assíncronos sobrepostos.
- Há separação de fonte e backend de replay, limites de histórico de chat e proteção por slot nos inputs Co-op.

### Principais fragilidades de manutenção

O runtime antigo em `js/app/` e as factories em `js/session/` mantêm caminhos paralelos para funcionalidades equivalentes. Os achados de `ended`, voz e callbacks mostram comportamento presente em um caminho e ausente em outro. A solução deve priorizar serviços comuns com contratos verificáveis; apenas dividir arquivos por tamanho não elimina essa divergência.

A autorização está melhor centralizada para dados do que para chamadas de mídia. O boundary de admissão deve abranger DataConnection, MediaConnection, transporte nativo e recursos Co-op com os mesmos critérios de identidade e geração.

Eventos síncronos de membership executam trabalho de rede que altera membership novamente. Esse acoplamento explica A02. Atualização de estado e efeitos de conexão precisam ter transições claras, com reservas e tratamento de reentrada.

Coleções de chamadas e transferências devem registrar aquisição, substituição e liberação no mesmo proprietário. Um mapa limitar referências não limita recursos se a referência for sobrescrita ou apagada antes de fechar a conexão.

A criação de `RelayManager` na Room não está acompanhada de uso na distribuição principal: `sendRoomStream` envia diretamente aos membros da malha. O estado `isTreeRelayEnabled` não implementa por si só uma topologia de relay. Para o browser, múltiplos espectadores continuam criando caminhos de envio por peer; no transporte nativo, fanout compartilha RTP codificado, mas o tráfego de saída continua crescendo com o número de receptores. As otimizações de bitrate não substituem limites de admissão/topologia.

O README precisa acompanhar capacidades efetivas: afirma indisponibilidade de gamepad virtual, enquanto o Rust registra comandos ViGEm e o controller negocia gamepad; o fallback TURN também diverge do comportamento descrito. O guia de arquitetura ainda informa uma branch `dev`, enquanto este checkout está em `main`.

### Cobertura que falta demonstrar

Priorizar testes de handshake e ciclo de vida: sala aberta com um único viewer; três membros e late join; fechamentos antigos após substituição; peer estranho chamando voz; negação de microfone após seleção de tela; stop sharing pelo navegador; ID customizado ocupado; imagem grande sincronizada; quota/TTL de chunks; falha no segundo recurso de fanout.

Há testes que verificam valores produzidos pelo próprio teste, em vez de chamar a lógica da aplicação. Por exemplo, o caso de HUD em `session-flow-regression.test.js` calcula `5.0%`, escreve esse valor no DOM e compara o mesmo valor. Esse tipo de assertion não protege uma regressão na função real de apresentação.

O workflow atual executa o frontend no Ubuntu e E2E browser, mas não contém o gate de compilação/testes Windows/GStreamer observado localmente. Um build nativo distribuível precisa de validação própria em ambiente compatível.

## Ordem recomendada de correção

1. Fechar o boundary de admissão de voz/mídia (A01/A04) e interromper a reentrada da malha (A02).
2. Tornar chamadas idempotentes e rastreáveis até o fechamento (A03), inclusive quando uma conexão antiga fecha depois da nova.
3. Implementar rollback de captura e encerramento por `ended` (A06/A07), recuperar ID ocupado (A08) e ligar as ações Co-op da sessão (A09).
4. Validar atualizações e transferências da lousa, fragmentar sincronização por bytes e limitar memória (A05/A11 e achados estáticos).
5. Fixar autoria de chat e identidade de reconexão, alinhar TURN e restringir o servidor local (A10/A12–A15).
6. Recuperar o gate de testes: atualizar mocks sem mascarar asserts, resolver o FFmpeg, medir o estresse isolado e incluir checks nativos/format no fluxo apropriado.

## Evidências e limites

- [Sondas de comportamento](C:/Users/Diogo/SeeMyGame/docs/audit-2026-10-02-reproductions.mjs): executar `node docs/audit-2026-10-02-reproductions.mjs`.
- [Sonda do servidor](C:/Users/Diogo/SeeMyGame/docs/audit-2026-10-02-server-probe.mjs): executar `node docs/audit-2026-10-02-server-probe.mjs`.
- [Resultado Vitest completo](C:/Users/Diogo/SeeMyGame/docs/audit-2026-10-02-vitest.json).
- [Rechecagem SSH](C:/Users/Diogo/SeeMyGame/docs/audit-2026-10-02-ssh-recheck.json).
- Logs locais em `docs/audit-2026-10-02-*.log` para Vitest, E2E sessões/lousa, native check/test, format, Companion e sondas. Esses arquivos estão cobertos pelo ignore de `*.log`, mas permanecem disponíveis neste workspace.

Não foram executados ensaios físicos completos de WGC/WASAPI em jogo, múltiplas máquinas, TURN entre redes independentes, reconexões prolongadas, exportação browser validada por FFmpeg funcional ou instalação limpa de drivers. Também não foi realizada consulta atualizada a um banco de vulnerabilidades de dependências. Os testes aprovados aqui não comprovam esses resultados.

As sondas documentam defeitos existentes e usam assertions invertidas em relação ao comportamento desejado. Após uma correção, elas devem ser convertidas em testes de regressão que exijam o comportamento seguro/correto; não devem virar um gate que preserve os defeitos.

