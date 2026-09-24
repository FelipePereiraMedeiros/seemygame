# Nono Parecer Técnico: Resolução do Stuttering (165Hz Pacing), Resolução Nativa de Janelas e Eliminação do Erro 0xc0000017

**Data:** 24 de Setembro de 2026  
**Contexto:** Diagnóstico empírico em ambiente Desktop (NVIDIA RTX 3070, monitor 165Hz) comparado ao ambiente Notebook, testes de resolução (720p vs 1080p), isolamento do erro `0xc0000017` em reinicializações sucessivas e integração Web-Desktop.

---

## 1. Síntese dos Achados Empíricos

1. **Equiparação de Desempenho em 720p**:
   - Em resolução 720p, tanto o encoder **Media Foundation** quanto o **NVIDIA NVENC** sustentaram **60 FPS praticamente cravados**.
   - Isso descartou definitivamente que o chip NVENC da RTX 3070 estivesse com defeito ou incompatibilidade de hardware.
   - O volume de pixels processados a 720p ($1280 \times 720 = 921.600$ pixels) é **55,6% menor** que a 1080p ($1920 \times 1080 = 2.073.600$ pixels), reduzindo drasticamente a pressão de conversão D3D11 e o tamanho dos pacotes RTP de quadros-chave (I-frames).

2. **Causa Raiz do Stuttering em 1080p no Monitor de 165Hz**:
   - O monitor do desktop opera a **165 Hz** (`CurrentRefreshRate: 164`).
   - A captura do Windows via WGC (`d3d11screencapturesrc`) injetava quadros a cada ~6 ms (165 vezes por segundo).
   - Sem um regulador de cadência com timestamps homogêneos, ocorria descompasso de amostragem ($165 / 60 = 2{,}75$), gerando *frame pacing judder* e acúmulo de processamento no conversor de texturas.
   - A 1080p, esse descompasso gerava perda de quadros perceptível. A 720p, a margem de folga de processamento amortecia o impacto.

3. **Causa e Resolução do Erro `0xc0000017` (`STATUS_NO_MEMORY`)**:
   - O erro ocorria ao abrir, fechar e reconfigurar a transmissão repetidas vezes.
   - **Causa Raiz:** As funções `prepare_process_environment()` e `configure_environment()` concatenavam os caminhos `bin` e `lib` do GStreamer à variável de ambiente `PATH` do sistema sem deduplicação. Como cada chamada a `probe()` inspeciona 11 plugins, a variável `PATH` crescia a cada teste até estourar a cota máxima de 32 KB para o bloco de variáveis de ambiente do Windows. Ao chamar `CreateProcess` com um ambiente saturado, o carregador NT do Windows abortava imediatamente com `0xc0000017`.
   - **Solução:** Implementação de `OnceLock` para inicialização única do ambiente e rotina estrita de deduplicação de diretórios no `PATH`. Adicionado também resfriamento de 60 ms no encerramento de processos para liberação limpa de contextos de GPU.

---

## 2. Implementações Realizadas

1. **Regulação de Cadência (`videorate`)**:
   - Inserido `videorate drop-only=true` operando em texturas `video/x-raw(memory:D3D11Memory)`.
   - Elemento promove descarte limpo de quadros excedentes da taxa de 165Hz antes da conversão de cores e escala, entregando **60 FPS com espaçamento uniforme de 16,6 ms**.
   - Adicionadas filas isoladoras (`queue max-size-buffers=3 max-size-time=50ms`) para estabilizar deadlines de buffer no GStreamer.

2. **Otimização do Pipeline NVENC (`nvd3d11h264enc`)**:
   - Alterado `strict-gop=true` para `strict-gop=false`, suavizando a curva de taxa de bits entre quadros e prevenindo choques de compressão nos limites de GOP.

3. **Validação da Resolução Nativa de Janelas (Ex.: 1420x858)**:
   - Esclarecido o comportamento intencional do SeeMyGame: para preservar nitidez de texto 1:1, evitar estiramento anamórfico e economizar GPU/banda, janelas capturadas não sofrem upscale artificial caso suas dimensões nativas sejam inferiores ao preset selecionado. A escala para 1920x1080 ou 1280x720 ocorre normalmente quando a fonte é um Monitor ou janela maximizada/fullscreen.

4. **Compatibilidade Contínua com a Web**:
   - O stream nativo gerado pelo Desktop utiliza WebRTC padrão (H.264 Constrained Baseline, Opus, packetization-mode 1), permitindo que qualquer navegador em desktop ou celular consuma o sinal com decodificação por hardware nativo.

---

## 3. Estado dos Testes e Conclusão

- **Testes Unitários Rust:** 29 testes aprovados (`cargo test`).
- **Testes Unitários Frontend:** 482 testes aprovados em 46 arquivos (`npm run test`).
- **Smoke Tests de Mídia:** Validados `videorate`, `nvenc`, `mfh264enc`, `mfh265enc`, `x264enc` e `webrtcbin` (100% de aprovação).
- **Conclusão:** O ambiente está estabilizado, a causa dos stutters em telas de alta taxa foi tratada no núcleo do pipeline, e a robustez contra falhas de inicialização foi garantida.
