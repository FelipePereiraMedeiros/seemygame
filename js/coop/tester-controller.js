/** tester-controller: commands receive explicit compatibility ports; no page initialization. */
export function setupGamepadTesterModal(compatibilityContext) {
  if (typeof document === 'undefined') return;

  const openBtn = document.getElementById('open-gamepad-tester-btn');
  const modal = document.getElementById('gamepad-tester-modal');
  const closeBtn = document.getElementById('close-gamepad-tester-btn');
  const doneBtn = document.getElementById('done-gamepad-tester-btn');
  const testRumbleBtn = document.getElementById('test-rumble-btn');
  const rumbleStatus = document.getElementById('gamepad-rumble-status');
  const select = document.getElementById('gamepad-select');
  const gamepadVisual = document.getElementById('gamepad-visual');
  const connectionLabel = document.getElementById('gamepad-connection-label');
  const sticksLabel = document.getElementById('gamepad-sticks-label');
  const triggersLabel = document.getElementById('gamepad-triggers-label');
  const buttonsLabel = document.getElementById('gamepad-buttons-label');
  const statusBox = document.getElementById('gamepad-driver-status-box');
  const statusText = document.getElementById('gamepad-driver-status-text');
  const presetSelect = document.getElementById('gamepad-mapping-preset');
  const swapAbBtn = document.getElementById('swap-ab-btn');
  const swapXyBtn = document.getElementById('swap-xy-btn');
  const resetMappingBtn = document.getElementById('reset-mapping-btn');
  const mappingStatus = document.getElementById('gamepad-mapping-status');

  if (!modal) return;
  if (modal.dataset.testerMounted === 'true') return;
  modal.dataset.testerMounted = 'true';
  const bindingAbort = new AbortController();
  let disposed = false;

  let animId = null;
  let gamepadOptionsSignature = '';
  let nativeXInputPads = [];
  let nativeXInputPollPending = false;
  let lastNativeXInputPollAt = 0;
  const buttonIndicators = Array.from(modal.querySelectorAll('[data-gamepad-button]'));
  const stickCaps = Array.from(modal.querySelectorAll('[data-gamepad-stick-cap]'));

  // Inicialização assíncrona do visualizador 3D com Three.js e mouse-tracking
  let viewer3D = null;
  const canvas3D = modal.querySelector('#gamepad-3d-canvas');
  if (canvas3D) {
    import(".././gamepad-3d-viewer.js")
      .then(({ Gamepad3DViewer }) => {
        if (disposed) return;
        viewer3D = new Gamepad3DViewer({
          container: document.getElementById('gamepad-visual-stage'),
          canvas: canvas3D,
          modelUrl: 'css/assets/gamepad.glb',
          enableMouseTracking: true
        });
        viewer3D.init().catch(error => console.warn('[Gamepad 3D]', error));
      })
      .catch((err) => {
        console.warn('[Gamepad 3D] Falha ao carregar visualizador:', err);
      });
  }

  const updateMappingUI = () => {
    if (presetSelect) presetSelect.value = compatibilityContext.currentMappingPreset;
    if (mappingStatus) {
      const label = compatibilityContext.currentMappingPreset === 'xbox' ? 'Padrão Xbox / PC'
        : compatibilityContext.currentMappingPreset === 'nintendo' ? 'Nintendo Switch (A↔B, X↔Y)'
        : 'Personalizado';
      mappingStatus.textContent = `Layout ativo: ${label}`;
    }
  };

  presetSelect?.addEventListener('change', (e) => {
    compatibilityContext.setGamepadMappingPreset(e.target.value);
    updateMappingUI();
  });

  swapAbBtn?.addEventListener('click', () => {
    compatibilityContext.swapGamepadButtons(0, 1);
    updateMappingUI();
    compatibilityContext.showToast('🔄 Botões A e B invertidos!', 'info');
  });

  swapXyBtn?.addEventListener('click', () => {
    compatibilityContext.swapGamepadButtons(2, 3);
    updateMappingUI();
    compatibilityContext.showToast('🔄 Botões X e Y invertidos!', 'info');
  });

  resetMappingBtn?.addEventListener('click', () => {
    compatibilityContext.resetGamepadMapping();
    updateMappingUI();
    compatibilityContext.showToast('Layout de botões restaurado para o padrão Xbox.', 'info');
  });

  const updateDriverStatus = async () => {
    if (!statusText || !statusBox) return;
    if (compatibilityContext.isTauriEnvironment()) {
      try {
        const [status, xinputPads] = await Promise.all([
          compatibilityContext.checkVirtualGamepadDriver(),
          compatibilityContext.getXInputGamepads().catch(() => [])
        ]);
        nativeXInputPads = Array.isArray(xinputPads) ? xinputPads : [];
        lastNativeXInputPollAt = Date.now();
        if (status?.vigem_available) {
          statusText.textContent = '🟢 Driver ViGEmBus: Ativo e pronto no Windows';
          statusBox.style.background = 'rgba(16, 185, 129, 0.1)';
          statusBox.style.color = '#10b981';
        } else {
          statusText.innerHTML = '🟡 Driver ViGEmBus não detectado. <button id="install-vigem-btn" style="margin-left: 8px; padding: 2px 8px; font-size: 11px; background: #eab308; color: #000; border: none; border-radius: 4px; cursor: pointer; font-weight: bold;">Instalar com 1 Clique</button>';
          statusBox.style.background = 'rgba(234, 179, 8, 0.1)';
          statusBox.style.color = '#eab308';

          const btn = document.getElementById('install-vigem-btn');
          if (btn) {
            btn.onclick = async () => {
              btn.disabled = true;
              btn.textContent = 'Instalando...';
              compatibilityContext.showToast('Iniciando instalação oficial do ViGEmBus... Confirme a janela UAC do Windows.', 'info', 6000);
              try {
                const res = await compatibilityContext.installViGEmDriver();
                compatibilityContext.showToast(res || 'Instalação concluída com sucesso!', 'success');
              } catch (err) {
                compatibilityContext.showToast(`Falha na instalação: ${err?.message || err}`, 'error');
              } finally {
                await updateDriverStatus();
              }
            };
          }
        }
      } catch (e) {
        statusText.textContent = '⚪ Modo Web P2P (Companion Agent opcional)';
      }
    } else {
      statusText.textContent = compatibilityContext.isCompanionConnected && compatibilityContext.companionCapabilities.gamepad
        ? '🟢 Companion Agent: Suporte a gamepad virtual ativo'
        : '⚪ Modo Web Convidado / Companion Agent opcional para host';
    }
  };

  const updateHud = () => {
    if (compatibilityContext.isTauriEnvironment() && !nativeXInputPollPending && Date.now() - lastNativeXInputPollAt >= 34) {
      nativeXInputPollPending = true;
      lastNativeXInputPollAt = Date.now();
      compatibilityContext.getXInputGamepads()
        .then((pads) => {
          nativeXInputPads = Array.isArray(pads) ? pads : [];
        })
        .catch(() => {})
        .finally(() => {
          nativeXInputPollPending = false;
        });
    }

    let gamepads = [];
    try {
      gamepads = typeof navigator !== 'undefined' && navigator.getGamepads
        ? Array.from(navigator.getGamepads() || [])
        : [];
    } catch (error) {}
    const connectedPads = gamepads.filter((gamepad) => gamepad?.connected);

    if (select) {
      const signature = [
        connectedPads.map((gamepad) => `${gamepad.index}:${gamepad.id}`).join('|'),
        connectedPads.length ? '' : nativeXInputPads.map((gamepad) => gamepad.index).join(',')
      ].join(';');
      if (signature !== gamepadOptionsSignature) {
        const currentVal = select.value;
        gamepadOptionsSignature = signature;
        select.replaceChildren();
        if (connectedPads.length > 0) {
          connectedPads.forEach((gamepad) => {
            const option = document.createElement('option');
            option.value = `web:${gamepad.index}`;
            option.textContent = `#${gamepad.index}: ${gamepad.id || 'Controle sem identificação'}`;
            select.appendChild(option);
          });
        } else if (nativeXInputPads.length > 0) {
          nativeXInputPads.forEach((gamepad) => {
            const option = document.createElement('option');
            option.value = `xinput:${gamepad.index}`;
            option.textContent = gamepad.id;
            select.appendChild(option);
          });
        } else {
          const option = document.createElement('option');
          option.value = '';
          option.textContent = 'Nenhum controle detectado (pressione um botão)';
          select.appendChild(option);
        }
        const availableValues = Array.from(select.options, (option) => option.value);
        select.value = availableValues.includes(currentVal)
          ? currentVal
          : (availableValues.find((value) => value !== '') || '');
      }
    }

    const selectedValue = select?.value || 'web:0';
    const selectedNativeIndex = selectedValue.startsWith('xinput:')
      ? Number(selectedValue.slice('xinput:'.length))
      : null;
    const selectedWebIndex = selectedValue.startsWith('web:')
      ? Number(selectedValue.slice('web:'.length))
      : null;
    const gp = selectedWebIndex === null
      ? nativeXInputPads.find((gamepad) => gamepad.index === selectedNativeIndex) || null
      : connectedPads.find((gamepad) => gamepad.index === selectedWebIndex) || null;
    buttonIndicators.forEach((indicator) => indicator.classList.remove('is-pressed'));

    if (gp) {
      gamepadVisual?.classList.add('is-connected');
      if (gamepadVisual) {
        gamepadVisual.setAttribute('aria-label', `Controle ${gp.id || `número ${gp.index}`}; botões pressionados são destacados na ilustração`);
      }
      if (connectionLabel) connectionLabel.textContent = `${gp.id || `Controle ${gp.index}`} · mexa nos analógicos e pressione os botões para testar`;
      const lx = (gp.axes[0] || 0).toFixed(2);
      const ly = (gp.axes[1] || 0).toFixed(2);
      const rx = (gp.axes[2] || 0).toFixed(2);
      const ry = (gp.axes[3] || 0).toFixed(2);
      if (sticksLabel) sticksLabel.textContent = `L: (${lx}, ${ly}) | R: (${rx}, ${ry})`;

      const ltVal = typeof gp.buttons[6] === 'object' ? Math.round((gp.buttons[6].value || 0) * 100) : (gp.buttons[6] ? 100 : 0);
      const rtVal = typeof gp.buttons[7] === 'object' ? Math.round((gp.buttons[7].value || 0) * 100) : (gp.buttons[7] ? 100 : 0);
      if (triggersLabel) triggersLabel.textContent = `LT: ${ltVal}% | RT: ${rtVal}%`;

      const pressed = [];
      const btnNames = ['A', 'B', 'X', 'Y', 'LB', 'RB', 'LT', 'RT', 'Back', 'Start', 'L3', 'R3', 'Up', 'Down', 'Left', 'Right', 'Guide'];
      const rawButtons = Array.from(gp.buttons || [], (button) => (
        typeof button === 'object' ? Boolean(button.pressed) : button === 1.0
      ));
      const mappedButtons = compatibilityContext.applyButtonMapping(rawButtons);
      mappedButtons.forEach((isPressed, i) => {
        if (isPressed) {
          const physicalIdx = compatibilityContext.currentGamepadMapping.indexOf(i);
          if (physicalIdx !== -1 && physicalIdx !== i) {
            pressed.push(`${btnNames[i] || `B${i}`} (Físico: ${btnNames[physicalIdx] || `B${physicalIdx}`})`);
          } else {
            pressed.push(btnNames[i] || `B${i}`);
          }
        }
      });
      if (buttonsLabel) buttonsLabel.textContent = pressed.length > 0 ? pressed.join(', ') : 'Nenhum';

      buttonIndicators.forEach((indicator) => {
        const index = Number(indicator.dataset.gamepadButton);
        const value = gp.buttons?.[index];
        const isPressed = typeof value === 'object'
          ? Boolean(value.pressed || value.value > 0.08)
          : value === 1.0;
        indicator.classList.toggle('is-pressed', isPressed);
      });

      const axis = (index) => Math.max(-1, Math.min(1, Number(gp.axes?.[index]) || 0));
      stickCaps.forEach((cap) => {
        const isLeft = cap.dataset.gamepadStickCap === 'left';
        const x = axis(isLeft ? 0 : 2) * 8;
        const y = axis(isLeft ? 1 : 3) * 8;
        cap.setAttribute('transform', `translate(${x.toFixed(1)} ${y.toFixed(1)})`);
      });

      if (viewer3D) {
        viewer3D.updateInputs({
          axes: gp.axes,
          buttons: mappedButtons.map((pressed, i) => {
            const physicalIdx = compatibilityContext.currentGamepadMapping.indexOf(i);
            const srcIdx = physicalIdx !== -1 ? physicalIdx : i;
            const btnObj = gp.buttons?.[srcIdx];
            const rawVal = typeof btnObj === 'object' ? btnObj.value : (btnObj ? 1 : 0);
            return {
              pressed,
              value: pressed && rawVal <= 0 ? 1.0 : rawVal
            };
          }),
          connected: true
        });
      }
    } else if (selectedNativeIndex !== null) {
      gamepadVisual?.classList.add('is-connected');
      gamepadVisual?.setAttribute('aria-label', `Controle Xbox ${selectedNativeIndex + 1} conectado por XInput; botões ainda não estão disponíveis para animação`);
      if (connectionLabel) connectionLabel.textContent = `Controle Xbox #${selectedNativeIndex + 1} encontrado pelo Windows · vibração nativa disponível`;
      if (sticksLabel) sticksLabel.textContent = 'Leitura dos botões indisponível neste WebView';
      if (triggersLabel) triggersLabel.textContent = 'LT: — | RT: —';
      if (buttonsLabel) buttonsLabel.textContent = 'Windows detectou o controle';
      if (viewer3D) {
        viewer3D.updateInputs({ axes: [0, 0, 0, 0], buttons: [], connected: true });
      }
    } else {
      gamepadVisual?.classList.remove('is-connected');
      gamepadVisual?.setAttribute('aria-label', 'Ilustração 3D do controle; nenhum controle conectado');
      if (connectionLabel) connectionLabel.textContent = 'Conecte um controle e pressione qualquer botão para começar';
      if (sticksLabel) sticksLabel.textContent = 'L: (0.00, 0.00) | R: (0.00, 0.00)';
      if (triggersLabel) triggersLabel.textContent = 'LT: 0% | RT: 0%';
      if (buttonsLabel) buttonsLabel.textContent = 'Nenhum controle conectado';
      stickCaps.forEach((cap) => cap.setAttribute('transform', 'translate(0 0)'));
      if (viewer3D) {
        viewer3D.updateInputs({ axes: [0, 0, 0, 0], buttons: [], connected: false });
      }
    }

    if (modal.style.display !== 'none') {
      animId = requestAnimationFrame(updateHud);
    }
  };

  const openModal = () => {
    modal.style.display = 'flex';
    viewer3D?.start();
    updateDriverStatus();
    updateMappingUI();
    if (typeof cancelAnimationFrame !== 'undefined') cancelAnimationFrame(animId);
    if (typeof requestAnimationFrame !== 'undefined') animId = requestAnimationFrame(updateHud);
  };

  const closeModal = () => {
    modal.style.display = 'none';
    viewer3D?.stop();
    if (typeof cancelAnimationFrame !== 'undefined') cancelAnimationFrame(animId);
  };

  openBtn?.addEventListener('click', openModal);
  closeBtn?.addEventListener('click', closeModal);
  doneBtn?.addEventListener('click', closeModal);
  modal.addEventListener('click', (e) => {
    if (e.target === modal) closeModal();
  }, { signal: bindingAbort.signal });
  if (typeof window !== 'undefined') {
    window.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && modal.style.display !== 'none') closeModal();
    }, { signal: bindingAbort.signal });
  }

  testRumbleBtn?.addEventListener('click', async () => {
    viewer3D?.triggerRumble(1.0);
    const selectedValue = select?.value || 'web:0';
    const selectedIdx = selectedValue.startsWith('xinput:')
      ? Number(selectedValue.slice('xinput:'.length))
      : Number(selectedValue.replace('web:', '')) || 0;
    testRumbleBtn.disabled = true;
    const originalLabel = testRumbleBtn.textContent;
    testRumbleBtn.textContent = 'Testando…';
    if (rumbleStatus) rumbleStatus.textContent = 'Enviando pulso de vibração…';
    gamepadVisual?.classList.remove('is-rumbling');
    void gamepadVisual?.offsetWidth;
    gamepadVisual?.classList.add('is-rumbling');
    setTimeout(() => gamepadVisual?.classList.remove('is-rumbling'), 800);
    try {
      let ok;
      let controllerAvailable = false;
      if (selectedValue.startsWith('xinput:')) {
        controllerAvailable = nativeXInputPads.some((gamepad) => gamepad.index === selectedIdx);
        try {
          await compatibilityContext.testGamepadVibration(selectedIdx, 0.8, 0.8, 350);
          ok = true;
        } catch (error) {
          ok = false;
        }
      } else {
        try {
          const pads = typeof navigator !== 'undefined' && navigator.getGamepads
            ? Array.from(navigator.getGamepads() || [])
            : [];
          controllerAvailable = pads.some((gamepad) => gamepad?.connected && gamepad.index === selectedIdx);
        } catch (error) {}
        ok = await compatibilityContext.triggerGamepadRumble(0.8, 0.8, 350, selectedIdx);
      }
      if (ok) {
        if (rumbleStatus) rumbleStatus.textContent = 'Comando de vibração enviado ao controle.';
        compatibilityContext.showToast('📳 Comando de vibração enviado ao controle.', 'success');
      } else {
        const message = !controllerAvailable
          ? 'Nenhum controle conectado foi detectado. Conecte-o e pressione um botão para começar.'
          : compatibilityContext.isTauriEnvironment()
          ? 'Não foi possível vibrar este controle. Confirme se ele é XInput e está conectado.'
          : 'Este navegador ou controle não oferece vibração háptica. Tente outro navegador ou controle.';
        if (rumbleStatus) rumbleStatus.textContent = message;
        compatibilityContext.showToast(message, 'info', 5000);
      }
    } finally {
      testRumbleBtn.disabled = false;
      testRumbleBtn.textContent = originalLabel;
    }
  });
  return () => {
    if (disposed) return; disposed = true;
    closeModal(); bindingAbort.abort(); viewer3D?.destroy();
    delete modal.dataset.testerMounted;
  };
}
