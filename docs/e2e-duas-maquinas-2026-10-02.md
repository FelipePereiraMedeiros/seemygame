# Primeira transmissão E2E entre desktop e notebook — 2026-10-02

A matriz posterior com receptores interativos Chrome/Tauri e transmissores nativo/web está em [matriz-e2e-duas-maquinas-2026-10-02.md](matriz-e2e-duas-maquinas-2026-10-02.md). Os resultados abaixo continuam sendo o lote anterior com receptor headless; não devem ser misturados como se tivessem as mesmas condições.

Foi executada transmissão real do Tauri/GStreamer no desktop para o Chrome no **Notebook-Diogo**, com identidades autenticadas na mesma sala. A conexão de mídia selecionada foi UDP, com candidatos `prflx → host`, sem candidato TURN selecionado. O SSH encaminhou controle, página e sinalização; a mídia estabeleceu sua própria conexão ICE. Os campos coletados não identificam a interface escolhida: não afirmar LAN física ou ausência de VPN apenas pelo tipo de candidato.

Foram feitas duas rodadas sequenciais, H.264/NVENC, fonte sintética a 60 FPS, D3D11/WGC padrão, áudio e replay desligados. Release do transmissor conferido contra o JavaScript do checkout. Cada rodada solicitou 70 intervalos; os 63 intervalos steady corresponderam a aproximadamente 72/73 segundos reais por causa do tempo das consultas. Recursos foram amostrados nos relógios de cada máquina. Nenhuma compilação ou suíte Vitest deste trabalho ocorreu durante a transmissão.

## Resultados

| Métrica | 720p (`ultra`) | 1080p (`balanced`) |
| --- | ---: | ---: |
| Resolução recebida | 1280×720 | 1920×1080 |
| Fonte, FPS mediano | 60,0 | 60,0 |
| Preview local, FPS mediano | 54,91 | 54,82 |
| Produção RTP nativa, FPS mediano¹ | 54,98 | 54,98 |
| Decode receptor, FPS mediano steady | 54,98 | 54,91 |
| Decode receptor, FPS p10 steady | 54,32 | 53,35 |
| Tempo de decode por frame, mediana dos intervalos | 1,14 ms | 2,27 ms |
| Jitter buffer, mediana dos intervalos | 11,21 ms | 12,27 ms |
| RTT do par ICE de vídeo, p50 / p95² | 5 / 9 ms | 8 / 35 ms |
| Bitrate recebido mediano¹ | 1,66 Mbps | 1,70 Mbps |
| Pacotes perdidos, total ao final | 0 | 8 |
| Freezes WebRTC, total / duração | 0 / 0 s | 4 / 1,40 s |
| Intervalos steady com pausa >150 ms | 0 | 4 |
| Maior pausa steady dos callbacks | 109 ms | 429 ms |
| FPS apresentado p10, gate de qualidade¹ | 34,98 | 33,99 |
| CPU total desktop p50 / p95 | 44,21% / 74,81% | 50,40% / 69,16% |
| CPU total notebook p50 / p95 | 12,19% / 20,97% | 13,39% / 20,49% |
| Núcleo mais ocupado notebook p95 | 96,95% | 96,95% |
| GPU, engine mais ocupada desktop p95 | 4,95% | 7,24% |
| GPU, engine mais ocupada notebook p95 | 0,10% | 0,24% |
| Entrega funcional | Aprovada | Aprovada |
| Gate de qualidade solicitado a 60 FPS | **Reprovado** | **Reprovado** |

¹ Amostras exportadas pelo diagnóstico de produção dentro da janela steady do receptor/transmissor. Não são exatamente a mesma série do sampler E2E de FPS. O bitrate configurado é um orçamento; conteúdo sintético simples não deve ser tratado como saturação de banda. A cadência rVFC/headless não certifica apresentação física.

² RTT não é latência glass-to-glass. Como não houve calibração dos relógios entre máquinas, **nenhuma latência óptica absoluta foi calculada**.

## Pista discriminante: perdas e recuperação em 1080p

| Intervalo do sampler | Pausa callback | FPS remoto | FPS preview | Perdas novas | NACKs novos | Freeze novo |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| 20 | 429 ms | 38,93 | 54,74 | 1 | 4 | 1 |
| 41 | 333 ms | 39,67 | 54,25 | 2 | 3 | 1 |
| 53 → 54 | 319 ms no 54 | 44,78 no 54 | 54,78 no 54 | 4 no 53 | 1 + 2 | 1 no 54 |
| 57 → 58 | 319 ms no 58 | 46,93 no 58 | 55,42 no 58 | 1 no 57 | 1 + 2 | 1 no 58 |

Essa associação é mais específica que uma mediana ponta a ponta: os freezes seguem perdas/NACKs, enquanto o preview e a produção nativa continuam perto de 55 FPS. A hipótese prioritária para **esses quatro eventos** é recuperação de perda RTP/H.264 ou bloqueio no receptor. Não prova a causa de todos os stutters históricos. Verificar retransmissões atendidas, RTX negociado e efetivo, feedback ao encoder e dependências dos frames é o próximo experimento discriminante.

O classificador atual marcou esses eventos como `COMPOSITOR_PRESENTATION`, confiança média: é um fallback, **não comprova falha do compositor**. Ele ainda não incorpora deltas de NACK/perdas para distinguir essa hipótese. Jitter buffer médio baixo não exclui perda de pacotes ou uma pausa pontual de centenas de milissegundos.

Existe também um teto upstream de ~55 FPS: fonte a 60, produção RTP/preview/receptor a ~55. Separar o notebook não removeu esse teto; permanece coerente com os probes D3D11 anteriores. D3D12 ainda é somente um probe diagnóstico; estas rodadas não o testaram nem alteraram a captura padrão.

## Condições que limitam as conclusões

- Receptor iniciado por SSH na sessão Windows 0, **headless**. Baixa utilização GPU e ausência de `decoderImplementation`/`powerEfficientDecoder` não permitem afirmar qual decoder ou caminho gráfico foi usado. Os ~35 FPS de callbacks podem incluir efeitos desse ambiente; não inferir que a tela física está limitada a 35 FPS.
- CPU/GPU coletados separadamente, com 72/73 amostras steady em cada máquina. Um núcleo do notebook ficou próximo de saturação. Existiam aplicações externas em ambas as máquinas; CPU externa desktop p95 ~31–32%. É a condição real do momento, não um baseline completamente ocioso.
- Não houve jogo, áudio, replay, perda artificial controlada ou comparação remota com `getDisplayMedia` nesta rodada. O `--compare` remoto continua rejeitado, porque a fase web atual inverte os papéis. Não usar estes dados para comparar nativo e web.
- Uma rodada por resolução, ordem 720p → 1080p. Sem repetições alternadas não atribuir a diferença de perda/stutters causalmente à resolução.

## Correção necessária para o teste funcionar

Tentativa inicial `2026-10-02T18-03-08-826Z-84ead7`: o controle Playwright funcionou e confirmou máquina diferente, mas `page.goto` no notebook falhou com `ERR_CONNECTION_REFUSED` ao acessar o servidor local do desktop. O auto-teste anterior na mesma máquina mascarava isso. A opção `exposeNetwork` não encaminhou o loopback nesse `launchServer` instalado; o código local do Playwright foi inspecionado e o resultado observado preservado.

Foi adicionada a opção **`--viewer-ssh-host notebook`**, usando `tools/e2e/harness/ssh-reverse.mjs`: encaminha somente as duas portas efêmeras do HTTP/sinalização para loopback do notebook. Valida alias/portas, exige autenticação sem prompt, known-hosts estrito e sucesso do forwarding; espera confirmação remota e encerra o processo SSH que criou. Não altera firewall, serviços ou configuração SSH. O helper do receptor e o túnel de controle continuam em loopback com capabilities temporárias.

Mantendo o helper no notebook e o túnel de controle/browser já descrito no guia, executar no desktop:

```powershell
node tools/e2e/run.mjs --exe src-tauri/target/release/seemygame.exe --channel chrome --preset ultra --codec h264 --seconds 70 --viewer-endpoint "http://127.0.0.1:19334/smg-viewer/TOKEN" --viewer-ssh-host notebook --source-position "30,30"
```

O exemplo usa helper/browser nas portas 19334/19333 desta rodada. Substituir pelo endpoint atual; quando a porta encaminhada do browser diferir da porta anunciada pelo helper, usar `--viewer-ws-port`. Nunca usar `--allow-same-machine-remote` para homologar duas máquinas.

## Evidências e próximos passos

- Orquestração: `output/playwright/two-machine-2026-10-02T18-05-52-990Z/report.json`; consolidação em `summary.json`. Script usado preservado em `output/playwright/two-machine-run.mjs`.
- 720p: `output/playwright/2026-10-02T18-05-59-691Z-c60c70/report.json`.
- 1080p: `output/playwright/2026-10-02T18-08-04-634Z-f91021/report.json`.
- Cada execução tem capturas `desktop.png`/`viewer.png`, diagnóstico de produção, log nativo, fonte e recursos do notebook separados. Relatórios não incluem tokens de controle/Playwright. Logs nativos podem conter candidatos de rede.
- Cleanup dos dois testes sem erro; helper encerrado; verificação SSH posterior confirmou **zero listeners nas portas temporárias 19333/19334**, no desktop e notebook.
- Regressões focadas após terminar os benchmarks: **30 testes / 3 arquivos aprovados**, incluindo validação de destinos/portas, confirmação fragmentada de readiness, falha de bind/conexão, timeout e encerramento do túnel. Sintaxe verificada. Mudanças são no harness, sem alterar o pipeline de produção.

Próxima sequência: (1) repetir 1080p em Chrome visível, sessão interativa e notebook desbloqueado; (2) registrar interface ICE selecionada e controlar a rota de rede, comparando perdas e RTX efetivo; (3) alternar pelo menos três repetições por condição; (4) validar D3D12 ponta a ponta mantendo codec/encoder/receptor iguais; (5) só então adicionar jogo limitado/ilimitado, áudio × replay e transmissor web local. Cada passo deve responder a uma hipótese, sem misturar mudanças.
