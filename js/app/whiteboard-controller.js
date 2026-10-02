/** whiteboard-controller: commands receive explicit compatibility ports; no page initialization. */
export function initWhiteboard(compatibilityContext) {
  const toggleBtn = document.getElementById('toggle-whiteboard-btn');
  const dockBtn = document.getElementById('dock-whiteboard-btn');
  const modal = document.getElementById('whiteboard-modal');
  const canvas = document.getElementById('whiteboard-canvas');
  if (!modal || !canvas) return;

  // Pré-vincula canvas ao whiteboardManager imediatamente
  window.whiteboardManager = compatibilityContext.whiteboardManager;
  compatibilityContext.whiteboardManager.setCanvas(canvas);

  // Conecta callbacks P2P do WhiteboardManager
  compatibilityContext.whiteboardManager.onElementCreated = (element) => {
    compatibilityContext.broadcastDataMessage({ type: 'WHITEBOARD_ELEMENT_ADD', element });
  };
  compatibilityContext.whiteboardManager.onElementUpdated = (element) => {
    compatibilityContext.broadcastDataMessage({ type: 'WHITEBOARD_ELEMENT_UPDATE', element });
  };
  compatibilityContext.whiteboardManager.onElementDeleted = (element) => {
    compatibilityContext.broadcastDataMessage({ type: 'WHITEBOARD_ELEMENT_DELETE', elementId: element.id });
  };
  compatibilityContext.whiteboardManager.onBoardCleared = () => {
    compatibilityContext.broadcastDataMessage({ type: 'WHITEBOARD_CLEAR' });
  };

  let lastCursorSend = 0;
  compatibilityContext.whiteboardManager.onCursorMoved = ({ x, y }) => {
    const now = Date.now();
    if (now - lastCursorSend > 50) {
      lastCursorSend = now;
      const senderName = compatibilityContext.getLocalUserDisplayName();
      const cursorColor = compatibilityContext.getPeerCursorColor(compatibilityContext.myId || 'local');
      compatibilityContext.broadcastDataMessage({
        type: 'WHITEBOARD_CURSOR',
        x,
        y,
        userName: senderName,
        color: cursorColor
      });
    }
  };

  const resizeCanvas = () => {
    if (typeof window === 'undefined') return;
    const w = window.innerWidth;
    const h = window.innerHeight;
    if (canvas.width !== w || canvas.height !== h) {
      canvas.width = w;
      canvas.height = h;
      compatibilityContext.whiteboardManager.render();
    }
  };

  window.addEventListener('resize', resizeCanvas);

  const openWhiteboard = () => {
    modal.style.display = 'flex';
    resizeCanvas();
    compatibilityContext.whiteboardManager.setCanvas(canvas);
    compatibilityContext.whiteboardManager.render();
    toggleBtn?.classList.add('active');
    dockBtn?.classList.add('is-active');
    // Solicita sincronização com peers na sala
    compatibilityContext.broadcastDataMessage({ type: 'WHITEBOARD_REQUEST_SYNC' });
  };

  const closeWhiteboard = () => {
    modal.style.display = 'none';
    toggleBtn?.classList.remove('active');
    dockBtn?.classList.remove('is-active');
  };

  const toggleWhiteboard = () => {
    if (modal.style.display === 'flex') {
      closeWhiteboard();
    } else {
      openWhiteboard();
    }
  };

  compatibilityContext.openWhiteboardModal = openWhiteboard;
  compatibilityContext.closeWhiteboardModal = closeWhiteboard;
  compatibilityContext.toggleWhiteboardModal = toggleWhiteboard;

  if (toggleBtn) {
    toggleBtn.onclick = toggleWhiteboard;
  }

  if (dockBtn && !dockBtn.onclick) {
    dockBtn.onclick = toggleWhiteboard;
  }

  window.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && modal.style.display === 'flex') {
      closeWhiteboard();
    }
  });

  // Fechar e Voltar para a Sala
  const closeBtn = document.getElementById('wb-close-btn');
  if (closeBtn) closeBtn.onclick = closeWhiteboard;
  const backRoomBtn = document.getElementById('wb-back-room-btn');
  if (backRoomBtn) backRoomBtn.onclick = closeWhiteboard;
  const floatCloseBtn = document.getElementById('wb-floating-close-btn');
  if (floatCloseBtn) floatCloseBtn.onclick = closeWhiteboard;

  // Botões de Ferramentas
  const toolBtns = modal.querySelectorAll('.wb-tool-btn');
  toolBtns.forEach(btn => {
    btn.onclick = () => {
      const tool = btn.dataset.tool;
      if (tool === 'image') {
        const imageInput = document.getElementById('wb-image-input');
        if (imageInput) imageInput.click();
        return;
      }
      toolBtns.forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      compatibilityContext.whiteboardManager.setTool(tool);
    };
  });

  // Notificação de ferramenta alterada (ex: após colar imagem ativa select)
  compatibilityContext.whiteboardManager.onToolChanged = (toolId) => {
    toolBtns.forEach(b => b.classList.toggle('active', b.dataset.tool === toolId));
  };

  // Upload de Imagem via input de arquivo
  const imageInput = document.getElementById('wb-image-input');
  if (imageInput) {
    imageInput.onchange = async (e) => {
      const file = e.target.files?.[0];
      if (file) {
        try {
          const dataUrl = await compatibilityContext.processImageFile(file);
          if (dataUrl) {
            await compatibilityContext.whiteboardManager.addImageFromDataUrl(dataUrl);
            compatibilityContext.showToast('🖼️ Imagem inserida na lousa!', 'success');
          }
        } catch (err) {
          console.error('Erro ao processar imagem:', err);
          compatibilityContext.showToast('Erro ao carregar imagem na lousa.', 'error');
        }
        imageInput.value = '';
      }
    };
  }

  // Paleta de Cores
  const colorDots = modal.querySelectorAll('.wb-color-dot');
  colorDots.forEach(dot => {
    dot.onclick = () => {
      colorDots.forEach(d => d.classList.remove('active'));
      dot.classList.add('active');
      compatibilityContext.whiteboardManager.setColor(dot.dataset.color);
    };
  });

  // Espessura
  const widthBtns = modal.querySelectorAll('#wb-width-group .wb-opt-btn');
  widthBtns.forEach(btn => {
    btn.onclick = () => {
      widthBtns.forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      compatibilityContext.whiteboardManager.setStrokeWidth(Number(btn.dataset.width));
    };
  });

  // Preenchimento
  const fillBtns = modal.querySelectorAll('#wb-fill-group .wb-opt-btn');
  fillBtns.forEach(btn => {
    btn.onclick = () => {
      fillBtns.forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      compatibilityContext.whiteboardManager.setFill(btn.dataset.fill);
    };
  });

  // Estilo Rascunho / Preciso
  const roughBtns = modal.querySelectorAll('#wb-rough-group .wb-opt-btn');
  roughBtns.forEach(btn => {
    btn.onclick = () => {
      roughBtns.forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      compatibilityContext.whiteboardManager.setRough(btn.dataset.rough === 'true');
    };
  });

  // Modo de Fundo
  const bgBtns = modal.querySelectorAll('#wb-bg-group .wb-opt-btn');
  bgBtns.forEach(btn => {
    btn.onclick = () => {
      bgBtns.forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      const mode = btn.dataset.bg;
      compatibilityContext.whiteboardManager.setBackgroundMode(mode);
      if (mode === 'transparent') {
        modal.style.background = 'transparent';
      } else if (mode === 'light') {
        modal.style.background = '#f8fafc';
      } else {
        modal.style.background = '#12131c';
      }
    };
  });

  // Desfazer / Refazer
  const undoBtn = document.getElementById('wb-undo-btn');
  if (undoBtn) {
    undoBtn.onclick = () => {
      if (compatibilityContext.whiteboardManager.undo()) {
        compatibilityContext.broadcastDataMessage({ type: 'WHITEBOARD_SYNC', elements: compatibilityContext.whiteboardManager.elements });
      }
    };
  }

  const redoBtn = document.getElementById('wb-redo-btn');
  if (redoBtn) {
    redoBtn.onclick = () => {
      if (compatibilityContext.whiteboardManager.redo()) {
        compatibilityContext.broadcastDataMessage({ type: 'WHITEBOARD_SYNC', elements: compatibilityContext.whiteboardManager.elements });
      }
    };
  }

  // Limpar
  const clearBtn = document.getElementById('wb-clear-btn');
  if (clearBtn) {
    clearBtn.onclick = () => {
      if (confirm('Deseja realmente limpar toda a lousa?')) {
        compatibilityContext.whiteboardManager.clear(true);
      }
    };
  }

  // Exportar PNG
  const exportBtn = document.getElementById('wb-export-btn');
  if (exportBtn) {
    exportBtn.onclick = async () => {
      try {
        const blob = await compatibilityContext.whiteboardManager.exportToBlob();
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `SeeMyGame-Lousa-${Date.now()}.png`;
        document.body.appendChild(a);
        a.click();
        setTimeout(() => {
          document.body.removeChild(a);
          URL.revokeObjectURL(url);
        }, 1500);
        compatibilityContext.showToast('Lousa exportada com sucesso em PNG!', 'success');
      } catch (err) {
        console.error('Erro ao exportar lousa:', err);
        compatibilityContext.showToast('Erro ao exportar imagem da lousa.', 'error');
      }
    };
  }

  // Compartilhar no Chat
  const chatBtn = document.getElementById('wb-chat-btn');
  if (chatBtn) {
    chatBtn.onclick = () => {
      const isHost = !window.location.pathname.endsWith('viewer.html');
      const coopState = compatibilityContext.getCoopState();
      const role = isHost ? 'host' : (coopState.isPlayer2 ? 'player2' : 'viewer');
      const senderName = isHost ? 'Streamer' : (coopState.isPlayer2 ? 'Player 2' : `Amigo ${compatibilityContext.myId ? compatibilityContext.myId.slice(0, 4) : ''}`);

      const msg = compatibilityContext.chatManager.createMessage({
        senderId: compatibilityContext.myId,
        senderName,
        role,
        text: '🎨 Compartilhou um esquema na Lousa Interativa! Abra a lousa no botão acima para ver.',
        channel: compatibilityContext.chatManager.getActiveChannel(),
      });

      if (msg) {
        compatibilityContext.chatManager.addMessage(msg);
        compatibilityContext.broadcastDataMessage({ type: 'CHAT_MESSAGE', message: msg });
        compatibilityContext.showToast('Aviso enviado para o chat da sala!', 'info');
      }
    };
  }

  // Suporte a arrastar e soltar (drag & drop) arquivos de imagem na lousa
  const handleWbDragOver = (e) => {
    if (modal.style.display !== 'flex') return;
    e.preventDefault();
    if (e.dataTransfer) {
      e.dataTransfer.dropEffect = 'copy';
    }
  };

  const handleWbDrop = async (e) => {
    if (modal.style.display !== 'flex') return;
    e.preventDefault();

    const files = Array.from(e.dataTransfer?.files || []);
    const imgFile = files.find(f => f.type && f.type.startsWith('image/'));
    if (!imgFile) return;

    const rect = canvas.getBoundingClientRect();
    const normX = Math.max(0, Math.min(1, (e.clientX - rect.left) / (rect.width || 1)));
    const normY = Math.max(0, Math.min(1, (e.clientY - rect.top) / (rect.height || 1)));
    const dropX = Math.round(normX * 1920);
    const dropY = Math.round(normY * 1080);

    try {
      const dataUrl = await compatibilityContext.processImageFile(imgFile);
      if (dataUrl) {
        await compatibilityContext.whiteboardManager.addImageFromDataUrl(dataUrl, dropX, dropY);
        compatibilityContext.showToast('🖼️ Imagem inserida na lousa!', 'success');
      }
    } catch (err) {
      console.error('Erro ao soltar imagem na lousa:', err);
      compatibilityContext.showToast('Erro ao carregar imagem solta na lousa.', 'error');
    }
  };

  modal.addEventListener('dragover', handleWbDragOver);
  modal.addEventListener('drop', handleWbDrop);

  // Suporte a colar imagem da área de transferência (Ctrl+V)
  window.addEventListener('paste', async (e) => {
    if (modal.style.display !== 'flex') return;
    if (e.target && (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA')) return;

    const items = Array.from(e.clipboardData?.items || []);
    const imageItem = items.find(item => item.type && item.type.startsWith('image/'));
    if (imageItem) {
      e.preventDefault();
      const file = imageItem.getAsFile();
      if (file) {
        try {
          const dataUrl = await compatibilityContext.processImageFile(file);
          if (dataUrl) {
            await compatibilityContext.whiteboardManager.addImageFromDataUrl(dataUrl);
            compatibilityContext.showToast('🖼️ Imagem colada na lousa!', 'success');
          }
        } catch (err) {
          console.error('Erro ao colar imagem na lousa:', err);
          compatibilityContext.showToast('Erro ao processar imagem colada.', 'error');
        }
      }
    }
  });

  // Atalhos de Teclado
  window.addEventListener('keydown', (e) => {
    if (modal.style.display !== 'flex') return;
    if (e.target && (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA')) return;

    if (e.key === 'Escape') {
      closeWhiteboard();
      return;
    }

    // Excluir elemento selecionado (Delete ou Backspace)
    if (e.key === 'Delete' || e.key === 'Backspace') {
      if (compatibilityContext.whiteboardManager.selectedElementId) {
        e.preventDefault();
        compatibilityContext.whiteboardManager.deleteSelected();
        compatibilityContext.showToast('🗑️ Objeto removido da lousa', 'info', 1500);
        return;
      }
    }

    if ((e.ctrlKey || e.metaKey) && (e.key === 'z' || e.key === 'Z')) {
      e.preventDefault();
      if (e.shiftKey) {
        if (compatibilityContext.whiteboardManager.redo()) compatibilityContext.broadcastDataMessage({ type: 'WHITEBOARD_SYNC', elements: compatibilityContext.whiteboardManager.elements });
      } else {
        if (compatibilityContext.whiteboardManager.undo()) compatibilityContext.broadcastDataMessage({ type: 'WHITEBOARD_SYNC', elements: compatibilityContext.whiteboardManager.elements });
      }
      return;
    }

    if ((e.ctrlKey || e.metaKey) && (e.key === 'y' || e.key === 'Y')) {
      e.preventDefault();
      if (compatibilityContext.whiteboardManager.redo()) compatibilityContext.broadcastDataMessage({ type: 'WHITEBOARD_SYNC', elements: compatibilityContext.whiteboardManager.elements });
      return;
    }

    const key = e.key.toLowerCase();
    if (key === 'i') {
      e.preventDefault();
      const imgInput = document.getElementById('wb-image-input');
      if (imgInput) imgInput.click();
      return;
    }

    const toolMap = {
      v: 'select',
      s: 'select',
      p: 'pencil',
      r: 'rectangle',
      d: 'diamond',
      c: 'circle',
      a: 'arrow',
      l: 'line',
      t: 'text',
      e: 'eraser'
    };
    if (toolMap[key]) {
      compatibilityContext.whiteboardManager.setTool(toolMap[key]);
      toolBtns.forEach(b => {
        b.classList.toggle('active', b.dataset.tool === toolMap[key]);
      });
    }
  });
}
