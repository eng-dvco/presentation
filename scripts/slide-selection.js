'use strict';

const search = document.getElementById('slide-search');
const clearBtn = document.getElementById('search-clear');
const filterBtns = document.querySelectorAll('.filter-btn');
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

// ---- ripple nos itens -----------------------------------------------------

const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

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
  filterBtns.forEach(btn => {
    if (btn.classList.contains('is-empty')) return;
    btn.addEventListener('mousedown', spawnItemRipple);
    btn.addEventListener('touchstart', spawnItemRipple, { passive: true });
  });
}
