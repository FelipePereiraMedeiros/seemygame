# Captura por etapas e preparação do E2E em duas máquinas

Data: 02/10/2026. Continuação de `medicao-recursos-e-isolamento-cadencia-2026-10-02.md`.

## O que já foi isolado

Foi criado um teste Rust ignorado por padrão, `benchmark_native_capture_stages`, e o wrapper `tools/e2e/native-capture-stages.mjs`. O teste captura exclusivamente uma janela Chrome sintética com título único da execução. Usa o pipeline de vídeo da aplicação até o empacotador RTP, terminando em `fakesink`, sem WebRTC, receptor, áudio ou replay. Conta buffers na saída da captura, videorate, conversão, entrada e saída do encoder; registra intervalos entre buffers, caps negociados e filas amostradas a 5 Hz. A compilação acontece antes de abrir a fonte e iniciar a medição.

O tempo de entrada → saída do encoder agora usa running-time normalizado pelo segmento de cada pad. Comparar PTS bruto falhava quando o encoder deslocava a origem dos timestamps. A medida inclui agendamento/espera interna; não representa somente execução GPU.

| Experimento isolado | FPS capturados e codificados | Encode observado p95 | Evidência |
| --- | --- | --- | --- |
| D3D11 WGC, meta 60, 3×12 s | 59,71–59,82 | 0,925–0,941 ms | `capture-stages-2026-10-02T13-08-41-605Z-dd9eea/report.json` |
| D3D11 WGC, meta 120, 2×12 s | 61,99–62,15 | 0,944–0,950 ms | `capture-stages-2026-10-02T13-14-19-750Z-c0c980/report.json` |
| D3D11 WGC, meta 120, 1×8 s, caps e rAF | 61,73 | registrado no JSON | `capture-stages-2026-10-02T13-24-10-018Z-ad4135/report.json` |

Todos os caminhos acima entregaram vídeo. Os casos 120 **não cumpriram a cadência solicitada**. As etapas acompanharam a mesma cadência, sem drops no videorate e sem ocupação nas amostras de fila. Filas medidas a 5 Hz podem ocultar picos curtos. O processo do probe usa prioridade normal e não é o worker `gst-launch` com prioridade da aplicação.

Na última rodada, os caps da captura declararam **120/1**. Portanto, a hipótese de simples falta de negociação upstream foi descartada neste caso. A fonte desenhou aproximadamente 121 FPS e seus callbacks rAF registraram aproximadamente 128 FPS no último intervalo, enquanto a captura entregou 62. Contadores de canvas/rAF não comprovam apresentação física de cada desenho.

O ambiente tem dois modos de display: primário 1920×1080 a 165 Hz e secundário a 100 Hz. O wrapper posiciona a janela em `30,30` por padrão. A janela real incluiu bordas/interface do Chrome: captura BGRA 1282×801, convertida para 1280×720, com pixel-aspect-ratio 641/712. Não chamar a entrada de 720p exatos nem comparar com captura sem bordas sem controlar essa diferença. O E2E agora registra modos dos monitores e aceita posições explícitas de fonte/receptor.

## Alternativa D3D12 em investigação

O runtime local é GStreamer **1.28.7**. Contém `d3d12screencapturesrc`, `d3d12convert`, `d3d12download` e `nvh264enc`. Não contém `nvd3d12h264enc`. Os caps locais de `d3d12download` incluem saída `D3D11Memory`; os de `nvh264enc` incluem entrada `D3D12Memory`.

O mantenedor Seungha Yang relatou que reescreveu a captura WGC no elemento D3D12 para tratar baixa cadência da implementação D3D11. Isso justifica testar a alternativa, mas o relato de 2024 não comprova que o mesmo defeito cause o resultado atual em 1.28.7. [Relato do mantenedor](https://discourse.gstreamer.org/t/d3d11screencapturesrc-vs-d3d12screencapturesrc/2080/2).

Experimento: WGC D3D12 → conversão D3D12 → interop negociado para D3D11 → **mesmo encoder NVENC D3D11**, preservando filas, bitrate, framerate e H.264. Os caps serão registrados para verificar a rota efetiva; negociação em memória GPU não prova ausência de qualquer cópia/sincronização interna. A alternativa permanece somente no teste; produção não foi migrada. [Captura D3D12](https://gstreamer.freedesktop.org/documentation/d3d12/d3d12screencapturesrc.html), [caps de interop](https://gstreamer.freedesktop.org/documentation/d3d12/d3d12download.html).

### Resultados do experimento

Em `capture-stages-2026-10-02T16-44-13-734Z-27bd83/report.json`, duas repetições D3D12 de 12 s entregaram **120,07 e 120,22 FPS**, com encoder p95 1,365/1,337 ms. Caps efetivos: captura `D3D12Memory`, entrada do encoder `D3D11Memory`, saída H.264 constrained-baseline 1280×720. Fonte aproximadamente 119–120 desenhos/s, rAF ~165 Hz. Videorate não descartou quadros. São buffers produzidos/codificados, não validação de 120 imagens únicas na tela do espectador.

A comparação com ordem alternada usa `--capture both`: mesma janela, ordem D3D11 → D3D12 → D3D12 → D3D11, em `capture-stages-2026-10-02T16-47-11-391Z-5ceec3/report.json`:

| Ordem | Captura | FPS codificados | Gap de saída p95 / máximo | CPU total p95 |
| --- | --- | ---: | --- | ---: |
| 1 | D3D11 | 54,94 | 19,7 / 26,3 ms | 77,9% |
| 2 | D3D12 | 119,00 | 11,0 / 92,8 ms | 100% |
| 3 | D3D12 | 109,08 | 20,8 / 348,6 ms | 100% |
| 4 | D3D11 | 51,37 | 35,3 / 146,6 ms | 100% |

Essa bateria coincidiu com um `rustc.exe` **externo ao runner** e posteriormente testes de navegador externos. Não foi uma saturação controlada. Na segunda metade, consultas do coletor chegaram a 0,7–1,0 s. A melhora de capacidade D3D12 se repetiu, mas a cauda e queda de cadência sob carga impedem afirmar estabilidade geral/ausência de stutters. O isolamento aponta uma rota melhor de captura/conversão; não identifica sozinho um defeito específico do plugin nem resolve sincronismo A/V ou filas de transporte.

Durante a saturação surgiu outra falha do instrumento: CPU por processo usava o timestamp do início do snapshot, embora os contadores fossem lidos depois da consulta PDH. Atrasos diferentes entre snapshots produziram somas externas >100%. O coletor foi corrigido para cronometrar cada leitura com relógio monotônico. Valores individuais/somas impossíveis passam a indisponíveis com aviso; coleta demorada também gera aviso. **Percentuais externos dessa bateria antiga não devem ser usados quantitativamente**. Os nomes dos processos/counters acumulados identificam a presença da carga, enquanto CPU total/contadores de vídeo permanecem evidências separadas. Os arquivos antigos e hashes foram preservados.

Comando reproduzível (pipeline diagnóstico, não E2E):

```powershell
node tools/e2e/native-capture-stages.mjs --capture both --backend nvenc --fps 120 --seconds 12 --repeat 2 --position "30,30"
```

### Comparação a 60 FPS depois da correção do coletor

`capture-stages-2026-10-02T16-51-36-294Z-147db0/report.json`, ordem alternada, 2×12 s por backend:

| Ordem | Captura | FPS codificados | Gap p95 / máximo | CPU total p95 |
| --- | --- | ---: | --- | ---: |
| 1 | D3D11 | 54,88 | 20,0 / 37,0 ms | 78,9% |
| 2 | D3D12 | 60,06 | 18,2 / 32,8 ms | 97,7% |
| 3 | D3D12 | 60,01 | 18,3 / 23,0 ms | 73,6% |
| 4 | D3D11 | 54,90 | 19,2 / 35,1 ms | 34,9% |

Nenhuma amostra teve CPU por processo inconsistente; consulta p95 9,3–29,7 ms. A vantagem reapareceu a 60 FPS. A D3D11 voltou a ~54,9 mesmo no trecho com CPU total mais baixa. Isso reforça a alternativa de captura/conversão, mas a carga externa não foi mantida constante. Ainda faltam repetições mais longas e fonte/jogo real antes de homologar estabilidade ou tornar D3D12 padrão.

O probe de encoder sintético também foi repetido com o cronômetro por segmento corrigido, em `native-cadence-2026-10-02T16-53-13-273Z/report.json`: seis casos NVENC/MF/CPU × 60/120 FPS. Ele continua medindo apenas capacidade sintética de encode, sem WGC ou receptor.

## Receptor remoto: primeira entrega e limites

`tools/e2e/viewer-agent.mjs` inicia no notebook um navegador com perfil isolado e coletor de CPU/GPU. Os endpoints de controle e Playwright escutam somente em loopback e usam caminhos temporários aleatórios. O navegador é controlado pelo transmissor através de duas portas encaminhadas por SSH. O helper expira em 30 minutos por padrão e pode ser encerrado com Ctrl+C.

O E2E nativo conecta esse navegador, entra na mesma sala e transmite diretamente pelo WebRTC nativo. Recursos e janelas de qualidade do receptor usam seu próprio relógio. Recursos do transmissor são registrados separadamente. URLs de controle/WS, que permitem controlar o navegador de teste, não são gravadas nos relatórios finais.

O teste local `tools/e2e/remote-viewer-smoke.mjs` passou, incluindo transmissão, recursos do receptor e encerramento do helper. Evidências: `remote-viewer-smoke-2026-10-02T13-16-33-660Z/report.json` e execução interna `2026-10-02T13-16-35-696Z-cf1e54/report.json`. Ele usa a mesma máquina e receptor headless: **valida o transporte do harness, não desempenho entre duas máquinas nem apresentação física**. A rodada de 15 s não homologa qualidade sustentada.

Revalidação após corrigir o coletor, registrar condições de apresentação e remover tokens dos erros exportados: `remote-viewer-smoke-2026-10-02T16-55-05-027Z/report.json`, execução interna `2026-10-02T16-55-08-090Z-50e546/report.json`. Passou com nove amostras steady de recursos do receptor; fonte explicitamente em `30,30`. CPU p95 do receptor/coletor no auto-teste ainda inclui concorrência da mesma máquina, portanto não é CPU isolada de um notebook. O helper foi encerrado pelo próprio teste sem erro de cleanup.

Limites deliberados:

- O receptor remoto funciona inicialmente na fase **nativa**. `--compare` remoto é rejeitado: a fase web antiga inverte papéis e tentaria capturar a fonte no notebook. É necessário adaptar um transmissor web local antes de oferecer A/B remoto equivalente.
- Latência óptica absoluta entre máquinas fica desativada até calibração dos relógios. FPS, pausas, decode, jitter buffer, RTT e recursos podem ser medidos separadamente sem essa subtração.
- Headless mede decode/rede/callbacks, não a tela física. Para avaliar apresentação, executar o helper no desktop interativo e desbloqueado do notebook; sessão de processo não certifica sozinha que a tela esteja ativa.
- A identificação de máquina usa hostname/plataforma/CPU; ajuda a detectar um auto-teste, mas não é uma prova criptográfica de dois computadores físicos.
- O encaminhamento Playwright de loopback serve assets e sinalização locais. **A mídia WebRTC precisa de sua própria rota ICE/LAN**; encaminhar TCP pelo SSH não encaminha automaticamente os pacotes de mídia. TURN/rede externa exige outro caso.

## Como executar quando o SSH estiver pronto

**Atualização posterior:** SSH e sincronização do projeto foram concluídos; os scripts do receptor estão disponíveis, o smoke do Chrome/coletor no notebook passou e a suíte remota final aprovou 942 testes. Detalhes e runtime Node usado na validação em [sincronizacao-notebook-2026-10-02.md](sincronizacao-notebook-2026-10-02.md). As observações de scripts ausentes abaixo registram o estado anterior à sincronização.

Na primeira verificação, o alias local `notebook` alcançou o SSH, mas retornou `Permission denied (publickey,password,keyboard-interactive)`.

**Reverificação após a configuração pelo usuário:** `ssh -o BatchMode=yes -o ConnectTimeout=5 -o StrictHostKeyChecking=yes notebook hostname` autenticou sem interação e retornou `Notebook-Diogo`. Notebook: Windows, 16 processadores lógicos, Node v24.14.0, Chrome 154.0.8037.58. O projeto existe em `C:\Users\Diogo\SeeMyGame`; Playwright 1.63.0 coincide com o transmissor. Porém `tools/e2e/viewer-agent.mjs` e `tools/e2e/harness/resource-counters.cs` ainda não estão no notebook; sincronizar os scripts/dependências do helper antes da execução. A sessão SSH é **0**, portanto iniciar por SSH em headless para decode/rede, ou iniciar o helper no desktop interativo para testar apresentação. Nenhuma chave, serviço, firewall ou arquivo remoto foi alterado nesta verificação. Ainda não houve medição real no notebook.

No notebook, usar a mesma versão major.minor do Playwright do projeto, Chrome instalado e dependências disponíveis. O helper não exige compilar Tauri no receptor. O Playwright exige versões major.minor compatíveis em `launchServer`/`connect`. [Documentação Playwright](https://playwright.dev/docs/api/class-browsertype).

Terminal no desktop aberto e desbloqueado do notebook, na pasta do projeto:

```powershell
node tools/e2e/viewer-agent.mjs --channel chrome
```

Para somente decode/rede via sessão não interativa:

```powershell
node tools/e2e/viewer-agent.mjs --channel chrome --headless
```

Guardar o `controlEndpoint` impresso, com seu token. No desktop transmissor, manter um terminal separado com o túnel (substituir o destino real):

```powershell
ssh -N -o ExitOnForwardFailure=yes -L 127.0.0.1:9333:127.0.0.1:9333 -L 127.0.0.1:9334:127.0.0.1:9334 usuario@IP_DO_NOTEBOOK
```

No desktop, pasta `G:\SeeMyGame`, substituir o token pelo endpoint recebido:

```powershell
node tools/e2e/run.mjs --exe src-tauri/target/release/seemygame.exe --channel chrome --preset ultra --codec h264 --seconds 70 --viewer-endpoint "http://127.0.0.1:9334/smg-viewer/TOKEN" --source-position "30,30"
```

Não usar `--allow-same-machine-remote` na medição real; essa exceção existe apenas para testar o harness. Não publicar as portas do helper em `0.0.0.0`. O teste fecha os contextos que criou; o helper permanece reutilizável até Ctrl+C/expiração. Nenhum serviço SSH/firewall foi alterado por este trabalho.

## Próximos experimentos discriminantes

1. Comparar D3D11/D3D12 sob a mesma fonte e posição, primeiro sem rede, em 60/120 FPS. Se houver ganho, validar captura com rede/receptor antes de migrar produção; conferir latência, geometria, HDR, cursor, reinício e fallback.
2. Duas máquinas com baseline sem jogo; depois mesma cena de jogo com FPS limitado/ilimitado, três repetições ≥60 s estáveis. Correlacionar quedas com CPU por núcleo, engines 3D/encode/decode/copy e filas por etapa.
3. Áudio × replay em matriz 2×2, sem misturar o custo da gravação com a captura pura; comparar p10/p50 FPS e p95/p99 dos intervalos, A/V e pausas.
4. Restrição de banda/perda/RTT e adaptação de bitrate; conferir codec solicitado/aplicado/recebido e testar falhas/renegociação. Gate funcional separado do gate de qualidade.
5. Adaptar a fase web para transmissor local/receptor remoto e controlar fonte, resolução, áudio, codec, browser e ordem alternada. `captureStream` de canvas não substitui `getDisplayMedia` em jogo real.

Não repetir somente uma mediana ponta a ponta: cada experimento deve modificar uma hipótese e dizer qual etapa mudou. Recursos do sistema contextualizam os resultados; correlação de CPU/GPU sozinha não estabelece causa.

## Validação final desta entrega

- Frontend completo: **942 testes / 92 arquivos aprovados**, `output/playwright/capture-remote-full-tests.log`.
- Regressões focadas em recursos/telemetria/receptor remoto: **47 testes / 3 arquivos aprovados**, `output/playwright/capture-remote-unit-tests.log`.
- Rust: **39 aprovados, 2 probes ignorados por padrão**, `output/playwright/capture-remote-rust-tests.log`. Os probes foram executados explicitamente e separadamente nos experimentos documentados acima.
- Grafo de módulos: 162 módulos / 419 imports-exports validado; sintaxe dos novos scripts verificada.
- Auto-teste E2E remoto após as correções: passou; SSH real autenticou na reverificação, faltando sincronizar os scripts no notebook e escolher a sessão de execução.

Os avisos de canvas/navegação de JSDOM na suíte frontend não substituem os testes de navegador real. As aprovações acima são regressões/entrega funcional; não homologam 120 FPS, jogo sob saturação, latência entre máquinas ou estabilidade geral. D3D12 continua disponível somente no probe diagnóstico; a rota padrão do aplicativo permanece D3D11.
