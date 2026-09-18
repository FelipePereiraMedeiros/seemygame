# Testes da revisão e fluxo E2E — 17/09/2026

## Como executar

```powershell
npm run test:review
cargo test --manifest-path src-tauri/Cargo.toml --locked --offline --lib review_
python -B -m unittest discover -s tests -p test_pending_companion.py -v

# Preparar executável atual, sem encerrar aplicativos por nome nem instalar drivers.
node tools/build-dist.js
cargo build --manifest-path src-tauri/Cargo.toml --locked --offline
npm run test:e2e:check
npm run test:e2e -- --seconds 30
# Meta explícita de desempenho, dependente do perfil e da máquina:
npm run test:e2e -- --seconds 60 --min-fps 30
```

Requer Windows, runtime nativo preparado, WebView2 e Edge instalado. A sinalização PeerJS depende da rede. `--check` verifica arquivos/plataforma; não comprova que navegador, mídia ou sinalização funcionam. O padrão usa o executável debug; `--exe caminho` permite testar outro build. Comparações de desempenho devem usar builds equivalentes, preferencialmente release.

## Fluxo revisado

Foi corrigido um falso positivo de sincronização: no Playwright 1.63.0 instalado, `waitForFunction(async () => ...)` considera a Promise verdadeira antes de inspecionar o booleano resolvido. Isso permitia avançar enquanto `roomManager` ainda era `null`. O helper `waitForAsync`, usado com `page.evaluate`, aguarda cada observação; três testes em `e2e-wait.test.js` cobrem espera, timeout e propagação de erros.

1. Cria perfis descartáveis e servidor HTTP limitado aos arquivos do frontend e à fonte sintética; abre uma instância própria do desktop e conecta ao WebView2 por CDP em loopback.
2. Confere hashes de todos os módulos JS embarcados contra o checkout. O HTML sofre transformações do Tauri e não é comparado byte a byte. Os hashes Rust e do executável são registrados, mas não provam sozinhos qual fonte Rust gerou o binário.
3. Abre uma janela animada separada e um espectador Edge. Desktop e espectador entram pela interface na mesma sala aleatória, com a mesma chave. Verifica autorização mútua dos IDs exatos dos dois participantes.
4. Seleciona somente a janela sintética no seletor nativo; áudio da captura fica desativado. Dispositivos de microfone são sintéticos nos dois clientes. Captura de vídeo nativa e transporte WebRTC são reais.
5. Coleta estatísticas desde a espera pelo primeiro frame; exige vídeo reproduzindo no card do host e sessão nativa existente. Durante a medição, exige avanço de `currentTime` em pelo menos 80% dos intervalos e frames decodificados crescentes. `--min-fps` exige uma meta para o percentil 10 dos intervalos medidos.
6. Interrompe pela interface e verifica estado nativo `idle`. Faz limpeza também na falha, com prazos por operação; problemas de limpeza tornam o resultado uma falha.

Relatórios ficam em `output/playwright/<execução>/`, ignorado pelo Git. Incluem etapas, hashes, estatísticas por conexão, desempenho, erros JavaScript e screenshots. Na falha, o JSON parcial já existe antes da limpeza. O trecho de `native_debug.log` é coletado por posição inicial no arquivo: pode incluir mensagens de outra instância que compartilhe o mesmo diretório. Esse log pode conter endereços de rede; não publicar perfis/logs indiscriminadamente.

## Cobertura dos apontamentos

| Apontamento | Evidência automatizada | Limite / teste adicional necessário |
|---|---|---|
| R01 autorização de voz | `review-app-integration.test.js`: PIN e destino forjado | Transporte e microfone simulados |
| R02 sync rejeitado | Mesmo arquivo: payload de outra sala não conecta peer | Acrescentar ataque entre processos para aceitação de segurança |
| R03 vida do worker | E2E: parar pela UI e estado idle | Ainda falta verificar PID do worker após fechamento abrupto/crash do pai |
| R04 RTP loopback e reserva | Rust `review_r04_*`: endereço real, exclusão do socket e handoff | A reserva deve sobreviver até a transferência para o receptor |
| R05 AV1 | Rust `review_av1_actual_conversion_pipeline_negotiates`: pipeline com fonte sintética e EOS | Não comprova captura real AV1 em todos os adaptadores |
| R06 gamepad | `review-replay-gamepad.test.js`: backend e revogação durante plug | Driver real não é instalado/exercitado |
| R07 broadcast | `review-app-integration.test.js`: PIN e deduplicação | Complementa `audit-remediation.test.js` |
| R08 TURN | Teste de inicialização pendente + `pending-turn.test.js` | E2E atual não força relay nem usa duas redes |
| R09 mídia pronta/cleanup | `review-native-bridge.test.js`, promise Rust e E2E | Injetar morte do worker e perda de conexão em E2E ainda pendente |
| R10 replay | `review-replay-gamepad.test.js` e `pending-replay*.test.js` | Testar replay real em sessão longa e sob carga |
| Transmissão §1 recodificação | E2E registra codec, implementação e tempos de encode/decode | Não implementa envio direto nativo; requer comparação arquitetural |
| §2 perfil nativo | `review-native-bridge.test.js` + `review-desktop-contract.test.js` | Complementar com matriz real de resolução/FPS/bitrate |
| §3 replay | Teste de opção desligada na integração | Benchmark A/B ligado/desligado ainda necessário |
| §4 jitter da ponte | Teste de configuração dos receivers + métricas E2E | Jitter observado depende da carga real |
| §5 feedback/keyframes | E2E registra NACK/PLI | Falta injeção controlada de perdas e tempo de recuperação |
| §6 startup | Testes de primeiro frame/timeout; métricas E2E durante startup | Medir distribuição em várias partidas, não só uma execução |
| §7 UDP | Testes R04; dados por conexão | Não mede ocupação das filas UDP |
| §8 sincronismo A/V | Não coberto pela E2E sem áudio | Fonte com flash+beep e medição de drift em sessão longa |
| §9 ABR/CPU | Integração do peer no ABR e `review-telemetry.test.js` | Dois espectadores com redes diferentes e saturação controlada |
| §10 codec/resolução | Stats de codec/resolução reais + negociação Rust existente | Matriz de codecs e fallback, qualidade visual e aspect ratio |
| §11 AV1 | Pipeline real sintético Rust | GPU/driver/codec precisam de matriz de hardware |
| §12 GPU/concorrência | E2E registra implementação/power efficiency quando disponível | Falta LUID de adaptador, carga GPU e benchmark com jogo |

As numerações §1–§12 referem-se à análise de latência de 16/09, e não aos identificadores abreviados internos de alguns testes. Uma linha parcialmente coberta não deve ser marcada como problema completamente resolvido.

## Como interpretar desempenho

### Validação desta execução

- Suíte JavaScript completa: 421/421 passaram antes da inclusão dos três testes do helper de espera. Suíte focada final: 24/24 passaram, incluindo esses três novos testes.
- Rust `review_`: 5/5 passaram, incluindo negociação AV1 real com fonte sintética, socket loopback e timeout da promise. Foi necessário condicionar o novo logger do worker, pois `system` não é compilado em `cfg(test)`.
- Companion Python: 4/4 passaram, com entrada simulada.
- E2E revisada: `2026-09-17T05-29-43-714Z-5b1816` passou, com 34 amostras dos dois lados, H.264 1920×1080, sessão nativa `live` e parada confirmada em `idle`. Não houve erro de página ou limpeza registrado.
- Medição de dez segundos: FPS decodificado mediano **57,17**, percentil 10 **0,94**. O vídeo avançou, mas houve queda transitória relevante; o teste funcional sem `--min-fps` não é aprovação de estabilidade de desempenho. Startup e aquecimento influenciam uma janela tão curta. Uma meta de 30 FPS no p10 reprovaria esses dados.
- Uma tentativa anterior ficou em descoberta de janelas por mais de 15 segundos. O timeout do seletor foi ampliado para 45 segundos com registro da duração; isso não corrige nem explica a demora nativa. Na execução aprovada, o seletor levou 83 ms.

Prioridades seguintes: repetição em release por 60 segundos com meta explícita; investigação das quedas de frames com as amostras da ponte/outbound/receiver; cenário de fechamento abrupto com inspeção do PID do worker; cenário TURN forçado, perdas/keyframes e sincronismo A/V. O último `git diff --check` também encontrou espaços em branco em alterações preexistentes de CSS, HTML, `app.js` e testes de clipping; não foram alteradas como parte desta revisão.

`totalEncodeTime`, `totalDecodeTime` e `jitterBufferDelay` são acumuladores. O coletor calcula deltas entre amostras da mesma conexão e relatório; valores ausentes ou resetados não viram zero. `e2e-telemetry.test.js` cobre esses contratos.

FPS positivo comprova atividade, não baixa latência. A E2E não mede tempo entre a imagem original e sua apresentação ao espectador, não compara automaticamente transmissão web versus nativa e não valida áudio. A janela sintética pode sofrer throttling ou oclusão; compare com a fonte visível e registre condições da máquina. Um benchmark válido exige fonte equivalente, mesmo codec/perfil, replay configurado igualmente, aquecimento e várias repetições.

Na execução anterior `2026-09-17T01-14-32-320Z-1092f3`, havia recepção real em torno de 20 FPS; a execução `2026-09-17T01-48-49-068Z-deb7a5` falhou após ICE conectado e recebeu timeout da ponte. Isso demonstra funcionamento possível e uma falha intermitente, sem estabelecer sua causa. O coletor revisado preserva amostras desse período para a próxima investigação.
