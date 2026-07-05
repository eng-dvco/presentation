'use strict';
/* ── Lista dinâmica de RDCs (slide-rdc-control) ──────────────────────────────
   Abaixo do painel de controle, monta uma lista dos Relatórios Diários de Campo
   (RDCs) a partir da seção 'documentos recebidos' do index.html — a MESMA fonte
   de verdade usada pelo banner (scripts/slide-banner.js) e pela navegação
   (scripts/slide-nav.js). Segue o mesmo idioma: fetch('../slides/index.html')
   sobre http(s), DOMParser, e catch silencioso em caso de falha (ex.: file://,
   onde o fetch é bloqueado → a lista fica vazia, sem erro).

   Cada cartão REUSA a FORMATAÇÃO do banner de RDC (.post-link): moldura chanfrada
   tracejada + preenchimento translúcido (SVG desenhado por window.__postLinkDraw,
   exposto por slide-banner.js) e faixa de título azul-escura (.post-link-title).
   Diferença: aqui o CARTÃO INTEIRO é o link e leva ao SLIDE associado (não ao
   documento), e o corpo mostra a descrição por inteiro (sem o clamp/exibir-mais).

   Para cada <li id^="doc-"> em index.html (os RDCs, com código+descrição+slide):
     • .doc-name-text → código do RDC (faixa de título .post-link-title)
     • .doc-desc-row  → descrição breve ("Assunto: …")  (corpo <p>)
     • .doc-goto (<a href="../slides/slide-XXX.html">) → slide associado */
(function rdcControlList() {
  var container = document.querySelector('.rdc-list');
  if (!container) return;

  var cards = [];
  function drawAll() {
    if (!window.__postLinkDraw) return;
    cards.forEach(function (c) { window.__postLinkDraw(c); });
  }

  fetch('../slides/index.html')
    .then(function (r) { return r.text(); })
    .then(function (html) {
      var doc = new DOMParser().parseFromString(html, 'text/html');
      // apenas os RDCs: <li> cujo id começa com "doc-" (as fichas/planilhas sem
      // id ficam de fora). Na ordem em que aparecem no index.html.
      var items = doc.querySelectorAll('li[id^="doc-"]');
      if (!items.length) return;

      var frag = document.createDocumentFragment();
      items.forEach(function (li) {
        var goto = li.querySelector('.doc-goto');
        var href = goto && goto.getAttribute('href');
        if (!href) return; // sem slide associado → não entra na lista de navegação

        var codeEl = li.querySelector('.doc-name-text');
        var descEl = li.querySelector('.doc-desc-row');
        var code = codeEl ? codeEl.textContent.trim() : li.id.replace(/^doc-/, '');
        var desc = descEl ? descEl.textContent.trim() : '';

        var cell = document.createElement('li');
        cell.className = 'rdc-item';

        // o cartão INTEIRO é o link (leva ao slide); veste a formatação do banner
        var card = document.createElement('a');
        card.className = 'rdc-card post-link';
        card.href = href;
        card.setAttribute('aria-label', 'Abrir slide do RDC ' + code);

        var title = document.createElement('span');
        title.className = 'post-link-title';
        title.textContent = code;
        card.appendChild(title);

        if (desc) {
          var p = document.createElement('p');
          p.textContent = desc;
          card.appendChild(p);
        }

        // indicação explícita de que o clique redireciona ao slide, com a MESMA
        // formatação do botão "exibir mais/menos" do banner (.post-link-toggle):
        // tab azul-escura chanfrada no canto inferior-direito, p/ consistência.
        var go = document.createElement('span');
        go.className = 'rdc-card-go post-link-toggle';
        go.textContent = 'ir para o slide';
        card.appendChild(go);

        cell.appendChild(card);
        cards.push(card);
        frag.appendChild(cell);
      });

      container.appendChild(frag);

      // desenha a moldura SVG chanfrada após o layout (dimensões prontas) e ao
      // (re)carregar as fontes; redesenha quando cada cartão muda de tamanho.
      requestAnimationFrame(drawAll);
      if (document.fonts && document.fonts.ready) document.fonts.ready.then(drawAll);
      if ('ResizeObserver' in window) {
        cards.forEach(function (c) {
          new ResizeObserver(function () {
            if (window.__postLinkDraw) window.__postLinkDraw(c);
          }).observe(c);
        });
      }
    })
    .catch(function () {
      // fetch indisponível (offline / protocolo file://) — lista fica vazia,
      // sem qualquer erro visível ao usuário.
    });

  window.addEventListener('resize', drawAll);
})();
