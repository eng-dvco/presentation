'use strict';
/* ── Banner de vínculo documento↔slide (.note-banner--rdc) ───────────────────
   O banner é o cartão do componente .note-banner (slide-style.css) e o PRÓPRIO
   elemento é um <a href>, então o clique e o redirecionamento (→ controle de RDCs)
   são NATIVOS: não há delegação de clique nem moldura desenhada em JS.

   Restam duas responsabilidades:
     • quebrar o CÓDIGO do documento em DUAS linhas — do início até "RDC" e, na
       segunda, o restante (ex.: "2026-03-23_1379-RDC" / "2817-60-08-013");
     • sincronizar a descrição viva de 'documentos recebidos' (a .doc-desc-row do
       index.html, FONTE DE VERDADE) no corpo do banner. Em file:// o fetch é
       bloqueado e o texto local do slide serve de fallback — por isso ele deve ser
       mantido idêntico à descrição do index.html.

   NB: o formato antigo (.post-link, com moldura chanfrada tracejada desenhada em SVG
   por __postLinkDraw, faixa de título e botão "exibir mais/menos") foi REMOVIDO — a
   lista de RDCs (slide-rdc-control.js) também passou a usar este mesmo componente. */
(function noteBannerRdc() {
  var banners = document.querySelectorAll('.note-banner--rdc[data-doc]');
  if (!banners.length) return;

  banners.forEach(function (a) {
    var id = decodeURIComponent(a.getAttribute('data-doc') || '');
    var code = id.replace(/^doc-/, '');

    var codeEl = a.querySelector('.note-banner-code');
    if (codeEl && code) {
      var m = code.match(/^(.*?RDC)[-_]?(.*)$/i);
      codeEl.textContent = '';
      [m ? m[1] : code, m ? m[2] : ''].forEach(function (line) {
        if (!line) return;
        var s = document.createElement('span');
        s.textContent = line;
        codeEl.appendChild(s);
      });
    }

    var p = a.querySelector('.note-banner-text');
    if (!id || !p) return;
    fetch('index.html').then(function (r) { return r.text(); }).then(function (html) {
      var li = new DOMParser().parseFromString(html, 'text/html').getElementById(id);
      var src = li && li.querySelector('.doc-desc-row');
      if (!src) return;
      var next = src.textContent.trim();
      if (p.textContent !== next) p.textContent = next;
    }).catch(function () {});
  });
})();
