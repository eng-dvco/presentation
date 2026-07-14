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
    r.documento && [r.documento.versao, r.documento.paginas, r.documento.tamanho].join(' '),
  ].filter(Boolean).join(' '));

  // ── um registro ──
  function cartao(r) {
    const a = el('a', 'hist-card hist-card--' + slug(r.acao));
    a.href = base + (r.link || 'slides/index.html');
    a.dataset.acao = r.acao;
    a.dataset.tipo = r.tipo;

    // guarda de ONDE se saiu, p/ o slide oferecer o retorno e a rolagem ser restaurada
    a.addEventListener('click', () => {
      try {
        sessionStorage.setItem('hist-scroll', String(window.scrollY));
        sessionStorage.setItem('hist-from', location.pathname);
      } catch (e) { /* sessionStorage bloqueado: o link continua funcionando */ }
    });

    const topo = el('div', 'hist-card-top');
    // HORA, não a data: a data já titula o grupo. Dentro de um mesmo dia há até 10 commits,
    // então a hora é o que de fato distingue um registro do outro.
    if (r.hora) topo.appendChild(el('span', 'hist-hora', r.hora));
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

    // ── DE → PARA em dois subcontainers (lado a lado no desktop, empilhados no mobile) ──
    if (r.de != null && r.para != null && r.de !== r.para) {
      const delta = el('div', 'hist-delta');
      [['de', r.de], ['para', r.para]].forEach(([papel, valor]) => {
        const cx = el('div', 'hist-delta-box hist-delta-box--' + papel);
        cx.appendChild(el('span', 'hist-delta-label', papel));
        cx.appendChild(el('p', 'hist-delta-valor', valor));
        delta.appendChild(cx);
      });
      a.appendChild(delta);
    } else if (r.resumo) {
      a.appendChild(el('p', 'hist-resumo', r.resumo));
    }

    // ── IMAGENS: miniaturas com o indicador "+N" ──
    if (r.imagens && r.imagens.amostra && r.imagens.amostra.length) {
      const total = r.imagens.total;
      const amostra = r.imagens.amostra;
      // O indicador COBRE a miniatura em que está — então ela também não é vista, e precisa
      // ser contada. Com 6 imagens e 3 miniaturas, a 3ª exibe "+4" (as 3 escondidas + ela
      // própria), não "+3". Só aparece quando há de fato imagem oculta.
      const escondidas = total - (amostra.length - 1);
      const mostraMais = total > amostra.length;

      const tiras = el('div', 'hist-thumbs');
      amostra.forEach((im, i) => {
        const cel = el('span', 'hist-thumb');
        const img = document.createElement('img');
        img.src = base + im.miniatura;
        img.alt = im.nome;
        img.loading = 'lazy';
        img.width = 64; img.height = 48;
        cel.appendChild(img);
        if (i === amostra.length - 1 && mostraMais) {
          cel.appendChild(el('span', 'hist-thumb-mais', '+' + escondidas));
        }
        tiras.appendChild(cel);
      });
      a.appendChild(tiras);

      const met = el('div', 'hist-meta');
      met.appendChild(el('span', 'hist-meta-item', total + (total === 1 ? ' imagem' : ' imagens')));
      met.appendChild(el('span', 'hist-meta-item', r.imagens.pesoTotal));
      if (r.removidas) met.appendChild(el('span', 'hist-meta-item', r.removidas + ' substituída(s)'));
      a.appendChild(met);
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

  // ── um dia (colapsável) ──
  function bloco(dia, registros) {
    const sec = el('section', 'hist-day');
    const cab = el('button', 'hist-day-head');
    cab.type = 'button';
    cab.setAttribute('aria-expanded', 'true');
    cab.appendChild(el('span', 'hist-day-caret', '▾'));
    cab.appendChild(el('span', 'hist-day-date', dia));
    cab.appendChild(el('span', 'hist-day-count', plural(registros.length, 'alteração')));
    const cx = el('div', 'hist-day-items');
    registros.forEach(r => cx.appendChild(cartao(r)));
    cab.addEventListener('click', () => {
      const fechado = sec.classList.toggle('is-collapsed');
      cab.setAttribute('aria-expanded', String(!fechado));
    });
    sec.appendChild(cab);
    sec.appendChild(cx);
    return sec;
  }

  function agrupaPorDia(regs) {
    const mapa = new Map();
    regs.forEach(r => { if (!mapa.has(r.data)) mapa.set(r.data, []); mapa.get(r.data).push(r); });
    // dentro do dia, o mais recente primeiro (pela hora)
    mapa.forEach(v => v.sort((a, b) => (b.hora || '').localeCompare(a.hora || '')));
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
      b.addEventListener('click', () => { filtroTipo = valor; render(); });
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
      b.addEventListener('click', () => { filtroAcao = valor; render(); });
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
  }

  // ── controles ──
  document.querySelectorAll('.hist-tab').forEach(b => b.addEventListener('click', () => {
    document.querySelectorAll('.hist-tab').forEach(x => { x.classList.remove('active'); x.setAttribute('aria-selected', 'false'); });
    b.classList.add('active'); b.setAttribute('aria-selected', 'true');
    aba = b.dataset.aba;
    filtroAcao = 'all'; filtroTipo = 'all';   // os rótulos mudam entre abas
    render();
  }));

  // escopado a .hist-groups: os botões de colapsar/expandir são outra coisa
  const botoesGrupo = document.querySelectorAll('.hist-groups .hist-group-btn');
  botoesGrupo.forEach(b => b.addEventListener('click', () => {
    botoesGrupo.forEach(x => { x.classList.remove('active'); x.setAttribute('aria-pressed', 'false'); });
    b.classList.add('active'); b.setAttribute('aria-pressed', 'true');
    agrupamento = b.dataset.grupo;
    render();
  }));

  if (busca) {
    busca.addEventListener('input', () => {
      termo = dobra(busca.value.trim());
      if (limpaBusca) limpaBusca.hidden = !busca.value;
      render();
    });
  }
  if (limpaBusca) {
    limpaBusca.addEventListener('click', () => {
      busca.value = ''; termo = ''; limpaBusca.hidden = true; busca.focus(); render();
    });
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
    let y = null;
    try {
      y = sessionStorage.getItem('hist-scroll');
      sessionStorage.removeItem('hist-scroll');
      sessionStorage.removeItem('hist-from');
    } catch (e) { /* bloqueado */ }
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
