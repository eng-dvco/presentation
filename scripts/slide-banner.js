'use strict';
/* ── Banner de vínculo documento↔slide (.post-link) ──────────────────────────
   Desenha o preenchimento (azul translúcido) e a BORDA TRACEJADA CHANFRADA do
   banner através de um SVG dimensionado em pixels exatos: o chanfro fica a 45°
   em qualquer largura e o tracejado segue TODAS as bordas, inclusive as duas
   chanfradas (superior-esquerda e inferior-direita). Recalcula no resize.
   A coloração (fill/stroke) vem do CSS (.post-link em slide-style.css). */
(function postLinkBanner() {
  var NS = 'http://www.w3.org/2000/svg';
  var CHAMFER = 20; // px do corte a 45°

  function draw(a) {
    var svg = a.querySelector(':scope > svg.post-link-edge');
    if (!svg) {
      svg = document.createElementNS(NS, 'svg');
      svg.setAttribute('class', 'post-link-edge');
      svg.setAttribute('aria-hidden', 'true');
      svg.setAttribute('preserveAspectRatio', 'none');
      svg.appendChild(document.createElementNS(NS, 'path'));
      a.insertBefore(svg, a.firstChild);
    }
    var w = a.clientWidth, h = a.clientHeight, c = CHAMFER;
    if (!w || !h) return;
    if (c * 2 > w) c = w / 2;
    if (c * 2 > h) c = h / 2;
    svg.setAttribute('viewBox', '0 0 ' + w + ' ' + h);
    svg.firstChild.setAttribute('d',
      'M ' + c + ' 0 L ' + w + ' 0 L ' + w + ' ' + (h - c) +
      ' L ' + (w - c) + ' ' + h + ' L 0 ' + h + ' L 0 ' + c + ' Z');
  }

  var banners = document.querySelectorAll('.post-link');
  if (!banners.length) return;
  banners.forEach(function (a) {
    draw(a);
    if ('ResizeObserver' in window) {
      new ResizeObserver(function () { draw(a); }).observe(a);
    }
  });
  window.addEventListener('resize', function () { banners.forEach(draw); });

  /* Vínculo automático: sincroniza a descrição do banner com a descrição viva
     do documento em 'documentos recebidos' (a .doc-desc-row de index.html, que
     é a fonte de verdade). Funciona quando a apresentação é servida via
     http(s); em file:// o fetch é bloqueado pelo navegador e mantém-se o texto
     local do banner (fallback — mantido em sincronia ao editar a descrição).
     O id do documento vem do próprio href do banner (#doc-…). */
  banners.forEach(function (a) {
    var url = (a.getAttribute('href') || '').split('#')[0];
    var id = decodeURIComponent((a.hash || '').replace(/^#/, ''));
    var p = a.querySelector('p');
    if (!url || !id || !p) return;
    fetch(url).then(function (r) { return r.text(); }).then(function (html) {
      var li = new DOMParser().parseFromString(html, 'text/html').getElementById(id);
      var src = li && li.querySelector('.doc-desc-row');
      if (!src) return;
      var next = 'Documento relacionado: ' + id.replace(/^doc-/, '') + '. ' + src.textContent.trim();
      if (p.textContent !== next) {
        p.textContent = next;
        draw(a);
      }
    }).catch(function () {});
  });
})();
