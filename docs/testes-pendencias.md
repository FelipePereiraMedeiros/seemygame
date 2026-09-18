# Testes de regressão das pendências

Executar da raiz do projeto:

```powershell
npm run test:pending
```

O comando executa todas as suítes abaixo mesmo quando uma delas falha e
retorna código 1 se houver qualquer falha. Não há `skip`, `todo` ou inversão
de resultado para ocultar pendências. `npm test` também inclui os novos
testes JavaScript, mas não executa Python/Rust.

Requisitos: dependências npm instaladas, Rust/Cargo com dependências já em
cache, Python 3 e FFmpeg no PATH. `PYTHON_BIN` e `FFMPEG_BIN` permitem indicar
executáveis específicos. O runner Rust usa `--locked --offline`. Uma
dependência ausente é erro de infraestrutura, não prova de defeito do app.

| Arquivo | Casos | O que exige |
|---|---:|---|
| `tests/pending-capture.test.js` | 2 | Cancelar A, iniciar B e receber conclusões em ambas as ordens preserva B; parar depois libera a track correta |
| `tests/pending-turn.test.js` | 3 | Origin permitido não substitui autenticação; token inválido não entrega credenciais; origem indevida continua bloqueada |
| `tests/pending-replay.test.js` | 2 | Fixture decodifica; replay exportado não inclui frames antigos, com FFmpeg real |
| `tests/pending-replay-streams.test.js` | 1 | Streams A/B mantêm gravações independentes; encerrar A não interrompe B |
| `tests/test_pending_companion.py` | 4 | Liberação no canto, revogação no failsafe de teclado, limpeza na desconexão, origens/token inválidos |
| `src-tauri/src/capture.rs`, módulo `acceptance_tests` | 2 | Backend real informa disponibilidade de vídeo janela/monitor e áudio do sistema |

São **14 casos novos**. Eles verificam o comportamento desejado e, portanto,
alguns ficam vermelhos enquanto a implementação correspondente estiver
incompleta. Não foram feitas correções funcionais para fazê-los passar.

## Isolamento e limites

- Python importa o módulo de produção inteiro com `pyautogui` e `websockets`
  substituídos antes do import. Não movimenta mouse, pressiona teclas, abre
  portas nem exige esses pacotes instalados.
- TURN usa respostas sintéticas do provedor; não consulta rede ou segredos
  reais. A suíte cobre vazamento sem autenticação, não quotas distribuídas
  entre instâncias serverless.
- Captura e PeerJS usam streams/conexões simulados. O replay usa um vídeo
  sintético de 995 bytes e decodificação FFmpeg por pipes, sem captura real.
- Os testes Rust de aceitação são critérios mínimos de disponibilidade contra
  o backend real; **não demonstram transmissão nativa ponta a ponta**. Os
  testes unitários de `media.rs` cobrem a montagem dos pipelines WGC/D3D11,
  H.264/HEVC e áudio de processo sem shell.
- O teste de múltiplos vídeos cobre independência dos gravadores. Escolha
  correta do clipe pelo cartão, mux de outros codecs e sincronização AV ainda
  exigem testes de integração adicionais quando esses recursos forem adaptados.

O Vite precisou de execução com permissão para iniciar subprocessos neste
ambiente. Não confundir um erro `spawn EPERM` antes da coleta com um teste
de regressão executado.

## Última validação em 15/09/2026

| Suíte | Passaram | Falharam |
|---|---:|---:|
| JavaScript completo, incluindo os casos novos | 339 | 0 |
| Python, 4 casos novos | 4 | 0 |
| Rust, 2 critérios novos | 0 | 2 |

As falhas JavaScript foram exportação do frame antigo no replay e os dois
casos de autenticação TURN. Python ainda não revoga a sessão no failsafe de
teclado. Rust confirma que vídeo nativo e áudio do sistema não estão disponíveis.

Os 331 testes JavaScript anteriores passaram. Resultados detalhados da
execução completa estão em `docs/resultados-testes-pendencias-js.json`.

Houve alterações concorrentes no código durante a criação dos testes:
cancelamento/reinício, isolamento dos gravadores e liberação no canto passaram
nas últimas execuções. As correções não foram feitas por esta tarefa. Os
resultados acima descrevem a última execução de cada suíte, não um checkout
imutável nem garantia sobre alterações posteriores.

## Atualização do worker nativo

O worker agora está implementado, mas o runtime GStreamer não está presente
neste checkout. Além disso, os dois testes de aceitação continuam sendo
critérios de ambiente e ainda não incluem a ponte WebRTC nativa nem um
espectador remoto. Para preparar a próxima execução:

```powershell
npm run native:prepare
npm run native:smoke
cargo test --manifest-path src-tauri/Cargo.toml --locked --offline --lib capture::acceptance_tests
```

As duas últimas etapas só podem ser consideradas verdes após instalar o
runtime oficial e executar em Windows com os plugins WGC, WASAPI, Media
Foundation e WebRTC disponíveis.

A validação posterior do worker adicionou a cobertura do encaminhamento
explícito de HEVC; a suíte JavaScript atual fica em **340/340**.
