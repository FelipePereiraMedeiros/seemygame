/** toasts: commands receive explicit compatibility ports; no page initialization. */
export function showToast(compatibilityContext, message, type = 'info', duration = 4000) {
  const container = document.getElementById('toast-container');
  if (!container) return;

  const msgText = String(message);

  // Previne flood de toasts idênticos consecutivos visíveis na tela
  const existingToasts = container.querySelectorAll('.toast');
  for (const existing of existingToasts) {
    if (existing.querySelector('span')?.textContent === msgText) {
      return;
    }
  }

  // Limite máximo de toasts empilhados simultaneamente (descarta os mais antigos para evitar flood)
  const MAX_VISIBLE_TOASTS = 4;
  if (existingToasts.length >= MAX_VISIBLE_TOASTS) {
    for (let i = 0; i <= existingToasts.length - MAX_VISIBLE_TOASTS; i++) {
      existingToasts[i].remove();
    }
  }

  const toast = document.createElement('div');
  toast.className = `toast toast-${type}`;

  const icons = {
    success: '✓',
    info: 'ℹ',
    error: '⚠'
  };

  const iconStrong = document.createElement('strong');
  iconStrong.textContent = icons[type] || '•';

  const msgSpan = document.createElement('span');
  msgSpan.textContent = msgText;

  toast.appendChild(iconStrong);
  toast.appendChild(document.createTextNode(' '));
  toast.appendChild(msgSpan);
  container.appendChild(toast);

  setTimeout(() => {
    toast.style.opacity = '0';
    toast.style.transform = 'translateX(100%)';
    toast.style.transition = 'all 0.3s ease';
    setTimeout(() => {
      toast.remove();
    }, 300);
  }, duration);
}
