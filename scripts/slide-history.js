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
  let filtroAcao = 'all';
  let filtroTipo = 'all';
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
    topo.appendChild(el('span', 'hist-badge hist-badge--' + slug(r.acao), r.acao));
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
      agendaMarcas();
    });
    sec.appendChild(cab);
    sec.appendChild(tl);
    return sec;
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
    });
  }
  let _marcasRAF = 0;
  function agendaMarcas() { if (_marcasRAF) return; _marcasRAF = requestAnimationFrame(() => { _marcasRAF = 0; atualizaMarcas(); }); }
  window.addEventListener('scroll', agendaMarcas, { passive: true });
  window.addEventListener('resize', agendaMarcas, { passive: true });

  function agrupaPorDia(regs) {
    const mapa = new Map();
    regs.forEach(r => { if (!mapa.has(r.data)) mapa.set(r.data, []); mapa.get(r.data).push(r); });
    return [...mapa.entries()].sort((a, b) => (parse(b[0]) || { chave: 0 }).chave - (parse(a[0]) || { chave: 0 }).chave);
  }

  // ── barra de filtros por ELEMENTO ──
  // A LISTA de botões sai de todos os registros da aba (é estável: a barra não dança a cada
  // tecla digitada); os CONTADORES saem do que a ação e a busca já deixaram passar, para que o
  // número diga quantos registros o clique vai de fato revelar.
  function montaFiltroTipo(daAba, visiveis) {
    if (!barraTipo) return;
    const cont = {};
    visiveis.forEach(r => (cont[r.tipo] = (cont[r.tipo] || 0) + 1));
    const ordem = {};
    daAba.forEach(r => (ordem[r.tipo] = (ordem[r.tipo] || 0) + 1));
    const tipos = Object.keys(ordem).sort((a, b) => ordem[b] - ordem[a]);
    barraTipo.innerHTML = '';
    const criar = (valor, rotulo, n) => {
      const b = el('button', 'hist-filter-btn' + (filtroTipo === valor ? ' active' : '') + (!n ? ' is-empty' : ''));
      b.type = 'button';
      b.dataset.valor = valor;
      b.textContent = rotulo + ' (' + n + ')';
      b.setAttribute('aria-pressed', String(filtroTipo === valor));
      b.addEventListener('click', () => { if (filtroTipo === valor) return; filtroTipo = valor; agendarRender(); });
      barraTipo.appendChild(b);
    };
    criar('all', 'Tudo', visiveis.length);
    tipos.forEach(t => criar(t, t.charAt(0).toUpperCase() + t.slice(1), cont[t] || 0));
  }

  function montaFiltroAcao() {
    if (!barraAcao) return;
    barraAcao.innerHTML = '';
    const criar = (valor, rotulo) => {
      const b = el('button', 'hist-filter-btn' + (filtroAcao === valor ? ' active' : '') + (valor !== 'all' ? ' hist-filter-btn--' + slug(valor) : ''));
      b.type = 'button';
      b.dataset.valor = valor;
      b.textContent = rotulo;
      b.setAttribute('aria-pressed', String(filtroAcao === valor));
      b.addEventListener('click', () => { if (filtroAcao === valor) return; filtroAcao = valor; agendarRender(); });
      barraAcao.appendChild(b);
    };
    criar('all', 'Tudo');
    ACOES[aba].forEach(a => criar(a, a.charAt(0).toUpperCase() + a.slice(1)));
  }

  function render() {
    lista.innerHTML = '';

    const daAba = (dados.registros || []).filter(r => (r.aba || 'conteudo') === aba)
      .concat(aba === 'funcoes' ? (dados.funcoes || []) : []);

    // os três filtros se combinam; o de ELEMENTO é aplicado por último para que seus
    // contadores possam ser medidos no conjunto que a ação e a busca já filtraram
    const semTipo = daAba.filter(r =>
      (filtroAcao === 'all' || r.acao === filtroAcao) &&
      (!termo || textoDe(r).includes(termo)));
    const regs = semTipo.filter(r => filtroTipo === 'all' || r.tipo === filtroTipo);

    montaFiltroAcao();
    montaFiltroTipo(daAba, semTipo);
    sincronizaFunil();

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
      let mesAtual = null;
      agrupaPorDia(regs).forEach(([dia, itens]) => {
        const p = parse(dia);
        const mes = p ? MESES[p.mes].charAt(0).toUpperCase() + MESES[p.mes].slice(1) : '—';
        const rotuloMes = p ? mes + ' de ' + p.ano : '—';
        if (rotuloMes !== mesAtual) {
          mesAtual = rotuloMes;
          lista.appendChild(el('h2', 'hist-month', rotuloMes));
        }
        lista.appendChild(bloco(dia, itens));
      });
    } else {
      ACOES[aba].forEach(acao => {
        const doGrupo = regs.filter(r => r.acao === acao);
        if (!doGrupo.length) return;
        const h = el('h2', 'hist-month hist-month--acao');
        h.appendChild(el('span', 'hist-badge hist-badge--' + slug(acao), acao));
        h.appendChild(el('span', 'hist-month-count', String(doGrupo.length)));
        lista.appendChild(h);
        agrupaPorDia(doGrupo).forEach(([dia, itens]) => lista.appendChild(bloco(dia, itens)));
      });
    }
    agendaMarcas();   // acerta os marcadores sticky ao estado inicial da lista recém-montada
  }

  // ── controles ──
  document.querySelectorAll('.hist-tab').forEach(b => b.addEventListener('click', () => {
    document.querySelectorAll('.hist-tab').forEach(x => { x.classList.remove('active'); x.setAttribute('aria-selected', 'false'); });
    b.classList.add('active'); b.setAttribute('aria-selected', 'true');
    aba = b.dataset.aba;
    filtroAcao = 'all'; filtroTipo = 'all';   // os rótulos mudam entre abas
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
  // Recolhe as barras de ação e de elemento num dropdown ao lado da busca, poupando espaço
  // vertical. Um ponto no botão avisa quando há filtro ativo mesmo com o menu fechado.
  const filtroToggle = document.querySelector('#hist-filter-toggle');
  const filtroPanel = document.querySelector('#hist-filter-panel');
  const filtroDot = document.querySelector('.hist-filtermenu-dot');
  const filtroClear = document.querySelector('#hist-filter-clear');
  const abreFunil = abrir => { if (!filtroPanel) return; filtroPanel.hidden = !abrir; filtroToggle.setAttribute('aria-expanded', String(abrir)); };
  if (filtroToggle) filtroToggle.addEventListener('click', e => { e.stopPropagation(); abreFunil(filtroPanel.hidden); });
  if (filtroPanel) filtroPanel.addEventListener('click', e => e.stopPropagation());
  document.addEventListener('click', () => abreFunil(false));
  document.addEventListener('keydown', e => { if (e.key === 'Escape') abreFunil(false); });
  if (filtroClear) filtroClear.addEventListener('click', () => {
    filtroAcao = 'all'; filtroTipo = 'all'; termo = '';
    if (busca) busca.value = '';
    if (limpaBusca) limpaBusca.hidden = true;
    agendarRender();
  });
  function sincronizaFunil() {
    if (!filtroToggle) return;
    const ativo = filtroAcao !== 'all' || filtroTipo !== 'all' || !!termo;
    if (filtroDot) filtroDot.hidden = !ativo;
    filtroToggle.classList.toggle('is-active', ativo);
  }

  // colapsar / expandir tudo
  const todos = (fechar) => {
    document.querySelectorAll('.hist-day').forEach(s => {
      s.classList.toggle('is-collapsed', fechar);
      const h = s.querySelector('.hist-day-head');
      if (h) h.setAttribute('aria-expanded', String(!fechar));
    });
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
      if (info) info.textContent = j.commits + ' commits analisados · ' + j.total + ' registros · última alteração em ' + j.geradoEm;
      render();
      restaurarRolagem();
    })
    .catch(() => {
      vazio.hidden = false;
      vazio.textContent = 'Não foi possível carregar o histórico. Sirva a página por http (o arquivo JSON é lido por fetch).';
    });
})();
