'use strict';
/* ── Cronograma de desligamentos das SEs ──────────────────────────────────────
   Widget interativo da "Linha do tempo" de slide-shutdown-timeline.html: busca
   textual, ordenação, detalhamento (completo = um registro por DIA / agrupado =
   um registro por subestação) e duas exibições — tabela e gráfico de Gantt.
   Helpers reutilizáveis (busca, scroll-fade, tooltip, máquina-de-escrever) vêm
   de window.UI (ui-utils.js, carregado antes deste arquivo); primitivas visuais
   (.seg/.search-pill/.status-dot/.scrollfade/.tip-bubble/.legend) de components.css.
   Status: 'programado' (laranja) ou 'forcado' (vermelho) para desligamentos;
   'energizado' (verde) para SEs sem desligamento (SE-N2/SE-N3). Marque s.forcado:
   true numa SE para classificá-la como desligamento forçado. */
(function sdtWidget() {
  var root = document.querySelector('.sdt');
  if (!root) return;
  var body = root.querySelector('.sdt-body');
  var searchInput = root.querySelector('#sdt-search');
  var countEl = root.querySelector('#sdt-count');

  var HORARIO = '07h–17h';
  var WD = ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sáb'];
  var EIXOS = [{ key: 'leste', label: 'Eixo Leste' }, { key: 'norte', label: 'Eixo Norte' }];
  var STATUS_LABEL = { programado: 'Desligamento programado', forcado: 'Desligamento forçado', energizado: 'Energizado' };

  // subestação → dias de desligamento (DD-MM-AA); lista vazia = sem desligamento.
  // s.forcado: true → desligamento forçado (vermelho); senão programado (laranja).
  var SE_DESL = [
    { eixo: 'leste', se: 'SE-E1', dias: ['11-05-26', '12-05-26', '13-05-26'] },
    { eixo: 'leste', se: 'SE-E2', dias: ['14-05-26', '15-05-26', '16-05-26'] },
    { eixo: 'leste', se: 'SE-E3', dias: ['18-05-26', '19-05-26', '20-05-26'] },
    { eixo: 'leste', se: 'SE-E4', dias: ['14-05-26', '15-05-26', '16-05-26'] },
    { eixo: 'leste', se: 'SE-E5', dias: ['11-05-26', '12-05-26', '13-05-26'] },
    { eixo: 'leste', se: 'SE-E6', dias: ['18-05-26', '19-05-26', '20-05-26'] },
    { eixo: 'leste', se: 'SE-E7', dias: ['18-05-26', '19-05-26', '20-05-26'] },
    { eixo: 'norte', se: 'SE-N1', dias: ['26-05-26', '27-05-26', '28-05-26'] },
    { eixo: 'norte', se: 'SE-N2', dias: [] },
    { eixo: 'norte', se: 'SE-N3', dias: [] }
  ];

  var state = { view: 'tabela', detail: 'completo', sortKey: 'se', sortDir: 1, query: '' };

  function parse(d) { var m = d && d.match(/(\d{2})-(\d{2})-(\d{2})/); return m ? new Date(2000 + +m[3], +m[2] - 1, +m[1]) : null; }
  function weekday(d) { var dt = parse(d); return dt ? WD[dt.getDay()] : ''; }
  function pad2(n) { return (n < 10 ? '0' : '') + n; }
  function statusOf(s) { return !s.dias.length ? 'energizado' : (s.forcado ? 'forcado' : 'programado'); }
  function el(tag, cls, txt) { var e = document.createElement(tag); if (cls) e.className = cls; if (txt != null) e.textContent = txt; return e; }

  // monta os registros (tabela) conforme o nível de detalhamento
  function buildRecords(detail) {
    var out = [];
    SE_DESL.forEach(function (s, si) {
      var st = statusOf(s);
      if (!s.dias.length) { out.push({ eixo: s.eixo, se: s.se, si: si, type: 'none', status: st, sortDate: Number.MAX_SAFE_INTEGER }); return; }
      if (detail === 'agrupado') {
        out.push({ eixo: s.eixo, se: s.se, si: si, type: 'win', status: st, ini: s.dias[0], fim: s.dias[s.dias.length - 1], n: s.dias.length, sortDate: parse(s.dias[0]).getTime() });
      } else {
        s.dias.forEach(function (d, di) {
          out.push({ eixo: s.eixo, se: s.se, si: si, type: 'day', status: st, date: d, di: di + 1, dtotal: s.dias.length, wd: weekday(d), sortDate: parse(d).getTime() });
        });
      }
    });
    out.forEach(function (r) { r.hay = UI.foldAccents([r.se, r.eixo, r.ini || '', r.fim || '', r.date || '', r.wd || ''].join(' ')); });
    return out;
  }

  function cmp(a, b) {
    var d;
    if (state.sortKey === 'se') d = (a.si - b.si) || (a.sortDate - b.sortDate);
    else d = (a.sortDate - b.sortDate) || (a.si - b.si);
    if (isNaN(d)) d = a.si - b.si; // empate (ex.: duas SEs sem desligamento) → ordem estável por subestação
    return d * state.sortDir;
  }

  // ── TABELA ──
  function statusTh() {
    return '<th class="sdt-th-status"><span class="sdt-th-tip" tabindex="0" role="img" aria-label="Status">' +
      '<svg viewBox="0 0 14 14" width="13" height="13" fill="none" stroke="currentColor" stroke-width="1.3" aria-hidden="true"><circle cx="7" cy="7" r="5.2"/><circle cx="7" cy="7" r="1.7" fill="currentColor" stroke="none"/></svg>' +
      '<span class="tip-bubble">Status</span></span></th>';
  }
  function renderTable(visible, detail) {
    var wrap = el('div', 'sdt-table-wrap');
    var t = el('table', 'sdt-table');
    var head = detail === 'agrupado'
      ? statusTh() + '<th>Eixo</th><th>Subestação</th><th>Início</th><th>Conclusão</th><th class="sdt-th-c">Duração</th><th>Horário</th>'
      : statusTh() + '<th>Eixo</th><th>Subestação</th><th>Data</th><th>Dia</th><th>Horário</th>';
    t.innerHTML = '<thead><tr>' + head + '</tr></thead>';
    var tb = el('tbody');
    visible.forEach(function (r, i) {
      var tr = el('tr', i % 2 === 0 ? 'is-odd' : 'is-even');
      var st = el('td', 'sdt-td-status');
      st.innerHTML = '<span class="status-dot status-dot--' + r.status + '" title="' + STATUS_LABEL[r.status] + '" aria-label="' + STATUS_LABEL[r.status] + '"></span>';
      tr.appendChild(st);
      tr.appendChild(el('td', 'sdt-eixo', r.eixo));
      tr.appendChild(el('td', 'sdt-se', r.se));
      if (detail === 'agrupado') {
        if (r.type === 'none') { tr.appendChild(el('td', 'sdt-none', '—')); tr.appendChild(el('td', 'sdt-none', '—')); tr.appendChild(el('td', 'sdt-cell-c sdt-none', '—')); tr.appendChild(el('td', 'sdt-none', '—')); }
        else {
          tr.appendChild(el('td', null, r.ini));
          tr.appendChild(el('td', null, r.fim));
          tr.appendChild(el('td', 'sdt-cell-c', r.n + ' dias'));
          tr.appendChild(el('td', null, HORARIO));
        }
      } else {
        if (r.type === 'none') { tr.appendChild(el('td', 'sdt-none', '—')); tr.appendChild(el('td', 'sdt-none', '—')); tr.appendChild(el('td', 'sdt-none', '—')); }
        else {
          tr.appendChild(el('td', null, r.date));
          tr.appendChild(el('td', 'sdt-wd', r.wd));
          tr.appendChild(el('td', null, HORARIO));
        }
      }
      tb.appendChild(tr);
    });
    t.appendChild(tb); wrap.appendChild(t); body.appendChild(wrap);
    UI.addScrollFade(wrap);
    wireStatusTip(t);
  }

  // ── GANTT (substitui vertical/horizontal): SEs × dias, barras coloridas por
  // status. Inclui TODAS as SEs do eixo (mesmo as energizadas, sem barra). Os
  // títulos das SEs e a linha do horário ficam em preto/cinza (no CSS). ──
  function renderGantt(q) {
    var DAY = 86400000;
    var any = false;
    EIXOS.forEach(function (ax) {
      var ses = SE_DESL.filter(function (s) { return s.eixo === ax.key; });
      var rows = ses.filter(function (s) {
        return !q || UI.foldAccents([s.se, s.eixo, (s.dias[0] || ''), (s.dias[s.dias.length - 1] || '')].join(' ')).indexOf(q) !== -1;
      });
      if (!rows.length) return;
      any = true;
      // eixo de tempo: do 1º ao último dia de desligamento do eixo (todas as SEs)
      var times = [];
      ses.forEach(function (s) { s.dias.forEach(function (d) { times.push(parse(d).getTime()); }); });
      var min = times.length ? Math.min.apply(null, times) : 0;
      var max = times.length ? Math.max.apply(null, times) : 0;
      var ncols = times.length ? Math.round((max - min) / DAY) + 1 : 0;

      var sec = el('div', 'sdt-axis');
      var title = el('div', 'sdt-axis-title');
      title.appendChild(el('span', null, ax.label));
      title.appendChild(el('span', 'sdt-axis-count', rows.length + (rows.length === 1 ? ' subestação' : ' subestações')));
      sec.appendChild(title);

      var wrap = el('div', 'sdt-gantt-wrap');
      var g = el('div', 'sdt-gantt');
      g.style.setProperty('--cols', ncols);

      // cabeçalho de dias
      var head = el('div', 'sdt-gantt-row sdt-gantt-head');
      head.appendChild(el('div', 'sdt-gantt-corner'));
      for (var i = 0; i < ncols; i++) {
        var dt = new Date(min + i * DAY);
        var dh = el('div', 'sdt-gantt-dh');
        dh.appendChild(el('b', null, pad2(dt.getDate()) + '/' + pad2(dt.getMonth() + 1)));
        dh.appendChild(el('span', 'sdt-gantt-wd', WD[dt.getDay()]));
        head.appendChild(dh);
      }
      g.appendChild(head);

      // linhas por SE
      rows.forEach(function (s) {
        var status = statusOf(s);
        var row = el('div', 'sdt-gantt-row');
        var lab = el('div', 'sdt-gantt-se');
        lab.innerHTML = '<span class="status-dot status-dot--' + status + '" title="' + STATUS_LABEL[status] + '" aria-label="' + STATUS_LABEL[status] + '"></span>';
        lab.appendChild(document.createTextNode(s.se));
        row.appendChild(lab);
        if (!s.dias.length) {
          var en = el('div', 'sdt-gantt-energ', 'energizado');
          en.style.gridColumn = '2 / -1';
          row.appendChild(en);
        } else {
          var set = {};
          s.dias.forEach(function (d) { set[parse(d).getTime()] = true; });
          for (var k = 0; k < ncols; k++) {
            var t = min + k * DAY;
            var on = !!set[t];
            var c = el('div', 'sdt-gantt-c' + (on ? ' is-on is-' + status : ''));
            if (on) {
              if (!set[t - DAY]) c.classList.add('is-first');
              if (!set[t + DAY]) c.classList.add('is-last');
              c.appendChild(el('span', 'sdt-gantt-h', HORARIO));
            }
            row.appendChild(c);
          }
        }
        g.appendChild(row);
      });

      wrap.appendChild(g); sec.appendChild(wrap);
      body.appendChild(sec);
      addGanttScroll(wrap);
    });
    if (!any) body.appendChild(el('div', 'sdt-empty', 'Nenhum registro encontrado para a busca.'));
  }

  // mobile: iguala a largura das colunas do Gantt entre os eixos. Define
  // --colw = (região visível de dados)/3 para que TODO eixo mostre exatamente 3
  // colunas com a MESMA largura — o eixo leste (mais dias) passa a rolar mostrando
  // 3 por vez; o norte (3 dias) preenche a região. Recalculado no resize. No
  // desktop a propriedade é removida (volta ao minmax(3rem,1fr) que preenche). */
  function sizeGanttCols() {
    var mobile = window.matchMedia('(max-width: 640px)').matches;
    Array.prototype.forEach.call(body.querySelectorAll('.sdt-gantt'), function (g) {
      if (!mobile) { g.style.removeProperty('--colw'); return; }
      var wrap = g.closest('.sdt-gantt-wrap');
      if (!wrap) return;
      var cs = window.getComputedStyle(wrap);
      var padX = parseFloat(cs.paddingLeft) + parseFloat(cs.paddingRight);
      var label = g.querySelector('.sdt-gantt-se, .sdt-gantt-corner');
      var labelW = label ? label.getBoundingClientRect().width : 0;
      var region = wrap.clientWidth - padX - labelW;
      // floor para evitar que arredondamento faça o norte transbordar (rolar)
      if (region > 0) g.style.setProperty('--colw', (Math.floor(region / 3 * 100) / 100) + 'px');
    });
  }

  // rolagem do Gantt: painéis congelados (sticky via CSS) + gradiente de
  // continuidade SÓ na área de dados (horários), nos 4 lados. Envolve o scroller
  // num wrapper que recebe os offsets --data-* (paddings do wrap + largura do
  // rótulo + altura do cabeçalho) e as 4 bordas-gradiente; alterna
  // has-left/right/top/bottom conforme a rolagem horizontal e vertical.
  function addGanttScroll(scroller) {
    if (!scroller) return;
    var wrap = el('div', 'sdt-gantt-scroll');
    scroller.parentNode.insertBefore(wrap, scroller);
    wrap.appendChild(scroller);
    ['left', 'right', 'top', 'bottom'].forEach(function (side) {
      var d = el('div', 'sdt-gantt-fade sdt-gantt-fade-' + side);
      d.setAttribute('aria-hidden', 'true');
      wrap.appendChild(d);
    });
    function measure() {
      var cs = window.getComputedStyle(scroller);
      var g = scroller.querySelector('.sdt-gantt');
      var label = g && g.querySelector('.sdt-gantt-se, .sdt-gantt-corner');
      var head = g && g.querySelector('.sdt-gantt-head');
      var labelW = label ? label.getBoundingClientRect().width : 0;
      var headH = head ? head.getBoundingClientRect().height : 0;
      wrap.style.setProperty('--data-left', (parseFloat(cs.paddingLeft) + labelW) + 'px');
      wrap.style.setProperty('--data-right', cs.paddingRight);
      wrap.style.setProperty('--data-top', (parseFloat(cs.paddingTop) + headH) + 'px');
      wrap.style.setProperty('--data-bottom', cs.paddingBottom);
    }
    function upd() {
      var maxX = scroller.scrollWidth - scroller.clientWidth;
      var maxY = scroller.scrollHeight - scroller.clientHeight;
      wrap.classList.toggle('has-left', scroller.scrollLeft > 1);
      wrap.classList.toggle('has-right', scroller.scrollLeft < maxX - 1);
      wrap.classList.toggle('has-top', scroller.scrollTop > 1);
      wrap.classList.toggle('has-bottom', scroller.scrollTop < maxY - 1);
    }
    scroller.addEventListener('scroll', upd, { passive: true });
    scroller._gRefresh = function () { measure(); upd(); };
    scroller._gRefresh();
  }

  // ── render principal ──
  function render() {
    var q = state.query;
    purgeTips();
    Array.prototype.forEach.call(body.querySelectorAll('.scrollfade'), function (w) { if (w._uiCleanup) w._uiCleanup(); });
    body.innerHTML = '';
    if (state.view === 'gantt') {
      renderGantt(q);
      sizeGanttCols();
      // larguras de coluna mudaram → recalcula offsets/estados das bordas-gradiente
      Array.prototype.forEach.call(body.querySelectorAll('.sdt-gantt-wrap'), function (w) { if (w._gRefresh) w._gRefresh(); });
      var nSE = SE_DESL.filter(function (s) { return !q || UI.foldAccents([s.se, s.eixo, (s.dias[0] || ''), (s.dias[s.dias.length - 1] || '')].join(' ')).indexOf(q) !== -1; }).length;
      if (countEl) countEl.textContent = (nSE === SE_DESL.length ? SE_DESL.length : nSE + ' de ' + SE_DESL.length) + (nSE === 1 ? ' subestação' : ' subestações');
      return;
    }
    var recs = buildRecords(state.detail);
    var visible = q ? recs.filter(function (r) { return r.hay.indexOf(q) !== -1; }) : recs.slice();
    visible.sort(cmp);
    if (countEl) countEl.textContent = (visible.length === recs.length ? recs.length + ' registros' : visible.length + ' de ' + recs.length + ' registros');
    if (!visible.length) { body.appendChild(el('div', 'sdt-empty', 'Nenhum registro encontrado para a busca.')); return; }
    renderTable(visible, state.detail);
  }

  // ── tooltip do cabeçalho "Status" (balão .tip-bubble portado p/ o <body> via UI.attachTip) ──
  function purgeTips() { Array.prototype.forEach.call(document.querySelectorAll('body > .tip-bubble'), function (e) { e.parentNode.removeChild(e); }); }
  function wireStatusTip(table) {
    var trigger = table.querySelector('.sdt-th-tip');
    var tip = trigger && trigger.querySelector('.tip-bubble');
    UI.attachTip(trigger, tip);
  }

  // ── controles ──
  function setActive(sel, btn) {
    root.querySelectorAll(sel).forEach(function (x) { var a = x === btn; x.classList.toggle('is-active', a); x.setAttribute('aria-pressed', String(a)); });
  }
  // ordenação e detalhamento valem só para a tabela; o container .sdt-filters é
  // ocultado no Gantt via CSS ([data-view="gantt"] .sdt-filters{display:none}) —
  // collapsa de fato (sem espaço vazio) e o grupo "Exibição" fica ancorado à
  // direita, então não se move ao trocar de exibição.
  root.querySelectorAll('.sdt-views button').forEach(function (b) {
    b.addEventListener('click', function () { state.view = b.dataset.view; root.dataset.view = state.view; setActive('.sdt-views button', b); render(); });
  });
  root.querySelectorAll('.sdt-detail button').forEach(function (b) {
    b.addEventListener('click', function () { state.detail = b.dataset.detail; root.dataset.detail = state.detail; setActive('.sdt-detail button', b); render(); });
  });
  root.querySelectorAll('.sdt-sort button').forEach(function (b) {
    b.addEventListener('click', function () {
      var key = b.dataset.sort;
      if (state.sortKey === key) state.sortDir = -state.sortDir; else { state.sortKey = key; state.sortDir = 1; }
      root.querySelectorAll('.sdt-sort button').forEach(function (x) {
        var a = x === b;
        x.classList.toggle('is-active', a); x.setAttribute('aria-pressed', String(a));
        var dir = x.querySelector('.seg-dir'); if (dir) dir.textContent = a ? (state.sortDir === 1 ? '▲' : '▼') : '▲';
      });
      render();
    });
  });
  if (searchInput) searchInput.addEventListener('input', function () { state.query = UI.foldAccents(this.value.trim()); render(); });

  // placeholder "máquina de escrever": cicla os nomes das SEs enquanto inativo
  if (searchInput) {
    UI.typewriterPlaceholder(searchInput, SE_DESL.map(function (s) { return s.se; }), {
      activePlaceholder: searchInput.getAttribute('placeholder') || '', startDelay: 600
    });
  }

  // recalcula a largura das colunas do Gantt ao redimensionar (mobile ↔ desktop)
  var sdtResizeTimer;
  window.addEventListener('resize', function () {
    clearTimeout(sdtResizeTimer);
    sdtResizeTimer = setTimeout(function () {
      if (state.view !== 'gantt') return;
      sizeGanttCols();
      Array.prototype.forEach.call(body.querySelectorAll('.sdt-gantt-wrap'), function (w) { if (w._gRefresh) w._gRefresh(); });
    }, 150);
  });

  root.dataset.detail = state.detail;
  root.dataset.view = state.view;
  render();
})();
