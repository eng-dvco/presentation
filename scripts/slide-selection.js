'use strict';

const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

const search = document.getElementById('slide-search');
const clearBtn = document.getElementById('search-clear');
const filterBtns = document.querySelectorAll('.filter-btn[data-filter]');
const sections = document.querySelectorAll('[data-section]');
const items = document.querySelectorAll('.item');
let activeFilter = 'all';

// ---- filtro e busca -------------------------------------------------------

function applyFilters() {
  const q = search.value.trim().toLowerCase();
  clearBtn.hidden = !q;

  items.forEach(item => {
    const sec = item.closest('[data-section]');
    const inFilter = activeFilter === 'all' || (sec && sec.dataset.section === activeFilter);
    const inSearch = !q || item.textContent.toLowerCase().includes(q);
    item.style.display = inFilter && inSearch ? '' : 'none';
  });

  sections.forEach(sec => {
    const filterMatch = activeFilter === 'all' || sec.dataset.section === activeFilter;
    if (!filterMatch) { sec.style.display = 'none'; return; }
    sec.style.display = '';
    if (q) {
      const sectionItems = sec.querySelectorAll('.item');
      if (sectionItems.length > 0) {
        const anyVisible = Array.from(sectionItems).some(i => i.style.display !== 'none');
        if (!anyVisible) sec.style.display = 'none';
      }
    }
  });

  const visibleSections = Array.from(sections).filter(s => s.style.display !== 'none');
  const shouldExpand = visibleSections.length < sections.length;
  sections.forEach(sec => {
    sec.classList.toggle('section-expanded', shouldExpand && sec.style.display !== 'none');
  });
}

search.addEventListener('input', applyFilters);

clearBtn.addEventListener('click', () => {
  search.value = '';
  applyFilters();
  search.focus();
});

// filtros cuja seção está ausente ou presente sem itens ficam indisponíveis
// (preenchimento transparente + cursor indicando a ausência da ação)
function sectionHasItems(sec) {
  // slides: ao menos um .item; documentos: ao menos uma entrada na lista
  return !!sec && !!(sec.querySelector('.item') || sec.querySelector('.list li:not(.li-subtitle)'));
}

filterBtns.forEach(btn => {
  if (btn.dataset.filter === 'all') return; // "Todos" está sempre disponível
  if (!sectionHasItems(document.querySelector(`[data-section="${btn.dataset.filter}"]`))) {
    btn.classList.add('is-empty');
    btn.setAttribute('aria-disabled', 'true');
    btn.tabIndex = -1;
  }
});

filterBtns.forEach(btn => {
  btn.addEventListener('click', () => {
    if (btn.classList.contains('is-empty')) return; // filtro indisponível: sem ação
    activeFilter = btn.dataset.filter;
    filterBtns.forEach(b => b.classList.toggle('active', b === btn));
    applyFilters();
  });
});

// ---- filtro e controles de documentos ---------------------------------------

const docSearch    = document.getElementById('doc-search');
const docClearBtn  = document.getElementById('doc-search-clear');
const docTypeBtns  = document.querySelectorAll('[data-doc-type]');
const docGroups    = document.querySelectorAll('.doc-group');
const docNoResults = document.querySelector('.doc-no-results');
const docCount     = document.querySelector('.doc-count');
const docToggleAll = document.getElementById('doc-toggle-all');
const docTotal     = Array.from(docGroups).reduce((n, g) => n + g.querySelectorAll('.doc-items li').length, 0);
let activeDocType  = 'all';

function syncToggleBtn() {
  if (!docToggleAll) return;
  const allOpen = Array.from(docGroups).every(g => g.open);
  docToggleAll.textContent = allOpen ? 'Recolher todos' : 'Expandir todos';
}

function applyDocFilters() {
  const q        = docSearch.value.trim().toLowerCase();
  const filtered = q || activeDocType !== 'all';
  docClearBtn.hidden = !q;

  let totalVisible = 0;

  docGroups.forEach(group => {
    const docItems = group.querySelectorAll('.doc-items li');
    let groupVisible = 0;

    docItems.forEach(li => {
      const typeTag     = li.querySelector('.ext-tag');
      const type        = typeTag ? typeTag.textContent.trim().toLowerCase() : '';
      const matchType   = activeDocType === 'all' || type === activeDocType;
      const nameEl = li.querySelector('.doc-name-text');
      const matchSearch = !q || (nameEl ? nameEl.textContent : li.textContent).toLowerCase().includes(q);
      const visible     = matchType && matchSearch;
      li.style.display  = visible ? '' : 'none';
      if (visible) groupVisible++;
    });

    group.style.display = (filtered && groupVisible === 0) ? 'none' : '';
    if (filtered && groupVisible > 0) group.open = true;
    totalVisible += groupVisible;
  });

  if (docNoResults) docNoResults.hidden = totalVisible > 0 || !filtered;
  if (docCount) docCount.textContent = filtered
    ? `${totalVisible} de ${docTotal} documentos`
    : `${docTotal} documentos`;
  syncToggleBtn();
  requestAnimationFrame(() => { refreshDocNameTruncation(); refreshDocMarquees(); });
}

if (docSearch) {
  docSearch.addEventListener('input', applyDocFilters);

  docClearBtn.addEventListener('click', () => {
    docSearch.value = '';
    applyDocFilters();
    docSearch.focus();
  });

  docTypeBtns.forEach(btn => {
    btn.addEventListener('click', () => {
      activeDocType = btn.dataset.docType;
      docTypeBtns.forEach(b => b.classList.toggle('active', b === btn));
      applyDocFilters();
    });
  });

  applyDocFilters();
}

function collapseGroup(group) {
  if (!group.open || group.dataset.closing) return;
  if (reducedMotion) { group.open = false; return; }
  const lis = [...group.querySelectorAll('.doc-items li')].filter(li => li.style.display !== 'none');
  if (!lis.length) { group.open = false; return; }
  group.dataset.closing = '1';
  const total = lis.length;
  const anims = lis.map((li, i) => li.animate(
    [{ opacity: 1 }, { opacity: 0 }],
    { duration: 180, delay: (total - 1 - i) * 35, fill: 'forwards', easing: 'ease-in' }
  ));
  // lis[0] tem o maior delay — aguarda o último a terminar
  anims[0].finished
    .then(() => { delete group.dataset.closing; group.open = false; })
    .catch(() => { delete group.dataset.closing; });
}

if (docToggleAll) {
  docToggleAll.addEventListener('click', () => {
    const allOpen = Array.from(docGroups).every(g => g.open);
    if (allOpen) {
      docGroups.forEach(g => collapseGroup(g));
    } else {
      docGroups.forEach(g => { g.open = true; });
      syncToggleBtn();
    }
  });

  docGroups.forEach(g => g.addEventListener('toggle', syncToggleBtn));
}

docGroups.forEach(group => {
  group.addEventListener('click', e => {
    if (group.open || e.target.closest('summary')) return;
    group.open = true;
  });

  // saída: delega para collapseGroup (animada ou imediata conforme reducedMotion)
  group.querySelector('summary').addEventListener('click', e => {
    if (!group.open) return;
    e.preventDefault();
    collapseGroup(group);
  });
});

if (!reducedMotion) {
  docGroups.forEach(group => {
    group.addEventListener('toggle', () => {
      if (!group.open) return;
      delete group.dataset.closing;
      const lis = [...group.querySelectorAll('.doc-items li')].filter(li => li.style.display !== 'none');
      // cancela animações de saída pendentes (fill: forwards manteria opacity: 0)
      lis.forEach(li => li.getAnimations().forEach(a => a.cancel()));
      // fill: 'backwards' aplica opacity: 0 imediatamente, antes do primeiro render
      lis.forEach((li, i) => {
        li.animate(
          [{ opacity: 0 }, { opacity: 1 }],
          { duration: 200, delay: i * 38, fill: 'backwards', easing: 'ease-out' }
        );
      });
    });
  });
}


// ---- tooltip e truncamento dos títulos de documentos ------------------------

document.querySelectorAll('.doc-name-text').forEach(el => {
  const wrap = el.closest('.doc-name-wrap');
  if (wrap) wrap.title = el.textContent.trim();
});

function refreshDocNameTruncation() {
  document.querySelectorAll('.doc-name-wrap').forEach(wrap => {
    const text = wrap.querySelector('.doc-name-text');
    if (!text) return;
    wrap.classList.toggle('is-truncated', text.scrollWidth > wrap.clientWidth + 1);
  });
}

// ---- marquee da descrição dos documentos ------------------------------------

function initDocDescMarquee(row) {
  if (row._descInitDone) return;
  row._descInitDone = true;
  const text = document.createElement('span');
  text.className = 'doc-desc-text';
  text.textContent = row.textContent;
  const track = document.createElement('span');
  track.className = 'doc-desc-track';
  track.appendChild(text);
  row.textContent = '';
  row.appendChild(track);
}

function measureDocDescMarquee(row) {
  if (!row._descInitDone) initDocDescMarquee(row);
  if (row._descAnim) { row._descAnim.cancel(); row._descAnim = null; }
  const track = row.querySelector('.doc-desc-track');
  const text  = row.querySelector('.doc-desc-text');
  if (!track || !text) return;
  const oldClone = track.querySelector('.doc-desc-clone');
  if (oldClone) oldClone.remove();
  row.classList.remove('is-overflowing');

  if (text.scrollWidth - row.clientWidth <= 1) return;
  row.classList.add('is-overflowing');
  if (reducedMotion) return;

  const clone = text.cloneNode(true);
  clone.classList.add('doc-desc-clone');
  clone.setAttribute('aria-hidden', 'true');
  track.appendChild(clone);

  const shift   = clone.getBoundingClientRect().left - text.getBoundingClientRect().left;
  const totalMs = (shift / 45 + 3) * 1000;
  row._descAnim = track.animate(
    [
      { transform: 'translateX(0)',            offset: 0              },
      { transform: 'translateX(0)',            offset: 3000 / totalMs },
      { transform: `translateX(${-shift}px)`, offset: 1              },
    ],
    { duration: totalMs, iterations: Infinity, easing: 'linear' }
  );
}

function refreshDocMarquees() {
  document.querySelectorAll('.doc-desc-row').forEach(measureDocDescMarquee);
}

let docResizeTimer;
window.addEventListener('resize', () => {
  clearTimeout(docResizeTimer);
  docResizeTimer = setTimeout(() => { refreshDocNameTruncation(); refreshDocMarquees(); }, 150);
});

// ---- ripple nos itens -----------------------------------------------------

if (!reducedMotion) {
  const spawnItemRipple = e => {
    const el = e.currentTarget;
    const rect = el.getBoundingClientRect();
    const cx = (e.touches ? e.touches[0].clientX : e.clientX) - rect.left;
    const cy = (e.touches ? e.touches[0].clientY : e.clientY) - rect.top;
    const dx = Math.max(cx, rect.width - cx);
    const dy = Math.max(cy, rect.height - cy);
    const r = Math.ceil(Math.sqrt(dx * dx + dy * dy));
    const dot = document.createElement('span');
    dot.className = 'item-ripple';
    dot.style.left = `${cx}px`;
    dot.style.top = `${cy}px`;
    dot.style.setProperty('--r', `${r}px`);
    el.appendChild(dot);
    dot.addEventListener('animationend', () => dot.remove(), { once: true });
  };

  items.forEach(item => {
    item.addEventListener('mousedown', spawnItemRipple);
    item.addEventListener('touchstart', spawnItemRipple, { passive: true });
  });

  // mesma animação de clique nos filtros clicáveis (exceto os indisponíveis)
  document.querySelectorAll('.filter-btn').forEach(btn => {
    if (btn.classList.contains('is-empty')) return;
    btn.addEventListener('mousedown', spawnItemRipple);
    btn.addEventListener('touchstart', spawnItemRipple, { passive: true });
  });

  // itens individuais de documento
  document.querySelectorAll('.doc-items li').forEach(li => {
    li.addEventListener('mousedown', spawnItemRipple);
    li.addEventListener('touchstart', spawnItemRipple, { passive: true });
  });
}

// ---- botão retornar ao topo ------------------------------------------------

const backToTop = document.getElementById('back-to-top');
if (backToTop) {
  const SCROLL_THRESHOLD = 400;
  let scrollTicking = false;

  window.addEventListener('scroll', () => {
    if (scrollTicking) return;
    scrollTicking = true;
    requestAnimationFrame(() => {
      backToTop.classList.toggle('is-visible', window.scrollY >= SCROLL_THRESHOLD);
      scrollTicking = false;
    });
  }, { passive: true });

  backToTop.addEventListener('click', () => {
    window.scrollTo({ top: 0, behavior: reducedMotion ? 'auto' : 'smooth' });
  });
}
