'use strict';

// busca sem acentuação: normaliza removendo diacríticos (ã/á/à/â → a, ç → c, …) e caixa
function foldAccents(s) { return (s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase(); }

// ── scroll drag horizontal: por trecho (cada faixa rola de forma independente) ──
document.querySelectorAll('.tl-entries-scroll').forEach(scroll => {
  const trecho = scroll.closest('.tl-trecho');
  const updateFade = () => {
    if (!trecho) return;
    const atEnd = scroll.scrollLeft >= scroll.scrollWidth - scroll.clientWidth - 1;
    trecho.classList.toggle('tl-scroll-end', atEnd);
  };
  scroll.addEventListener('scroll', updateFade, { passive: true });
  requestAnimationFrame(updateFade);

  let active = false, startX, startLeft;
  scroll.addEventListener('mousedown', e => { active = true; startX = e.pageX - scroll.offsetLeft; startLeft = scroll.scrollLeft; scroll.classList.add('is-grabbing'); });
  const stop = () => { active = false; scroll.classList.remove('is-grabbing'); };
  scroll.addEventListener('mouseleave', stop);
  scroll.addEventListener('mouseup', stop);
  scroll.addEventListener('mousemove', e => { if (!active) return; e.preventDefault(); scroll.scrollLeft = startLeft - (e.pageX - scroll.offsetLeft - startX) * 1.4; });
  // touchpad horizontal swipe (dois dedos)
  scroll.addEventListener('wheel', e => {
    if (Math.abs(e.deltaX) > Math.abs(e.deltaY)) {
      e.preventDefault();
      scroll.scrollLeft += e.deltaX;
    }
  }, { passive: false });
});

// ── Filtros do cronograma: código, status, eixo, trecho, data inicial e
// data de conclusão. Uma estrutura aparece se satisfizer TODOS os filtros.
(function tlFilters() {
  const root = document.querySelector('.tl-filters');
  if (!root) return;
  const axisChipSets = {};
  const axisCodeInputs = {};
  document.querySelectorAll('.tl-axis-section').forEach(sec => {
    const key = sec.classList.contains('tl-axis-section--norte') ? 'Eixo Norte' : 'Eixo Leste';
    axisChipSets[key] = Array.from(sec.querySelectorAll('.tlf-chips--axis .tlf-chip'));
    axisCodeInputs[key] = sec.querySelector('.tl-axis-code');
  });
  const allAxisChips = Object.values(axisChipSets).flat();
  const iniDe = root.querySelector('#tlf-ini-de'), iniAte = root.querySelector('#tlf-ini-ate');
  const fimDe = root.querySelector('#tlf-fim-de'), fimAte = root.querySelector('#tlf-fim-ate');
  const clearBtn = root.querySelector('#tlf-clear');

  const dmy = s => { const m = s && s.match(/(\d{2})\/(\d{2})\/(\d{2})/); return m ? (2000 + +m[3]) * 10000 + (+m[2]) * 100 + (+m[1]) : null; };
  const iso = s => { const m = s && s.match(/(\d{4})-(\d{2})-(\d{2})/); return m ? (+m[1]) * 10000 + (+m[2]) * 100 + (+m[3]) : null; };

  const entries = Array.from(document.querySelectorAll('.tl-entry')).map(el => {
    const txt = el.querySelector('.tl-dates').textContent;
    return {
      el,
      code: foldAccents(el.querySelector('.tl-code').textContent.trim()),
      status: el.classList.contains('tl-entry--done') ? 'done' : el.classList.contains('tl-entry--running') ? 'running' : 'pending',
      ini: dmy((txt.match(/ini\s*(\d{2}\/\d{2}\/\d{2})/) || [])[1]),
      fim: dmy((txt.match(/fim\s*(\d{2}\/\d{2}\/\d{2})/) || [])[1]),
      trecho: el.closest('.tl-trecho').querySelector('.tl-trecho-name').textContent.trim(),
      eixo: el.closest('.tl-axis-section') && el.closest('.tl-axis-section').classList.contains('tl-axis-section--norte') ? 'Eixo Norte' : 'Eixo Leste',
    };
  });

  function enhanceSelect(select, labelId) {
    const field = select.closest('.tlf-field');
    const dd = document.createElement('div'); dd.className = 'tlf-dd';
    const trigger = document.createElement('button');
    trigger.type = 'button'; trigger.className = 'tlf-dd-trigger';
    trigger.setAttribute('aria-haspopup', 'listbox');
    trigger.setAttribute('aria-expanded', 'false');
    if (labelId) trigger.setAttribute('aria-labelledby', labelId);
    const valSpan = document.createElement('span'); valSpan.className = 'tlf-dd-value';
    const arrow = document.createElement('span'); arrow.className = 'tlf-dd-arrow'; arrow.setAttribute('aria-hidden', 'true'); arrow.textContent = '▾';
    trigger.append(valSpan, arrow);
    const menu = document.createElement('ul'); menu.className = 'tlf-dd-menu'; menu.setAttribute('role', 'listbox'); menu.hidden = true;
    dd.append(trigger, menu);

    function sync() {
      const opt = [...select.options].find(o => o.value === select.value) || select.options[0];
      valSpan.textContent = opt ? opt.textContent : '';
      for (const li of menu.children) {
        const on = li.dataset.value === select.value;
        li.classList.toggle('is-selected', on);
        li.setAttribute('aria-selected', on ? 'true' : 'false');
      }
    }
    function rebuild() {
      menu.innerHTML = '';
      for (const opt of select.options) {
        const li = document.createElement('li');
        li.className = 'tlf-dd-opt'; li.setAttribute('role', 'option'); li.tabIndex = -1;
        li.dataset.value = opt.value; li.textContent = opt.textContent;
        li.addEventListener('click', () => choose(opt.value));
        menu.appendChild(li);
      }
      sync();
    }
    function open() {
      document.querySelectorAll('.tlf-dd-menu, .tlf-cal-menu').forEach(m => { if (m !== menu) { m.hidden = true; const tg = m.previousElementSibling; if (tg) tg.setAttribute('aria-expanded', 'false'); } });
      menu.hidden = false; trigger.setAttribute('aria-expanded', 'true');
      const cur = menu.querySelector('.is-selected') || menu.firstElementChild; if (cur) cur.focus();
    }
    function close(focusTrigger) { menu.hidden = true; trigger.setAttribute('aria-expanded', 'false'); if (focusTrigger) trigger.focus(); }
    function choose(v) { select.value = v; select.dispatchEvent(new Event('change', { bubbles: true })); close(true); }

    trigger.addEventListener('click', () => { menu.hidden ? open() : close(false); });
    trigger.addEventListener('keydown', e => { if (e.key === 'ArrowDown' || e.key === 'Enter' || e.key === ' ') { e.preventDefault(); open(); } });
    menu.addEventListener('keydown', e => {
      const opts = [...menu.children]; const i = opts.indexOf(document.activeElement);
      if (e.key === 'ArrowDown') { e.preventDefault(); (opts[i + 1] || opts[0]).focus(); }
      else if (e.key === 'ArrowUp') { e.preventDefault(); (opts[i - 1] || opts[opts.length - 1]).focus(); }
      else if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); if (opts[i]) choose(opts[i].dataset.value); }
      else if (e.key === 'Escape') { e.preventDefault(); close(true); }
      else if (e.key === 'Tab') { close(false); }
    });
    document.addEventListener('click', e => { if (!dd.contains(e.target)) close(false); });
    select.addEventListener('change', sync);

    select.classList.add('tlf-native-hidden');
    field.appendChild(dd);
    rebuild();
  }

  // ── calendário customizado p/ os seletores de data: mesmo menu flutuante
  // escuro semitransparente, dia selecionado em verde (texto preto), demais
  // em cinza. O <input type="date"> nativo é mantido oculto como fonte do
  // valor (YYYY-MM-DD), então a lógica de filtro segue inalterada.
  function enhanceDate(input) {
    const WD = ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sáb'];
    const MO = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];
    const pad = n => String(n).padStart(2, '0');
    const toISO = d => d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
    const parse = s => { const m = s && s.match(/(\d{4})-(\d{2})-(\d{2})/); return m ? new Date(+m[1], +m[2] - 1, +m[3]) : null; };

    const dd = document.createElement('span'); dd.className = 'tlf-dd tlf-date';
    const trigger = document.createElement('button');
    trigger.type = 'button'; trigger.className = 'tlf-dd-trigger';
    trigger.setAttribute('aria-haspopup', 'dialog'); trigger.setAttribute('aria-expanded', 'false');
    const al = input.getAttribute('aria-label'); if (al) trigger.setAttribute('aria-label', al);
    const valSpan = document.createElement('span'); valSpan.className = 'tlf-dd-value';
    const arrow = document.createElement('span'); arrow.className = 'tlf-dd-arrow'; arrow.setAttribute('aria-hidden', 'true'); arrow.textContent = '▾';
    trigger.append(valSpan, arrow);
    const menu = document.createElement('div'); menu.className = 'tlf-cal-menu'; menu.hidden = true; menu.setAttribute('role', 'dialog');
    dd.append(trigger, menu);
    let view;

    function syncTrigger() {
      const d = parse(input.value);
      valSpan.textContent = d ? pad(d.getDate()) + '-' + pad(d.getMonth() + 1) + '-' + String(d.getFullYear()).slice(2) : 'dd-mm-aa';
      valSpan.classList.toggle('tlf-dd-placeholder', !d);
      trigger.classList.toggle('tlf-dd-filled', !!d); // valor ativo → fundo verde
    }
    function render() {
      const sel = parse(input.value), today = new Date();
      menu.innerHTML = '';
      const head = document.createElement('div'); head.className = 'tlf-cal-head';
      const prev = document.createElement('button'); prev.type = 'button'; prev.className = 'tlf-cal-nav'; prev.textContent = '‹'; prev.setAttribute('aria-label', 'mês anterior');
      const title = document.createElement('span'); title.className = 'tlf-cal-title'; title.textContent = MO[view.getMonth()] + ' ' + view.getFullYear();
      const next = document.createElement('button'); next.type = 'button'; next.className = 'tlf-cal-nav'; next.textContent = '›'; next.setAttribute('aria-label', 'próximo mês');
      // stopPropagation: render() recria os botões, e sem isso o clique
      // chegaria ao listener de "clique fora" com um alvo já desanexado
      // (dd.contains == false), fechando o menu indevidamente.
      prev.addEventListener('click', e => { e.stopPropagation(); view.setMonth(view.getMonth() - 1); render(); });
      next.addEventListener('click', e => { e.stopPropagation(); view.setMonth(view.getMonth() + 1); render(); });
      head.append(prev, title, next);
      const grid = document.createElement('div'); grid.className = 'tlf-cal-grid';
      for (const w of WD) { const c = document.createElement('div'); c.className = 'tlf-cal-wd'; c.textContent = w; grid.appendChild(c); }
      const startDow = new Date(view.getFullYear(), view.getMonth(), 1).getDay();
      const days = new Date(view.getFullYear(), view.getMonth() + 1, 0).getDate();
      for (let i = 0; i < startDow; i++) { const e = document.createElement('div'); e.className = 'tlf-cal-day is-empty'; grid.appendChild(e); }
      for (let d = 1; d <= days; d++) {
        const cell = document.createElement('button'); cell.type = 'button'; cell.className = 'tlf-cal-day'; cell.textContent = d; cell.tabIndex = -1;
        const dt = new Date(view.getFullYear(), view.getMonth(), d);
        if (sel && toISO(sel) === toISO(dt)) cell.classList.add('is-selected');
        if (toISO(today) === toISO(dt)) cell.classList.add('is-today');
        cell.addEventListener('click', () => { input.value = toISO(dt); input.dispatchEvent(new Event('change', { bubbles: true })); close(true); });
        grid.appendChild(cell);
      }
      const clr = document.createElement('button'); clr.type = 'button'; clr.className = 'tlf-cal-clear'; clr.textContent = 'limpar';
      clr.addEventListener('click', () => { input.value = ''; input.dispatchEvent(new Event('change', { bubbles: true })); close(true); });
      menu.append(head, grid, clr);
    }
    function open() {
      document.querySelectorAll('.tlf-dd-menu, .tlf-cal-menu').forEach(m => { if (m !== menu) { m.hidden = true; const tg = m.previousElementSibling; if (tg) tg.setAttribute('aria-expanded', 'false'); } });
      const sel = parse(input.value), now = new Date();
      view = sel ? new Date(sel.getFullYear(), sel.getMonth(), 1) : new Date(now.getFullYear(), now.getMonth(), 1);
      render(); menu.hidden = false; trigger.setAttribute('aria-expanded', 'true');
      menu.style.left = '0'; menu.style.right = 'auto';
      if (menu.getBoundingClientRect().right > window.innerWidth - 8) { menu.style.left = 'auto'; menu.style.right = '0'; }
    }
    function close(focus) { menu.hidden = true; trigger.setAttribute('aria-expanded', 'false'); if (focus) trigger.focus(); }
    trigger.addEventListener('click', () => { menu.hidden ? open() : close(false); });
    trigger.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ' || e.key === 'ArrowDown') { e.preventDefault(); open(); } });
    menu.addEventListener('keydown', e => { if (e.key === 'Escape') { e.preventDefault(); close(true); } });
    document.addEventListener('click', e => { if (!dd.contains(e.target)) close(false); });
    input.addEventListener('change', syncTrigger);

    input.classList.add('tlf-native-hidden');
    input.parentElement.insertBefore(dd, input.nextSibling);
    syncTrigger();
  }
  [iniDe, iniAte, fimDe, fimAte].forEach(enhanceDate);

  const emptyStates = {}, axisCounts = {};
  document.querySelectorAll('.tl-axis-section').forEach(sec => {
    const key = sec.classList.contains('tl-axis-section--norte') ? 'Eixo Norte' : 'Eixo Leste';
    const empty = document.createElement('div');
    empty.className = 'tl-empty-state';
    empty.textContent = 'Nenhuma estrutura encontrada para os filtros aplicados.';
    empty.hidden = true;
    sec.appendChild(empty);
    emptyStates[key] = empty;

    const count = document.createElement('div');
    count.className = 'tl-axis-count';
    count.setAttribute('aria-live', 'polite');
    sec.appendChild(count);
    axisCounts[key] = { el: count, total: sec.querySelectorAll('.tl-entry').length };
  });

  function apply() {
    const stByAxis = {}, qByAxis = {};
    for (const [ax, chips] of Object.entries(axisChipSets)) {
      stByAxis[ax] = new Set(chips.filter(c => c.classList.contains('active')).map(c => c.dataset.status));
    }
    for (const [ax, inp] of Object.entries(axisCodeInputs)) {
      qByAxis[ax] = inp ? foldAccents(inp.value.trim()) : '';
    }
    const id = iso(iniDe.value), ia = iso(iniAte.value), fd = iso(fimDe.value), fa = iso(fimAte.value);
    let vis = 0;
    for (const e of entries) {
      const q = qByAxis[e.eixo] || '';
      const st = stByAxis[e.eixo] || new Set(['done', 'running', 'pending']);
      let ok = (!q || e.code.includes(q)) && st.has(e.status);
      if (ok && (id || ia)) ok = e.ini !== null && (!id || e.ini >= id) && (!ia || e.ini <= ia);
      if (ok && (fd || fa)) ok = e.fim !== null && (!fd || e.fim >= fd) && (!fa || e.fim <= fa);
      e.el.style.display = ok ? '' : 'none';
      if (ok) vis++;
    }
    // recolhe faixas, grupos e cabeçalhos de eixo sem estruturas visíveis
    document.querySelectorAll('.tl-trecho').forEach(tr => { tr.style.display = [...tr.querySelectorAll('.tl-entry')].some(x => x.style.display !== 'none') ? '' : 'none'; });
    document.querySelectorAll('.tl-group').forEach(g => { g.style.display = [...g.querySelectorAll('.tl-entry')].some(x => x.style.display !== 'none') ? '' : 'none'; });
    const seen = { 'Eixo Leste': false, 'Eixo Norte': false };
    const visByAxis = { 'Eixo Leste': 0, 'Eixo Norte': 0 };
    for (const e of entries) if (e.el.style.display !== 'none') { seen[e.eixo] = true; visByAxis[e.eixo]++; }
    for (const [key, visible] of Object.entries(seen)) {
      if (emptyStates[key]) emptyStates[key].hidden = visible;
      if (axisCounts[key]) axisCounts[key].el.textContent = visByAxis[key] + ' de ' + axisCounts[key].total + ' estruturas';
    }
    // oculta o conector curvado para trechos cuja primeira entrada está filtrada
    document.querySelectorAll('.tl-trecho').forEach(tr => {
      const svg = tr._tlCurveConnector;
      if (!svg) return;
      const firstEntry = tr.querySelector('.tl-entry');
      const scrollEl = tr.querySelector('.tl-entries-scroll');
      const scrolled = scrollEl ? scrollEl.scrollLeft > 0 : false;
      const firstHidden = firstEntry && firstEntry.style.display === 'none';
      svg.style.opacity = (firstHidden || scrolled) ? '0' : '';
    });
    window._tlUpdateSpineRange && window._tlUpdateSpineRange();
    window._tlUpdateTableView && window._tlUpdateTableView();
  }

  allAxisChips.forEach(c => c.addEventListener('click', () => { c.classList.toggle('active'); apply(); }));
  Object.values(axisCodeInputs).forEach(inp => { if (inp) inp.addEventListener('input', apply); });
  [iniDe, iniAte, fimDe, fimAte].forEach(el => { el.addEventListener('input', apply); el.addEventListener('change', apply); });
  clearBtn.addEventListener('click', () => {
    Object.values(axisCodeInputs).forEach(inp => { if (inp) inp.value = ''; });
    iniDe.value = iniAte.value = fimDe.value = fimAte.value = '';
    allAxisChips.forEach(c => c.classList.add('active'));
    [iniDe, iniAte, fimDe, fimAte].forEach(el => el.dispatchEvent(new Event('change', { bubbles: true })));
    apply();
  });
  apply();
})();

// ── bases card: colapsar/expandir individualmente ────────────────────────────
(function tlBasesCollapse() {
  // Após fontes carregadas, todas as entradas estão colapsadas (estado inicial).
  // Medimos e travamos a largura de cada painel nesse estado para que ela não
  // mude ao expandir/colapsar.
  document.fonts.ready.then(() => {
    document.querySelectorAll('.tl-entry-panel').forEach(panel => {
      const w = panel.getBoundingClientRect().width;
      if (w > 0) panel.style.width = w + 'px';
    });
  });

  document.querySelectorAll('.tl-card--bases').forEach(card => {
    card.addEventListener('click', () => {
      const collapsed = card.classList.toggle('is-collapsed');
      card.setAttribute('aria-expanded', String(!collapsed));
    });
    card.addEventListener('keydown', e => {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); card.click(); }
    });
  });
})();

// ── eixo toggle: expandir/colapsar todas as bases do eixo ────────────────────
(function tlAxisToggle() {
  document.querySelectorAll('.tl-axis-toggle').forEach(btn => {
    // inicializa o label de acordo com o estado atual (todas colapsadas = "expandir tudo")
    const initLabel = btn.querySelector('.tl-axis-toggle-label');
    const initSec = btn.closest('.tl-axis-section');
    const initCollapsed = initSec && [...initSec.querySelectorAll('.tl-card--bases')].some(c => c.classList.contains('is-collapsed'));
    if (initLabel) initLabel.textContent = initCollapsed ? 'expandir tudo' : 'colapsar tudo';
    btn.title = initCollapsed ? 'expandir tudo' : 'colapsar tudo';
    btn.setAttribute('aria-label', initCollapsed ? 'expandir tudo' : 'colapsar tudo');

    btn.addEventListener('click', e => {
      e.stopPropagation();
      const section = btn.closest('.tl-axis-section');
      if (!section) return;
      const cards = [...section.querySelectorAll('.tl-card--bases')];
      const anyCollapsed = cards.some(c => c.classList.contains('is-collapsed'));
      cards.forEach(c => {
        c.classList.toggle('is-collapsed', !anyCollapsed);
        c.setAttribute('aria-expanded', String(anyCollapsed));
      });
      const icon = btn.querySelector('.tl-axis-toggle-icon');
      // conteúdo expande verticalmente: seta para BAIXO quando colapsado (expandir),
      // para CIMA quando expandido (colapsar)
      if (icon) icon.style.transform = anyCollapsed ? 'rotate(180deg)' : 'rotate(0deg)';
      const label = btn.querySelector('.tl-axis-toggle-label');
      if (label) label.textContent = anyCollapsed ? 'colapsar tudo' : 'expandir tudo';
      btn.title = anyCollapsed ? 'colapsar tudo' : 'expandir tudo';
      btn.setAttribute('aria-label', anyCollapsed ? 'colapsar tudo' : 'expandir tudo');
    });
  });
})();

// ── conector curvado animado: label → spine, para todos os trechos ──
(function tlConnectors() {
  const DOT_R = 6;     // px — corresponde a --tl-dot-r
  const PAD_TOP = 16;  // px — 1rem (padding-top de .tl-entries)
  const PAD_LEFT = 24; // px — 1.5rem (padding-left de .tl-entries)
  const NAME_W = 80;   // px — 5rem (width de .tl-trecho-name)
  const ns = 'http://www.w3.org/2000/svg';

  function buildConnector(trecho) {
    const entriesEl = trecho.querySelector('.tl-entries');
    if (!entriesEl) return;
    const firstEntry = entriesEl.querySelector('.tl-entry');
    if (!firstEntry) return;

    const color = 'rgba(0,0,0,0.15)';
    const trechoH = trecho.getBoundingClientRect().height;
    if (!trechoH) return;

    const spineY = PAD_TOP + DOT_R;
    const startY = trechoH / 2;
    const endX = NAME_W + PAD_LEFT;
    const midX = NAME_W + PAD_LEFT / 2;
    const d = `M ${NAME_W} ${startY} C ${midX} ${startY}, ${midX} ${spineY}, ${endX} ${spineY}`;

    const svg = document.createElementNS(ns, 'svg');
    svg.setAttribute('aria-hidden', 'true');
    svg.style.cssText = `position:absolute;top:0;left:0;width:${endX}px;height:${trechoH}px;pointer-events:none;overflow:visible;z-index:1;transition:opacity 0.4s ease;`;

    const path = document.createElementNS(ns, 'path');
    path.setAttribute('d', d);
    path.setAttribute('fill', 'none');
    path.setAttribute('stroke', color);
    path.setAttribute('stroke-width', '1.5');
    path.setAttribute('stroke-linecap', 'butt');
    path.setAttribute('opacity', '0');

    svg.appendChild(path);
    trecho.appendChild(svg);
    trecho._tlCurveConnector = svg;

    // oculta quando o trecho estiver rolado horizontalmente
    const scrollEl = trecho.querySelector('.tl-entries-scroll');
    if (scrollEl) {
      scrollEl.addEventListener('scroll', () => {
        svg.style.opacity = scrollEl.scrollLeft > 0 ? '0' : '';
      }, { passive: true });
    }

    // Anima um traço curto viajando de P_start (label) a P_end (spine)
    requestAnimationFrame(() => {
      const len = path.getTotalLength ? path.getTotalLength() : 40;
      const dot = len * 0.35;
      const cycle = 2200; // ms por loop

      // dasharray: [dot, gap_large] — garante que só um traço fica visível
      path.setAttribute('stroke-dasharray', `${dot} ${len + dot}`);

      // offset decrescente → traço viaja da esquerda (label) para a direita (spine)
      let startTs = null;
      (function tick(ts) {
        if (!startTs) startTs = ts;
        const progress = ((ts - startTs) % cycle) / cycle; // 0 → 1
        const offset = dot - progress * (len + 2 * dot); // decrescente: dot → -(len+dot)
        path.setAttribute('stroke-dashoffset', offset);
        const fadeIn  = Math.min(1, -offset / dot);
        const fadeOut = Math.min(1, (len + offset) / dot);
        path.setAttribute('opacity', Math.max(0, Math.min(fadeIn, fadeOut)));
        requestAnimationFrame(tick);
      })();
    });
  }

  document.querySelectorAll('.tl-trecho').forEach(buildConnector);
})();

// ── spine dinâmica: extensão do primeiro ao último dot visível de cada trecho ──
(function tlSpineRange() {
  const DOT_R = 6;
  const TRAIL = 40; // 2.5rem — gap após o último item

  function update() {
    document.querySelectorAll('.tl-entries').forEach(entries => {
      const visible = [...entries.children]
        .filter(el => el.classList.contains('tl-entry') && el.style.display !== 'none');
      if (!visible.length) return;
      const first = visible[0];
      // Spine sólida termina no último entry não-pendente; pending zone é coberta pelas linhas tracejadas
      const lastSolid = [...visible].reverse().find(e => !e.classList.contains('tl-entry--pending'));
      entries.style.setProperty('--spine-left', (first.offsetLeft + DOT_R) + 'px');
      if (lastSolid) {
        // Estende até panel.left do último item sólido, cobrindo o gap de ~20px entre dot e painel
        const lastPanel = lastSolid.querySelector('.tl-entry-panel');
        const panelLeft = lastPanel ? lastPanel.offsetLeft : (DOT_R * 2 + 14);
        entries.style.setProperty('--spine-width', (lastSolid.offsetLeft + panelLeft - first.offsetLeft - DOT_R) + 'px');
      } else {
        entries.style.setProperty('--spine-width', '0px');
      }

      // Força min-width para que o scroll container inclua TRAIL px após o último item.
      // Pseudo-elementos e flex items vazios não entram no scrollWidth do Chrome —
      // expandir o próprio container é a única forma confiável.
      entries.style.minWidth = '';
      entries.style.minWidth = (entries.scrollWidth + TRAIL) + 'px';
    });
    // atualiza gradiente de scroll em todos os trechos
    document.querySelectorAll('.tl-entries-scroll').forEach(s => {
      const t = s.closest('.tl-trecho');
      if (t) t.classList.toggle('tl-scroll-end', s.scrollLeft >= s.scrollWidth - s.clientWidth - 1);
    });
  }

  window._tlUpdateSpineRange = update;
  document.fonts.ready.then(update);
})();

// ── segmentos SVG da spine: sólido (done/running) ou tracejado (pending), sem sobreposição ──
(function tlSpineSegments() {
  var DOT_R  = 6;
  var SPINE_Y = 16 + DOT_R; // PAD_TOP(1rem=16px) + DOT_R = 22px
  var ns = 'http://www.w3.org/2000/svg';

  function dotX(e)   { return e.offsetLeft + DOT_R; }
  function panelX(e) {
    var p = e.querySelector('.tl-entry-panel');
    return e.offsetLeft + (p ? p.offsetLeft : DOT_R * 2 + 14);
  }
  function isPend(e) { return e.classList.contains('tl-entry--pending'); }

  function seg(x1, x2, solid) {
    if (x2 <= x1) return null;
    var el = document.createElementNS(ns, 'line');
    el.setAttribute('x1', x1); el.setAttribute('y1', SPINE_Y);
    el.setAttribute('x2', x2); el.setAttribute('y2', SPINE_Y);
    if (solid) {
      el.setAttribute('stroke', 'rgba(0,0,0,0.15)');
      el.setAttribute('stroke-width', '1.5');
    } else {
      el.setAttribute('stroke', 'rgba(0,0,0,0.22)');
      el.setAttribute('stroke-width', '1.5');
      el.setAttribute('stroke-dasharray', '4 5');
    }
    el.setAttribute('stroke-linecap', 'round');
    return el;
  }

  function push(svg, el) { if (el) svg.appendChild(el); }

  function drawSpine(entriesEl) {
    var old = entriesEl._tlSpineSvg;
    if (old) { old.remove(); entriesEl._tlSpineSvg = null; }

    var visible = [].slice.call(entriesEl.children).filter(function(el) {
      return el.classList.contains('tl-entry') && el.style.display !== 'none';
    });

    // Desativa a spine CSS e os ::before estáticos — o SVG assume o controle
    entriesEl.style.setProperty('--spine-width', '0px');
    entriesEl.classList.add('has-spine-svg');

    if (!visible.length) return;

    var svg = document.createElementNS(ns, 'svg');
    svg.setAttribute('aria-hidden', 'true');
    // z-index implícito pela posição no DOM: inserido antes dos flex-children → fica atrás deles
    svg.style.cssText = 'position:absolute;top:0;left:0;width:100%;height:100%;pointer-events:none;overflow:visible;';

    var f = visible[0];
    var fPend = isPend(f);

    // === Segmento da área da curva até a primeira entrada ===
    // Cobre 0→dot (pending) ou 0→panel (não-pending); partindo de x=0 (borda esq. do .tl-entries)
    push(svg, seg(0, fPend ? dotX(f) : panelX(f), !fPend));

    // === Segmentos entre pares de entradas consecutivas visíveis ===
    for (var i = 0; i < visible.length - 1; i++) {
      var a = visible[i], b = visible[i + 1];
      var aP = isPend(a), bP = isPend(b);
      var ax = dotX(a), ap = panelX(a);
      var bx = dotX(b), bp = panelX(b);

      if (!aP && !bP) {
        // Ambos sólidos: único segmento sólido de a.dot a b.panel
        push(svg, seg(ax, bp, true));
      } else if (aP && bP) {
        // Ambos pendentes: tracejado de a.dot a b.dot
        push(svg, seg(ax, bx, false));
      } else if (!aP && bP) {
        // Sólido→pendente: sólido até a.panel, tracejado até b.dot
        push(svg, seg(ax, ap, true));
        push(svg, seg(ap, bx, false));
      } else {
        // Pendente→sólido: tracejado até o meio do gap, sólido até b.panel
        var mid = Math.round((ax + bx) / 2);
        push(svg, seg(ax, mid, false));
        push(svg, seg(mid, bp, true));
      }
    }

    // Inserir ANTES dos flex-children para ficar atrás dos dots/panels
    entriesEl._tlSpineSvg = svg;
    entriesEl.insertBefore(svg, entriesEl.firstChild);
  }

  function refreshAll() {
    document.querySelectorAll('.tl-entries').forEach(drawSpine);
  }

  // Encapsula _tlUpdateSpineRange: mantém cálculo de minWidth e adiciona os segmentos SVG
  var _orig = window._tlUpdateSpineRange;
  window._tlUpdateSpineRange = function() {
    if (_orig) _orig();
    refreshAll();
  };

  document.fonts.ready.then(window._tlUpdateSpineRange);
})();

// ── raio na spine: faísca SVG do dot anterior ao dot da entrada running ──
(function tlSpineRay() {
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;

  const DOT_R = 6;
  const GAP_W = 40;  // px — 2.5rem (gap entre entradas no flex)
  const CYCLE = 2200;
  const ns = 'http://www.w3.org/2000/svg';

  function buildRay(entry, entriesEl) {
    const siblings = [...entriesEl.children].filter(el => el.classList.contains('tl-entry'));
    const idx = siblings.indexOf(entry);
    // sem estrutura anterior → o conector curvado já cobre a chegada ao primeiro dot
    if (idx === 0) return;

    // faísca cobre o gap entre o dot anterior e o dot running
    const startX = -(GAP_W + DOT_R); // ≈ centro do dot anterior
    const endX   = DOT_R;            // centro do dot running
    const totalW = endX - startX;    // GAP_W + 2 * DOT_R = 52px

    const color = getComputedStyle(entry).getPropertyValue('--tl-color').trim() || '#a78bfa';

    const svg = document.createElementNS(ns, 'svg');
    svg.setAttribute('aria-hidden', 'true');
    svg.style.cssText =
      `position:absolute;left:${startX}px;width:${totalW}px;height:3px;` +
      `top:${DOT_R - 1}px;pointer-events:none;overflow:visible;z-index:0;`;

    const path = document.createElementNS(ns, 'path');
    path.setAttribute('d', `M 0 1.5 L ${totalW} 1.5`);
    path.setAttribute('fill', 'none');
    path.setAttribute('stroke', color);
    path.setAttribute('stroke-width', '1.5');
    path.setAttribute('stroke-linecap', 'butt');

    svg.appendChild(path);
    entry.appendChild(svg);

    requestAnimationFrame(() => {
      const len = totalW;
      const dot = len * 0.35; // mesma proporção do conector curvado

      path.setAttribute('stroke-dasharray', `${dot} ${len + dot}`);

      // offset decrescente → faísca viaja do dot anterior para o dot running
      let startTs = null;
      (function tick(ts) {
        if (!startTs) startTs = ts;
        const progress = ((ts - startTs) % CYCLE) / CYCLE;
        const offset = dot - progress * (len + 2 * dot);
        path.setAttribute('stroke-dashoffset', offset);
        const fadeIn  = Math.min(1, -offset / dot);
        const fadeOut = Math.min(1, (len + offset) / dot);
        path.setAttribute('opacity', Math.max(0, Math.min(fadeIn, fadeOut)));
        requestAnimationFrame(tick);
      })();
    });
  }

  document.fonts.ready.then(() => {
    document.querySelectorAll('.tl-entries').forEach(entriesEl => {
      entriesEl
        .querySelectorAll('.tl-entry--running.tl-entry--expanded')
        .forEach(entry => buildRay(entry, entriesEl));
    });
  });
})();

// ── alternância de visualização: cronograma ↔ tabela ─────────────────────────
(function tlViewToggle() {
  const STATUS_LABEL = { done: 'Executada', running: 'Em execução', pending: 'Pendente' };

  // Constrói a tabela para uma seção de eixo a partir das suas .tl-entry
  function buildSectionTable(section) {
    const allEntries = [...section.querySelectorAll('.tl-entry')];
    if (!allEntries.length) return null;

    const container = document.createElement('div');
    container.className = 'tl-axis-table';

    const table = document.createElement('table');
    table.className = 'tl-data-table';

    const thead = document.createElement('thead');
    thead.innerHTML = `<tr>
      <th>Trecho</th><th>Código</th><th>Status</th>
      <th>Início</th><th>Conclusão</th>
      <th class="tlt-th-base">A</th><th class="tlt-th-base">B</th>
      <th class="tlt-th-base">C</th><th class="tlt-th-base">D</th>
    </tr>`;
    table.appendChild(thead);

    const tbody = document.createElement('tbody');
    const entryRowMap = new Map();
    let prevTrecho = null;

    for (const entry of allEntries) {
      const code = entry.querySelector('.tl-code')?.textContent.trim() || '—';
      const trechoName = entry.closest('.tl-trecho')?.querySelector('.tl-trecho-name')?.textContent.trim() || '—';
      const status = entry.classList.contains('tl-entry--done') ? 'done'
                   : entry.classList.contains('tl-entry--running') ? 'running' : 'pending';

      const txt = entry.querySelector('.tl-dates')?.textContent || '';
      const iniVal = (txt.match(/ini\s*([\d\/]+)/) || [])[1] || null;
      const fimVal = (txt.match(/fim\s*([\d\/]+)/) || [])[1] || null;

      const basesMap = {};
      entry.querySelectorAll('.tl-base').forEach(base => {
        const lbl = base.querySelector('.tl-base-lbl')?.textContent.trim();
        if (!lbl) return;
        const bSt = base.classList.contains('tl-base--done') ? 'done'
                  : base.classList.contains('tl-base--running') ? 'running' : 'pending';
        basesMap[lbl] = { status: bSt, icon: base.querySelector('.tl-base-icon') };
      });

      // Separador visual entre trechos
      if (prevTrecho !== null && trechoName !== prevTrecho) {
        const sep = document.createElement('tr');
        sep.className = 'tlt-sep-row';
        sep.innerHTML = '<td colspan="9"></td>';
        tbody.appendChild(sep);
      }
      prevTrecho = trechoName;

      const tr = document.createElement('tr');

      // Trecho
      const tdT = document.createElement('td');
      tdT.className = 'tlt-trecho'; tdT.textContent = trechoName; tr.appendChild(tdT);

      // Código
      const tdC = document.createElement('td');
      tdC.className = 'tlt-code'; tdC.textContent = code; tr.appendChild(tdC);

      // Status
      const tdS = document.createElement('td');
      tdS.innerHTML = `<span class="tlt-status tlt-status--${status}"><span class="tlt-status-dot"></span><span class="tlt-status-text">${STATUS_LABEL[status]}</span></span>`;
      tr.appendChild(tdS);

      // Início
      const tdI = document.createElement('td');
      tdI.className = iniVal ? 'tlt-date' : 'tlt-date--empty';
      tdI.textContent = iniVal || '—'; tr.appendChild(tdI);

      // Conclusão
      const tdF = document.createElement('td');
      tdF.className = fimVal ? 'tlt-date' : 'tlt-date--empty';
      tdF.textContent = fimVal || '—'; tr.appendChild(tdF);

      // Bases A–D
      for (const lbl of ['A', 'B', 'C', 'D']) {
        const td = document.createElement('td');
        td.className = 'tlt-base-cell';
        const b = basesMap[lbl];
        if (b && b.icon) {
          const wrap = document.createElement('span');
          wrap.className = `tlt-base-wrap tlt-base--${b.status}`;
          const ic = b.icon.cloneNode(true);
          ic.setAttribute('class', 'tlt-base-icon');
          ic.style.cssText = ''; // remove inline animation/mask do original
          wrap.appendChild(ic);
          td.appendChild(wrap);
        } else {
          td.textContent = '—';
        }
        tr.appendChild(td);
      }

      entryRowMap.set(entry, tr);
      tbody.appendChild(tr);
    }

    table.appendChild(tbody);
    container.appendChild(table);
    section._tlTableContainer = container;
    section._tlEntryRowMap = entryRowMap;
    return container;
  }

  // Gera as tabelas e as insere em cada seção (ocultas por padrão)
  document.querySelectorAll('.tl-axis-section').forEach(section => {
    const tbl = buildSectionTable(section);
    if (tbl) section.appendChild(tbl);
  });

  // Espelha a visibilidade das .tl-entry nas linhas da tabela
  window._tlUpdateTableView = function() {
    document.querySelectorAll('.tl-axis-section').forEach(section => {
      const map = section._tlEntryRowMap;
      if (!map) return;
      for (const [entryEl, row] of map) {
        row.style.display = entryEl.style.display === 'none' ? 'none' : '';
      }
    });
  };

  window._tlRebuildTable = function(section) {
    const old = section._tlTableContainer;
    if (old && old.parentNode) old.parentNode.removeChild(old);
    const tbl = buildSectionTable(section);
    if (tbl) section.appendChild(tbl);
  };

  // Adiciona os botões de seleção de visualização em cada cabeçalho de eixo
  document.querySelectorAll('.tl-axis').forEach(axis => {
    const section = axis.closest('.tl-axis-section');
    if (!section) return;

    const existingToggle = axis.querySelector('.tl-axis-toggle');

    // Botão: cronograma
    const cronBtn = document.createElement('button');
    cronBtn.type = 'button';
    cronBtn.className = 'tl-view-btn tl-view-btn--cronograma is-active';
    cronBtn.setAttribute('aria-pressed', 'true');
    cronBtn.title = 'Exibir cronograma horizontal';
    cronBtn.innerHTML = `<svg class="tl-view-btn-icon" viewBox="0 0 10 10" width="10" height="10" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" aria-hidden="true"><circle cx="2" cy="2.5" r="0.8" fill="currentColor" stroke="none"/><line x1="3.5" y1="2.5" x2="9" y2="2.5"/><circle cx="2" cy="5" r="0.8" fill="currentColor" stroke="none"/><line x1="3.5" y1="5" x2="7" y2="5"/><circle cx="2" cy="7.5" r="0.8" fill="currentColor" stroke="none"/><line x1="3.5" y1="7.5" x2="8" y2="7.5"/></svg><span class="tl-axis-toggle-label">Cronograma</span>`;

    // Botão: tabela
    const tabBtn = document.createElement('button');
    tabBtn.type = 'button';
    tabBtn.className = 'tl-view-btn tl-view-btn--tabela';
    tabBtn.setAttribute('aria-pressed', 'false');
    tabBtn.title = 'Exibir dados em tabela';
    tabBtn.innerHTML = `<svg class="tl-view-btn-icon" viewBox="0 0 10 10" width="10" height="10" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="1" y="1" width="8" height="8" rx="0.5"/><line x1="1" y1="4" x2="9" y2="4"/><line x1="1" y1="7" x2="9" y2="7"/><line x1="4" y1="1" x2="4" y2="9"/></svg><span class="tl-axis-toggle-label">Tabela</span>`;

    // Grupo de seleção
    const viewGroup = document.createElement('div');
    viewGroup.className = 'tl-view-toggle';
    viewGroup.setAttribute('role', 'group');
    viewGroup.setAttribute('aria-label', 'Modo de exibição');
    viewGroup.append(cronBtn, tabBtn);

    // Agrupa o toggle existente + o seletor de visualização num container
    const controls = document.createElement('div');
    controls.className = 'tl-axis-controls';
    if (existingToggle) {
      existingToggle.style.marginLeft = '0';
      axis.insertBefore(controls, existingToggle);
      controls.appendChild(existingToggle);
    } else {
      axis.appendChild(controls);
    }
    controls.appendChild(viewGroup);

    // Move chips de status do eixo para a barra de controles
    const axisChips = axis.querySelector('.tlf-chips--axis');
    if (axisChips) controls.prepend(axisChips);

    function setView(mode) {
      const isTable = mode === 'tabela';
      section.classList.toggle('is-table-view', isTable);
      cronBtn.classList.toggle('is-active', !isTable);
      tabBtn.classList.toggle('is-active', isTable);
      cronBtn.setAttribute('aria-pressed', String(!isTable));
      tabBtn.setAttribute('aria-pressed', String(isTable));
      // colapsar/expandir não é relevante na visão tabular
      if (existingToggle) existingToggle.style.display = isTable ? 'none' : '';
      // Sincroniza a tabela com o estado atual dos filtros
      if (isTable) window._tlUpdateTableView && window._tlUpdateTableView();
    }

    cronBtn.addEventListener('click', () => setView('cronograma'));
    tabBtn.addEventListener('click', () => setView('tabela'));
  });
})();

// ── zebra dinâmica: alterna a cor sempre seguindo a ordem VISÍVEL ─────────────
// :nth-child segue a ordem no DOM, não a ordem visível; ao filtrar (linhas
// ocultas) ou ordenar (linhas reordenadas) duas linhas visíveis adjacentes
// podem cair na mesma paridade. Recalculamos is-row-odd/is-row-even sobre as
// linhas realmente visíveis, e o CSS dirige o fundo por essas classes.
(function tlZebraStriping() {
  function stripe(rows) {
    let i = 0;
    for (const row of rows) {
      const odd = i % 2 === 0; // 1ª visível = ímpar (#f5f5f5), como no :nth-child(odd) original
      row.classList.toggle('is-row-odd', odd);
      row.classList.toggle('is-row-even', !odd);
      i++;
    }
  }

  function update() {
    // cronograma: cada .tl-trechos tem sua própria sequência (zebra reinicia por grupo)
    document.querySelectorAll('.tl-trechos').forEach(container => {
      const visible = [...container.children].filter(el =>
        el.classList.contains('tl-trecho') && el.style.display !== 'none');
      stripe(visible);
    });
    // tabela: ignora as linhas separadoras (.tlt-sep-row) e as ocultas
    document.querySelectorAll('.tl-data-table tbody').forEach(tbody => {
      const visible = [...tbody.children].filter(el =>
        el.matches('tr:not(.tlt-sep-row)') && el.style.display !== 'none');
      stripe(visible);
    });
  }

  window._tlUpdateStriping = update;

  // Encapsula _tlUpdateTableView: ele já é chamado após cada filtro (apply),
  // ordenação (sortSection) e troca de visão (setView) — restripamos junto.
  const _orig = window._tlUpdateTableView;
  window._tlUpdateTableView = function() {
    if (_orig) _orig();
    update();
  };

  update();
})();

(function tlSortToggle() {
  function parseCode(str) {
    const m = (str || '').trim().match(/^(\d+)\/(\d+)(?:\s+([A-Za-z]))?/);
    if (!m) return [Infinity, Infinity, ''];
    return [parseInt(m[2], 10), parseInt(m[1], 10), m[3] || ''];
  }

  function parseDate(str) {
    if (!str) return null;
    const m = str.trim().match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/);
    if (!m) return null;
    let y = parseInt(m[3], 10);
    if (y < 100) y += 2000;
    return new Date(y, parseInt(m[2], 10) - 1, parseInt(m[1], 10)).getTime();
  }

  function getCode(entry) {
    const el = entry.querySelector('.tl-code');
    return el ? el.textContent.trim() : '';
  }

  function getIniDate(entry) {
    const el = entry.querySelector('.tl-dates--hdr');
    const txt = el ? el.textContent : '';
    const m = txt.match(/ini\s*([\d\/]+)/);
    return m ? parseDate(m[1]) : null;
  }

  function sortSection(section, mode) {
    section.querySelectorAll('.tl-entries').forEach(function(container) {
      const entries = [].slice.call(container.querySelectorAll(':scope > .tl-entry'));
      if (entries.length < 2) return;
      entries.sort(function(a, b) {
        if (mode === 'code-asc' || mode === 'code-desc') {
          const ca = parseCode(getCode(a)), cb = parseCode(getCode(b));
          let cmp = 0;
          if (ca[0] !== cb[0]) cmp = ca[0] - cb[0];
          else if (ca[1] !== cb[1]) cmp = ca[1] - cb[1];
          else cmp = ca[2].localeCompare(cb[2]);
          return mode === 'code-desc' ? -cmp : cmp;
        }
        const nullFallback = mode === 'date-asc' ? Infinity : -Infinity;
        const da = getIniDate(a), db = getIniDate(b);
        const dA = da !== null ? da : nullFallback;
        const dB = db !== null ? db : nullFallback;
        return mode === 'date-desc' ? dB - dA : dA - dB;
      });
      entries.forEach(function(e) { container.appendChild(e); });
    });
    if (window._tlUpdateSpineRange) window._tlUpdateSpineRange();
    if (window._tlRebuildTable) window._tlRebuildTable(section);
    if (window._tlUpdateTableView) window._tlUpdateTableView();
  }

  // Cada botão alterna entre 2 modos ao clicar: inativo → ativa (modo lembrado);
  // ativo → inverte para o outro modo do mesmo botão.
  var BTN_DEFS = [
    {
      id: 'code',
      modes:  ['code-asc',  'code-desc'],
      labels: ['Código ↑',  'Código ↓'],
      titles: ['Ordenar por código (crescente)', 'Ordenar por código (decrescente)'],
    },
    {
      id: 'date',
      modes:  ['date-desc', 'date-asc'],
      labels: ['Data ↓',    'Data ↑'],
      titles: ['Ordenar por data (mais recente primeiro)', 'Ordenar por data (mais antiga primeiro)'],
    },
  ];

  document.querySelectorAll('.tl-axis-section').forEach(function(section) {
    var controls = section.querySelector('.tl-axis-controls');
    if (!controls) return;

    var current = 'code-asc';
    var btnMem = { code: 'code-asc', date: 'date-desc' };
    var btnEls = {};

    function updateUI() {
      BTN_DEFS.forEach(function(def) {
        var btn = btnEls[def.id];
        var active = def.modes.indexOf(current) !== -1;
        btn.classList.toggle('is-active', active);
        btn.setAttribute('aria-pressed', String(active));
        var modeShown = active ? current : btnMem[def.id];
        var idx = def.modes.indexOf(modeShown);
        if (idx < 0) idx = 0;
        btn.textContent = def.labels[idx];
        btn.title = def.titles[idx];
      });
    }

    var group = document.createElement('div');
    group.className = 'tl-sort-toggle';
    group.setAttribute('role', 'group');
    group.setAttribute('aria-label', 'Ordenação');

    BTN_DEFS.forEach(function(def) {
      var btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'tl-sort-btn';
      btn.setAttribute('aria-pressed', 'false');

      btn.addEventListener('click', function() {
        if (def.modes.indexOf(current) !== -1) {
          var nextIdx = (def.modes.indexOf(current) + 1) % def.modes.length;
          current = def.modes[nextIdx];
        } else {
          current = btnMem[def.id];
        }
        btnMem[def.id] = current;
        updateUI();
        sortSection(section, current);
      });

      btnEls[def.id] = btn;
      group.appendChild(btn);
    });

    var viewToggle = controls.querySelector('.tl-view-toggle');
    controls.insertBefore(group, viewToggle || null);

    updateUI();
    sortSection(section, current);
  });
})();
