# Revalidação e plano consolidado de correções e testes

Data: 16/09/2026. Base: arquivos atuais de `G:\SeeMyGame`, confrontados com `revisao-projeto-2026-09-16.md` e `analise-latencia-captura-nativa-2026-09-16.md`. Este documento atualiza o diagnóstico anterior; não aplica correções de produção.

## Situação dos dez apontamentos da revisão

“Atendido no código” significa que o defeito específico foi corrigido na implementação lida. Não equivale a aprovação da suíte JavaScript ou do executável instalado. Questões residuais e novos riscos ficam explícitos abaixo.

| ID | Estado | Evidência atual e pendência |
| --- | --- | --- |
| R01 — autorização de voz | Atendido no código | `app.js:1393,1518` consulta autorização; mensagens com `peerId` diferente do remetente são rejeitadas em 1538–1539. Canais de entrada têm guardas antes do dispatch. Preservar testes de PIN e autenticação de membros. |
| R02 — sync rejeitado com efeitos | Parcial | O remetente agora precisa ser autorizado e ser o master (`app.js:1953`). Mas a aplicação ainda percorre `data.members` original. Uma mensagem do master autenticado com `roomId` errado pode ser rejeitada por RoomManager e continuar produzindo conexões na integração. Usar resultado de aceitação explícito ou estado aceito, não apenas identidade do master. |
| R03 — fechamento da captura | Parcial | `lib.rs:57,64` chama stop e removeu `process::exit`. Falta garantir encerramento do filho quando o pai termina abruptamente; não há Job Object com kill-on-close no código examinado. Falta teste real do ciclo de vida com filho sintético. |
| R04 — UDP e reserva de portas | Parcial | `webrtc_bridge.rs:398` agora usa `127.0.0.1`. Worker mantém leases, mas `capture.rs:502` os libera antes de construir/bindar a ponte. A janela de corrida diminuiu, não desapareceu. Transferir o socket reservado ao receptor ou outra estratégia sem intervalo de liberação. |
| R05 — propriedade inválida AV1 | Atendido no código | `config-interval` foi condicionado a H.264/H.265 e removido do worker AV1. Há teste novo da ponte AV1. Isso não valida o caminho inteiro: ainda há NV12 antes do download e I420 depois, sem conversor explícito. |
| R06 — acesso Tauri/gamepad | Atendido no código | Co-op usa o adaptador desktop e só anuncia aprovação após `plugVirtualGamepad` resolver. Falta testar falha, revoke/disconnect durante plug pendente e global real `__TAURI_INTERNALS__`. A nova operação assíncrona precisa invalidar aprovações obsoletas. |
| R07 — broadcast/deduplicação | Atendido no código | Filtro de autorização, `excludePeerId`, IDs e exports de deduplicação restaurados. No modo sala usa somente RoomManager para broadcast. Validar malha de três participantes e mensagens retransmitidas para evitar duplicação, descarte indevido ou atribuição ao relay. |
| R08 — TURN antes do PeerJS | Parcial | Bootstrap espera `iceReady`; origem Tauri usa endpoint público (`config.js:94`). Mas `initPeer` continua síncrona e acessível por outros caminhos; `watchFriend` pode chamá-la diretamente antes de ICE concluir. Token compartilhado e provisão de credenciais continuam exigindo validação. |
| R09 — primeiro frame/saúde | Parcial | Adicionado vídeo de confirmação, monitor do worker a cada 750 ms, captura de stderr e timeout de promise de cinco segundos. Falha/close da ponte JS ainda chama só `close_native_capture_peer`, que remove a ponte e mantém o worker. Falta transição única que pare toda a sessão. |
| R10 — flush do replay | Parcial | Evento corrigido para `dataavailable` e requestData redundante removido de exportClip. O timeout de 120 ms ainda resolve como sucesso sem garantir o último bloco; listener não é removido no timeout. Exportações lentas/simultâneas precisam de contrato explícito. |

São quatro defeitos específicos atendidos no código e seis apontamentos parcialmente atendidos. Nenhum dos quatro deve ser reimplementado do zero; os testes devem proteger as correções existentes.

## Outros itens da revisão original

- Instalador ViGEm agora valida Authenticode e o signatário Nefarius antes de executar. Pendem testes com assinatura inválida e signatário inesperado, usando mocks, sem instalar driver.
- Hooks `beforeDevCommand`/`beforeBuildCommand` deixaram de instalar GStreamer. O comando `npm run desktop` ainda chama `native:prepare`; provisionamento precisa permanecer documentado como etapa explícita.
- A formatação Rust passou nesta revalidação.
- Compatibilidade com Vanguard, pacote limpo sem SDK e seleção mínima de plugins continuam sem validação de aceitação. Não interpretar ausência de falha em testes unitários como garantia de compatibilidade.
- CSP com permissões amplas e dependência opcional do ViGEm continuam assuntos de manutenção. Não misturar instalação de driver de controle com captura/transmissão.

## O que permanece da análise de transmissão

| Achado da análise | Estado atual | Trabalho associado |
| --- | --- | --- |
| Dupla codificação e decoder intermediário | Permanece: worker → WebView → PeerJS | Fases 2 e 5 |
| Perfil não chega ao worker | Permanece: FPS/bitrate por ambiente, sem tamanho solicitado | Fase 3 |
| Replay automático com preferência VP9 | Permanece no host e receptor | Fases 2 e 3 |
| Receptor WebRTC local sem ajustes de latência | Permanece | Fase 3 |
| Feedback de keyframe interrompido no UDP | Permanece | Fases 1 e 4 |
| Startup antes do transporte pronto | Permanece; confirmação de frame melhorou | Fases 1 e 4 |
| Buffer UDP e timestamps A/V pouco observáveis | Permanece; bind agora é loopback | Fases 2 e 4 |
| ABR global apesar de módulo por peer | Permanece em app.js | Fase 3 |
| Codec externo pode diferir da escolha nativa | Permanece | Fases 3 e 4 |
| AV1/software e conversão NV12/I420 | Propriedade inválida corrigida; restante pendente | Fase 4 |
| GPU/adaptadores não correlacionados | Permanece | Fase 2 |
| Telemetria não mede atraso visual | Permanece | Fases 2 e 5 |

Resultados anteriores úteis como referência, não como nova medição: teste sintético H.264 1080p60 com mediana 3,85 ms/p95 4,60 ms até RTP; log anterior com aproximadamente 59,17 FPS na ponte. Não incluem latência até o espectador e não demonstram desempenho desta revisão dos arquivos.

## Planejamento de execução

### Fase 0 — estabelecer uma base verificável

1. Registrar hash dos fontes relevantes, versão do WebView2, Windows, GPU/driver, runtime GStreamer e hash do executável. Relatórios de desempenho devem apontar para o build medido.
2. Executar testes JS em ambiente Windows que permita os subprocessos do Vite. Não mudar testes para contornar resultados ou considerar erro de infraestrutura como falha funcional.
3. Executar Rust completo, fmt e Clippy, além dos quatro testes Python com entrada simulada.
4. Separar testes unitários, integração Tauri e aceitação com hardware. Extrair lógica de sessão testável onde hoje `cfg(not(test))` exclui comandos/runtime.

**Saída exigida:** resultados ligados ao snapshot; nenhum resultado antigo reutilizado como aprovação atual. Só repetir testes de áreas alteradas e o conjunto de aceitação ao fechar cada fase.

### Fase 1 — completar segurança e ciclo de vida (prioridade alta)

| Correção | Testes obrigatórios | Critério de aceite |
| --- | --- | --- |
| R02: ação somente após sync aceito | Master autorizado com roomId errado; não-master; conexão substituída; payload válido | Rejeitados não alteram membros, não conectam peers e não chamam microfone; válido continua funcionando |
| R01/R07: proteger comportamento corrigido | PIN ausente/errado/correto; voz com destino forjado; terceiro participante retransmitindo; repetição de msgId | Zero entrega de mídia/chat privado a não autorizados; mensagem válida entregue uma vez aos destinos esperados |
| R03/R09: parada unificada | Fechar janela durante start; falha ICE após primeiro frame; EOF do worker; stop repetido; restart imediato; término abrupto do pai sintético | Nenhum worker, socket, bridge, timer ou callback antigo sobrevivente; estado de erro chega à UI |
| R04: socket sem corrida de propriedade | Reservar portas de áudio/vídeo; processo concorrente tenta bindar durante transferência; falha na construção da ponte | Porta não pode ser tomada durante a transferência; bind só em loopback; cleanup libera tudo |
| R06: invalidação de plug pendente | Aprovar, desconectar/revogar antes da promise; falha tardia; outra pessoa ocupa o slot | Nenhuma aprovação tardia, nenhum unplug/delete do slot de outra geração e nenhum controle órfão |

Projetar ID de geração por sessão/slot para callbacks assíncronos. Em Windows, avaliar Job Object kill-on-close com criação/associação sem janela de processo órfão. Não testar encerramento abrupto matando o aplicativo do usuário: criar harness isolado com filho sintético.

Novo detalhe de R09: o timeout de fallback de áudio chama `confirmFrame`, mas essa função ainda exige áudio quando `expectAudio=true`. Definir política de produto: erro explícito por ausência de áudio ou continuar só vídeo. Testar ambos os contratos; o timer atual não implementa um fallback efetivo.

### Fase 2 — medir antes de otimizar

Implementar coleta a cada segundo, por sessão e peer, sem exportar SDP/segredos. Guardar perfil solicitado e efetivo, codec negociado e flags de replay/áudio.

- Worker: timestamps e latência WGC→conversão→encoder→RTP, filas/descartes e saúde.
- Ponte recebida no WebView: deltas de `jitterBufferDelay`, `jitterBufferEmittedCount`, `totalDecodeTime`, `framesDecoded`, freezes e drops.
- Saída: deltas de `totalEncodeTime`, `framesEncoded`, `totalPacketSendDelay`, `packetsSent`, PLI/NACK e qualityLimitationReason/durations.
- Espectador: buffer, decode, freezes e apresentação. Identificar o candidate pair realmente selecionado e se usa relay.
- Host: GPU e adaptador/LUID, motores Encode/Decode/Copy/3D; não assumir aceleração apenas porque o codec está disponível.

**Testes:** contador reiniciado, campo ausente, denominador zero, múltiplos SSRCs e peers, timer atrasado e sessão encerrada. Métrica indisponível deve ser “indisponível”, nunca zero de sucesso.

**Saída exigida:** distinguir custo do worker, ponte, saída e receptor; FPS ou RTT não são substitutos de latência visual. Não somar tempos sobrepostos sem explicar a interpretação.

### Fase 3 — reduzir trabalho desnecessário e corrigir controle de qualidade

1. Passar resolução/FPS/bitrate validados ao worker; escala na GPU antes da primeira codificação. Preservar proporção e dimensões pares. Manter perfil do worker separado do orçamento por espectador.
2. Tornar replay opcional, com orçamento próprio. A/B com replay desligado em ambos, ligado só no host e ligado só no receptor. Considerar armazenamento do fluxo já codificado no backend.
3. Ajustar receiver da ponte quando o WebView suportar os parâmetros de latência; medir buffer efetivo antes/depois. Não atribuir automaticamente 200 ms à propriedade de recepção do webrtcbin usado como sender.
4. Integrar ABR por peer, preservar valores ausentes e limitar upload agregado. Separar restrição de rede de gargalo de CPU/GPU. Validar resolução/codec reais depois do primeiro frame.
5. R08: centralizar inicialização em uma promise compartilhada que espere ICE em todos os caminhos, inclusive clique antecipado em conectar; endpoint desktop público já corrigido deve ser preservado.
6. R10: flush aguardável com timeout explícito e remoção de listeners, serializando exportações. Nunca reportar um flush incompleto como se o último bloco estivesse presente.

**Testes de regressão:** perfil UI chega a Rust; fonte 4K com saída 720p não é codificada em 4K; rejeição de dimensões inválidas; um peer ruim não reduz os demais; recuperação não acelera com quantidade de peers; desligar replay não para trilha compartilhada; TURN atrasado não cria Peer prematuro; clipe contém o último frame mesmo com dataavailable após 120 ms; keyframes espaçados e duas fontes independentes.

### Fase 4 — mídia, negociação e recuperação

- Validar pipelines completos sintéticos H.264, HEVC e AV1, chegando a frames decodificados; string de argumentos ou SDP com m=video não basta. Teste AV1 atual retorna cedo se capabilities não existem: não usar esse sucesso como prova de cobertura nesse ambiente.
- Corrigir/validar conversão AV1 NV12→I420; negociar perfil/nível/packetization-mode compatíveis com a oferta. Codec ausente deve produzir erro controlado/fallback negociado, não payload arbitrário.
- Criar retorno de PLI/force-key-unit ao encoder; solicitar keyframe quando o receptor estiver pronto. Determinar GOP em tempo e verificar 10/30/60 FPS.
- Testar perda isolada, rajada, atraso e reconexão usando RTP sintético. Medir recuperação e garantir que filas não cresçam sem limite. Não descartar aleatoriamente pacotes de frames de referência como “otimização”.
- Verificar sincronismo com flash e pulso sonoro conhecidos, áudio ausente e mudança de modo. Comparar drift no início e após 30 minutos.

**Saída exigida:** nenhum codec anunciado sem teste de entrega real; perdas recuperadas sem restart manual; todos os erros limpam a sessão. Estabelecer prazos de recuperação medidos, sem confundir GOP com atraso permanente.

### Fase 5 — comparar com web e decidir envio nativo direto

Executar três repetições por cenário principal, cinco minutos após aquecimento, sem alteração de cena/configuração entre A/B:

| Eixo | Cenários |
| --- | --- |
| Provedor | Web; nativo atual corrigido; protótipo de envio nativo direto |
| Fonte | Mesma janela e mesmo monitor; origem 1080p e origem maior com alvo 720p |
| Carga | Cena sintética; jogo com GPU sem saturação; jogo com GPU saturada |
| Reprodução/gravação | Replay off/off; host on; espectador on; prévia visível/oculta |
| Mídia | H.264 como referência; áudio off/on; demais codecs após fase 4 |
| Rede/peers | LAN; duas redes com relay forçado; 1/2/4 espectadores |

Começar com matriz reduzida (H.264, um espectador, mesma rota, sem replay), depois expandir só os eixos necessários para isolar o gargalo. Medir mediana/p95/p99 de atraso visual, freezes, FPS, bitrate, CPU/GPU e drift A/V. Relógios de máquinas distintas não podem ser subtraídos sem sincronização; preferir câmera externa mostrando origem/destino ou mecanismo de calibração documentado.

**Critérios propostos para o comparativo:** nenhuma piora de p95 de atraso visual frente ao web além da incerteza da medição, sem aumento relevante de freezes ou perda de qualidade. O orçamento absoluto deve ser definido após a baseline; não há número medido que justifique prometer “menos de X ms” agora.

Se a ponte/recodificação dominar o atraso, implementar transporte nativo direto ao espectador. Reutilizar a política de autorização, ICE/TURN, controle de congestionamento, RTCP e teardown das fases anteriores. A prévia local passa a ser consumidora opcional; não deve ser requisito para transmitir.

### Fase 6 — pacote e aceitação final

Build/instalação em Windows limpo sem SDK; inventário mínimo de DLLs/plugins; assinatura do driver testada por mocks; captura independente de ViGEm. Testar janela, monitor, cancelar, fonte fechada, mudança de resolução/DPI e sessão longa. Validar compatibilidade com jogos/anticheats como aceitação específica, sem declarar garantia geral.

## Evidências desta revalidação

- `cargo fmt --manifest-path src-tauri/Cargo.toml --check`: passou.
- Suíte JavaScript: tentativa atual falhou antes da coleta por `spawn EPERM` no carregamento do Vite. Nenhum total JS aprovado é atribuído a este snapshot.
- `cargo test --manifest-path src-tauri/Cargo.toml --locked --offline --lib`: 14 passaram, zero falhas. Inclui o novo caso de construção/negociação da ponte AV1; não testa entrega de frames AV1 nem comandos/runtime excluídos por `cfg(not(test))`.
- Não foram repetidos os benchmarks de transmissão, nem os testes Python/Clippy nesta etapa de planejamento. Os resultados anteriores continuam históricos.
- Hashes dos 15 arquivos centrais reavaliados foram registrados em `docs/snapshot-planejamento-2026-09-16.json` para identificar esta base.

## Entregas e dependências

Entregar correções em lotes verificáveis: (1) segurança/ciclo de vida, (2) telemetria, (3) perfil/replay/ABR/TURN, (4) codecs/feedback/A-V, (5) comparação e arquitetura, (6) pacote. Fase 0 precede a aprovação de qualquer lote; telemetria precede conclusões de desempenho; envio direto só é avaliado com a mesma baseline e sem reabrir falhas de autorização.
