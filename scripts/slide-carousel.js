'use strict';
/* ── Carrossel inline (imagem principal + tira vertical de miniaturas) ─────────
   Construído a partir de uma .mosaic-container.is-carousel: seus blocos .img
   permanecem no DOM (ocultos via CSS) p/ alimentar o lightbox global (mosaicImages,
   em slide-nav.js) — clicar na imagem principal abre o lightbox em tela cheia
   (via window.__openImgLightbox, exposto por slide-nav.js). A UI visível é gerada
   aqui replicando o lightbox: auto-avanço (10s) com barra de progresso na
   miniatura ativa; pausa ao pairar o cursor (ícone de pausa) e retomada com flash
   do ícone de play; troca pela miniatura (com rolagem até a ativa); legenda (obs)
   colorida; e tooltip de observação (título do grupo com marquee + obs) no hover.
   Reusa primitivas visuais do lightbox (.thumb-tooltip etc.) de slide-style.css. */
(function inlineCarousels() {
  var carousels = document.querySelectorAll('.mosaic-container.is-carousel');
  if (!carousels.length) return;

  var reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  var DURATION = 10000;

  // tooltip compartilhada entre todas as miniaturas (mesmo visual do lightbox)
  var tip = null;
  function ensureTip() {
    if (tip) return tip;
    tip = document.createElement('div');
    tip.className = 'thumb-tooltip';
    document.body.appendChild(tip);
    return tip;
  }
  function clampTipIntoView() {
    var margin = 8;
    tip.style.transform = 'translateX(-50%)';
    var r = tip.getBoundingClientRect();
    var shift = 0;
    if (r.left < margin) shift = margin - r.left;
    else if (r.right > window.innerWidth - margin) shift = (window.innerWidth - margin) - r.right;
    tip.style.transform = shift ? 'translateX(-50%) translateX(' + shift + 'px)' : 'translateX(-50%)';
  }

  carousels.forEach(function (root) {
    var blocks = Array.from(root.querySelectorAll(':scope > .img'));

    // título do grupo (h2/h3 que precede a .mosaic-container) — igual ao lightbox
    var groupTitle = '';
    var prev = root.previousElementSibling;
    while (prev) {
      if (prev.classList.contains('title-header-h2') || prev.classList.contains('title-header-h3')) {
        groupTitle = (prev.querySelector('h2, h3') || prev).textContent.trim();
        break;
      }
      prev = prev.previousElementSibling;
    }

    var items = blocks.map(function (b) {
      var im = b.querySelector('img');
      var obsEl = b.querySelector('.obs');
      var obs = (obsEl && !obsEl.classList.contains('invisible')) ? obsEl.textContent.trim() : '';
      var obsStatus = obsEl && obsEl.classList.contains('obs-done') ? 'done'
                    : (obsEl && obsEl.classList.contains('obs-pending')) ? 'pending' : '';
      return { img: im, obs: obs, obsStatus: obsStatus };
    }).filter(function (it) { return it.img; });
    if (!items.length) return;

    // ── palco (imagem principal + legenda) ──
    var stage = document.createElement('div');
    stage.className = 'carousel-stage';
    var main = document.createElement('img');
    main.className = 'carousel-img';
    main.setAttribute('role', 'button');
    main.setAttribute('tabindex', '0');
    main.setAttribute('aria-label', 'Ampliar imagem em tela cheia');
    var caption = document.createElement('p');
    caption.className = 'carousel-caption';
    stage.appendChild(main);
    stage.appendChild(caption);

    // ── tira de miniaturas ──
    var thumbsBar = document.createElement('div');
    thumbsBar.className = 'carousel-thumbs';
    thumbsBar.setAttribute('aria-label', 'Miniaturas');

    var cur = 0, timer = null, startAt = 0, remaining = DURATION, hovering = false;

    function clearTimer() { if (timer !== null) { clearInterval(timer); timer = null; } }

    function startProgress() {
      if (items.length <= 1 || hovering || reduced) return;
      clearTimer();
      startAt = Date.now() - (DURATION - remaining);
      timer = setInterval(function () {
        var pct = Math.min((Date.now() - startAt) / DURATION, 1);
        items.forEach(function (it, i) { it.progress.style.width = (i === cur ? pct * 100 : 0) + '%'; });
        if (pct >= 1) { clearTimer(); show((cur + 1) % items.length); }
      }, 50);
    }

    function resetProgress() {
      clearTimer();
      remaining = DURATION;
      items.forEach(function (it) { it.progress.style.width = '0%'; });
      startProgress();
    }

    function flashPlay() {
      if (items.length <= 1 || reduced) return;
      var ic = items[cur].playIcon;
      if (ic) { ic.classList.remove('is-playing'); void ic.offsetWidth; ic.classList.add('is-playing'); }
    }

    // rola SOMENTE o contêiner de miniaturas (nunca a página) até a ativa — o
    // carrossel é inline (ao contrário do lightbox, que é um overlay fixo), então
    // scrollIntoView arrastaria a viewport inteira durante o auto-avanço.
    function scrollActiveIntoThumbs(wrap) {
      if (!thumbsBar.isConnected) return;
      var cr = thumbsBar.getBoundingClientRect();
      var wr = wrap.getBoundingClientRect();
      var behavior = reduced ? 'auto' : 'smooth';
      if (thumbsBar.scrollHeight > thumbsBar.clientHeight + 1) {
        thumbsBar.scrollBy({ top: (wr.top - cr.top) - (thumbsBar.clientHeight - wr.height) / 2, behavior: behavior });
      } else if (thumbsBar.scrollWidth > thumbsBar.clientWidth + 1) {
        thumbsBar.scrollBy({ left: (wr.left - cr.left) - (thumbsBar.clientWidth - wr.width) / 2, behavior: behavior });
      }
    }

    function show(idx) {
      cur = (idx + items.length) % items.length;
      var it = items[cur];
      main.src = it.img.getAttribute('src');
      main.alt = it.img.getAttribute('alt') || '';
      caption.textContent = it.obs || 'nenhuma observação foi fornecida para esta imagem';
      caption.classList.toggle('carousel-caption--empty', !it.obs);
      caption.classList.toggle('carousel-caption--done', !!it.obs && it.obsStatus === 'done');
      caption.classList.toggle('carousel-caption--pending', !!it.obs && it.obsStatus === 'pending');
      items.forEach(function (t, i) { t.thumb.classList.toggle('active', i === cur); });
      scrollActiveIntoThumbs(it.wrap);
      resetProgress();
    }

    items.forEach(function (it, i) {
      var wrap = document.createElement('div');
      wrap.className = 'carousel-thumb-wrap';

      var btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'carousel-thumb';
      btn.setAttribute('aria-label', it.img.getAttribute('alt') || ('Imagem ' + (i + 1)));
      var timg = document.createElement('img');
      timg.src = it.img.getAttribute('src');
      timg.alt = '';
      btn.appendChild(timg);
      var pauseIcon = document.createElement('span');
      pauseIcon.className = 'carousel-thumb-pause';
      pauseIcon.setAttribute('aria-hidden', 'true');
      btn.appendChild(pauseIcon);
      var playIcon = document.createElement('span');
      playIcon.className = 'carousel-thumb-play';
      playIcon.setAttribute('aria-hidden', 'true');
      btn.appendChild(playIcon);
      btn.addEventListener('click', function () { show(i); });

      var bar = document.createElement('span');
      bar.className = 'carousel-thumb-progress';

      // tooltip (título do grupo com marquee + observação) ao pairar
      if (groupTitle || it.obs) {
        wrap.addEventListener('mouseenter', function () {
          var t = ensureTip();
          if (t._titleAnim) { t._titleAnim.cancel(); t._titleAnim = null; }
          t.innerHTML = '';
          if (groupTitle) {
            var titleEl = document.createElement('span');
            titleEl.className = 'thumb-tooltip-title';
            var track = document.createElement('span');
            track.className = 'tooltip-title-track';
            var text = document.createElement('span');
            text.className = 'tooltip-title-text';
            text.textContent = groupTitle;
            track.appendChild(text);
            titleEl.appendChild(track);
            t.appendChild(titleEl);
          }
          if (it.obs) {
            var s = document.createElement('span');
            s.className = 'thumb-tooltip-obs' + (it.obsStatus ? ' obs-' + it.obsStatus : '');
            s.textContent = it.obs;
            t.appendChild(s);
          }
          var rect = btn.getBoundingClientRect();
          t.style.left = (rect.left + rect.width / 2) + 'px';
          t.style.bottom = (window.innerHeight - rect.top + 8) + 'px';
          t.classList.add('is-visible');
          clampTipIntoView();
          if (groupTitle && !reduced) {
            requestAnimationFrame(function () {
              var container = t.querySelector('.thumb-tooltip-title');
              var track = t.querySelector('.tooltip-title-track');
              var text = t.querySelector('.tooltip-title-text');
              if (!container || !track || !text) return;
              var old = track.querySelector('.tooltip-title-clone');
              if (old) old.remove();
              if (text.scrollWidth - container.clientWidth <= 1) return;
              var clone = text.cloneNode(true);
              clone.className = 'tooltip-title-clone';
              clone.setAttribute('aria-hidden', 'true');
              track.appendChild(clone);
              var shift = clone.getBoundingClientRect().left - text.getBoundingClientRect().left;
              var totalMs = (shift / 45 + 3) * 1000;
              if (t._titleAnim) { t._titleAnim.cancel(); }
              t._titleAnim = track.animate(
                [
                  { transform: 'translateX(0)', offset: 0 },
                  { transform: 'translateX(0)', offset: 3000 / totalMs },
                  { transform: 'translateX(' + (-shift) + 'px)', offset: 1 },
                ],
                { duration: totalMs, iterations: Infinity, easing: 'linear' }
              );
            });
          }
        });
        wrap.addEventListener('mouseleave', function () {
          if (tip) {
            if (tip._titleAnim) { tip._titleAnim.cancel(); tip._titleAnim = null; }
            tip.classList.remove('is-visible');
          }
        });
      }

      // barra DENTRO do botão (não mais abaixo dele): o overflow:hidden +
      // border-radius da miniatura a recortam, contendo-a nas bordas arredondadas.
      btn.appendChild(bar);
      wrap.appendChild(btn);
      thumbsBar.appendChild(wrap);

      it.thumb = btn;
      it.progress = bar;
      it.playIcon = playIcon;
      it.wrap = wrap;
    });

    // pausa ao pairar (palco ou miniaturas), retoma ao sair (igual ao lightbox)
    function pause() {
      hovering = true;
      if (timer !== null) { remaining = DURATION - (Date.now() - startAt); clearTimer(); }
    }
    function resume() { hovering = false; startProgress(); flashPlay(); }
    stage.addEventListener('mouseenter', pause);
    stage.addEventListener('mouseleave', resume);
    thumbsBar.addEventListener('mouseenter', pause);
    thumbsBar.addEventListener('mouseleave', resume);

    // clicar (ou Enter/Espaço) na imagem principal abre o lightbox em tela cheia
    function openZoom() {
      if (typeof window.__openImgLightbox === 'function') window.__openImgLightbox(items[cur].img);
    }
    main.addEventListener('click', openZoom);
    main.addEventListener('keydown', function (e) {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openZoom(); }
    });

    root.appendChild(stage);
    if (items.length > 1) {
      // envolve a tira num wrapper p/ o fade de rolagem topo/fundo, no mesmo
      // molde das tabelas/cronogramas (.scrollfade): duas bordas-gradiente
      // absolutas, alternadas por has-top/has-bottom conforme a rolagem vertical.
      var fade = document.createElement('div');
      fade.className = 'carousel-thumbs-fade';
      fade.appendChild(thumbsBar);
      // 4 bordas: vertical (topo/fundo, layout desktop) e horizontal (esquerda/
      // direita, layout mobile). updFade liga apenas as do eixo que realmente rola
      // — o outro eixo não tem overflow (scrollTop/scrollLeft fixos em 0), então
      // suas classes nunca ativam. Espelha o has-left/right do .scrollfade das tabelas.
      ['top', 'bottom', 'left', 'right'].forEach(function (side) {
        var edge = document.createElement('div');
        edge.className = 'carousel-thumbs-edge carousel-thumbs-' + side;
        edge.setAttribute('aria-hidden', 'true');
        fade.appendChild(edge);
      });
      root.appendChild(fade);

      var updFade = function () {
        var maxX = thumbsBar.scrollWidth - thumbsBar.clientWidth;
        var maxY = thumbsBar.scrollHeight - thumbsBar.clientHeight;
        var sx = thumbsBar.scrollLeft, sy = thumbsBar.scrollTop;
        fade.classList.toggle('has-top', sy > 1);
        fade.classList.toggle('has-bottom', maxY > 1 && sy < maxY - 1);
        fade.classList.toggle('has-left', sx > 1);
        fade.classList.toggle('has-right', maxX > 1 && sx < maxX - 1);
      };
      thumbsBar.addEventListener('scroll', updFade, { passive: true });
      window.addEventListener('resize', updFade);
      if ('ResizeObserver' in window) new ResizeObserver(updFade).observe(thumbsBar);
      thumbsBar._updFade = updFade;
    }
    show(0);
    if (thumbsBar._updFade) thumbsBar._updFade();
  });
})();
