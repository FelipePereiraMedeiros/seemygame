# Correção da montagem do controle 3D

Registro da revisão `shell-2`. O refinamento visual posterior e a validação atual estão em [modelo-controle-referencia-2026-10-01.md](modelo-controle-referencia-2026-10-01.md).

## Problemas confirmados

- A extrusão/bevel da carcaça atingia uma altura maior que a prevista pelos botões. O direcional e os botões de sistema ficavam parcialmente encobertos, especialmente ao pressionar.
- Cápsulas usadas como grips estavam orientadas no eixo vertical: suas extremidades atravessavam a face e pareciam buracos ou peças soltas.
- Os analógicos ficavam próximos demais do direcional e do cluster ABXY, criando sobreposição e oclusão na câmera.
- L3/R3 deslocavam o pivô e depois deslocavam novamente os filhos da cabeça: o movimento era duplicado e alterava o encaixe com a haste.
- O brilho do clique dos analógicos era tão intenso que apagava os detalhes da geometria.

## Correções

Corrigida a espessura da carcaça, orientação dos grips, posição da placa central e dos controles. Botões ABXY têm tampas menos esféricas; os botões de sistema continuam visíveis ao pressionar. O clique dos analógicos move o conjunto apenas pelo pivô. A câmera mostra melhor a face e o feedback emissivo preserva os detalhes.

O arquivo `css/assets/gamepad.glb` foi regenerado a partir do builder. A revisão `shell-2` está no modelo e no endereço usado para carregá-lo, evitando reutilização do GLB antigo em cache. O tester individual também usa o endereço padrão com revisão e enquadramento automático. `modelUrl: null` permite testar o fallback procedural sem carregar o GLB.

## Evidências e testes

- `tests/gamepad-model-assembly.test.js`: 15 testes sobre carcaça/peças, grips, distâncias, clique sem deslocamento duplicado e equivalência de revisão, posições e geometria do GLB.
- `npm run test:e2e:gamepad`: renderização real em Chrome de procedural e GLB, em repouso e com inputs ativos. Raycasting confirma que os botões/direcional estão acima da carcaça e visíveis na câmera; o teste também verifica liberação dos inputs e ausência de erros da página.
- `npm run test:e2e:controllers`: aprovado novamente, incluindo quatro renderizadores, inputs por participante, checklist, layout móvel e fluxo Room.
- Suíte completa: **82 arquivos / 848 testes aprovados** (`npx vitest run --maxWorkers=4`). Checks de módulos, HTML e smoke ESM aprovados.

Imagens e relatório: `output/playwright/gamepad-model/after.png`, `released.png`, `report.json`; resultado integrado em `output/playwright/controller-lab/desktop.png`. Os inputs automatizados são simulados, mas os modelos, GLB, WebGL e conexões da sala são reais.

O `dist` foi atualizado. Recarregue a página para carregar os módulos corrigidos. Um executável Tauri que embute o frontend anterior precisa ser reconstruído.
