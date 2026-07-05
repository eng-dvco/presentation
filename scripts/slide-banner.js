'use strict';
/* ── Banner de vínculo documento↔slide (.post-link) ──────────────────────────
   Desenha o preenchimento (azul translúcido) e a BORDA TRACEJADA CHANFRADA do
   banner através de um SVG dimensionado em pixels exatos: o chanfro fica a 45°
   em qualquer largura e o tracejado segue TODAS as bordas, inclusive as duas
   chanfradas (superior-esquerda e inferior-direita). Recalcula no resize.
   A coloração (fill/stroke) vem do CSS (.post-link em slide-style.css). */
(function postLinkBanner() {
  var NS = 'http://www.w3.org/2000/svg';
  var CHAMFER = 10;   // px do corte a 45°
  var STROKE = 1.5;   // espessura do traço (igual ao stroke-width do CSS)
  var INSET = STROKE / 2; // recua o caminho meia-espessura p/ dentro do viewBox: assim
                          // NENHUMA borda é cortada pelo overflow do SVG e TODAS — retas
                          // e chanfradas (sup-esq / inf-dir) — ficam com a MESMA espessura
                          // (1.5px). Sem o recuo, as retas (sobre a moldura do viewBox)
                          // perdiam metade do traço e ficavam ~½ das chanfradas.

  function layer(a, cls) {
    var svg = a.querySelector(':scope > svg.' + cls);
    if (!svg) {
      svg = document.createElementNS(NS, 'svg');
      svg.setAttribute('class', cls);
      svg.setAttribute('aria-hidden', 'true');
      svg.setAttribute('preserveAspectRatio', 'none');
      svg.appendChild(document.createElementNS(NS, 'path'));
      a.insertBefore(svg, a.firstChild);
    }
    return svg;
  }

  /* DUAS camadas SVG sobrepostas para que o título (faixa azul-escura que vai de
     borda a borda, inclusive no chanfro) NÃO cubra a borda nem seja tingido pelo
     preenchimento:
       • post-link-fill  (z-index 0, ATRÁS): só o preenchimento azul translúcido,
         no chanfro da borda da caixa (preenche até as arestas).
       • post-link-edge  (z-index 2, NA FRENTE do título): só o traço tracejado
         chanfrado, recuado meia-espessura p/ ficar uniforme (retas = chanfros). */
  function draw(a) {
    var fillSvg = layer(a, 'post-link-fill');
    var edgeSvg = layer(a, 'post-link-edge');
    var w = a.clientWidth, h = a.clientHeight, c = CHAMFER, s = INSET;
    if (!w || !h) return;
    if (c * 2 > w) c = w / 2;
    if (c * 2 > h) c = h / 2;
    var vb = '0 0 ' + w + ' ' + h;
    var fillD =
      'M ' + c + ' 0 L ' + w + ' 0 L ' + w + ' ' + (h - c) +
      ' L ' + (w - c) + ' ' + h + ' L 0 ' + h + ' L 0 ' + c + ' Z';
    var edgeD =
      'M ' + (s + c) + ' ' + s +
      ' L ' + (w - s) + ' ' + s +
      ' L ' + (w - s) + ' ' + (h - s - c) +
      ' L ' + (w - s - c) + ' ' + (h - s) +
      ' L ' + s + ' ' + (h - s) +
      ' L ' + s + ' ' + (s + c) + ' Z';
    fillSvg.setAttribute('viewBox', vb); fillSvg.firstChild.setAttribute('d', fillD);
    edgeSvg.setAttribute('viewBox', vb); edgeSvg.firstChild.setAttribute('d', edgeD);
  }

  /* Exposto p/ REUSO: outras telas (ex.: a lista de RDCs em slide-rdc-control.js)
     desenham a MESMA moldura chanfrada tracejada + preenchimento em elementos
     .post-link criados dinamicamente, sem a lógica de fetch/título/clampToggle
     específica do banner. Fica antes do early-return abaixo (que sai quando a
     página não tem banners próprios), garantindo a exposição em qualquer slide. */
  window.__postLinkDraw = draw;

  /* exibir mais/menos: quando a descrição passa de 3 linhas (clamp do CSS), um
     botão no canto inferior direito expande/colapsa o texto. O botão é IRMÃO do
     banner (.post-link), no .postscriptum-container, p/ se sobrepor à quina
     inferior-direita ancorado na caixa do container (e não no fluxo do texto). */
  function clampToggle(a) {
    var p = a.querySelector('p');
    var container = a.parentNode;
    if (!p || !container) return;
    var btn = container.querySelector(':scope > .post-link-toggle');
    if (a.classList.contains('is-expanded')) return; // expandido: mantém o botão
    if (p.scrollHeight - p.clientHeight <= 1) { if (btn) btn.remove(); a.classList.remove('has-more'); return; }
    a.classList.add('has-more'); // ativa o gradiente de continuidade (só quando há overflow)
    if (btn) return;
    btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'post-link-toggle';
    btn.textContent = 'exibir mais';
    btn.setAttribute('aria-expanded', 'false');
    btn.addEventListener('click', function (e) {
      e.preventDefault();
      e.stopPropagation();
      var expanded = a.classList.toggle('is-expanded');
      btn.textContent = expanded ? 'exibir menos' : 'exibir mais';
      btn.setAttribute('aria-expanded', expanded ? 'true' : 'false');
      draw(a); // a altura mudou → redesenha as bordas SVG
    });
    container.appendChild(btn);
  }

  function refresh(a) { draw(a); clampToggle(a); }

  var banners = document.querySelectorAll('.post-link');
  if (!banners.length) return;
  banners.forEach(function (a) {
    refresh(a);
    if ('ResizeObserver' in window) {
      new ResizeObserver(function () { refresh(a); }).observe(a);
    }
  });
  window.addEventListener('resize', function () { banners.forEach(refresh); });

  /* Título + descrição:
     - TÍTULO (.post-link-title) = nome do documento (código do RDC). É o ÚNICO
       elemento clicável do banner (um <a>); AO CLICAR leva ao CONTROLE GERAL de
       RDCs (slide-rdc-control.html, no próprio href), NÃO mais ao index.html. O
       restante do banner (.post-link) é uma <div> NÃO clicável.
     - O id do documento (doc-…) vem do atributo data-doc do título (não mais do
       href, que passou a ser a navegação p/ o controle geral); o código exibido é
       derivado desse id — disponível mesmo offline (file://).
     - CORPO (<p>) = descrição viva do documento em 'documentos recebidos'
       (a .doc-desc-row de index.html, fonte de verdade), SEM o prefixo
       "Documento relacionado: …". Sincronizado via fetch do index.html quando
       servido por http(s); em file:// o fetch é bloqueado e mantém-se o texto
       local (fallback). */
  banners.forEach(function (a) {
    var titleEl = a.querySelector('.post-link-title');
    // o id do doc vive em data-doc; o href do título é a navegação (controle geral)
    var id = titleEl ? decodeURIComponent(titleEl.getAttribute('data-doc') || '') : '';
    var p = a.querySelector('p');
    var code = id.replace(/^doc-/, '');
    if (titleEl && code && titleEl.textContent.trim() !== code) {
      titleEl.textContent = code;
      refresh(a);
    }
    if (!id || !p) return;
    fetch('index.html').then(function (r) { return r.text(); }).then(function (html) {
      var li = new DOMParser().parseFromString(html, 'text/html').getElementById(id);
      var src = li && li.querySelector('.doc-desc-row');
      if (!src) return;
      var next = src.textContent.trim();
      if (p.textContent !== next) {
        p.textContent = next;
        refresh(a);
      }
    }).catch(function () {});
  });
})();
