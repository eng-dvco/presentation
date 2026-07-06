'use strict';

const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

// busca sem acentuação: normaliza removendo diacríticos (ã/á/à/â → a, ç → c, …) e caixa
function foldAccents(s) { return (s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase(); }

const search = document.getElementById('slide-search');
const clearBtn = document.getElementById('search-clear');
const filterBtns = document.querySelectorAll('.filter-btn[data-filter]');
const sections = document.querySelectorAll('[data-section]');
const items = document.querySelectorAll('.item');
let activeFilter = 'all';

// ---- filtro e busca -------------------------------------------------------

function applyFilters() {
  const q = foldAccents(search.value.trim());
  clearBtn.hidden = !q;

  items.forEach(item => {
    const sec = item.closest('[data-section]');
    const inFilter = activeFilter === 'all' || (sec && sec.dataset.section === activeFilter);
    const inSearch = !q || foldAccents(item.textContent).includes(q);
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
  // slides: ao menos um .item; documentos: ao menos uma entrada na lista; timelines: ao menos uma entrada
  return !!sec && !!(
    sec.querySelector('.item') ||
    sec.querySelector('.list li:not(.li-subtitle)') ||
    sec.querySelector('.tl-entry')
  );
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

// ---- persistência da seleção (rolagem + filtro + busca) ------------------
// Ao voltar pelo "conteúdo" do breadcrumb de um slide, reabre a seleção no mesmo
// estado: mesmo filtro de seção, mesma busca e mesmo ponto de rolagem. Visitas
// novas continuam no topo e sem filtro — só restaura quando o retorno foi
// sinalizado pelo slide (sessionStorage), nunca em uma carga comum.
// restoringFromSlide é compartilhado com a persistência da seção de documentos
// (mais abaixo), que reabre os grupos colapsáveis nesse mesmo retorno sinalizado.
let restoringFromSlide = false;
(() => {
  const ss = {
    get: (k, d = '') => { try { const v = sessionStorage.getItem(k); return v === null ? d : v; } catch { return d; } },
    set: (k, v) => { try { sessionStorage.setItem(k, v); } catch {} },
    del: (k) => { try { sessionStorage.removeItem(k); } catch {} },
  };

  // salva o estado atual ao sair da seleção (clique em item, breadcrumb, logo…)
  window.addEventListener('pagehide', () => {
    ss.set('indexScrollY', String(Math.round(window.scrollY)));
    ss.set('indexFilter', activeFilter);
    ss.set('indexQuery', search.value);
  });

  if (ss.get('indexRestoreScroll') !== '1') return;   // retorno não sinalizado → topo
  ss.del('indexRestoreScroll');
  restoringFromSlide = true;

  // 1) reaplica a busca e o filtro salvos antes de posicionar a rolagem
  const savedQuery = ss.get('indexQuery');
  const savedFilter = ss.get('indexFilter', 'all');
  if (savedQuery) search.value = savedQuery;
  const btn = Array.from(filterBtns).find(b => b.dataset.filter === savedFilter && !b.classList.contains('is-empty'));
  if (btn && savedFilter !== 'all') {
    activeFilter = savedFilter;
    filterBtns.forEach(b => b.classList.toggle('active', b === btn));
  }
  if (savedQuery || activeFilter !== 'all') applyFilters();

  // 2) restaura a rolagem depois que o layout filtrado já está aplicado
  const y = parseInt(ss.get('indexScrollY', '0'), 10) || 0;
  if (y > 0) {
    const apply = () => window.scrollTo(0, y);
    apply();
    requestAnimationFrame(apply);
    window.addEventListener('load', apply, { once: true });
  }
})();

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
  const q        = foldAccents(docSearch.value.trim());
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
      const matchSearch = !q || foldAccents(nameEl ? nameEl.textContent : li.textContent).includes(q);
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


// ---- persistência do estado da seção de documentos -------------------------
// No retorno sinalizado a partir de um slide (mesma condição da persistência da
// seleção acima), reabre a seção "Documentos Recebidos" no mesmo estado: grupos
// colapsáveis abertos, filtro de tipo, busca e realce do documento aberto.
// Visitas novas continuam no padrão (grupos recolhidos).
(() => {
  if (!docGroups.length) return;
  const ss = {
    get: (k, d = '') => { try { const v = sessionStorage.getItem(k); return v === null ? d : v; } catch { return d; } },
    set: (k, v) => { try { sessionStorage.setItem(k, v); } catch {} },
    del: (k) => { try { sessionStorage.removeItem(k); } catch {} },
  };

  // salva o estado ao sair (clique em "ir", item, breadcrumb, logo…)
  window.addEventListener('pagehide', () => {
    ss.set('indexDocGroupsOpen', Array.from(docGroups).map(g => g.open ? '1' : '0').join(''));
    ss.set('indexDocType', activeDocType);
    ss.set('indexDocQuery', docSearch ? docSearch.value : '');
  });

  // registra qual documento foi aberto ao clicar no "ir" (para realçá-lo na volta)
  document.querySelectorAll('.doc-items li .doc-goto').forEach(goto => {
    goto.addEventListener('click', () => {
      const name = goto.closest('li').querySelector('.doc-name-text');
      ss.set('indexDocFocus', name ? name.textContent.trim() : '');
    });
  });

  if (!restoringFromSlide) return;   // visita nova → grupos no padrão (recolhidos)

  // 1) restaura o filtro de tipo e a busca, depois reaplica os filtros
  const savedType  = ss.get('indexDocType', 'all');
  const savedQuery = ss.get('indexDocQuery', '');
  if (docSearch && savedQuery) docSearch.value = savedQuery;
  const typeBtn = Array.from(docTypeBtns).find(b => b.dataset.docType === savedType);
  if (typeBtn && savedType !== 'all') {
    activeDocType = savedType;
    docTypeBtns.forEach(b => b.classList.toggle('active', b === typeBtn));
  }
  if (savedQuery || activeDocType !== 'all') applyDocFilters();

  // 2) reabre exatamente os grupos que estavam abertos ao sair
  const savedGroups = ss.get('indexDocGroupsOpen', '');
  if (savedGroups.length === docGroups.length) {
    docGroups.forEach((g, i) => { g.open = savedGroups[i] === '1'; });
    syncToggleBtn();
  }

  // 3) realça o último documento aberto (a rolagem já é restaurada acima); some
  //    após o uso para não repetir o realce em retornos seguintes
  const focusName = ss.get('indexDocFocus', '');
  ss.del('indexDocFocus');
  if (focusName) {
    const target = Array.from(document.querySelectorAll('.doc-items li')).find(li => {
      const n = li.querySelector('.doc-name-text');
      return n && n.textContent.trim() === focusName;
    });
    if (target) {
      const det = target.closest('details');
      if (det) det.open = true;
      target.classList.remove('doc-flash');
      void target.offsetWidth;
      target.classList.add('doc-flash');
    }
  }
})();


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

// ---- marquee do nome dos documentos ----------------------------------------
// espelha o marquee da descrição (loop CONTÍNUO via clone): quando o .doc-name-text
// excede a largura visível do .doc-name-wrap, um clone é encostado após o texto
// (separado pelo gap do .doc-name-track) e o trilho desliza -shift, fazendo o nome
// reaparecer sem corte. Sem espera inicial e a ~55 px/s, igual à descrição.

function measureDocNameMarquee(wrap) {
  if (wrap._nameAnim) { wrap._nameAnim.cancel(); wrap._nameAnim = null; }
  const track = wrap.querySelector('.doc-name-track');
  const text  = wrap.querySelector('.doc-name-text');
  if (!track || !text) return;
  const oldClone = track.querySelector('.doc-name-clone');
  if (oldClone) oldClone.remove();

  // só anima quando o texto está realmente truncado (mesma condição da máscara)
  if (text.scrollWidth - wrap.clientWidth <= 1 || reducedMotion) return;

  // clone que segue o original: ao transladar -shift (= largura do texto + gap),
  // o clone ocupa a posição inicial do texto → reinício contínuo, sem salto
  const clone = text.cloneNode(true);
  clone.classList.add('doc-name-clone');
  clone.setAttribute('aria-hidden', 'true');
  track.appendChild(clone);

  const shift   = clone.getBoundingClientRect().left - text.getBoundingClientRect().left;
  const totalMs = (shift / 55) * 1000;
  wrap._nameAnim = track.animate(
    [
      { transform: 'translateX(0)',           offset: 0 },
      { transform: `translateX(${-shift}px)`, offset: 1 },
    ],
    // 1 ciclo só: ao terminar, fica parqueado no estado final (forwards), sem salto
    { duration: totalMs, iterations: 1, fill: 'forwards', easing: 'linear' }
  );
  // pausada por padrão: só desliza ao clicar/tocar o container do documento
  wrap._nameAnim.pause();
}

// inicia (do começo) UM único ciclo do deslizamento do nome de UMA linha;
// se já estiver tocando, ignora o gatilho para não interferir
function playDocNameMarquee(wrap) {
  const anim = wrap && wrap._nameAnim;
  if (!anim) return;
  if (anim.playState === 'running') return;
  anim.currentTime = 0;
  anim.play();
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
  // velocidade levemente maior (55 px/s) e SEM espera inicial: ao clicar/tocar
  // o container, o deslizamento começa imediatamente do offset 0
  const totalMs = (shift / 55) * 1000;
  row._descAnim = track.animate(
    [
      { transform: 'translateX(0)',           offset: 0 },
      { transform: `translateX(${-shift}px)`, offset: 1 },
    ],
    // 1 ciclo só: ao terminar, fica parqueado no estado final (forwards), sem salto
    { duration: totalMs, iterations: 1, fill: 'forwards', easing: 'linear' }
  );
  // por-documento: a animação não toca sozinha — fica pausada até clicar/tocar
  // o container do documento
  row._descAnim.pause();
}

// inicia (do começo) UM único ciclo do deslizamento da descrição de UMA linha;
// se já estiver tocando, ignora o gatilho para não interferir
function playDocDescMarquee(row) {
  const anim = row && row._descAnim;
  if (!anim) return;
  if (anim.playState === 'running') return;
  anim.currentTime = 0;
  anim.play();
}

function refreshDocMarquees() {
  document.querySelectorAll('.doc-desc-row').forEach(measureDocDescMarquee);
  document.querySelectorAll('.doc-name-wrap').forEach(measureDocNameMarquee);
}

// gatilho por CLIQUE no CONTAINER: clicar o item (<li>) executa 1 ciclo do
// marquee da DESCRIÇÃO. POR ENQUANTO o título permanece fixo (sem deslize) — a
// chamada playDocNameMarquee está desativada; basta reativá-la p/ animar o título
// de novo. NÃO há gatilho por hover — em QUALQUER viewport (inclusive nas maiores,
// onde antes rodava ao pairar o mouse) o deslize só roda ao clicar/tocar o
// container. playDocDescMarquee é no-op quando a descrição não está truncada, e
// ignora-se enquanto um ciclo já está em andamento.
if (!reducedMotion) {
  document.querySelectorAll('.doc-items li').forEach(li => {
    const descRow = li.querySelector('.doc-desc-row');
    li.addEventListener('click', e => {
      // o clique no link "ir ↗" navega p/ o slide — não dispara o marquee
      if (e.target.closest('.doc-goto')) return;
      playDocDescMarquee(descRow); // título fixo por enquanto (ver comentário acima)
    });
  });
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

/* Vínculo bidirecional documento↔slide: ao chegar em index.html#doc-…, abre o
   grupo <details> do documento, rola até ele e o destaca brevemente. */
(function docDeepLink() {
  function focus() {
    var h = location.hash;
    if (!h || h.length < 2) return;
    var li = null;
    try { li = document.getElementById(decodeURIComponent(h.slice(1))); } catch (e) { li = null; }
    if (!li) return;
    var det = li.closest('details');
    if (det) det.open = true;
    li.scrollIntoView({ behavior: 'smooth', block: 'center' });
    li.classList.remove('doc-flash');
    void li.offsetWidth;
    li.classList.add('doc-flash');
  }
  window.addEventListener('hashchange', focus);
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', focus);
  else focus();
})();
