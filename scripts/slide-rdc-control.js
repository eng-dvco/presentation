'use strict';
/* ── Lista dinâmica de RDCs (slide-rdc-control) ──────────────────────────────
   Abaixo do painel de controle, monta uma lista dos Relatórios Diários de Campo
   (RDCs) a partir da seção 'documentos recebidos' do index.html — a MESMA fonte
   de verdade usada pelos banners (scripts/slide-banner.js) e pela navegação
   (scripts/slide-nav.js). Segue o mesmo idioma: fetch('../slides/index.html')
   sobre http(s), DOMParser, e catch silencioso em caso de falha (ex.: file://,
   onde o fetch é bloqueado → a lista fica vazia, sem erro).

   Cada cartão usa o MESMO componente dos banners dos slides (.note-banner--rdc):
   mosaico + código em duas linhas + descrição. Assim a estética é a mesma em toda
   a apresentação — não há mais o formato antigo (.post-link, moldura chanfrada).
   A DIFERENÇA de sentido: aqui o cartão leva ao SLIDE associado (e não ao controle
   de RDCs), por isso ganha a chamada "ir para o slide" (.note-banner-goto).

   Para cada <li id^="doc-"> em index.html (os RDCs, com código+descrição+slide):
     • .doc-name-text → código do RDC (quebrado em duas linhas: …-RDC / restante)
     • .doc-desc-row  → descrição breve (corpo) — fonte de verdade, ≤70 caracteres
     • .doc-goto (<a href="../slides/slide-XXX.html">) → slide associado */
(function rdcControlList() {
  var container = document.querySelector('.rdc-list');
  if (!container) return;

  function span(cls, text) {
    var s = document.createElement('span');
    if (cls) s.className = cls;
    if (text) s.textContent = text;
    return s;
  }

  fetch('../slides/index.html')
    .then(function (r) { return r.text(); })
    .then(function (html) {
      var doc = new DOMParser().parseFromString(html, 'text/html');
      // apenas os RDCs: <li> com id "doc-" contendo "RDC" — mesmo critério de
      // scripts/slide-banner.js (outros documentos, como as Cartas, também têm
      // id para deep-link, mas não pertencem a esta lista). Na ordem do index.html.
      var items = Array.prototype.filter.call(
        doc.querySelectorAll('li[id^="doc-"]'),
        function (li) { return /RDC/i.test(li.id); }
      );
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

        // o cartão INTEIRO é o link (leva ao slide) — clique/redirect NATIVOS
        var card = document.createElement('a');
        card.className = 'note-banner note-banner--mosaic note-banner--rdc rdc-card';
        card.href = href;
        card.setAttribute('aria-label', 'Abrir slide do RDC ' + code);

        // espaço reservado: ícone de documentos + código em DUAS linhas (…-RDC / resto)
        var aside = document.createElement('div');
        aside.className = 'note-banner-aside';
        var tag = span('note-banner-tag');
        var ico = span('note-banner-icon'); ico.setAttribute('aria-hidden', 'true');
        var sep = span('note-banner-div'); sep.setAttribute('aria-hidden', 'true');
        var codeWrap = span('note-banner-code');
        var m = code.match(/^(.*?RDC)[-_]?(.*)$/i);
        [m ? m[1] : code, m ? m[2] : ''].forEach(function (line) {
          if (line) codeWrap.appendChild(span('', line));
        });
        tag.appendChild(ico); tag.appendChild(sep); tag.appendChild(codeWrap);
        aside.appendChild(tag);
        card.appendChild(aside);

        // corpo: descrição (fonte de verdade do index.html) + chamada de navegação
        var body = document.createElement('div');
        body.className = 'note-banner-body';
        var p = document.createElement('p');
        p.className = 'note-banner-text';
        p.textContent = desc;
        body.appendChild(p);
        body.appendChild(span('note-banner-goto', 'ir para o slide'));
        card.appendChild(body);

        cell.appendChild(card);
        frag.appendChild(cell);
      });

      container.appendChild(frag);
    })
    .catch(function () {
      // fetch indisponível (offline / protocolo file://) — lista fica vazia,
      // sem qualquer erro visível ao usuário.
    });
})();
