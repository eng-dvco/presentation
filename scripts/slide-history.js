'use strict';
/* ── Histórico de Modificações ─────────────────────────────────────────────────
   Consome history/history-<apresentação>.json (gerado por tools/build-history.js a partir
   do git) e monta os registros. A página é 100% estática: nenhuma chamada de rede além do
   próprio JSON, então funciona no GitHub Pages e offline.

   Abas:        CONTEÚDO (adição / modificação / deleção)
                FUNÇÕES  (implementada / aperfeiçoada / descartada)
   Agrupamento: CRONOLÓGICO (mês → dia) e POR AÇÃO (rótulo → dia).
   Filtros:     por AÇÃO, por ELEMENTO (imagens, documentos, observações…) e BUSCA textual
                sem acentuação — os três se combinam.
   Cada registro é clicável no corpo INTEIRO e leva ao conteúdo que ele descreve, guardando
   a posição de rolagem para o retorno. */
(function historico() {
  const raiz = document.querySelector('.hist-root');
  if (!raiz) return;

  const arquivo = raiz.dataset.fonte || '../history/history-indefinida.json';
  const base = raiz.dataset.base || '../';

  const lista = document.querySelector('.hist-list');
  const vazio = document.querySelector('.hist-empty');
  const resumoEl = document.querySelector('.hist-summary');
  const busca = document.querySelector('#hist-search');
  const limpaBusca = document.querySelector('#hist-search-clear');
  const barraAcao = document.querySelector('.hist-filter-acao');
  const barraTipo = document.querySelector('.hist-filter-tipo');
  const barraAtiva = document.querySelector('.hist-active');

  const MESES = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];
  const ACOES = { conteudo: ['adição', 'modificação', 'deleção'], funcoes: ['implementada', 'aperfeiçoada', 'descartada'] };

  // sem acentuação e sem caixa — mesma regra da busca do index.html
  const dobra = s => (window.UI && window.UI.foldAccents)
    ? window.UI.foldAccents(s)
    : (s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

  // "adição" → "adicao" (serve de classe CSS e de valor de filtro)
  const slug = s => dobra(s).replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

  // "1 adição" mas "349 adições"; "1 implementada" mas "3 implementadas"
  const plural = (n, rotulo) => n + ' ' + (n === 1 ? rotulo
    : /ção$/.test(rotulo) ? rotulo.replace(/ção$/, 'ções') : rotulo + 's');

  const parse = d => {
    const m = /^(\d{2})-(\d{2})-(\d{2})$/.exec(d || '');
    if (!m) return null;
    return { dia: +m[1], mes: +m[2] - 1, ano: 2000 + +m[3], chave: (2000 + +m[3]) * 10000 + (+m[2]) * 100 + (+m[1]) };
  };

  let dados = null;
  let aba = 'conteudo';
  let agrupamento = 'cronologico';
  // filtros MULTI-SELEÇÃO: conjuntos de ações e de elementos (vazio = todos). Um registro passa
  // se casar com QUALQUER ação marcada E QUALQUER elemento marcado (e a busca).
  const filtrosAcao = new Set();
  const filtrosTipo = new Set();
  let gruposTab = null;   // aba para a qual os grupos do menu de filtro foram montados
  let termo = '';

  // render() reconstrói a lista inteira (innerHTML = '' + 599 cartões + 659 imagens), e ~¾ do
  // seu custo é o layout/paint do navegador, não o JS. Chamá-lo direto a cada tecla da busca
  // enfileirava ~10 reconstruções síncronas: numa máquina modesta a thread principal congelava
  // por segundos. Coalescemos as chamadas num único render do estado final.
  //   • cliques (filtro, aba, agrupamento): espera 0 → ainda parece instantâneo, mas uma rajada
  //     de cliques encadeados vira um render só;
  //   • busca: espera ~160ms → uma palavra digitada dispara um render, não um por tecla.
  // (render é function declaration, então já existe aqui; só é de fato chamada após o fetch.)
  let _tRender = 0;
  const agendarRender = espera => { clearTimeout(_tRender); _tRender = setTimeout(render, espera || 0); };

  const el = (tag, cls, texto) => {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (texto != null) e.textContent = texto;
    return e;
  };

  // ── índice de busca: tudo que o registro "diz" ──
  const textoDe = r => dobra([
    r.titulo, r.resumo, r.tipo, r.acao, r.de, r.para, r.curadoria, r.commit,
    (r.breadcrumb || []).join(' '),
    (r.imagens && r.imagens.amostra || []).map(a => a.nome).join(' '),
    (r.legendas || []).map(l => l.texto).join(' '),
    r.documento && [r.documento.versao, r.documento.paginas, r.documento.tamanho].join(' '),
  ].filter(Boolean).join(' '));

  // srcs das imagens que o registro toca (para o "localizar" no slide destino)
  const focoImgs = r => {
    const nomes = [];
    (r.imagens && r.imagens.amostra || []).forEach(a => nomes.push(a.src.split('/').pop()));
    (r.legendas || []).forEach(l => (l.imagens.amostra || []).forEach(a => nomes.push(a.src.split('/').pop())));
    return [...new Set(nomes)];
  };

  // tira de miniaturas com o indicador "+N" (que CONTA a miniatura que cobre)
  function tiras(imagens, mini) {
    const total = imagens.total, amostra = imagens.amostra || [];
    if (!amostra.length) return null;
    const escondidas = total - (amostra.length - 1);
    const mostraMais = total > amostra.length;
    const wrap = el('div', 'hist-thumbs' + (mini ? ' hist-thumbs--mini' : ''));
    amostra.forEach((im, i) => {
      const cel = el('span', 'hist-thumb');
      const img = document.createElement('img');
      img.src = base + im.miniatura; img.alt = im.nome; img.loading = 'lazy';
      img.width = mini ? 46 : 64; img.height = mini ? 35 : 48;
      cel.appendChild(img);
      if (i === amostra.length - 1 && mostraMais) cel.appendChild(el('span', 'hist-thumb-mais', '+' + escondidas));
      wrap.appendChild(cel);
    });
    return wrap;
  }

  // de → para em dois subcontainers (lado a lado no desktop, empilhados no mobile)
  function delta(de, para) {
    const d = el('div', 'hist-delta');
    [['de', de], ['para', para]].forEach(([papel, valor]) => {
      const cx = el('div', 'hist-delta-box hist-delta-box--' + papel);
      cx.appendChild(el('span', 'hist-delta-label', papel));
      cx.appendChild(el('p', 'hist-delta-valor', valor));
      d.appendChild(cx);
    });
    return d;
  }

  // container rotulado "informação da(s) imagem(ns)": deixa claro que o texto é a legenda das
  // fotos, não uma nota solta. Recebe o miolo já montado (texto, de/para ou grupos legenda↔fotos).
  function infoBox(umaImagem, miolo) {
    const box = el('div', 'hist-info');
    box.appendChild(el('span', 'hist-info-label', umaImagem ? 'informação da imagem' : 'informação das imagens'));
    miolo.forEach(n => n && box.appendChild(n));
    return box;
  }

  // ícone por ação (traço, cor = currentColor → preto como os títulos). Mesmo estilo Feather dos
  // demais ícones da apresentação: viewBox 24, stroke, cantos redondos.
  const ICONES_ACAO = {
    adicao: '<line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>',
    modificacao: '<path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z"/>',
    delecao: '<line x1="5" y1="12" x2="19" y2="12"/>',
    implementada: '<polyline points="20 6 9 17 4 12"/>',
    aperfeicoada: '<polyline points="23 6 13.5 15.5 8.5 10.5 1 18"/><polyline points="17 6 23 6 23 12"/>',
    descartada: '<line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>',
  };
  function iconeAcao(acao) {
    const d = ICONES_ACAO[slug(acao)];
    if (!d) return null;
    const s = el('span', 'hist-acao-icon');
    s.setAttribute('aria-hidden', 'true');
    s.innerHTML = '<svg viewBox="0 0 24 24" width="1em" height="1em" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">' + d + '</svg>';
    return s;
  }

  // o rótulo da ação: ícone DENTRO do badge, à esquerda do texto
  function badgeAcao(acao) {
    const b = el('span', 'hist-badge hist-badge--' + slug(acao));
    const ico = iconeAcao(acao);
    if (ico) b.appendChild(ico);
    b.appendChild(document.createTextNode(acao));
    return b;
  }

  // ── um registro ──
  function cartao(r) {
    const a = el('a', 'hist-card hist-card--' + slug(r.acao));
    a.href = base + (r.link || 'slides/index.html');
    a.dataset.acao = r.acao;
    a.dataset.tipo = r.tipo;
    if (r.id) a.dataset.id = r.id;

    // guarda de ONDE se saiu (retorno + realce do próprio registro) e O QUE realçar no slide
    a.addEventListener('click', () => {
      try {
        sessionStorage.setItem('hist-scroll', String(window.scrollY));
        sessionStorage.setItem('hist-from', location.pathname);
        if (r.id) sessionStorage.setItem('hist-record', r.id);
        sessionStorage.setItem('hist-focus', JSON.stringify({
          imgs: focoImgs(r),
          texto: (r.tipo === 'título' ? r.para : (r.breadcrumb || []).slice(-1)[0]) || null,
        }));
      } catch (e) { /* sessionStorage bloqueado: o link continua funcionando */ }
    });

    const topo = el('div', 'hist-card-top');
    topo.appendChild(badgeAcao(r.acao));
    topo.appendChild(el('span', 'hist-type', r.tipo));
    a.appendChild(topo);

    a.appendChild(el('h3', 'hist-card-title', r.titulo || '—'));

    if (r.breadcrumb && r.breadcrumb.length) {
      const bc = el('div', 'hist-crumbs');
      r.breadcrumb.forEach((p, i) => {
        if (i) bc.appendChild(el('span', 'hist-crumb-sep', '›'));
        bc.appendChild(el('span', 'hist-crumb', p));
      });
      a.appendChild(bc);
    }

    const temDelta = r.de != null && r.para != null && r.de !== r.para;

    // ── OBSERVAÇÃO: a legenda, embrulhada, VINCULADA à(s) imagem(ns) que a receberam ──
    if (r.tipo === 'observação') {
      const umaImg = r.imagens && r.imagens.total === 1;
      const miolo = [temDelta ? delta(r.de, r.para) : (r.resumo ? el('p', 'hist-info-text', r.resumo) : null)];
      if (r.imagens) miolo.push(tiras(r.imagens, true));
      a.appendChild(infoBox(umaImg, miolo));

    // ── IMAGENS: legendas por faixa (1-2: X · 3-4: Y) + tira de miniaturas + metadados ──
    } else if (r.tipo === 'imagens') {
      const legendas = r.legendas || [];
      const umaImg = r.imagens && r.imagens.total === 1;
      if (legendas.length > 1) {
        // legendas DIFERENTES por faixa de imagens: cada uma com as suas miniaturas (o vínculo)
        const grupos = el('div', 'hist-info-groups');
        legendas.forEach(l => {
          const g = el('div', 'hist-info-group');
          g.appendChild(el('p', 'hist-info-text', l.texto));
          const t = tiras(l.imagens, true);
          if (t) g.appendChild(t);
          grupos.appendChild(g);
        });
        a.appendChild(infoBox(umaImg, [grupos]));
      } else {
        if (legendas.length === 1) a.appendChild(infoBox(umaImg, [el('p', 'hist-info-text', legendas[0].texto)]));
        if (r.imagens) { const t = tiras(r.imagens, false); if (t) a.appendChild(t); }
      }
      if (r.imagens) {
        const met = el('div', 'hist-meta');
        met.appendChild(el('span', 'hist-meta-item', plural(r.imagens.total, 'imagem')));
        if (r.imagens.pesoTotal) met.appendChild(el('span', 'hist-meta-item', r.imagens.pesoTotal));
        if (r.removidas) met.appendChild(el('span', 'hist-meta-item', r.removidas + ' substituída(s)'));
        a.appendChild(met);
      }

    // ── DEMAIS (título, subtítulo, nome/seção do slide, funções): de/para ou resumo ──
    } else {
      if (temDelta) a.appendChild(delta(r.de, r.para));
      else if (r.resumo) a.appendChild(el('p', 'hist-resumo', r.resumo));
    }

    // ── DOCUMENTOS: extensão, versão, páginas, tamanho ──
    if (r.documento) {
      const d = r.documento;
      const met = el('div', 'hist-meta');
      met.appendChild(el('span', 'hist-meta-item hist-meta-ext', 'PDF'));
      if (d.versao) met.appendChild(el('span', 'hist-meta-item', 'versão ' + d.versao));
      if (d.paginas) met.appendChild(el('span', 'hist-meta-item', d.paginas + (d.paginas === '1' ? ' página' : ' páginas')));
      if (d.tamanho) met.appendChild(el('span', 'hist-meta-item', d.tamanho));
      a.appendChild(met);
    }

    if (r.curadoria) a.appendChild(el('p', 'hist-nota', r.curadoria));
    a.appendChild(el('span', 'hist-commit', r.commit));
    return a;
  }

  // hora "17:42" → "17h42" (formato pedido)
  const horaBR = h => (h || '').replace(':', 'h');

  // atualiza o MARCADOR sticky de um dia: horário (00h00) + cor do ponto pela ação corrente
  function setMark(mark, hora, acao) {
    const t = mark.querySelector('.hist-mark-time');
    const d = mark.querySelector('.hist-dot');
    const txt = horaBR(hora);
    if (t.textContent !== txt) t.textContent = txt;
    const cls = 'hist-dot hist-dot--' + slug(acao || 'misto');
    if (d.className !== cls) d.className = cls;
  }

  // ── um dia (colapsável): linha do tempo com MARCADOR STICKY ──
  // Em vez de repetir horário+ponto em cada registro, um único marcador desliza pela linha do
  // tempo (sticky) e, conforme o registro sob ele, atualiza o horário (00h00) e a COR do ponto
  // pela ação — verde/amarelo/vermelho. O cabeçalho (a data) também gruda no topo. Como as datas
  // e horários variam, cada dia tem a sua própria linha do tempo e o seu próprio marcador.
  function bloco(dia, registros) {
    const sec = el('section', 'hist-day');
    const cab = el('button', 'hist-day-head');
    cab.type = 'button';
    cab.setAttribute('aria-expanded', 'true');
    cab.appendChild(el('span', 'hist-day-caret', '▾'));
    cab.appendChild(el('span', 'hist-day-date', dia));
    cab.appendChild(el('span', 'hist-day-count', plural(registros.length, 'alteração')));

    const tl = el('div', 'hist-day-items hist-tl');
    const rail = el('div', 'hist-tl-rail');
    const mark = el('div', 'hist-mark');
    mark.appendChild(el('span', 'hist-mark-time'));
    mark.appendChild(el('span', 'hist-dot'));
    rail.appendChild(mark);
    const corpo = el('div', 'hist-tl-body');
    registros.forEach(r => { const c = cartao(r); c.dataset.hora = r.hora || ''; corpo.appendChild(c); });
    tl.appendChild(rail);
    tl.appendChild(corpo);
    if (registros[0]) setMark(mark, registros[0].hora, registros[0].acao);

    cab.addEventListener('click', () => {
      const fechado = sec.classList.toggle('is-collapsed');
      cab.setAttribute('aria-expanded', String(!fechado));
      requestAnimationFrame(() => { atualizaMarcas(); if (!fechado) centraTodos([sec]); });
    });
    sec.appendChild(cab);
    sec.appendChild(tl);
    return sec;
  }

  // posiciona o MARCADOR de cada dia no CENTRO vertical do 1º registro (metade da sua altura), em
  // vez de no topo do rail — assim o registro em evidência aparece inteiro e o marcador começa a
  // deslizar um pouco antes. Lê todas as alturas e só então escreve, para não fazer thrash de layout.
  function centraTodos(dias) {
    const leituras = [];
    dias.forEach(day => {
      const mark = day.querySelector('.hist-mark');
      const card = day.querySelector('.hist-tl-body > .hist-card');
      if (mark && card) leituras.push({ mark, ch: card.getBoundingClientRect().height, mh: mark.getBoundingClientRect().height });
    });
    leituras.forEach(({ mark, ch, mh }) => { mark.style.marginTop = Math.max(0, (ch - mh) / 2) + 'px'; });
  }

  function diasVisiveis() {
    return [...document.querySelectorAll('.hist-day:not(.is-collapsed)')].filter(d => {
      const r = d.getBoundingClientRect();
      return r.bottom > 0 && r.top < innerHeight;
    });
  }

  // cada dia é centrado quando o seu 1º registro entra em cena (aí ele já tem a altura real, mesmo
  // com content-visibility) — de forma preguiçosa, sem forçar render de fora da tela nem recalcular
  // a cada scroll (o que causaria deslocamento). Re-observa a cada render/resize.
  let _obsCentro = null;
  function atualizaCentragem() {
    if (_obsCentro) _obsCentro.disconnect();
    _obsCentro = new IntersectionObserver(entradas => {
      centraTodos(entradas.filter(e => e.isIntersecting).map(e => e.target.closest('.hist-day')).filter(Boolean));
    }, { rootMargin: '150px 0px' });
    document.querySelectorAll('.hist-day:not(.is-collapsed) .hist-tl-body > .hist-card:first-child').forEach(c => _obsCentro.observe(c));
    centraTodos(diasVisiveis());   // pass imediato p/ os dias já visíveis (sem "pulo" no load)
  }

  // percorre os dias visíveis e, em cada um, acha o registro sob a linha do marcador (busca
  // binária — os cartões estão em ordem vertical) para atualizar horário e cor. rAF-throttled.
  function atualizaMarcas() {
    document.querySelectorAll('.hist-day:not(.is-collapsed)').forEach(day => {
      const r = day.getBoundingClientRect();
      if (r.bottom <= 0 || r.top >= window.innerHeight) return;
      const mark = day.querySelector('.hist-mark');
      const cards = day.querySelectorAll('.hist-tl-body > .hist-card');
      if (!mark || !cards.length) return;
      const linha = mark.getBoundingClientRect().top + mark.offsetHeight / 2 + 1;
      let lo = 0, hi = cards.length - 1, at = 0;
      while (lo <= hi) {
        const mid = (lo + hi) >> 1;
        if (cards[mid].getBoundingClientRect().top <= linha) { at = mid; lo = mid + 1; }
        else hi = mid - 1;
      }
      setMark(mark, cards[at].dataset.hora, cards[at].dataset.acao);
      // SÓ o registro sob o marcador ganha a cor da ação; os demais voltam ao cinza. A cor
      // "acompanha" o marcador conforme ele desce. Delta: apaga o anterior, acende o atual.
      const prev = day._evAt;
      if (prev !== at) {
        if (prev != null && cards[prev]) cards[prev].classList.remove('is-evidenced');
        cards[at].classList.add('is-evidenced');
        day._evAt = at;
      }
    });
  }

  // o título do MÊS (único sticky) ABSORVE a data + contagem do dia atual: conforme os cabeçalhos
  // de dia deslizam para debaixo dele, a informação passa a ser exibida no próprio mês, mantendo a
  // continuidade da referência. O "dia atual" é o último cujo cabeçalho já passou por baixo do mês.
  function atualizaMeses() {
    document.querySelectorAll('.hist-month:not(.hist-month--acao)').forEach(mes => {
      const cur = mes.querySelector('.hist-month-cur');
      if (!cur) return;
      const r = mes.getBoundingClientRect();
      if (r.bottom <= 0 || r.top >= window.innerHeight) { if (!cur.hidden) cur.hidden = true; return; }
      // a área rolável é irmã do título dentro do cartão (a faixa zebrada fica entre os dois)
      const rol = mes.parentElement && mes.parentElement.querySelector('.hist-monthscroll');
      let atual = null;
      if (rol) rol.querySelectorAll('.hist-day-head').forEach(head => {
        // a data só migra para o título quando o subtítulo do dia SOME por completo sob o título
        // (a base dele passa acima da base do título), não assim que começa a entrar
        if (head.getBoundingClientRect().bottom <= r.bottom + 1) atual = head;
      });
      if (atual) {
        const d = atual.querySelector('.hist-day-date'), c = atual.querySelector('.hist-day-count');
        const txt = (d ? d.textContent : '') + (c ? '  ·  ' + c.textContent : '');
        if (cur.textContent !== txt) cur.textContent = txt;
        if (cur.hidden) cur.hidden = false;
      } else if (!cur.hidden) { cur.hidden = true; cur.textContent = ''; }
    });
  }

  let _marcasRAF = 0;
  function agendaMarcas() { if (_marcasRAF) return; _marcasRAF = requestAnimationFrame(() => { _marcasRAF = 0; atualizaMarcas(); atualizaMeses(); }); }
  window.addEventListener('scroll', agendaMarcas, { passive: true });
  window.addEventListener('resize', agendaMarcas, { passive: true });
  // no resize as alturas dos registros mudam: recentra os marcadores (adiado, fora do caminho do scroll)
  let _tCentra = 0;
  window.addEventListener('resize', () => { clearTimeout(_tCentra); _tCentra = setTimeout(atualizaCentragem, 200); }, { passive: true });

  function agrupaPorDia(regs) {
    const mapa = new Map();
    regs.forEach(r => { if (!mapa.has(r.data)) mapa.set(r.data, []); mapa.get(r.data).push(r); });
    return [...mapa.entries()].sort((a, b) => (parse(b[0]) || { chave: 0 }).chave - (parse(a[0]) || { chave: 0 }).chave);
  }

  const cap = s => (s || '').charAt(0).toUpperCase() + s.slice(1);

  // um GRUPO colapsável de checkboxes (multi-seleção). O cabeçalho é o subtítulo do conjunto;
  // clicar nele recolhe/expande o grupo (mesma seta dos "documentos recebidos").
  function montaGrupo(container, titulo, opcoes, selecionados, aoAlternar) {
    if (!container) return;
    const colapsado = container.classList.contains('is-collapsed');
    container.innerHTML = '';
    const head = el('button', 'hist-filtergroup-head');
    head.type = 'button';
    head.setAttribute('aria-expanded', String(!colapsado));
    head.appendChild(el('span', 'hist-filtergroup-title', titulo));
    head.appendChild(el('span', 'hist-filtergroup-caret', '▾'));
    head.addEventListener('click', () => {
      const c = container.classList.toggle('is-collapsed');
      head.setAttribute('aria-expanded', String(!c));
    });
    const body = el('div', 'hist-filtergroup-body');
    opcoes.forEach(o => {
      const lab = el('label', 'hist-check' + (!o.n ? ' is-empty' : ''));
      const inp = document.createElement('input');
      inp.type = 'checkbox';
      inp.value = o.valor;
      inp.checked = selecionados.has(o.valor);
      inp.addEventListener('change', () => aoAlternar(o.valor, inp.checked));
      lab.appendChild(inp);
      lab.appendChild(el('span', 'hist-check-lbl', o.rotulo));
      lab.appendChild(el('span', 'hist-check-n', String(o.n)));
      body.appendChild(lab);
    });
    container.appendChild(head);
    container.appendChild(body);
  }

  const alternaAcao = (v, on) => { on ? filtrosAcao.add(v) : filtrosAcao.delete(v); agendarRender(); };
  const alternaTipo = (v, on) => { on ? filtrosTipo.add(v) : filtrosTipo.delete(v); agendarRender(); };

  // monta os dois grupos do menu (Ação e Elemento) com as contagens totais da aba. Chamado só
  // quando a ABA muda — contagens estáveis, o menu não "dança" a cada seleção e preserva o colapso.
  function montaFiltros(daAba) {
    const acaoOpts = ACOES[aba].map(a => ({ valor: a, rotulo: cap(a), n: daAba.filter(r => r.acao === a).length }));
    montaGrupo(barraAcao, 'Ação', acaoOpts, filtrosAcao, alternaAcao);
    const cont = {};
    daAba.forEach(r => (cont[r.tipo] = (cont[r.tipo] || 0) + 1));
    const tipoOpts = Object.keys(cont).sort((a, b) => cont[b] - cont[a]).map(t => ({ valor: t, rotulo: cap(t), n: cont[t] }));
    montaGrupo(barraTipo, 'Elemento', tipoOpts, filtrosTipo, alternaTipo);
  }

  // contagens FACETADAS: cada opção mostra quantos registros restariam se ela fosse a única marcada
  // na sua categoria, respeitando o filtro da OUTRA categoria e a busca. Opção sem resultado fica
  // desabilitada (nada a exibir). Os filtros da MESMA categoria não influenciam as próprias
  // contagens — só as da outra categoria (Ação↔Elemento).
  function atualizaContagens(daAba) {
    const casaBusca = r => !termo || textoDe(r).includes(termo);
    const conta = (container, valorDe, outroOk) => {
      if (!container) return;
      container.querySelectorAll('.hist-check').forEach(lab => {
        const inp = lab.querySelector('input');
        const n = daAba.filter(r => valorDe(r) === inp.value && outroOk(r) && casaBusca(r)).length;
        const nEl = lab.querySelector('.hist-check-n');
        if (nEl) nEl.textContent = n;
        lab.classList.toggle('is-empty', n === 0);
        inp.disabled = n === 0 && !inp.checked;
      });
    };
    conta(barraAcao, r => r.acao, r => filtrosTipo.size === 0 || filtrosTipo.has(r.tipo));
    conta(barraTipo, r => r.tipo, r => filtrosAcao.size === 0 || filtrosAcao.has(r.acao));
  }

  // remove um filtro (via chip) e desmarca o checkbox correspondente, sem remontar o menu
  function removeFiltro(conjunto, valor) {
    conjunto.delete(valor);
    const esc = window.CSS && CSS.escape ? CSS.escape(valor) : valor.replace(/"/g, '\\"');
    const inp = document.querySelector('.hist-filtergroup input[value="' + esc + '"]');
    if (inp) inp.checked = false;
    agendarRender();
  }

  function limparFiltros() {
    filtrosAcao.clear(); filtrosTipo.clear(); termo = '';
    if (busca) busca.value = '';
    if (limpaBusca) limpaBusca.hidden = true;
    document.querySelectorAll('.hist-filtergroup input:checked').forEach(i => (i.checked = false));
    agendarRender();
  }

  // ── filtros ATIVOS, logo abaixo da busca ──
  // Um chip por elemento selecionado (mostra o "X" ao pairar, p/ remoção individual) + a busca
  // ativa, e o botão "Limpar" ao final. Sem ponto/indicador no botão do funil (que mudava a
  // largura e empurrava a busca): quem sinaliza o que está ativo é esta lista.
  function renderAtivos() {
    if (!barraAtiva) return;
    barraAtiva.innerHTML = '';
    const itens = [];
    if (termo) itens.push({ rotulo: '“' + termo + '”', classe: 'busca', remove: () => { termo = ''; if (busca) busca.value = ''; if (limpaBusca) limpaBusca.hidden = true; agendarRender(); } });
    filtrosAcao.forEach(v => itens.push({ rotulo: cap(v), classe: slug(v), remove: () => removeFiltro(filtrosAcao, v) }));
    filtrosTipo.forEach(v => itens.push({ rotulo: cap(v), classe: 'tipo', remove: () => removeFiltro(filtrosTipo, v) }));
    if (!itens.length) { barraAtiva.hidden = true; return; }
    barraAtiva.hidden = false;
    itens.forEach(it => {
      const chip = el('span', 'hist-chip hist-chip--' + it.classe);
      chip.appendChild(el('span', 'hist-chip-lbl', it.rotulo));
      const x = el('button', 'hist-chip-x');
      x.type = 'button';
      x.setAttribute('aria-label', 'Remover ' + it.rotulo);
      x.textContent = '✕';
      x.addEventListener('click', it.remove);
      chip.appendChild(x);
      barraAtiva.appendChild(chip);
    });
    const limpar = el('button', 'hist-filter-clear', 'Limpar');
    limpar.type = 'button';
    limpar.addEventListener('click', limparFiltros);
    barraAtiva.appendChild(limpar);
  }

  function render() {
    lista.innerHTML = '';

    const daAba = (dados.registros || []).filter(r => (r.aba || 'conteudo') === aba)
      .concat(aba === 'funcoes' ? (dados.funcoes || []) : []);

    // o menu de filtros é montado só quando a ABA muda (estrutura estável, colapso preservado);
    // as contagens facetadas e o estado "desabilitado" das opções são atualizados a cada render
    if (gruposTab !== aba) { montaFiltros(daAba); gruposTab = aba; }
    atualizaContagens(daAba);

    // multi-seleção: vazio = todos; senão o registro precisa casar com ALGUMA ação marcada E
    // ALGUM elemento marcado (e a busca). Os três conjuntos se combinam.
    const regs = daAba.filter(r =>
      (filtrosAcao.size === 0 || filtrosAcao.has(r.acao)) &&
      (filtrosTipo.size === 0 || filtrosTipo.has(r.tipo)) &&
      (!termo || textoDe(r).includes(termo)));

    renderAtivos();

    if (!regs.length) {
      vazio.hidden = false;
      vazio.textContent = daAba.length
        ? 'Nenhuma alteração corresponde aos filtros.'
        : (aba === 'funcoes'
          ? 'Nenhuma funcionalidade registrada ainda. A partir de agora, cada nova função, aperfeiçoamento ou descarte aparece aqui.'
          : 'Nenhuma alteração registrada.');
      resumoEl.textContent = '';
      return;
    }
    vazio.hidden = true;

    const cont = {};
    regs.forEach(r => (cont[r.acao] = (cont[r.acao] || 0) + 1));
    resumoEl.textContent = plural(regs.length, 'alteração') +
      (regs.length !== daAba.length ? ' (de ' + daAba.length + ')' : '') + ' · ' +
      Object.entries(cont).map(([k, v]) => plural(v, k)).join(' · ');

    if (agrupamento === 'cronologico') {
      // cada MÊS é um CONTAINER: o título fica FIXO no topo do cartão e só os REGISTROS rolam, num
      // elemento interno com scroll próprio (a barra de rolagem fica sob o título, limitada aos
      // registros). Assim um mês inteiro pode ser pulado pelo scroll da página, e o título nunca
      // encosta no breadcrumb.
      let mesAtual = null, rolagem = null;
      agrupaPorDia(regs).forEach(([dia, itens]) => {
        const p = parse(dia);
        const mes = p ? MESES[p.mes].charAt(0).toUpperCase() + MESES[p.mes].slice(1) : '—';
        const rotuloMes = p ? mes + ' de ' + p.ano : '—';
        if (rotuloMes !== mesAtual) {
          mesAtual = rotuloMes;
          const caixa = el('div', 'hist-monthbox');
          const mh = el('h2', 'hist-month');
          mh.appendChild(el('span', 'hist-month-label', rotuloMes));
          mh.appendChild(el('span', 'hist-month-cur'));   // data + contagem do dia, absorvidas ao rolar
          caixa.appendChild(mh);
          caixa.appendChild(el('div', 'hist-gap'));   // faixa zebrada suave logo abaixo do título do mês
          rolagem = el('div', 'hist-monthscroll');   // SÓ os registros rolam; a barra fica sob o título
          rolagem.addEventListener('scroll', agendaMarcas, { passive: true });
          caixa.appendChild(rolagem);
          lista.appendChild(caixa);
        }
        rolagem.appendChild(bloco(dia, itens));
      });
    } else {
      // mesma estrutura de cartão do cronológico: cada AÇÃO é um container com título fixo e área de
      // registros com scroll próprio, para poder pular um grupo inteiro pelo scroll da página.
      ACOES[aba].forEach(acao => {
        const doGrupo = regs.filter(r => r.acao === acao);
        if (!doGrupo.length) return;
        const caixa = el('div', 'hist-monthbox');
        const h = el('h2', 'hist-month hist-month--acao');
        h.appendChild(badgeAcao(acao));
        h.appendChild(el('span', 'hist-month-count', String(doGrupo.length)));
        caixa.appendChild(h);
        caixa.appendChild(el('div', 'hist-gap'));   // faixa zebrada suave logo abaixo do título da ação
        const rolagem = el('div', 'hist-monthscroll');
        rolagem.addEventListener('scroll', agendaMarcas, { passive: true });
        agrupaPorDia(doGrupo).forEach(([dia, itens]) => rolagem.appendChild(bloco(dia, itens)));
        caixa.appendChild(rolagem);
        lista.appendChild(caixa);
      });
    }
    // depois que o layout assenta, acerta os marcadores ao estado inicial da lista e centra cada
    // marcador no 1º registro do seu dia
    requestAnimationFrame(() => { atualizaCentragem(); atualizaMarcas(); });
  }

  // ── controles ──
  document.querySelectorAll('.hist-tab').forEach(b => b.addEventListener('click', () => {
    document.querySelectorAll('.hist-tab').forEach(x => { x.classList.remove('active'); x.setAttribute('aria-selected', 'false'); });
    b.classList.add('active'); b.setAttribute('aria-selected', 'true');
    aba = b.dataset.aba;
    filtrosAcao.clear(); filtrosTipo.clear();   // os rótulos de ação mudam entre abas
    gruposTab = null;                            // força remontar o menu para a nova aba
    agendarRender();
  }));

  // escopado a .hist-groups: os botões de colapsar/expandir são outra coisa
  const botoesGrupo = document.querySelectorAll('.hist-groups .hist-group-btn');
  botoesGrupo.forEach(b => b.addEventListener('click', () => {
    if (b.dataset.grupo === agrupamento) return;   // já é o agrupamento atual: nada a refazer
    botoesGrupo.forEach(x => { x.classList.remove('active'); x.setAttribute('aria-pressed', 'false'); });
    b.classList.add('active'); b.setAttribute('aria-pressed', 'true');
    agrupamento = b.dataset.grupo;
    agendarRender();
  }));

  if (busca) {
    busca.addEventListener('input', () => {
      termo = dobra(busca.value.trim());   // imediato: alimenta o botão limpar
      if (limpaBusca) limpaBusca.hidden = !busca.value;
      agendarRender(160);                  // adiado: só re-renderiza quando a digitação pausa
    });
  }
  if (limpaBusca) {
    limpaBusca.addEventListener('click', () => {
      busca.value = ''; termo = ''; limpaBusca.hidden = true; busca.focus(); render();
    });
  }

  // ── menu de filtros (funil) ──
  // Abre/fecha o dropdown com os grupos colapsáveis de checkboxes. Sem indicador no botão (que
  // mudava a largura e empurrava a busca): o que está ativo aparece nos chips abaixo da busca.
  const filtroToggle = document.querySelector('#hist-filter-toggle');
  const filtroPanel = document.querySelector('#hist-filter-panel');
  const abreFunil = abrir => { if (!filtroPanel) return; filtroPanel.hidden = !abrir; filtroToggle.setAttribute('aria-expanded', String(abrir)); };
  if (filtroToggle) filtroToggle.addEventListener('click', e => { e.stopPropagation(); abreFunil(filtroPanel.hidden); });
  if (filtroPanel) filtroPanel.addEventListener('click', e => e.stopPropagation());
  document.addEventListener('click', () => abreFunil(false));
  document.addEventListener('keydown', e => { if (e.key === 'Escape') abreFunil(false); });

  // colapsar / expandir tudo
  const todos = (fechar) => {
    document.querySelectorAll('.hist-day').forEach(s => {
      s.classList.toggle('is-collapsed', fechar);
      const h = s.querySelector('.hist-day-head');
      if (h) h.setAttribute('aria-expanded', String(!fechar));
    });
    requestAnimationFrame(() => { atualizaCentragem(); atualizaMarcas(); });
  };
  const btnColapsar = document.querySelector('#hist-collapse');
  const btnExpandir = document.querySelector('#hist-expand');
  if (btnColapsar) btnColapsar.addEventListener('click', () => todos(true));
  if (btnExpandir) btnExpandir.addEventListener('click', () => todos(false));

  // ── retorno ao ponto exato ──
  // O navegador restaura a rolagem ANTES de o JS montar os registros (a página nasce vazia) e a
  // posição se perde. Assumimos o controle e restauramos DEPOIS da renderização.
  // A restauração é de uso único: consumida a marca, ela é apagada — senão uma visita futura,
  // vinda do índice, saltaria sozinha para o meio da página. Apagar 'hist-from' aqui também
  // retira o botão "‹ histórico" dos slides, já que o usuário voltou.
  if ('scrollRestoration' in history) history.scrollRestoration = 'manual';
  function restaurarRolagem() {
    let y = null, rec = null;
    try {
      y = sessionStorage.getItem('hist-scroll');
      rec = sessionStorage.getItem('hist-record');
      sessionStorage.removeItem('hist-scroll');
      sessionStorage.removeItem('hist-from');
      sessionStorage.removeItem('hist-record');
      sessionStorage.removeItem('hist-focus');
    } catch (e) { /* bloqueado */ }
    // preferimos localizar o PRÓPRIO registro clicado: rola até ele e o pisca em verde (mesma
    // afordância do "localizar" no slide). Só caímos no scroll bruto se o registro não existir.
    if (rec) {
      const alvo = lista.querySelector('.hist-card[data-id="' + (window.CSS && CSS.escape ? CSS.escape(rec) : rec) + '"]');
      if (alvo) {
        requestAnimationFrame(() => requestAnimationFrame(() => {
          alvo.scrollIntoView({ block: 'center' });
          alvo.classList.remove('hist-located'); void alvo.offsetWidth; alvo.classList.add('hist-located');
        }));
        return;
      }
    }
    if (y == null) return;
    requestAnimationFrame(() => requestAnimationFrame(() => window.scrollTo(0, +y)));
  }

  fetch(arquivo)
    .then(r => r.json())
    .then(j => {
      dados = j;
      const info = document.querySelector('.hist-source');
      // sem a contagem de registros aqui: ela reaparece logo abaixo, em .hist-summary ("N
      // alterações"), então repeti-la seria redundante.
      if (info) info.textContent = j.commits + ' commits analisados · última alteração em ' + j.geradoEm;
      render();
      restaurarRolagem();
    })
    .catch(() => {
      vazio.hidden = false;
      vazio.textContent = 'Não foi possível carregar esta seção no momento. Tente novamente mais tarde.';
    });
})();
