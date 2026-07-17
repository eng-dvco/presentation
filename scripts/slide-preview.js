'use strict';

/* Pré-visualização flutuante do slide ao pairar um item do índice (index.html).
   - Só liga em ponteiros finos (mouse/trackpad) e viewports largas (≥1024px);
     em toque/telas pequenas não cria painel nem listeners.
   - Um ÚNICO painel/iframe é reaproveitado (nada de dezenas de iframes). O iframe
     é criado/carregado sob demanda, após um curto atraso de intenção (~180ms).
   - O painel é posicionado com position:fixed junto ao cursor e depois
     CLAMPADO/VIRADO para nunca vazar da viewport (flip nas bordas direita/baixo,
     clamp com margem mínima em todas as bordas).
   IIFE p/ não colidir com o `const reducedMotion` de escopo global do
   slide-selection.js (dois scripts clássicos compartilham o léxico global). */
(() => {
  const enableMQ = window.matchMedia('(hover: hover) and (pointer: fine) and (min-width: 1024px)');
  const reducedMQ = window.matchMedia('(prefers-reduced-motion: reduce)');

  const HREF_RE = /slide-.+\.html(?:[?#].*)?$/i; // aceita só links de slide
  const INTENT_DELAY = 180; // ms de intenção antes de carregar/exibir
  const OFFSET = 18;        // afastamento do cursor
  const MARGIN = 12;        // folga mínima de cada borda da viewport
  const PAN_SPEED = 150;    // px/s (na tela) do auto-scroll da miniatura
  const PAN_HOLD = 500;     // ms de pausa no topo antes de começar a rolar

  let panel = null;
  let frame = null;
  let iframe = null;
  let enabled = false;

  let hoverTimer = null;
  let activeLink = null;
  let loadedHref = null;    // href atualmente carregado no iframe (evita recarga)
  let panAnim = null;       // animação (WAAPI) do auto-scroll vertical da miniatura
  let lastX = 0, lastY = 0;
  let pw = 0, ph = 0;       // dimensões do painel (constantes; medidas 1× no 1º show)

  function buildPanel() {
    if (panel) return;
    panel = document.createElement('div');
    panel.className = 'slide-preview';
    panel.setAttribute('aria-hidden', 'true');

    frame = document.createElement('div');
    frame.className = 'slide-preview__frame';

    iframe = document.createElement('iframe');
    iframe.className = 'slide-preview__iframe';
    iframe.setAttribute('tabindex', '-1');
    iframe.setAttribute('aria-hidden', 'true');
    iframe.setAttribute('scrolling', 'no');
    iframe.setAttribute('loading', 'lazy');
    iframe.setAttribute('title', 'Pré-visualização do slide');
    iframe.addEventListener('load', () => { if (frame) frame.classList.remove('is-loading'); startPan(); });

    frame.appendChild(iframe);
    panel.appendChild(frame);
    document.body.appendChild(panel);
  }

  /* Posiciona o painel junto ao ponto (x,y) da viewport e o mantém inteiro dentro
     dela: por padrão fica à direita/abaixo do cursor; se estouraria a borda
     direita/inferior, VIRA para o lado oposto; por fim, CLAMPA nos dois eixos com
     a margem mínima, garantindo que nunca fique clipado. */
  function place(x, y) {
    const w = pw || panel.offsetWidth;
    const h = ph || panel.offsetHeight;
    const vw = window.innerWidth;
    const vh = window.innerHeight;

    let left = x + OFFSET;
    if (left + w + MARGIN > vw) left = x - OFFSET - w;           // vira p/ a esquerda
    left = Math.max(MARGIN, Math.min(left, vw - w - MARGIN));    // clamp horizontal

    let top = y + OFFSET;
    if (top + h + MARGIN > vh) top = y - OFFSET - h;            // vira p/ cima
    top = Math.max(MARGIN, Math.min(top, vh - h - MARGIN));     // clamp vertical

    panel.style.left = `${left}px`;
    panel.style.top = `${top}px`;
  }

  function stopPan() {
    if (panAnim) { panAnim.cancel(); panAnim = null; }
  }

  /* auto-scroll da miniatura: pairar revela o slide INTEIRO. Mede a altura real do conteúdo
     (mesmo host → contentDocument acessível), amplia o iframe para renderizar tudo e faz um pan
     vertical de ida-e-volta (alternate) proporcional ao transbordo, com uma pausa no topo. */
  function startPan() {
    stopPan();
    if (reducedMQ.matches || !iframe || !activeLink) return;   // sem pan em movimento reduzido / fora de foco
    const medir = () => {
      const d = iframe.contentDocument;
      if (!d) return 0;
      return Math.max(
        d.documentElement ? d.documentElement.scrollHeight : 0,
        d.body ? d.body.scrollHeight : 0);
    };
    let contentH = 0;
    try {
      iframe.style.height = '';         // volta ao viewport-base p/ medir o CONTEÚDO, não o iframe já ampliado
      contentH = medir();
      if (!contentH) return;
      iframe.style.height = contentH + 'px';   // renderiza o slide inteiro, sem rolagem interna
      const cresceu = medir();          // alguns slides crescem quando o viewport cresce (min-height:100vh, flex)
      if (cresceu > contentH) { contentH = cresceu; iframe.style.height = contentH + 'px'; }
    } catch (e) { return; }   // cross-origin (não ocorre no mesmo host): fica no topo, estático
    const scale = parseFloat(getComputedStyle(panel).getPropertyValue('--pv-scale')) || 0.3125;
    const dist = Math.round(contentH * scale - frame.clientHeight);
    if (dist < 8) { iframe.style.height = ''; return; }   // slide curto (cabe na miniatura): nada a rolar
    const dur = Math.min(9000, Math.max(2600, (dist / PAN_SPEED) * 1000));
    panAnim = iframe.animate(
      [{ transform: 'translateY(0) scale(' + scale + ')' },
       { transform: 'translateY(' + (-dist) + 'px) scale(' + scale + ')' }],
      { duration: dur, delay: PAN_HOLD, easing: 'ease-in-out', direction: 'alternate', iterations: Infinity });
  }

  function show(link, x, y) {
    buildPanel();
    const href = link.href; // URL absoluta já resolvida
    if (href !== loadedHref) {
      loadedHref = href;
      frame.classList.add('is-loading');
      stopPan();
      iframe.src = href;   // o pan (re)inicia no evento load
    } else {
      startPan();          // já carregado: reinicia o pan do topo
    }
    // mede o painel 1× (tamanho é constante) para o clamp e evitar layout por move
    if (!pw || !ph) { pw = panel.offsetWidth; ph = panel.offsetHeight; }
    place(x, y);
    // força um frame antes de revelar p/ a transição de entrada disparar
    requestAnimationFrame(() => { if (panel) panel.classList.add('is-visible'); });
  }

  function hide() {
    if (hoverTimer) { clearTimeout(hoverTimer); hoverTimer = null; }
    activeLink = null;
    stopPan();
    if (panel) panel.classList.remove('is-visible');
  }

  function onEnter(e) {
    const link = e.currentTarget;
    activeLink = link;
    lastX = e.clientX; lastY = e.clientY;
    if (hoverTimer) clearTimeout(hoverTimer);
    hoverTimer = setTimeout(() => {
      if (activeLink === link) show(link, lastX, lastY);
    }, INTENT_DELAY);
  }

  function onMove(e) {
    lastX = e.clientX; lastY = e.clientY;
    if (panel && activeLink === e.currentTarget && panel.classList.contains('is-visible')) {
      place(lastX, lastY);
    }
  }

  function onLeave() {
    hide();
  }

  function slideLinks() {
    return Array.from(document.querySelectorAll('.selection-grid a.item[href]'))
      .filter(a => HREF_RE.test(a.getAttribute('href')) && !a.classList.contains('pending'));
  }

  function attach() {
    if (enabled) return;
    enabled = true;
    slideLinks().forEach(a => {
      a.addEventListener('mouseenter', onEnter);
      a.addEventListener('mousemove', onMove);
      a.addEventListener('mouseleave', onLeave);
    });
    // rolar a página some com a prévia (evita painel "preso" longe do item)
    window.addEventListener('scroll', hide, { passive: true });
  }

  function detach() {
    if (!enabled) return;
    enabled = false;
    hide();
    slideLinks().forEach(a => {
      a.removeEventListener('mouseenter', onEnter);
      a.removeEventListener('mousemove', onMove);
      a.removeEventListener('mouseleave', onLeave);
    });
    window.removeEventListener('scroll', hide);
    if (panel) { panel.remove(); panel = frame = iframe = null; }
    loadedHref = null; pw = ph = 0;
  }

  function sync() {
    if (enableMQ.matches) attach();
    else detach();
  }

  sync();
  // reavalia ao cruzar o limiar (redimensionar, trocar de dispositivo de entrada)
  if (enableMQ.addEventListener) enableMQ.addEventListener('change', sync);
  else if (enableMQ.addListener) enableMQ.addListener(sync);
})();
