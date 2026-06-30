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

// Estado dos gestos do lightbox (deslize/pan/pinça). O transform da imagem é a
// composição translate(gestureTX,gestureTY) scale(gestureScale). paintGesture é
// definido dentro de buildLightbox() e reaplica o transform; resetGestureTransform
// zera tudo (chamado ao trocar de imagem e ao fechar).
let gestureScale = 1, gestureTX = 0, gestureTY = 0;
let paintGesture = null;
function resetGestureTransform() {
  gestureScale = 1; gestureTX = 0; gestureTY = 0;
  if (paintGesture) paintGesture(false);
  else if (overlayImg) { overlayImg.style.transition = 'none'; overlayImg.style.transform = ''; }
}

const mosaicImages = Array.from(document.querySelectorAll('.mosaic-container img:not(.carousel-img)'));

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
    const title = cleanSectionName(
      sec.querySelector('.title-h2 .st-name-full')?.textContent
        ?? sec.querySelector('.title-h2')?.textContent ?? '',
      sec.dataset.section
    );
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

// T5: Altura FIXA do marcador (em px), lida da custom property --secnav-marker-h
// definida no CSS (.slide-secnav). É a MESMA altura usada pelo indicador da seção
// ativa (.secnav-all-link.active::before), garantindo tracinhos idênticos nos dois
// lugares. Centraliza-se verticalmente em cada item (vide moveMarkerTo). Cai num
// fallback coerente com a barra de um item de 1 linha se a leitura falhar.
const MARKER_HEIGHT_FALLBACK = 16;
function markerFixedHeight(marker) {
  const raw = getComputedStyle(marker).getPropertyValue('--secnav-marker-h').trim();
  const px = parseFloat(raw);
  return Number.isFinite(px) && px > 0 ? px : MARKER_HEIGHT_FALLBACK;
}

// Posiciona o marcador (translateY) na linha de um item, com ALTURA FIXA
// (--secnav-marker-h) e CENTRALIZADO verticalmente dentro do item.
function moveMarkerTo(marker, el, animate) {
  // lê uma vez a altura fixa do CSS e memoiza no próprio marcador
  if (marker._fixedHeight == null) {
    marker._fixedHeight = markerFixedHeight(marker);
  }
  const h = marker._fixedHeight;
  const y = el.offsetTop + (el.offsetHeight - h) / 2; // centraliza no item
  if (!animate) marker.style.transition = 'none';
  // T5: o afastamento horizontal (4px da borda esquerda) vem do CSS (.secnav-marker
  // { left: 4px }) — NÃO sobrescrever com el.offsetLeft (que seria 2px por causa do
  // padding da lista), para casar exatamente com o indicador da seção ativa.
  marker.style.height = `${h}px`;
  marker.style.transform = `translateY(${y}px)`;
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
// saltar direto ao 1º item de qualquer uma. A cada carga o estado inicial segue
// a regra do item 5 (colapsada se existe "slides desta seção"; senão expandida),
// ignorando qualquer estado anterior do usuário.
function buildAllSectionsNav(sections, currentIndex, hasItemNav) {
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
  // voltar à seleção pela navegação lateral também restaura o ponto de onde o
  // usuário saiu (mesma intenção do "conteúdo" do breadcrumb) — ver slide-selection.js
  home.addEventListener('click', () => {
    try { sessionStorage.setItem('indexRestoreScroll', '1'); } catch {}
  });
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

  // a 1ª caixa (entre seções) ignora estado memorizado e, a cada carga, inicia
  // COLAPSADA quando existe a caixa "slides desta seção"; quando ela não existe,
  // esta passa a ser a única navegação e abre EXPANDIDA.
  let open = !hasItemNav;
  const apply = () => {
    wrap.classList.toggle('is-open', open);
    toggle.setAttribute('aria-expanded', open ? 'true' : 'false');
  };
  apply();
  toggle.addEventListener('click', () => {
    open = !open;
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

  // T3: DOIS containers DISTINTOS/independentes (duas caixas separadas):
  //   Container 1 = navegação ENTRE SEÇÕES (.secnav-all: toggle colapsável + lista).
  //   Container 2 = CONTEÚDO da seção ativa (.secnav-items: subtítulo + contador +
  //   itens com o marcador deslizante). Antes o Container 2 ficava ANINHADO dentro
  //   do painel colapsável do Container 1; agora cada um é uma caixa irmã/própria.
  // navegação entre os itens da seção atual — agora em seu PRÓPRIO container (irmão)
  const itemNav = buildItemNav(sections[currentIndex], currentSlug);
  // a 1ª caixa sabe se há "slides desta seção" p/ decidir o estado inicial (item 5)
  const allNav = buildAllSectionsNav(sections, currentIndex, !!itemNav);
  if (allNav) nav.appendChild(allNav);
  if (itemNav) {
    // envolve o bloco de itens em uma caixa própria (Container 2), separada do
    // Container 1 (navegação entre seções). O conteúdo interno (.secnav-items e
    // seus filhos) é PRESERVADO — herda o look/feel atual (marcador, etc.).
    const itemsBox = document.createElement('div');
    itemsBox.className = 'secnav-section-content';
    itemsBox.appendChild(itemNav.group);
    nav.appendChild(itemsBox);
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

  // Mantém a tooltip dentro da viewport: o CSS a centraliza com translateX(-50%)
  // sobre o `left`; aqui medimos o rect resultante e, se estourar uma borda,
  // adicionamos um deslocamento horizontal ao transform para reentrá-la (margem
  // de 8px), mesmo que isso a descentralize em relação à miniatura.
  const clampTooltipIntoView = () => {
    const margin = 8;
    sharedTooltip.style.transform = 'translateX(-50%)';
    const rect = sharedTooltip.getBoundingClientRect();
    let shift = 0;
    if (rect.left < margin) {
      shift = margin - rect.left;                          // estourou à esquerda → empurra p/ direita
    } else if (rect.right > window.innerWidth - margin) {
      shift = (window.innerWidth - margin) - rect.right;   // estourou à direita → empurra p/ esquerda
    }
    sharedTooltip.style.transform = shift
      ? `translateX(-50%) translateX(${shift}px)`
      : 'translateX(-50%)';
  };

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
        clampTooltipIntoView();
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

    // barra DENTRO do botão (não mais abaixo dele): o overflow:hidden +
    // border-radius da miniatura a recortam, contendo-a nas bordas arredondadas.
    btn.appendChild(bar);
    wrap.appendChild(btn);
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
  // Por requisito: APENAS a tecla ESC e o botão ✕ fecham o lightbox.
  // Clicar/tocar na imagem, no backdrop ou no palco NÃO fecha.

  // Gestos na imagem (toque e mouse, via Pointer Events):
  //   • 1 ponteiro + zoom == 1 → deslize horizontal: a imagem acompanha o dedo
  //     (com atrito) e, ao soltar além do limiar, alterna de imagem; senão volta
  //     ao centro (snap-back suave). [T4]
  //   • 2 ponteiros → pinça: aplica scale entre 1 e ~3. Enquanto houver pinça,
  //     NÃO navega. [T5]
  //   • 1 ponteiro + zoom > 1 → pan: arrasta a imagem ampliada (não navega). [T5]
  //   • duplo toque/clique → alterna entre ampliar (~2,2) e voltar a 1. [T5]
  // O pointerdown inicia no palco; pointermove/up/cancel escutam na janela para
  // que o gesto conte mesmo fora do palco (ex.: deslize horizontal longo).
  // O estado do transform (gestureScale/gestureTX/gestureTY) é compartilhado e
  // zerado ao trocar de imagem (resetGestureTransform) e ao fechar.
  overlayStage.style.touchAction = 'none';
  (() => {
    const SWIPE_TH = 45;   // distância mínima (px) p/ diferenciar deslize de toque
    const FRICTION = 0.55; // atrito do deslize-navega: imagem acompanha ~55% do dedo
    // resposta tátil (Vibration API) ao cruzar o limiar de navegação — só onde há
    // suporte (Android Chrome/Edge/Firefox; iOS Safari NÃO implementa navigator.vibrate)
    const canVibrate = typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function';
    const MIN_SCALE = 1, MAX_SCALE = 3;
    const ZOOM_LEVEL = 2.2;   // ampliação aplicada no duplo toque
    const DOUBLE_TAP_MS = 300, DOUBLE_TAP_DIST = 30;

    // mapa dos ponteiros ativos (id → posição atual)
    const pointers = new Map();
    // gesto de deslize/pan com 1 ponteiro
    let dragId = null, sx = 0, sy = 0, baseTX = 0, baseTY = 0, dragging = false, swiping = false;
    let swipeHapticDone = false; // garante UMA vibração por deslize ao cruzar o limiar
    // gesto de pinça com 2 ponteiros
    let pinching = false, pinchStartDist = 0, pinchStartScale = 1;
    // detecção de duplo toque
    let lastTapTime = 0, lastTapX = 0, lastTapY = 0;

    const onNav = el => el && el.closest && el.closest('.lightbox-nav, .lightbox-close');

    const dist = () => {
      const [a, b] = [...pointers.values()];
      return Math.hypot(a.x - b.x, a.y - b.y);
    };

    // aplica o transform atual (escala + deslocamento) sem transição
    const paint = (transition = false) => {
      overlayImg.style.transition = transition && !reducedMotion
        ? 'transform 0.28s cubic-bezier(0.22, 1, 0.36, 1)' : 'none';
      overlayImg.style.transform =
        `translate(${gestureTX}px, ${gestureTY}px) scale(${gestureScale})`;
    };
    // expõe o pintor p/ resetGestureTransform (definido fora da IIFE)
    paintGesture = paint;

    // mantém o pan dentro de limites razoáveis quando ampliado
    const clampPan = () => {
      const rect = overlayImg.getBoundingClientRect();
      // rect já reflete a escala atual; metade do excedente em cada eixo
      const maxX = Math.max(0, (rect.width - overlayImg.clientWidth) / 2);
      const maxY = Math.max(0, (rect.height - overlayImg.clientHeight) / 2);
      gestureTX = Math.max(-maxX, Math.min(maxX, gestureTX));
      gestureTY = Math.max(-maxY, Math.min(maxY, gestureTY));
    };

    overlayStage.addEventListener('pointerdown', e => {
      if (e.button > 0) return;               // ignora botões secundários do mouse
      if (onNav(e.target)) return;            // setas/✕ tratam o próprio clique
      pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      try { overlayStage.setPointerCapture(e.pointerId); } catch {}

      if (pointers.size === 2) {
        // entrou em modo pinça → cancela qualquer deslize/pan em andamento
        pinching = true; dragging = false; swiping = false; dragId = null;
        pinchStartDist = dist() || 1;
        pinchStartScale = gestureScale;
        paint(false);
        return;
      }
      if (pointers.size !== 1) return;

      // duplo toque (mesmo ponto, em curto intervalo) → alterna o zoom
      const now = Date.now();
      if (now - lastTapTime < DOUBLE_TAP_MS &&
          Math.hypot(e.clientX - lastTapX, e.clientY - lastTapY) < DOUBLE_TAP_DIST) {
        lastTapTime = 0;
        gestureScale = gestureScale > 1 ? 1 : ZOOM_LEVEL;
        if (gestureScale === 1) { gestureTX = 0; gestureTY = 0; }
        else clampPan();
        paint(true);
        dragId = null;
        return;
      }
      lastTapTime = now; lastTapX = e.clientX; lastTapY = e.clientY;

      // inicia deslize (zoom == 1) ou pan (zoom > 1) com 1 ponteiro
      dragId = e.pointerId;
      sx = e.clientX; sy = e.clientY;
      baseTX = gestureTX; baseTY = gestureTY;
      dragging = true; swiping = gestureScale === 1;
      swipeHapticDone = false; // re-arma o haptic para este novo deslize
      overlayImg.style.transition = 'none';
    });

    window.addEventListener('pointermove', e => {
      if (!lightboxOpen) return;
      if (!pointers.has(e.pointerId)) return;
      pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });

      if (pinching && pointers.size >= 2) {
        const ratio = dist() / pinchStartDist;
        gestureScale = Math.max(MIN_SCALE, Math.min(MAX_SCALE, pinchStartScale * ratio));
        if (gestureScale === 1) { gestureTX = 0; gestureTY = 0; }
        else clampPan();
        paint(false);
        return;
      }

      if (!dragging || e.pointerId !== dragId) return;
      const dx = e.clientX - sx, dy = e.clientY - sy;

      if (gestureScale > 1) {
        // pan da imagem ampliada (sem navegar)
        gestureTX = baseTX + dx;
        gestureTY = baseTY + dy;
        clampPan();
        paint(false);
      } else if (swiping) {
        // deslize-navega: a imagem acompanha o dedo com atrito (resistência)
        gestureTX = dx * FRICTION;
        gestureTY = 0;
        paint(false);
        // resposta tátil ao ATINGIR o limiar de navegação (uma única vez por deslize,
        // no mesmo instante em que soltar passará a navegar). Re-arma se voltar aquém.
        const adx = Math.abs(dx);
        if (adx >= SWIPE_TH && Math.abs(dy) < adx) {
          if (canVibrate && !swipeHapticDone) { try { navigator.vibrate(8); } catch {} }
          swipeHapticDone = true;
        } else if (adx < SWIPE_TH) {
          swipeHapticDone = false;
        }
      }

    });

    const endPointer = e => {
      pointers.delete(e.pointerId);
      try { overlayStage.releasePointerCapture(e.pointerId); } catch {}

      if (pinching) {
        // ao sair da pinça (menos de 2 ponteiros): mantém o zoom resultante.
        if (pointers.size < 2) {
          pinching = false;
          if (gestureScale <= 1.02) {
            // praticamente sem zoom → normaliza p/ 1 e recentraliza
            gestureScale = 1; gestureTX = 0; gestureTY = 0; paint(true);
          }
          // se ainda há 1 ponteiro, prepara-o para pan a partir da posição atual
          if (pointers.size === 1) {
            const [id, p] = [...pointers.entries()][0];
            dragId = id; sx = p.x; sy = p.y; baseTX = gestureTX; baseTY = gestureTY;
            dragging = true; swiping = false;
          }
        }
        return;
      }

      if (!dragging || e.pointerId !== dragId) return;
      dragging = false; dragId = null;
      if (!lightboxOpen) return;
      const dx = e.clientX - sx, dy = e.clientY - sy;
      const adx = Math.abs(dx), ady = Math.abs(dy);

      if (gestureScale > 1) { swiping = false; return; } // estava em pan; nada a navegar

      if (swiping && adx > ady && adx >= SWIPE_TH) {
        // passou do limiar → navega (o transform é zerado em showImage)
        showImage(currentImgIdx + (dx < 0 ? 1 : -1)); // ← próxima / → anterior
      } else {
        // toque parado ou deslize curto → volta suavemente ao centro
        gestureTX = 0; gestureTY = 0; paint(true);
      }
      swiping = false;
    };

    window.addEventListener('pointerup', endPointer);
    window.addEventListener('pointercancel', e => {
      pointers.delete(e.pointerId);
      try { overlayStage.releasePointerCapture(e.pointerId); } catch {}
      if (pointers.size < 2) pinching = false;
      if (e.pointerId === dragId) {
        dragging = false; dragId = null;
        if (gestureScale === 1) { gestureTX = 0; gestureTY = 0; paint(true); }
      }
    });
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
  resetGestureTransform(); // zera deslize/pan/zoom ao trocar de imagem
  overlayPrev.disabled = mosaicImages.length <= 1;
  overlayNext.disabled = mosaicImages.length <= 1;

  const { posInGroup, groupTotal } = imgGroupInfo[currentImgIdx] ?? { posInGroup: 1, groupTotal: 1 };
  // título da subseção (h2 do grupo de mosaico ao qual a imagem pertence), acima da
  // contagem; se o grupo não tiver subtítulo, recai no título principal do slide (h1).
  const groupEl = img.closest('.mosaic-container');
  let titleEl = groupEl ? groupEl.previousElementSibling : null;
  while (titleEl && !titleEl.classList.contains('title-header-h2')) titleEl = titleEl.previousElementSibling;
  const titleText = (titleEl
    ? (titleEl.querySelector('.title-h2')?.textContent || titleEl.textContent)
    : (document.querySelector('.title-h1')?.textContent || '')
  ).trim();
  overlayTitle.textContent = titleText || 'subgrupo não identificado';
  overlayTitle.classList.toggle('lightbox-title--empty', !titleText);
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
  resetGestureTransform(); // zera deslize/pan/zoom ao fechar
  if (!reducedMotion) overlay.classList.remove('lightbox-visible');
  overlay.setAttribute('hidden', '');
  overlay.style.opacity = '';
  document.body.style.overflow = '';
  lightboxOpen = false;
}

if (mosaicImages.length) {
  mosaicImages.forEach((img, idx) => {
    // imagens-fonte do carrossel inline (.is-carousel) ficam ocultas e são geridas
    // por slide-carousel.js — a imagem principal abre o lightbox via a ponte abaixo;
    // por isso não recebem o clique-para-ampliar aqui.
    if (img.closest('.is-carousel')) return;
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

// ponte p/ o carrossel inline (slide-carousel.js): abre o lightbox global na
// imagem informada — um dos blocos .img do carrossel, presentes em mosaicImages.
window.__openImgLightbox = function (imgEl) {
  const i = mosaicImages.indexOf(imgEl);
  if (i >= 0) openLightbox(i);
};

// ---- 3. BOTÃO COPIAR URL --------------------------------------------------

const breadcrumb = document.querySelector('.breadcrumb');
if (breadcrumb && navigator.clipboard) {
  // ícone de prancheta (copiar) e ícone de check (sucesso) — apenas ícones, sem texto
  const ICON_COPY = '<svg viewBox="0 0 24 24" width="1em" height="1em" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="9" y="9" width="11" height="11" rx="2"/><path d="M5 15V5a2 2 0 0 1 2-2h8"/></svg>';
  const ICON_CHECK = '<svg viewBox="0 0 24 24" width="1em" height="1em" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="20 6 9 17 4 12"/></svg>';

  const copyBtn = document.createElement('button');
  copyBtn.className = 'copy-url-btn';
  copyBtn.setAttribute('aria-label', 'Copiar link desta página');
  copyBtn.innerHTML = ICON_COPY;
  breadcrumb.appendChild(copyBtn);

  let copyResetTimer = null;
  copyBtn.addEventListener('click', () => {
    navigator.clipboard.writeText(window.location.href).then(() => {
      copyBtn.classList.add('is-copied');
      copyBtn.innerHTML = ICON_CHECK;
      clearTimeout(copyResetTimer);
      copyResetTimer = setTimeout(() => {
        copyBtn.classList.remove('is-copied');
        copyBtn.innerHTML = ICON_COPY;
      }, 2000);
    });
  });
}

// ---- teclado global -------------------------------------------------------
// prevUrl/nextUrl são null até initNav() resolver; o handler já está ativo
// mas as teclas de navegação não disparam enquanto ambos são null.

// ---- botões flutuantes: retornar ao topo / ir para o fim -------------------

const backToTop = document.getElementById('back-to-top');
if (backToTop) {
  const SCROLL_THRESHOLD = 400;

  // botão gêmeo (inverso): ir para o fim da página — injetado aqui para não
  // duplicar markup em todos os slides; empilhado verticalmente com o do topo.
  const goToBottom = document.createElement('button');
  goToBottom.id = 'go-to-bottom';
  goToBottom.setAttribute('aria-label', 'Ir para o fim da página');
  goToBottom.innerHTML = '<span class="back-top-icon back-top-icon--down" aria-hidden="true"></span>';
  backToTop.insertAdjacentElement('afterend', goToBottom);

  let scrollTicking = false;
  function syncScrollFabs() {
    const doc = document.documentElement;
    const showTop = window.scrollY >= SCROLL_THRESHOLD;
    const bottomGap = doc.scrollHeight - window.scrollY - window.innerHeight;
    backToTop.classList.toggle('is-visible', showTop);
    goToBottom.classList.toggle('is-visible', bottomGap > SCROLL_THRESHOLD);
    // quando o "topo" aparece, o "fim" sobe para ficar acima dele
    goToBottom.classList.toggle('is-raised', showTop);
  }
  window.addEventListener('scroll', () => {
    if (scrollTicking) return;
    scrollTicking = true;
    requestAnimationFrame(() => { syncScrollFabs(); scrollTicking = false; });
  }, { passive: true });
  window.addEventListener('resize', syncScrollFabs, { passive: true });
  syncScrollFabs();

  backToTop.addEventListener('click', () => {
    window.scrollTo({ top: 0, behavior: reducedMotion ? 'auto' : 'smooth' });
  });
  goToBottom.addEventListener('click', () => {
    window.scrollTo({ top: document.documentElement.scrollHeight, behavior: reducedMotion ? 'auto' : 'smooth' });
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
