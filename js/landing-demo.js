// A bounded, illustrative sequence. Never opens a room or requests media.
const demo = document.querySelector('.smg-demo');
if (demo) {
  const choices = [...demo.querySelectorAll('[data-demo-choice]')];
  const motion = demo.querySelector('#demo-motion');
  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
  const steps = [
    ['Ana entrou na sala', 'A aventura já tem companhia.', 'Na sala'],
    ['Sua partida está na tela', 'Todo mundo acompanhando, junto.', 'Assistindo'],
    ['Ana está no controle', 'Player 2 liberado por você.', 'Player 2'],
  ];
  let current = 0;
  let paused = reducedMotion.matches;
  let visible = false;
  let timer;

  function render(index) {
    current = index;
    demo.dataset.demoStep = String(index);
    demo.querySelector('#demo-toast-title').textContent = steps[index][0];
    demo.querySelector('#demo-toast-copy').textContent = steps[index][1];
    demo.querySelector('#demo-person-status').textContent = steps[index][2];
    choices.forEach((button, i) => button.setAttribute('aria-pressed', String(i === index)));
  }

  function schedule() {
    clearTimeout(timer);
    const running = !paused && visible && !document.hidden && !reducedMotion.matches;
    demo.classList.toggle('is-animating', running);
    motion.setAttribute('aria-pressed', String(paused || reducedMotion.matches));
    motion.setAttribute('aria-label', paused ? 'Reproduzir demonstração' : 'Pausar demonstração');
    motion.textContent = paused ? '▶' : 'Ⅱ';
    motion.hidden = reducedMotion.matches;
    if (running) timer = setTimeout(() => {
      if (current === steps.length - 1) paused = true;
      else render(current + 1);
      schedule();
    }, 3500);
  }

  choices.forEach((button, i) => button.addEventListener('click', () => {
    paused = true;
    render(i);
    schedule();
  }));
  motion.addEventListener('click', () => {
    paused = !paused;
    if (!paused && current === steps.length - 1) render(0);
    schedule();
  });
  document.addEventListener('visibilitychange', schedule);
  reducedMotion.addEventListener('change', () => {
    paused = reducedMotion.matches;
    schedule();
  });
  const observer = new IntersectionObserver(([entry]) => {
    visible = entry.isIntersecting;
    schedule();
  }, { threshold: 0.25 });
  observer.observe(demo);
  schedule();
}
