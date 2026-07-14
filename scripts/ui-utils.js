'use strict';
/* ─────────────────────────────────────────────────────────────────────────────
   ui-utils.js — helpers de UI reutilizáveis, expostos em window.UI.
   Fonte única para padrões antes duplicados entre slide-tl.js e os scripts de
   slides (cronograma de desligamentos, situação geral do PISF). As funções são
   AGNÓSTICAS de classe/seletor (parametrizadas) para que cada consumidor reuse a
   LÓGICA mantendo seus próprios nomes de classe CSS. Deve ser carregado com
   `defer` ANTES dos scripts que o consomem.
   ───────────────────────────────────────────────────────────────────────────── */
(function (global) {
  // normaliza removendo diacríticos (ã/á/à/â → a, ç → c…) e caixa — para busca
  function foldAccents(s) {
    return (s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
  }

  function reducedMotion() {
    return global.matchMedia && global.matchMedia('(prefers-reduced-motion: reduce)').matches;
  }

  // ── fade de rolagem nas duas bordas de um scroller horizontal ──
  // Envolve `scroller` num wrapper `<prefix>` com duas bordas-gradiente e alterna
  // has-left/has-right conforme a posição. prefix permite reusar o CSS existente
  // (.tl-scrollfade) ou o componente compartilhado (.scrollfade). Guarda um
  // _uiCleanup no wrapper p/ remover listeners ao reconstruir o conteúdo.
  function addScrollFade(scroller, prefix) {
    prefix = prefix || 'scrollfade';
    if (!scroller || scroller.dataset.fadeInit) return null;
    scroller.dataset.fadeInit = '1';
    var w = document.createElement('div');
    w.className = prefix;
    scroller.parentNode.insertBefore(w, scroller);
    w.appendChild(scroller);
    ['left', 'right'].forEach(function (side) {
      var d = document.createElement('div');
      d.className = prefix + '-edge ' + prefix + '-' + side;
      d.setAttribute('aria-hidden', 'true');
      w.appendChild(d);
    });
    var upd = function () {
      var max = scroller.scrollWidth - scroller.clientWidth;
      w.classList.toggle('has-left', scroller.scrollLeft > 1);
      w.classList.toggle('has-right', scroller.scrollLeft < max - 1);
    };
    scroller.addEventListener('scroll', upd, { passive: true });
    global.addEventListener('resize', upd);
    var ro = ('ResizeObserver' in global) ? new ResizeObserver(upd) : null;
    if (ro) ro.observe(scroller);
    w._uiCleanup = function () { global.removeEventListener('resize', upd); if (ro) ro.disconnect(); };
    // upd() lê scrollWidth/clientWidth — que ainda não estão assentados no instante em que o
    // wrapper acabou de ser inserido. Chamado só aqui, ele às vezes concluía que não há
    // transbordo e o degradê da borda NÃO aparecia até um resize (bug real, reproduzido no
    // Gantt de desligamentos). Medir também no próximo frame, com o layout pronto, resolve.
    upd();
    (global.requestAnimationFrame || setTimeout)(upd);
    return w;
  }

  // ── tooltip portado para o <body> (escapa overflow/transform), posicionado por
  // position:fixed com clamp no viewport. Agnóstico de classe: recebe o gatilho e
  // o balão (já criados pelo chamador). Esconde ao rolar (listener global único). ──
  var _scrollHideWired = false;
  function attachTip(trigger, tip) {
    if (!trigger || !tip) return null;
    document.body.appendChild(tip);
    function place() {
      tip.style.display = 'block';
      var r = trigger.getBoundingClientRect(), tw = tip.offsetWidth, th = tip.offsetHeight, m = 8;
      var left = Math.max(m, Math.min(r.left + r.width / 2 - tw / 2, global.innerWidth - tw - m));
      var top = r.bottom + 6;
      if (top + th > global.innerHeight - m) top = r.top - th - 6;
      tip.style.left = left + 'px';
      tip.style.top = Math.max(m, top) + 'px';
    }
    function hide() { tip.style.display = 'none'; }
    trigger.addEventListener('mouseenter', place);
    trigger.addEventListener('focus', place);
    trigger.addEventListener('mouseleave', hide);
    trigger.addEventListener('blur', hide);
    if (!_scrollHideWired) {
      _scrollHideWired = true;
      global.addEventListener('scroll', function () {
        var all = document.querySelectorAll('[data-ui-tip="1"]');
        for (var i = 0; i < all.length; i++) all[i].style.display = 'none';
      }, true);
    }
    tip.setAttribute('data-ui-tip', '1');
    return { place: place, hide: hide };
  }

  // ── placeholder "máquina de escrever": cicla `values` enquanto o campo está
  // INATIVO (vazio + sem foco). É só visual (altera placeholder, nunca value).
  // Respeita prefers-reduced-motion. opts: { startDelay, activePlaceholder, reducedTo }. ──
  function typewriterPlaceholder(input, values, opts) {
    if (!input || !values || !values.length) return;
    opts = opts || {};
    if (reducedMotion()) { input.placeholder = (opts.reducedTo != null) ? opts.reducedTo : values[0]; return; }
    var TYPE = 95, ERASE = 45, HOLD = 1400, GAP = 480, POLL = 350;
    var active = (opts.activePlaceholder != null) ? opts.activePlaceholder : '';
    var ci = 0, pos = 0, typing = true;
    function step() {
      if (input.value !== '' || document.activeElement === input) {
        if (document.activeElement === input) input.placeholder = active;
        typing = true; pos = 0; setTimeout(step, POLL); return;
      }
      var v = values[ci];
      if (typing) {
        input.placeholder = v.slice(0, ++pos);
        if (pos >= v.length) { typing = false; setTimeout(step, HOLD); } else setTimeout(step, TYPE);
      } else {
        input.placeholder = v.slice(0, --pos);
        if (pos <= 0) { typing = true; ci = (ci + 1) % values.length; setTimeout(step, GAP); } else setTimeout(step, ERASE);
      }
    }
    setTimeout(step, opts.startDelay || 500);
  }

  // ── zebra pela ordem VISÍVEL (não :nth-child): aplica oddCls/evenCls em sequência
  // sobre os elementos passados, garantindo que vizinhos nunca repitam a cor. ──
  function stripeByOrder(elements, oddCls, evenCls) {
    oddCls = oddCls || 'is-row-odd'; evenCls = evenCls || 'is-row-even';
    for (var i = 0; i < elements.length; i++) {
      var el = elements[i], odd = i % 2 === 0;
      el.classList.toggle(oddCls, odd);
      el.classList.toggle(evenCls, !odd);
    }
  }

  global.UI = {
    foldAccents: foldAccents,
    reducedMotion: reducedMotion,
    addScrollFade: addScrollFade,
    attachTip: attachTip,
    typewriterPlaceholder: typewriterPlaceholder,
    stripeByOrder: stripeByOrder
  };
})(window);
