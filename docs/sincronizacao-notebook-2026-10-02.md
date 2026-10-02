# Atualização do SeeMyGame no notebook por SSH

Data: 02/10/2026. Destino: alias SSH `notebook`, projeto `C:\Users\Diogo\SeeMyGame`.

## Arquivos atualizados

Foi transferido um snapshot do código atual do desktop, incluindo alterações ainda não commitadas: fontes JS/Rust, HTML, templates, CSS, assets, testes, ferramentas, documentação e lockfile. O pacote contém **531 arquivos**; **187 foram substituídos, 304 adicionados e 40 já estavam iguais**. SHA-256 foi verificado na transferência, no staging e no destino.

Backup dos arquivos substituídos no notebook:

```text
C:\Users\Diogo\SeeMyGame\output\ssh-sync\sync-2026-10-02T17-23-09-36ff98\backup
```

Metadados Git, `.env`, chaves, configurações Cargo específicas da máquina, runtime GStreamer, SDK, binários Tauri e outros outputs foram preservados. Arquivos extras do notebook não foram removidos. O processo atualizou o working tree por SSH/SCP; não mudou branch nem executou commit/push. Git não foi encontrado no PATH ou nos locais padrão do notebook.

## Dependências e Node

O lockfile do notebook foi atualizado para o mesmo snapshot do desktop e as dependências reinstaladas com `npm ci --ignore-scripts --no-audit --no-fund`. A instalação global do notebook continua em Node **24.14.0**. O JSDOM 30.0.1 do projeto exige **24.15.0** ou outra versão suportada pelo pacote; foi transferido um Node 24.15.0 x64 isolado para validar o projeto:

```text
C:\Users\Diogo\SeeMyGame\output\ssh-sync\sync-2026-10-02T17-23-09-36ff98\runtime\node.exe
```

O hash do executável foi verificado. Nenhuma instalação global ou perfil de shell foi alterado. Para executar os testes com esse runtime no notebook:

```powershell
cd C:\Users\Diogo\SeeMyGame
$env:PATH = "$PWD\output\ssh-sync\sync-2026-10-02T17-23-09-36ff98\runtime;" + $env:PATH
node node_modules/vitest/vitest.mjs run --maxWorkers=2
```

Playwright 1.63.0 coincide entre as máquinas; Chrome do notebook: 154.0.8037.58.

## Achado durante a validação

A primeira suíte remota executou os mesmos 942 testes: 941 passaram e o stress que cria/destrói **100 controles 3D** excedeu o timeout padrão de 5 s. Em execução isolada, com orçamento maior, passou em 5,232 s, com todas as verificações de descarte/listeners/referências. O teste verifica ciclo de vida, não um requisito de concluir 100 modelos em 5 segundos.

Somente esse caso recebeu timeout explícito de 20 s em `tests/gamepad-3d-adversarial.test.js`, no desktop e no notebook. Quantidade de iterações e assertions foram mantidas. Regressão local: 20 testes aprovados. Backup remoto do arquivo antes do ajuste: `test-before-timeout-fix.js`, na pasta da sincronização. O manifesto original foi preservado; o ajuste posterior está registrado em `post-sync-patch.json` no relatório local.

## Receptor preparado

O smoke executado **no próprio notebook** iniciou `viewer-agent.mjs`, conectou o Playwright ao Chrome headless, conferiu renderização de canvas, APIs WebRTC/rVFC e coletou três amostras de CPU/GPU com o coletor Windows. Passou e encerrou os processos que criou. Resultado: `receiver-smoke.json`.

A sessão SSH é **0**. Esse teste valida a prontidão para decode/rede e controle remoto do browser; não certifica apresentação na tela física e não transmitiu uma partida. Para observar apresentação, iniciar o helper no desktop interativo e desbloqueado do notebook. O executável Tauri do notebook não foi recompilado; o receptor web/Playwright não precisa dele.

Evidências locais em `output/playwright/sync-2026-10-02T17-23-09-36ff98/`: manifesto/pacote, scripts utilizados, `report.json`, `receiver-smoke.json`, logs e registro do ajuste do teste. Os comandos do E2E entre máquinas estão em `captura-por-etapas-e-e2e-duas-maquinas-2026-10-02.md`.

## Resultado final

Validação remota final aprovada: dependências instaladas, grafo de módulos e imports ESM aprovados, **942 testes / 92 arquivos aprovados**, build web `dist` regenerado. A suíte final usou dois workers e levou aproximadamente 117–121 s no notebook. A primeira falha e as verificações posteriores foram preservadas em logs separados. A aprovação funcional do receptor não substitui o benchmark de streaming entre as duas máquinas.
