'use strict';

const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

// Navegações novas (clique em link da sidebar, setas, digitar a URL) devem
// iniciar pelo topo; já voltar/avançar pelo navegador deve RESTAURAR a posição
// onde o usuário estava (onde clicou). É exatamente o que o modo 'auto' faz:
// navegação nova → topo (rolagem 0); travessia de histórico → posição salva.
// O bug de "iniciar no fim da página" era causado pelo scrollIntoView da
// navegação lateral (agora restrito à própria lista via scrollActiveIntoNav),
// não pela restauração — por isso não forçamos mais o topo aqui.
if ('scrollRestoration' in history) history.scrollRestoration = 'auto';

// Voltar à seleção pelo "conteúdo" do breadcrumb deve reabrir o índice no ponto
// de onde o usuário saiu (onde clicou no item da seção) — como o botão "voltar"
// do navegador. Aqui apenas sinalizamos a intenção; o índice restaura a posição
// salva (ver slide-selection.js).
document.querySelectorAll('.breadcrumb a[href$="index.html"]').forEach((a) => {
  a.addEventListener('click', () => {
    try { sessionStorage.setItem('indexRestoreScroll', '1'); } catch {}
  });
});

// state shared between keyboard handler and lightbox
let prevUrl = null;
let nextUrl = null;
let lightboxOpen = false;
let currentImgIdx = 0;
let overlay, overlayStage, overlayImg, overlayCaption, overlayTitle, overlayCount, overlayClose, overlayPrev, overlayNext;
let imgGroupInfo = [];
let autoTimer = null;
let autoStart = null;
let autoRemaining = 10000;
let isHoveringMain = false;
const AUTO_DURATION = 10000;

const mosaicImages = Array.from(document.querySelectorAll('.mosaic-container img'));

// ---- 1. NAVEGAÇÃO ENTRE SEÇÕES --------------------------------------------
// Os botões "anterior"/"próximo" da barra lateral saltam para a seção vizinha
// (1º item dela), seguindo a ordem exibida no index.html. Seções, ordem e
// rótulos são lidos dinamicamente do index.html — acrescentar um item ou uma
// seção lá reflete nestes botões automaticamente. As setas ← → usam os mesmos
// destinos.

function spawnRipple(e) {
  const el = e.currentTarget;
  const rect = el.getBoundingClientRect();
  const cx = (e.touches ? e.touches[0].clientX : e.clientX) - rect.left;
  const cy = (e.touches ? e.touches[0].clientY : e.clientY) - rect.top;
  const dx = Math.max(cx, rect.width - cx);
  const dy = Math.max(cy, rect.height - cy);
  const r = Math.ceil(Math.sqrt(dx * dx + dy * dy));
  const dot = document.createElement('span');
  dot.className = 'nav-hint-ripple';
  dot.style.left = `${cx}px`;
  dot.style.top = `${cy}px`;
  dot.style.setProperty('--r', `${r}px`);
  el.appendChild(dot);
  dot.addEventListener('animationend', () => dot.remove(), { once: true });
}

// Remove apenas o prefixo do código real da seção (ex.: "SE — "), derivado do
// data-section, para nunca cortar uma palavra hifenizada legítima de um título
// futuro (ex.: "Pré-operação").
function cleanSectionName(raw, code) {
  let name = (raw || '').replace(/\s+/g, ' ').trim();
  if (code) {
    const esc = code.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    name = name.replace(new RegExp(`^${esc}\\s*[—–-]\\s*`, 'i'), '').trim();
  }
  return name;
}

// Lê o index.html e devolve as seções navegáveis, na ordem exibida, cada uma
// com seus itens reais (ignora itens "pending", cujo href ainda não aponta a um
// slide). Acrescentar item/seção no index.html reflete aqui sem mais nada.
function parseSections(doc) {
  const sections = [];
  for (const sec of doc.querySelectorAll('.selection-grid > section[data-section]')) {
    const title = cleanSectionName(sec.querySelector('.title-h2')?.textContent ?? '', sec.dataset.section);
    const items = Array.from(sec.querySelectorAll('a.item[href]'))
      .filter(a => !a.classList.contains('pending'))
      .map(a => ({ slug: a.getAttribute('href').split('/').pop(), label: a.textContent.trim() }))
      .filter(it => /^slide-.+\.html$/.test(it.slug));
    if (items.length) sections.push({ code: sec.dataset.section, title, items });
  }
  return sections;
}

function findCurrentSectionIndex(sections, slug) {
  const i = sections.findIndex(s => s.items.some(it => it.slug === slug));
  if (i !== -1) return i;
  // Sub-slides (ex.: slide-lt-maintenance-cpisf.html) não estão listados no
  // index.html — herdam a seção do slide "geral" correspondente.
  if (/^slide-lt-maintenance-/.test(slug)) {
    return sections.findIndex(s => s.items.some(it => it.slug === 'slide-lt-maintenance-general.html'));
  }
  return -1;
}

// Marca os itens cujo nome ultrapassa as 2 linhas: só nesses o gradiente de
// esmaecimento/truncamento (CSS .is-clamped::after) é exibido.
function markClampedItems(list) {
  if (!list) return;
  list.querySelectorAll('.secnav-item-link').forEach(link => {
    const name = link.querySelector('.secnav-item-name');
    link.classList.remove('is-clamped');
    if (!name) return;
    const hidden = name.scrollHeight - name.clientHeight; // parte oculta do nome
    if (hidden > 2) {
      link.classList.add('is-clamped');
      // distância e duração do deslize que revela o restante ao pairar
      name.style.setProperty('--reveal-distance', `${hidden}px`);
      const dur = Math.max(1.1, hidden / 14); // ~14 px/s: deslize lento
      name.style.setProperty('--reveal-duration', `${dur.toFixed(2)}s`);
    } else {
      name.style.removeProperty('--reveal-distance');
      name.style.removeProperty('--reveal-duration');
    }
  });
}

// Navegação entre os itens da seção atual (lista abaixo dos botões de seção).
// Para sub-slides (lt-maintenance-*), que não estão no index.html, usa a
// sub-navegação (.nav-list) embutida na própria página.
function buildItemNav(section, currentSlug) {
  let items = section ? section.items.slice() : [];
  let title = section ? section.title : '';
  if (!items.some(it => it.slug === currentSlug)) {
    const navList = document.querySelector('.nav-list');
    if (navList) {
      items = Array.from(navList.querySelectorAll('a.item[href]'))
        .map(a => ({ slug: a.getAttribute('href').split('/').pop(), label: a.textContent.trim() }))
        .filter(it => /^slide-.+\.html$/.test(it.slug));
      title = document.querySelector('h1.title-h1')?.textContent.trim() || title;
    }
  }
  if (items.length < 2) return null;

  const group = document.createElement('div');
  group.className = 'secnav-items';

  // cabeçalho: rótulo fixo à esquerda + total de slides (entre parênteses) à direita
  const heading = document.createElement('p');
  heading.className = 'secnav-items-title';
  const label = document.createElement('span');
  label.textContent = 'slides desta seção';
  const count = document.createElement('span');
  count.className = 'secnav-items-count';
  count.textContent = `(${items.length})`;
  heading.appendChild(label);
  heading.appendChild(count);
  group.appendChild(heading);

  const list = document.createElement('div');
  list.className = 'secnav-items-list';
  let activeLink = null;
  items.forEach(it => {
    const isCurrent = it.slug === currentSlug;
    const link = document.createElement('a');
    link.href = it.slug;
    link.className = 'secnav-item-link' + (isCurrent ? ' active' : '');
    // nome em um span próprio (janela recortada a 2 linhas + máscara) com um
    // span interno que desliza verticalmente ao pairar, revelando o nome todo
    const name = document.createElement('span');
    name.className = 'secnav-item-name';
    const nameInner = document.createElement('span');
    nameInner.className = 'secnav-item-name-inner';
    nameInner.textContent = it.label;
    name.appendChild(nameInner);
    link.appendChild(name);
    if (isCurrent) {
      link.setAttribute('aria-current', 'page');
      activeLink = link;
    } else {
      // memoriza o item de origem p/ o marcador deslizar até o destino na página seguinte
      link.addEventListener('click', () => {
        try { sessionStorage.setItem('secnav-from', currentSlug); } catch {}
      });
      if (!reducedMotion) {
        link.addEventListener('mousedown', spawnRipple);
        link.addEventListener('touchstart', spawnRipple, { passive: true });
      }
    }
    list.appendChild(link);
  });

  // marcador do item ativo: barra vertical de 4px que desliza entre os itens
  let marker = null;
  if (activeLink) {
    marker = document.createElement('span');
    marker.className = 'secnav-marker';
    marker.setAttribute('aria-hidden', 'true');
    list.appendChild(marker);
  }

  group.appendChild(list);
  return { group, activeLink, list, marker };
}

// Posiciona o marcador (translateY + altura) na linha de um item.
function moveMarkerTo(marker, el, animate) {
  if (!animate) marker.style.transition = 'none';
  marker.style.left = `${el.offsetLeft}px`;
  marker.style.height = `${el.offsetHeight}px`;
  marker.style.transform = `translateY(${el.offsetTop}px)`;
  if (!animate) {
    void marker.offsetWidth;      // aplica a posição sem transição…
    marker.style.transition = ''; // …e reabilita a transição definida no CSS
  }
}

// Na carga: fica direto no item ativo; se viemos de outro item da mesma lista
// (clique anterior, gravado em sessionStorage), parte da origem e desliza até ele.
function initMarker(itemNav) {
  const { marker, activeLink, list } = itemNav;
  if (!marker || !activeLink) return;
  let from = null;
  try { from = sessionStorage.getItem('secnav-from'); sessionStorage.removeItem('secnav-from'); } catch {}
  const fromLink = (from && from !== activeLink.getAttribute('href'))
    ? list.querySelector(`.secnav-item-link[href="${from}"]`) : null;
  if (!reducedMotion && fromLink && fromLink !== activeLink) {
    moveMarkerTo(marker, fromLink, false);                               // origem (instantâneo)
    requestAnimationFrame(() => moveMarkerTo(marker, activeLink, true)); // desliza até o destino
  } else {
    moveMarkerTo(marker, activeLink, false);                            // carga direta
  }
}

// Sidebar colapsível com TODAS as seções navegáveis (acima de anterior/próximo).
// O cabeçalho mostra a seção atual; ao expandir, lista todas as seções e permite
// saltar direto ao 1º item de qualquer uma. O estado (aberto/fechado) é
// memorizado em sessionStorage, persistindo entre os slides.
function buildAllSectionsNav(sections, currentIndex) {
  if (sections.length < 2) return null;
  const current = sections[currentIndex] || null;

  const wrap = document.createElement('div');
  wrap.className = 'secnav-all';

  const listId = 'secnav-all-list';
  const toggle = document.createElement('button');
  toggle.type = 'button';
  toggle.className = 'secnav-btn secnav-all-toggle';
  toggle.setAttribute('aria-controls', listId);
  toggle.setAttribute('aria-label', `Todas as seções (atual: ${current ? current.title : '—'})`);

  const kicker = document.createElement('span');
  kicker.className = 'secnav-dir';
  kicker.innerHTML = '<span>seções</span><span class="secnav-all-chevron" aria-hidden="true">▾</span>';
  toggle.appendChild(kicker);

  const cur = document.createElement('span');
  cur.className = 'secnav-section';
  cur.textContent = current ? current.title : 'Seções';
  toggle.appendChild(cur);

  if (!reducedMotion) {
    toggle.addEventListener('mousedown', spawnRipple);
    toggle.addEventListener('touchstart', spawnRipple, { passive: true });
  }
  wrap.appendChild(toggle);

  // corpo colapsível: a lista de todas as seções
  const listWrap = document.createElement('div');
  listWrap.className = 'secnav-all-list';
  listWrap.id = listId;
  const listInner = document.createElement('div');
  listInner.className = 'secnav-all-list-inner';
  const links = document.createElement('div');
  links.className = 'secnav-all-links';
  listInner.appendChild(links);

  // atalho no topo: volta para a tela de seleção (index.html)
  const home = document.createElement('a');
  home.href = 'index.html';
  home.className = 'secnav-item-link secnav-all-link secnav-all-home';
  home.textContent = 'Seleção de conteúdo';
  if (!reducedMotion) {
    home.addEventListener('mousedown', spawnRipple);
    home.addEventListener('touchstart', spawnRipple, { passive: true });
  }
  links.appendChild(home);

  const divider = document.createElement('div');
  divider.className = 'secnav-all-divider';
  divider.setAttribute('aria-hidden', 'true');
  links.appendChild(divider);

  sections.forEach((sec, idx) => {
    const isCurrent = idx === currentIndex;
    const link = document.createElement('a');
    link.href = sec.items[0].slug;
    link.className = 'secnav-item-link secnav-all-link' + (isCurrent ? ' active' : '');
    link.textContent = sec.title;
    if (isCurrent) {
      link.setAttribute('aria-current', 'true');
    } else if (!reducedMotion) {
      link.addEventListener('mousedown', spawnRipple);
      link.addEventListener('touchstart', spawnRipple, { passive: true });
    }
    links.appendChild(link);
  });
  listWrap.appendChild(listInner);
  wrap.appendChild(listWrap);

  // estado aberto/fechado memorizado (fechado por padrão)
  let open = false;
  try { open = sessionStorage.getItem('secnav-all-open') === '1'; } catch {}
  const apply = () => {
    wrap.classList.toggle('is-open', open);
    toggle.setAttribute('aria-expanded', open ? 'true' : 'false');
  };
  apply();
  toggle.addEventListener('click', () => {
    open = !open;
    try { sessionStorage.setItem('secnav-all-open', open ? '1' : '0'); } catch {}
    apply();
  });

  return wrap;
}

// Rola o item ativo para dentro da própria lista da sidebar SEM mexer na rolagem
// da janela. (scrollIntoView afetaria todos os ancestrais roláveis, inclusive a
// janela — o que jogava a página para o fim em viewports menores, onde a lista
// flui no documento, abaixo do conteúdo, em vez de rolar internamente.)
function scrollActiveIntoNav(link) {
  if (!link) return;
  const list = link.closest('.secnav-items-list');
  if (!list || list.scrollHeight <= list.clientHeight + 1) return; // não rolável → nada a fazer
  const linkRect = link.getBoundingClientRect();
  const listRect = list.getBoundingClientRect();
  const within = (linkRect.top - listRect.top) + list.scrollTop;
  list.scrollTop = within - (list.clientHeight - linkRect.height) / 2;
}

function buildSectionNav(sections, currentIndex, currentSlug) {
  const nav = document.createElement('nav');
  nav.className = 'slide-sidebar slide-secnav';
  nav.setAttribute('aria-label', 'Navegação dos slides');

  // sidebar colapsível com todas as seções
  const allNav = buildAllSectionsNav(sections, currentIndex);
  // navegação entre os itens da seção atual — incluída dentro do container colapsível
  const itemNav = buildItemNav(sections[currentIndex], currentSlug);
  if (allNav) {
    if (itemNav) {
      const listInner = allNav.querySelector('.secnav-all-list-inner');
      if (listInner) listInner.appendChild(itemNav.group);
    }
    nav.appendChild(allNav);
  } else if (itemNav) {
    nav.appendChild(itemNav.group);
  }

  const container = document.querySelector('.content-container');
  if (!container) return;
  container.insertAdjacentElement('afterbegin', nav);
  container.classList.add('has-sidebar');

  const settle = () => {
    if (itemNav) markClampedItems(itemNav.list);
    if (itemNav && itemNav.activeLink) scrollActiveIntoNav(itemNav.activeLink);
  };
  requestAnimationFrame(settle);
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(settle);

  if (itemNav && itemNav.marker) {
    const initOnce = () => requestAnimationFrame(() => initMarker(itemNav));
    if (document.fonts && document.fonts.ready) document.fonts.ready.then(initOnce);
    else initOnce();
  }

  let resizeTimer;
  window.addEventListener('resize', () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => {
      if (itemNav) markClampedItems(itemNav.list);
      if (itemNav && itemNav.marker && itemNav.activeLink) {
        moveMarkerTo(itemNav.marker, itemNav.activeLink, false);
      }
    }, 150);
  });
}

async function initNav() {
  try {
    const res = await fetch('./index.html');
    const text = await res.text();
    const doc = new DOMParser().parseFromString(text, 'text/html');
    const sections = parseSections(doc);
    const slug = location.pathname.split('/').pop();
    const i = findCurrentSectionIndex(sections, slug);
    if (i === -1) return;
    prevUrl = i > 0 ? sections[i - 1].items[0].slug : null;
    nextUrl = i < sections.length - 1 ? sections[i + 1].items[0].slug : null;
    buildSectionNav(sections, i, slug);
  } catch {
    // fetch indisponível (offline / protocolo file://) — navegação não aparece
  }
}

initNav();

// ---- 2. AUTO-AVANÇO DO LIGHTBOX ------------------------------------------

function flashPlayIndicator() {
  if (mosaicImages.length <= 1 || reducedMotion) return;
  const thumbs = overlay?.querySelectorAll('.lightbox-thumb');
  const thumbPlayIcon = thumbs?.[currentImgIdx]?.querySelector('.thumb-play-icon');
  if (thumbPlayIcon) {
    thumbPlayIcon.classList.remove('is-playing');
    void thumbPlayIcon.offsetWidth;
    thumbPlayIcon.classList.add('is-playing');
  }
}

function clearAutoTimer() {
  if (autoTimer !== null) { clearInterval(autoTimer); autoTimer = null; }
}

function startAutoProgress() {
  if (mosaicImages.length <= 1 || isHoveringMain) return;
  clearAutoTimer();
  autoStart = Date.now() - (AUTO_DURATION - autoRemaining);
  autoTimer = setInterval(() => {
    const pct = Math.min((Date.now() - autoStart) / AUTO_DURATION, 1);
    overlay?.querySelectorAll('.lightbox-thumb-progress').forEach((bar, i) => {
      bar.style.width = i === currentImgIdx ? `${pct * 100}%` : '0%';
    });
    if (pct >= 1) { clearAutoTimer(); showImage((currentImgIdx + 1) % mosaicImages.length); }
  }, 50);
}

function resetAutoProgress() {
  clearAutoTimer();
  autoRemaining = AUTO_DURATION;
  overlay?.querySelectorAll('.lightbox-thumb-progress').forEach(bar => { bar.style.width = '0%'; });
  startAutoProgress();
}

// ---- 3. LIGHTBOX ----------------------------------------------------------

function getGroupTitle(img) {
  const mosaic = img.closest('.mosaic-container');
  if (!mosaic) return '';
  let el = mosaic.previousElementSibling;
  while (el) {
    if (el.classList.contains('title-header-h2') || el.classList.contains('title-header-h3')) {
      return el.querySelector('h2, h3')?.textContent.trim() ?? '';
    }
    el = el.previousElementSibling;
  }
  return '';
}

function buildLightbox() {
  const groupMap = new Map();
  mosaicImages.forEach((img, i) => {
    const title = getGroupTitle(img);
    if (!groupMap.has(title)) groupMap.set(title, []);
    groupMap.get(title).push(i);
  });
  imgGroupInfo = mosaicImages.map((img, i) => {
    const title = getGroupTitle(img);
    const indices = groupMap.get(title);
    return { posInGroup: indices.indexOf(i) + 1, groupTotal: indices.length };
  });

  overlay = document.createElement('div');
  overlay.className = 'lightbox-overlay';
  overlay.setAttribute('role', 'dialog');
  overlay.setAttribute('aria-modal', 'true');
  overlay.setAttribute('aria-label', 'Visualização de imagem');

  overlayClose = document.createElement('button');
  overlayClose.className = 'lightbox-close';
  overlayClose.setAttribute('aria-label', 'Fechar visualização');
  overlayClose.textContent = '✕';

  overlayStage = document.createElement('div');
  overlayStage.className = 'lightbox-stage';

  overlayPrev = document.createElement('button');
  overlayPrev.className = 'lightbox-nav lightbox-nav-prev';
  overlayPrev.setAttribute('aria-label', 'Imagem anterior');
  overlayPrev.innerHTML = '&#8249;';

  overlayNext = document.createElement('button');
  overlayNext.className = 'lightbox-nav lightbox-nav-next';
  overlayNext.setAttribute('aria-label', 'Próxima imagem');
  overlayNext.innerHTML = '&#8250;';

  overlayImg = document.createElement('img');
  overlayImg.className = 'lightbox-img';
  overlayImg.alt = '';

  overlayStage.appendChild(overlayPrev);
  overlayStage.appendChild(overlayImg);
  overlayStage.appendChild(overlayNext);

  const thumbsBar = document.createElement('div');
  thumbsBar.className = 'lightbox-thumbs';
  thumbsBar.setAttribute('aria-label', 'Miniaturas');

  const sharedTooltip = document.createElement('div');
  sharedTooltip.className = 'thumb-tooltip';
  document.body.appendChild(sharedTooltip);

  mosaicImages.forEach((img, i) => {
    const wrap = document.createElement('div');
    wrap.className = 'lightbox-thumb-wrap';

    const btn = document.createElement('button');
    btn.className = 'lightbox-thumb';
    btn.setAttribute('aria-label', img.alt || `Imagem ${i + 1}`);
    const thumb = document.createElement('img');
    thumb.src = img.src;
    thumb.alt = '';
    btn.appendChild(thumb);
    const pauseIcon = document.createElement('span');
    pauseIcon.className = 'thumb-pause-icon';
    pauseIcon.setAttribute('aria-hidden', 'true');
    btn.appendChild(pauseIcon);
    const playIcon = document.createElement('span');
    playIcon.className = 'thumb-play-icon';
    playIcon.setAttribute('aria-hidden', 'true');
    btn.appendChild(playIcon);
    btn.addEventListener('click', () => showImage(i));

    const bar = document.createElement('span');
    bar.className = 'lightbox-thumb-progress';

    const groupTitle = getGroupTitle(img);
    const obsEl = img.closest('.img')?.querySelector('.obs');
    const obsText = (obsEl && !obsEl.classList.contains('invisible')) ? obsEl.textContent.trim() : '';
    const obsCls = obsEl?.classList.contains('obs-done') ? 'obs-done'
                 : obsEl?.classList.contains('obs-pending') ? 'obs-pending' : '';

    if (groupTitle || obsText) {
      wrap.addEventListener('mouseenter', () => {
        if (sharedTooltip._titleAnim) { sharedTooltip._titleAnim.cancel(); sharedTooltip._titleAnim = null; }
        sharedTooltip.innerHTML = '';
        if (groupTitle) {
          const titleEl = document.createElement('span');
          titleEl.className = 'thumb-tooltip-title';
          const track = document.createElement('span');
          track.className = 'tooltip-title-track';
          const text = document.createElement('span');
          text.className = 'tooltip-title-text';
          text.textContent = groupTitle;
          track.appendChild(text);
          titleEl.appendChild(track);
          sharedTooltip.appendChild(titleEl);
        }
        if (obsText) {
          const s = document.createElement('span');
          s.className = 'thumb-tooltip-obs' + (obsCls ? ' ' + obsCls : '');
          s.textContent = obsText;
          sharedTooltip.appendChild(s);
        }
        const rect = btn.getBoundingClientRect();
        sharedTooltip.style.left = `${rect.left + rect.width / 2}px`;
        sharedTooltip.style.bottom = `${window.innerHeight - rect.top + 8}px`;
        sharedTooltip.classList.add('is-visible');
        if (groupTitle && !reducedMotion) {
          requestAnimationFrame(() => {
            const container = sharedTooltip.querySelector('.thumb-tooltip-title');
            const track     = sharedTooltip.querySelector('.tooltip-title-track');
            const text      = sharedTooltip.querySelector('.tooltip-title-text');
            if (!container || !track || !text) return;
            const oldClone = track.querySelector('.tooltip-title-clone');
            if (oldClone) oldClone.remove();
            if (text.scrollWidth - container.clientWidth <= 1) return;
            const clone = text.cloneNode(true);
            clone.className = 'tooltip-title-clone';
            clone.setAttribute('aria-hidden', 'true');
            track.appendChild(clone);
            const shift    = clone.getBoundingClientRect().left - text.getBoundingClientRect().left;
            const totalMs  = (shift / 45 + 3) * 1000;
            sharedTooltip._titleAnim = track.animate(
              [
                { transform: 'translateX(0)',            offset: 0              },
                { transform: 'translateX(0)',            offset: 3000 / totalMs },
                { transform: `translateX(${-shift}px)`, offset: 1              },
              ],
              { duration: totalMs, iterations: Infinity, easing: 'linear' }
            );
          });
        }
      });
      wrap.addEventListener('mouseleave', () => {
        if (sharedTooltip._titleAnim) { sharedTooltip._titleAnim.cancel(); sharedTooltip._titleAnim = null; }
        sharedTooltip.classList.remove('is-visible');
      });
    }

    wrap.appendChild(btn);
    wrap.appendChild(bar);
    thumbsBar.appendChild(wrap);
  });

  overlayTitle = document.createElement('p');
  overlayTitle.className = 'lightbox-title';

  overlayCount = document.createElement('p');
  overlayCount.className = 'lightbox-title-count';

  overlayCaption = document.createElement('p');
  overlayCaption.className = 'lightbox-caption';

  overlay.appendChild(overlayClose);
  overlay.appendChild(overlayTitle);
  overlay.appendChild(overlayCount);
  overlay.appendChild(overlayStage);
  overlay.appendChild(overlayCaption);
  if (mosaicImages.length > 1) overlay.appendChild(thumbsBar);
  document.body.appendChild(overlay);

  overlayClose.addEventListener('click', closeLightbox);
  overlayPrev.addEventListener('click', () => showImage(currentImgIdx - 1));
  overlayNext.addEventListener('click', () => showImage(currentImgIdx + 1));
  let swipeSuppressClick = false;
  overlay.addEventListener('click', e => {
    if (swipeSuppressClick) { swipeSuppressClick = false; return; }
    if (e.target === overlay || e.target === overlayStage) closeLightbox();
  });

  // Gestos de deslize na imagem (toque e mouse, via Pointer Events):
  //   • deslizar para a esquerda/direita → alterna entre as imagens
  //   • deslizar para cima/baixo → fecha o lightbox
  // O pointerdown inicia no palco; pointerup/cancel escutam na janela para que
  // a soltura conte mesmo fora do palco (ex.: deslize vertical longo).
  overlayStage.style.touchAction = 'none';
  (() => {
    let sx = 0, sy = 0, active = false;
    const TH = 45; // distância mínima (px) para diferenciar deslize de toque
    overlayStage.addEventListener('pointerdown', e => {
      if (e.button > 0) return; // ignora botões secundários do mouse
      if (e.target.closest && e.target.closest('.lightbox-nav, .lightbox-close')) return;
      active = true; sx = e.clientX; sy = e.clientY;
    });
    window.addEventListener('pointerup', e => {
      if (!active) return;
      active = false;
      if (!lightboxOpen) return;
      const dx = e.clientX - sx, dy = e.clientY - sy;
      const adx = Math.abs(dx), ady = Math.abs(dy);
      if (Math.max(adx, ady) < TH) return; // foi um toque/clique, não um deslize
      swipeSuppressClick = true;            // impede o clique de fechar após o deslize
      if (adx > ady) showImage(currentImgIdx + (dx < 0 ? 1 : -1)); // ← próxima / → anterior
      else closeLightbox();                                        // ↑ ou ↓ fecha
    });
    window.addEventListener('pointercancel', () => { active = false; });
  })();

  overlayStage.addEventListener('mouseenter', () => {
    isHoveringMain = true;
    if (autoTimer !== null) {
      autoRemaining = AUTO_DURATION - (Date.now() - autoStart);
      clearAutoTimer();
    }
  });
  overlayStage.addEventListener('mouseleave', () => {
    isHoveringMain = false;
    startAutoProgress();
    flashPlayIndicator();
  });

  thumbsBar.addEventListener('mouseenter', () => {
    isHoveringMain = true;
    if (autoTimer !== null) {
      autoRemaining = AUTO_DURATION - (Date.now() - autoStart);
      clearAutoTimer();
    }
  });
  thumbsBar.addEventListener('mouseleave', () => {
    isHoveringMain = false;
    startAutoProgress();
    flashPlayIndicator();
  });
}

function showImage(idx) {
  if (!mosaicImages.length) return;
  currentImgIdx = (idx + mosaicImages.length) % mosaicImages.length;
  const img = mosaicImages[currentImgIdx];
  overlayImg.src = img.src;
  overlayImg.alt = img.alt;
  overlayPrev.disabled = mosaicImages.length <= 1;
  overlayNext.disabled = mosaicImages.length <= 1;

  const titleText = getGroupTitle(img);
  overlayTitle.textContent = titleText || 'subgrupo não identificado';
  overlayTitle.classList.toggle('lightbox-title--empty', !titleText);

  const { posInGroup, groupTotal } = imgGroupInfo[currentImgIdx] ?? { posInGroup: 1, groupTotal: 1 };
  overlayCount.textContent = `exibindo ${posInGroup} de ${groupTotal} de um total de ${mosaicImages.length} (${currentImgIdx + 1}/${mosaicImages.length})`;

  const obsEl = img.closest('.img')?.querySelector('.obs');
  const obsText = (obsEl && !obsEl.classList.contains('invisible')) ? obsEl.textContent.trim() : '';
  overlayCaption.textContent = obsText || 'nenhuma observação foi fornecida para esta imagem';
  overlayCaption.classList.toggle('lightbox-caption--empty',   !obsText);
  overlayCaption.classList.toggle('lightbox-caption--done',    !!obsText && obsEl.classList.contains('obs-done'));
  overlayCaption.classList.toggle('lightbox-caption--pending', !!obsText && obsEl.classList.contains('obs-pending'));

  resetAutoProgress();

  const thumbs = overlay?.querySelectorAll('.lightbox-thumb');
  if (thumbs?.length) {
    thumbs.forEach((t, i) => t.classList.toggle('active', i === currentImgIdx));
    overlay.querySelectorAll('.lightbox-thumb-wrap')[currentImgIdx]
      ?.scrollIntoView({ block: 'nearest', inline: 'center', behavior: 'smooth' });
  }
}

function openLightbox(idx) {
  if (!overlay) buildLightbox();
  showImage(idx);
  overlay.removeAttribute('hidden');
  if (!reducedMotion) overlay.classList.add('lightbox-visible');
  else overlay.style.opacity = '1';
  document.body.style.overflow = 'hidden';
  lightboxOpen = true;
  overlayClose.focus();
}

function closeLightbox() {
  if (!overlay) return;
  clearAutoTimer();
  isHoveringMain = false;
  autoRemaining = AUTO_DURATION;
  if (!reducedMotion) overlay.classList.remove('lightbox-visible');
  overlay.setAttribute('hidden', '');
  overlay.style.opacity = '';
  document.body.style.overflow = '';
  lightboxOpen = false;
}

if (mosaicImages.length) {
  mosaicImages.forEach((img, idx) => {
    img.style.cursor = 'zoom-in';
    img.setAttribute('tabindex', '0');
    img.setAttribute('role', 'button');
    img.setAttribute('aria-label', `${img.alt || 'Imagem'} — clique para ampliar`);
    img.addEventListener('click', () => openLightbox(idx));
    img.addEventListener('keydown', e => {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openLightbox(idx); }
    });
  });
}

// ---- 3. BOTÃO COPIAR URL --------------------------------------------------

const breadcrumb = document.querySelector('.breadcrumb');
if (breadcrumb && navigator.clipboard) {
  const copyBtn = document.createElement('button');
  copyBtn.className = 'copy-url-btn';
  copyBtn.setAttribute('aria-label', 'Copiar link desta página');
  copyBtn.textContent = 'copiar link';
  breadcrumb.appendChild(copyBtn);

  copyBtn.addEventListener('click', () => {
    navigator.clipboard.writeText(window.location.href).then(() => {
      copyBtn.textContent = '✓ copiado!';
      setTimeout(() => { copyBtn.textContent = 'copiar link'; }, 2000);
    });
  });
}

// ---- teclado global -------------------------------------------------------
// prevUrl/nextUrl são null até initNav() resolver; o handler já está ativo
// mas as teclas de navegação não disparam enquanto ambos são null.

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

document.addEventListener('keydown', e => {
  if (e.altKey || e.ctrlKey || e.metaKey) return;

  if (lightboxOpen) {
    if (e.key === 'Escape')     { e.preventDefault(); closeLightbox(); }
    if (e.key === 'ArrowLeft')  { e.preventDefault(); showImage(currentImgIdx - 1); }
    if (e.key === 'ArrowRight') { e.preventDefault(); showImage(currentImgIdx + 1); }
    return;
  }

  const tag = document.activeElement?.tagName;
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;

  if (e.key === 'ArrowLeft'  && prevUrl) { e.preventDefault(); location.href = prevUrl; }
  if (e.key === 'ArrowRight' && nextUrl) { e.preventDefault(); location.href = nextUrl; }
});
