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
  const expNote = document.querySelector('.hist-exp-note');
  const busca = document.querySelector('#hist-search');
  const limpaBusca = document.querySelector('#hist-search-clear');
  const barraAcao = document.querySelector('.hist-filter-acao');
  const barraTipo = document.querySelector('.hist-filter-tipo');
  const barraAtiva = document.querySelector('.hist-active');

  const MESES = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];
  const ACOES = { conteudo: ['adição', 'modificação', 'transferência', 'deleção'], funcoes: ['implementada', 'aperfeiçoada', 'descartada'] };

  // sem acentuação e sem caixa — mesma regra da busca do index.html
  const dobra = s => (window.UI && window.UI.foldAccents)
    ? window.UI.foldAccents(s)
    : (s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

  // "adição" → "adicao" (serve de classe CSS e de valor de filtro)
  const slug = s => dobra(s).replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

  // "1 adição" mas "349 adições"; "1 implementada" mas "3 implementadas"
  const plural = (n, rotulo) => n + ' ' + (n === 1 ? rotulo
    : /ção$/.test(rotulo) ? rotulo.replace(/ção$/, 'ções')
    : /m$/.test(rotulo) ? rotulo.replace(/m$/, 'ns')   // imagem → imagens (não "imagems")
    : rotulo + 's');

  const parse = d => {
    const m = /^(\d{2})-(\d{2})-(\d{2})$/.exec(d || '');
    if (!m) return null;
    return { dia: +m[1], mes: +m[2] - 1, ano: 2000 + +m[3], chave: (2000 + +m[3]) * 10000 + (+m[2]) * 100 + (+m[1]) };
  };

  let dados = null;
  let aba = 'conteudo';
  let agrupamento = 'tempo';
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

  // um registro consolidado guarda cada alteração em `partes`; um simples é a sua própria parte
  const partesDe = r => (r.partes && r.partes.length ? r.partes : [r]);
  // os tipos de elemento do registro (vários, quando consolidado) — para o filtro por elemento
  const tiposDe = r => (r.tipos && r.tipos.length ? r.tipos : [r.tipo]);

  // papel de cada segmento do breadcrumb — vira uma pequena label: [seção] › [slide] › [subtítulo]
  // (o índice segue a estrutura seção › slide › atividade; nos documentos, o 2º item é o documento).
  const papelCrumb = (r, i) => i === 0 ? 'seção'
    : i === 1 ? (tiposDe(r).includes('documento') ? 'documento' : 'slide')
      : 'subtítulo';

  // ── índice de busca: tudo que o registro "diz" ──
  const textoDe = r => dobra([
    r.titulo, r.tipo, r.acao, r.curadoria, r.commit, (r.breadcrumb || []).join(' '),
    ...partesDe(r).flatMap(p => [
      p.resumo, p.de, p.para,
      (p.imagens && p.imagens.amostra || []).map(a => a.nome).join(' '),
      (p.legendas || []).map(l => l.texto).join(' '),
      p.documento && [p.documento.versao, p.documento.paginas, p.documento.tamanho].join(' '),
    ]),
  ].filter(Boolean).join(' '));

  // srcs das imagens que o registro toca (para o "localizar" no slide destino)
  const focoImgs = r => {
    const nomes = [];
    partesDe(r).forEach(p => {
      (p.imagens && p.imagens.amostra || []).forEach(a => nomes.push(a.src.split('/').pop()));
      (p.legendas || []).forEach(l => (l.imagens.amostra || []).forEach(a => nomes.push(a.src.split('/').pop())));
    });
    return [...new Set(nomes)];
  };
  // srcs SÓ das imagens de uma faixa/legenda (para localizar aquela alteração específica no slide)
  const focoImgsGrupo = imagens => [...new Set((imagens && imagens.amostra || []).map(a => a.src.split('/').pop()))];

  // salta até o registro (card) de id informado, dentro da lista, e o realça — mesma affordância do
  // "localizar". Usado pelo aviso de registro DEFASADO para levar à versão vigente do elemento.
  function irParaRegistro(id) {
    if (!id) return;
    const alvo = lista.querySelector('.hist-card[data-id="' + (window.CSS && CSS.escape ? CSS.escape(id) : id) + '"]');
    if (!alvo) return;   // pode estar filtrado/oculto no momento
    alvo.scrollIntoView({ block: 'center' });
    alvo.classList.remove('hist-located'); void alvo.offsetWidth; alvo.classList.add('hist-located');
  }

  // guarda ONDE se saiu (retorno + realce) e O QUE localizar no slide destino (imagens + texto).
  // Usada tanto pelo cartão inteiro quanto por cada faixa de imagens (clique individual).
  function salvaFoco(r, imgs, texto) {
    try {
      sessionStorage.setItem('hist-scroll', String(window.scrollY));
      sessionStorage.setItem('hist-from', location.pathname);
      if (r.id) sessionStorage.setItem('hist-record', r.id);
      sessionStorage.setItem('hist-focus', JSON.stringify({ imgs: imgs, texto: texto || null }));
    } catch (e) { /* sessionStorage bloqueado: o link continua funcionando */ }
  }

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
      img.width = 64; img.height = 48;   // tamanho único: sempre a miniatura maior
      cel.appendChild(img);
      if (i === amostra.length - 1 && mostraMais) cel.appendChild(el('span', 'hist-thumb-mais', '+' + escondidas));
      // viewports menores mostram no MÁXIMO 3 miniaturas: a 3ª carrega o "+N" (revelado via CSS)
      if (i === 2 && total > 3) cel.appendChild(el('span', 'hist-thumb-mais hist-thumb-mais--mob', '+' + (total - 2)));
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

  // de → para da TRANSFERÊNCIA: mais simples que o delta de modificação (sem caixas fortes lado a
  // lado). Origem EM CIMA, destino EMBAIXO, com um ícone de movimentação (seta) entre os dois.
  function deltaTransfer(de, para) {
    const d = el('div', 'hist-move');
    const linha = (papel, valor) => {
      const row = el('div', 'hist-move-row');
      row.appendChild(el('span', 'hist-move-label', papel));
      row.appendChild(el('span', 'hist-move-valor', valor));
      return row;
    };
    d.appendChild(linha('de', de));
    d.appendChild(linha('para', para));
    return d;
  }

  // conteúdo precedido pela label do ELEMENTO (ex.: observação) à esquerda — mesmo estilo do breadcrumb,
  // para deixar claro qual elemento aquilo representa.
  function comRotulo(papel, conteudo) {
    const linha = el('div', 'hist-rot');
    linha.appendChild(el('span', 'hist-crumb-tag', papel));
    linha.appendChild(conteudo);
    return linha;
  }

  // ícone por ação (traço, cor = currentColor → preto como os títulos). Mesmo estilo Feather dos
  // demais ícones da apresentação: viewBox 24, stroke, cantos redondos.
  const ICONES_ACAO = {
    adicao: '<line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>',
    modificacao: '<path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z"/>',
    transferencia: '<line x1="4" y1="12" x2="17" y2="12"/><polyline points="12 7 18 12 12 17"/>',
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

  // ── corpo de UMA parte (tipo + conteúdo). `r` dá o contexto de clique/href do cartão inteiro. ──
  function corpoParte(a, r, p) {
    const temDelta = p.de != null && p.para != null && p.de !== p.para;
    // a transferência usa um delta próprio (empilhado, com ícone de movimentação); os demais, o padrão
    const montarDelta = () => r.acao === 'transferência' ? deltaTransfer(p.de, p.para) : delta(p.de, p.para);

    // ── OBSERVAÇÃO: a legenda VINCULADA à(s) imagem(ns) que a receberam (sem envelope) ──
    if (p.tipo === 'observação') {
      // a legenda (resumo) de uma observação ADICIONADA ou REMOVIDA leva a label "observação" à esquerda
      // (como nas legendas das imagens). A MODIFICAÇÃO isolada (de→para) não leva — o próprio de/para já
      // a identifica e o topo do card diz OBSERVAÇÃO.
      if (temDelta) a.appendChild(delta(p.de, p.para));
      else if (p.resumo) a.appendChild(comRotulo('observação', el('span', 'hist-info-text', p.resumo)));
      if (p.imagens) { const t = tiras(p.imagens, true); if (t) a.appendChild(t); }

    // ── IMAGENS: legendas por faixa (1-2: X · 3-4: Y) + tira de miniaturas + metadados ──
    } else if (p.tipo === 'imagens') {
      const legendas = p.legendas || [];
      // a legenda ganha a label "observação" quando imagem e observação vêm JUNTAS: na adição de
      // imagens (imagem + legenda) ou num registro que UNE 'imagens' e 'observação' (ex.: 3c6891a).
      const uniaoImgObs = tiposDe(r).includes('imagens') && tiposDe(r).includes('observação');
      const legendaEl = texto => (r.acao === 'adição' || uniaoImgObs)
        ? comRotulo('observação', el('span', 'hist-info-text', texto))
        : el('p', 'hist-info-text', texto);
      if (temDelta) a.appendChild(montarDelta());   // transferência de imagens: origem → destino
      if (legendas.length > 1) {
        // legendas DIFERENTES por faixa de imagens: cada uma com as suas miniaturas (o vínculo).
        // Cada faixa é CLICÁVEL individualmente: leva o usuário exatamente àquela alteração no slide
        // (localiza só as imagens daquela faixa), em vez de tratar o registro como um bloco único.
        const grupos = el('div', 'hist-info-groups');
        legendas.forEach(l => {
          const g = el('div', 'hist-info-group hist-info-group--link');
          g.tabIndex = 0;
          g.setAttribute('role', 'link');
          g.title = 'Localizar esta alteração no slide';
          g.appendChild(legendaEl(l.texto));
          const t = tiras(l.imagens, true);
          if (t) g.appendChild(t);
          const irAoGrupo = e => {
            e.preventDefault(); e.stopPropagation();   // sobrepõe o clique geral do cartão
            salvaFoco(r, focoImgsGrupo(l.imagens), l.texto);
            location.href = a.href;
          };
          g.addEventListener('click', irAoGrupo);
          g.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') irAoGrupo(e); });
          grupos.appendChild(g);
        });
        a.appendChild(grupos);
      } else {
        if (legendas.length === 1) a.appendChild(legendaEl(legendas[0].texto));
        if (p.imagens) { const t = tiras(p.imagens, false); if (t) a.appendChild(t); }
      }
      if (p.imagens) {
        const met = el('div', 'hist-meta');
        met.appendChild(el('span', 'hist-meta-item', plural(p.imagens.total, 'imagem')));
        if (p.imagens.pesoTotal) met.appendChild(el('span', 'hist-meta-item', p.imagens.pesoTotal));
        if (p.removidas) met.appendChild(el('span', 'hist-meta-item', p.removidas + ' substituída(s)'));
        a.appendChild(met);
      }

    // ── DEMAIS (título, subtítulo, nome/seção do slide, funções): de/para ou resumo ──
    } else {
      if (temDelta) a.appendChild(montarDelta());
      else if (p.resumo) a.appendChild(el('p', 'hist-resumo', p.resumo));
    }

    // ── DOCUMENTOS: extensão, versão, páginas, tamanho ──
    if (p.documento) {
      const d = p.documento;
      const met = el('div', 'hist-meta');
      met.appendChild(el('span', 'hist-meta-item hist-meta-ext', 'PDF'));
      if (d.versao) met.appendChild(el('span', 'hist-meta-item', 'versão ' + d.versao));
      if (d.paginas) met.appendChild(el('span', 'hist-meta-item', d.paginas + (d.paginas === '1' ? ' página' : ' páginas')));
      if (d.tamanho) met.appendChild(el('span', 'hist-meta-item', d.tamanho));
      a.appendChild(met);
    }

    // ── DEFASADO: esta alteração já foi superada por outra mais recente do mesmo elemento. O aviso
    //    é clicável e leva ao registro vigente (realçando-o), cujo commit é indicado. ──
    if (p.obsoleto) {
      const av = el('div', 'hist-obsoleto');
      av.tabIndex = 0;
      av.setAttribute('role', 'link');
      av.title = 'Ir para a versão atual (' + p.obsoleto.commit + ')';
      av.appendChild(el('span', 'hist-obsoleto-tag', 'obsoleto'));
      av.appendChild(el('span', 'hist-obsoleto-txt', 'versão atual em ' + p.obsoleto.commit));
      const ir = e => { e.preventDefault(); e.stopPropagation(); irParaRegistro(p.obsoleto.id); };
      av.addEventListener('click', ir);
      av.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') ir(e); });
      a.appendChild(av);
    }

    // ── VIGENTE: esta versão lista, como um histórico, os registros que tornou obsoletos (com data,
    //    commit e o valor de cada um). Cada item é clicável e leva ao registro correspondente. ──
    if (p.substitui && p.substitui.length) {
      const box = el('div', 'hist-hist is-collapsed');   // colapsado por padrão (economiza espaço)
      const cab = el('div', 'hist-hist-toggle');
      cab.tabIndex = 0;
      cab.setAttribute('role', 'button');
      cab.setAttribute('aria-expanded', 'false');
      cab.appendChild(el('span', 'hist-hist-caret', '▾'));
      const lbl = el('span', 'hist-hist-label', 'expandir histórico');
      cab.appendChild(lbl);
      const lst = el('div', 'hist-hist-list');
      p.substitui.forEach(s => {
        const it = el('div', 'hist-hist-item');
        it.tabIndex = 0;
        it.setAttribute('role', 'link');
        it.title = 'Ir para este registro (' + s.commit + ')';
        it.appendChild(el('span', 'hist-hist-data', s.data));
        it.appendChild(el('span', 'hist-hist-commit', s.commit));
        if (s.para != null) it.appendChild(el('span', 'hist-hist-valor', s.para));
        const ir = e => { e.preventDefault(); e.stopPropagation(); irParaRegistro(s.id); };
        it.addEventListener('click', ir);
        it.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') ir(e); });
        lst.appendChild(it);
      });
      const alterna = e => {
        e.preventDefault(); e.stopPropagation();
        const col = box.classList.toggle('is-collapsed');
        cab.setAttribute('aria-expanded', String(!col));
        lbl.textContent = col ? 'expandir histórico' : 'colapsar histórico';
      };
      cab.addEventListener('click', alterna);
      cab.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') alterna(e); });
      box.appendChild(cab);
      box.appendChild(lst);
      a.appendChild(box);
    }
  }

  // ── um registro (pode reunir várias alterações do mesmo elemento, feitas no mesmo commit) ──
  function cartao(r) {
    const a = el('a', 'hist-card hist-card--' + slug(r.acao));
    a.href = base + (r.link || 'slides/index.html');
    a.dataset.acao = r.acao;
    a.dataset.tipo = r.tipo;
    if (r.id) a.dataset.id = r.id;

    // clique no cartão INTEIRO: localiza todas as imagens do registro (foco geral). Se o slide-alvo
    // não existe mais (alvoAusente), o link já aponta para o índice — não faz sentido tentar localizar.
    const textoGeral = (r.tipo === 'título' ? (r.partes ? r.partes[0].para : r.para) : (r.breadcrumb || []).slice(-1)[0]) || null;
    a.addEventListener('click', () => { if (!r.alvoAusente) salvaFoco(r, focoImgs(r), textoGeral); });

    const topo = el('div', 'hist-card-top');
    topo.appendChild(badgeAcao(r.acao));
    topo.appendChild(el('span', 'hist-type', r.tipo));
    a.appendChild(topo);

    // canto superior direito: aviso "slide indisponível" (se o slide-alvo sumiu) + o código do commit.
    // No desktop fica fixo à direita, ao lado do commit; no mobile FLUI abaixo do topo (evita sobrepor
    // o tipo em telas estreitas).
    const canto = el('div', 'hist-topinfo' + (r.alvoAusente ? ' hist-topinfo--ausente' : ''));
    if (r.alvoAusente) {
      const av = el('span', 'hist-ausente', 'slide indisponível');
      av.title = 'O slide original foi removido — o link abre o índice.';
      canto.appendChild(av);
    }
    canto.appendChild(el('span', 'hist-commit', r.commit));
    a.appendChild(canto);

    // sem título quando ele só repetiria o que já está à vista:
    //  • transferência (r.titulo já vem nulo);
    //  • modificação de título (o próprio "para" do de→para já é o novo título) ou só de observação;
    //  • adição de subtítulo e/ou imagens (o título repete a atividade/slide, já no breadcrumb).
    const t = tiposDe(r);
    const semTitulo =
      (r.acao === 'modificação' && (t.includes('título') || (t.length === 1 && t[0] === 'observação'))) ||
      (r.acao === 'adição' && (t.includes('subtítulo') || t.includes('imagens')));
    if (r.titulo && !semTitulo) a.appendChild(el('h3', 'hist-card-title', r.titulo));

    // a transferência não mostra breadcrumb: origem e destino já vêm por extenso em "de" e "para".
    // (o dado permanece no registro — é o que agrupa a transferência por seção/slide nas outras vistas.)
    // breadcrumb horizontal (com a label do papel em cada segmento); a transferência não usa breadcrumb
    // — origem/destino já vêm por extenso, empilhados, em "de"/"para".
    if (r.breadcrumb && r.breadcrumb.length && r.acao !== 'transferência') {
      const bc = el('div', 'hist-crumbs');
      r.breadcrumb.forEach((p, i) => {
        if (i) bc.appendChild(el('span', 'hist-crumb-sep', '›'));
        const seg = el('span', 'hist-crumb');
        seg.appendChild(el('span', 'hist-crumb-tag', papelCrumb(r, i)));   // pequena label do papel
        seg.appendChild(document.createTextNode(p));
        bc.appendChild(seg);
      });
      a.appendChild(bc);
    }

    // uma parte (registro simples) ou várias (consolidado). Quando o registro reúne DUAS OU MAIS
    // alterações com corpo, cada uma vira um bloco ROTULADO com o seu elemento (ex.: distinguir
    // "nome do slide" de "título", que de outra forma pareceriam duplicados) — à mesma distância
    // que separa os subcontainers "de" e "para". Uma parte só, ou registro simples, vai sem rótulo.
    const partes = partesDe(r);
    if (partes.length > 1) {
      const ehDelta = p => p.de != null && p.para != null && p.de !== p.para;
      // rotula cada alteração com o seu elemento SÓ quando há 2+ TIPOS de delta distintos (ex.: "nome
      // do slide" vs "título", que de outra forma pareceriam duplicados). Casos visualmente distintos
      // (imagens + observação) seguem sem rótulo, só espaçados pela distância do vão entre "de"/"para".
      const rotular = new Set(partes.filter(ehDelta).map(p => p.tipo)).size > 1;
      partes.forEach(p => {
        if (rotular && ehDelta(p)) {
          const w = el('div', 'hist-parte');
          corpoParte(w, r, p);
          if (w.childElementCount) { w.insertBefore(el('span', 'hist-parte-tipo', p.tipo), w.firstChild); a.appendChild(w); }
        } else {
          corpoParte(a, r, p);
        }
      });
    } else {
      corpoParte(a, r, partes[0]);
    }

    if (r.curadoria) a.appendChild(el('p', 'hist-nota', r.curadoria));
    return a;
  }

  // hora "17:42" → "17h42" (formato pedido)
  const horaBR = h => (h || '').replace(':', 'h');
  // "15-07-26" → "15/07": no agrupamento por slide os registros abrangem vários dias, então o
  // marcador exibe a DATA (o que varia ali) em vez do horário (o que varia dentro de um mesmo dia)
  const diaCurto = d => { const p = parse(d); return p ? String(p.dia).padStart(2, '0') + '/' + String(p.mes + 1).padStart(2, '0') : (d || ''); };

  // atualiza o MARCADOR sticky: texto (horário ou data, já formatado) + cor do ponto pela ação corrente
  function setMark(mark, texto, acao) {
    const t = mark.querySelector('.hist-mark-time');
    const d = mark.querySelector('.hist-dot');
    if (t.textContent !== texto) t.textContent = texto;
    const cls = 'hist-dot hist-dot--' + slug(acao || 'misto');
    if (d.className !== cls) d.className = cls;
  }

  // ── um dia (colapsável): linha do tempo com MARCADOR STICKY ──
  // Em vez de repetir horário+ponto em cada registro, um único marcador desliza pela linha do
  // tempo (sticky) e, conforme o registro sob ele, atualiza o horário (00h00) e a COR do ponto
  // pela ação — verde/amarelo/vermelho. O cabeçalho (a data) também gruda no topo. Como as datas
  // e horários variam, cada dia tem a sua própria linha do tempo e o seu próprio marcador.
  // `titulo` é a data (por tempo/ação/seção→dia) ou o nome do slide (por seção→slide). Quando
  // `porSlide`, o marcador da linha do tempo exibe a DATA de cada registro em vez do horário.
  function bloco(titulo, registros, porSlide) {
    const marcaDe = r => porSlide ? diaCurto(r.data) : horaBR(r.hora);
    const sec = el('section', 'hist-day' + (porSlide ? ' hist-day--slide' : ''));
    const cab = el('button', 'hist-day-head');
    cab.type = 'button';
    cab.setAttribute('aria-expanded', 'true');
    cab.appendChild(el('span', 'hist-day-caret', '▾'));
    cab.appendChild(el('span', 'hist-day-date', titulo));
    cab.appendChild(el('span', 'hist-day-count', plural(registros.length, 'alteração')));

    const tl = el('div', 'hist-day-items hist-tl');
    const rail = el('div', 'hist-tl-rail');
    const mark = el('div', 'hist-mark');
    mark.appendChild(el('span', 'hist-mark-time'));
    mark.appendChild(el('span', 'hist-dot'));
    rail.appendChild(mark);
    const corpo = el('div', 'hist-tl-body');
    registros.forEach(r => { const c = cartao(r); c.dataset.hora = r.hora || ''; c.dataset.marca = marcaDe(r); corpo.appendChild(c); });
    tl.appendChild(rail);
    tl.appendChild(corpo);
    if (registros[0]) setMark(mark, marcaDe(registros[0]), registros[0].acao);

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
      setMark(mark, cards[at].dataset.marca, cards[at].dataset.acao);
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
    document.querySelectorAll('.hist-month:not(.hist-month--acao):not(.hist-month--secao)').forEach(mes => {
      const cur = mes.querySelector('.hist-month-cur');
      if (!cur) return;
      // a faixa zebrada ALTERNA para a versão gradiente (.is-merged) no MESMO instante da absorção
      // da data — quando o subtítulo some sob o título; em repouso fica sólida no lugar de sempre
      const band = mes.parentElement && mes.parentElement.querySelector('.hist-gap');
      const r = mes.getBoundingClientRect();
      if (r.bottom <= 0 || r.top >= window.innerHeight) {
        // fora da tela: some direto (invisível, sem fade), e cancela qualquer limpeza pendente
        cur.classList.remove('is-shown');
        if (band) band.classList.remove('is-merged');
        if (cur._fadeT) { clearTimeout(cur._fadeT); cur._fadeT = 0; }
        if (cur.textContent) cur.textContent = '';
        return;
      }
      // a área rolável é irmã do título dentro do cartão
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
        if (cur._fadeT) { clearTimeout(cur._fadeT); cur._fadeT = 0; }   // cancela um fade-out em curso
        cur.classList.add('is-shown');   // ganha opacidade suavemente (fade-in via CSS)
        if (band) band.classList.add('is-merged');   // faixa ALTERNA para o gradiente que revela a lista
      } else {
        if (band) band.classList.remove('is-merged');   // volta a ser a faixa sólida
        if (cur.classList.contains('is-shown')) {
          // some por ESMAECIMENTO: perde a opacidade (transição) e só limpa o texto DEPOIS do fade,
          // para a largura não colapsar antes de ele terminar de esmaecer
          cur.classList.remove('is-shown');
          if (cur._fadeT) clearTimeout(cur._fadeT);
          cur._fadeT = setTimeout(() => { if (!cur.classList.contains('is-shown')) cur.textContent = ''; cur._fadeT = 0; }, 420);
        }
      }
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

  // ── agrupamento POR SEÇÃO (experimental) ──
  // Reúne as alterações pela seção a que pertencem, aproximando o que é estruturalmente semelhante.
  // A seção vem do 1º item do breadcrumb; o CÓDIGO (ST/SE/LT/LD) unifica as variações do mesmo nome
  // que surgiram ao longo dos commits ("Segurança do Trabalho" vs "Seg. do Trabalho"), e o dobra()
  // unifica as que só diferem em acento/caixa ("Documentos recebidos" vs "Documentos Recebidos").
  // Registros sem seção (breadcrumb "—") caem num grupo "Sem seção", sempre por último.
  function secaoDe(r) {
    const bruto = ((r.breadcrumb && r.breadcrumb[0]) || '').replace(/\s+/g, ' ').trim();
    if (!bruto || /^[—–-]$/.test(bruto)) return { chave: '__sem_secao__', rotulo: 'Sem seção' };
    const m = /^([A-Za-z]{2})\s*[—–-]/.exec(bruto);
    return m ? { chave: m[1].toUpperCase(), rotulo: bruto } : { chave: dobra(bruto), rotulo: bruto };
  }

  function agrupaPorSecao(regs) {
    const mapa = new Map();   // chave → { itens, rotulos: Map<rótulo, contagem> }
    regs.forEach(r => {
      const { chave, rotulo } = secaoDe(r);
      if (!mapa.has(chave)) mapa.set(chave, { itens: [], rotulos: new Map() });
      const g = mapa.get(chave);
      g.itens.push(r);
      g.rotulos.set(rotulo, (g.rotulos.get(rotulo) || 0) + 1);
    });
    // rótulo canônico = a variante mais usada (empate → a mais longa, que é a mais descritiva)
    const grupos = [...mapa.entries()].map(([chave, g]) => ({
      chave,
      rotulo: [...g.rotulos.entries()].sort((a, b) => b[1] - a[1] || b[0].length - a[0].length)[0][0],
      itens: g.itens,
    }));
    // "Sem seção" (sentinela) por último; as demais pela quantidade de alterações (desc)
    return grupos.sort((a, b) => (a.chave === '__sem_secao__') - (b.chave === '__sem_secao__') || b.itens.length - a.itens.length);
  }

  // ── dentro de uma seção, agrupamento POR SLIDE (experimental) ──
  // mapa GLOBAL link → nome mais recente e legível do slide: alimenta o rótulo dos slides que, num
  // dado momento, ainda estavam sem seção (breadcrumb "—"/arquivo) mas já ganharam nome depois.
  let _nomes = null;
  function nomeDoLink(link) {
    if (!_nomes) {
      _nomes = new Map();   // registros já vêm do mais novo p/ o mais antigo → o 1º visto é o atual
      (dados.registros || []).forEach(r => {
        const nome = (r.breadcrumb || [])[1];
        if (r.link && nome && !/^slide-|\.html$/.test(nome) && !_nomes.has(r.link)) _nomes.set(r.link, nome);
      });
    }
    return _nomes.get(link) || null;
  }
  // "slides/slide-ac-repair.html" → "Ac repair" (só quando não há nome legível algum)
  const prettify = link => {
    const f = (link.split('/').pop() || '').replace(/\.html$/, '').replace(/^slide-/, '').replace(/-/g, ' ').trim();
    return f ? f.charAt(0).toUpperCase() + f.slice(1) : link;
  };

  // a UNIDADE de um registro dentro da seção: o slide (pelo link, que mantém o histórico junto mesmo
  // após renomeações) ou, no índice, cada DOCUMENTO (pelo nome). Registros de nível de seção (sem
  // slide) caem num grupo "Mudanças de seção".
  function slideDe(r) {
    const link = r.link || '(sem link)';
    const nome = (r.breadcrumb || [])[1];
    const nomeLegivel = nome && !/^slide-|\.html$/.test(nome) ? nome : null;
    if (/(^|\/)index\.html$/.test(link)) {
      return nomeLegivel ? { chave: 'doc::' + dobra(nomeLegivel), rotulo: nomeLegivel } : { chave: 'sec::', rotulo: 'Mudanças de seção' };
    }
    return { chave: link, rotulo: nomeLegivel || nomeDoLink(link) || prettify(link) };
  }

  function agrupaPorSlide(regs) {
    const mapa = new Map();   // chave → { chave, rotulo, itens }
    regs.forEach(r => {
      const { chave, rotulo } = slideDe(r);
      if (!mapa.has(chave)) mapa.set(chave, { chave, rotulo, itens: [] });   // 1ª ocorrência (mais recente) fixa o rótulo
      mapa.get(chave).itens.push(r);
    });
    // por quantidade de alterações (desc); "Mudanças de seção" sempre por último
    return [...mapa.values()].sort((a, b) => (a.chave === 'sec::') - (b.chave === 'sec::') || b.itens.length - a.itens.length);
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
    daAba.forEach(r => tiposDe(r).forEach(t => (cont[t] = (cont[t] || 0) + 1)));
    const tipoOpts = Object.keys(cont).sort((a, b) => cont[b] - cont[a]).map(t => ({ valor: t, rotulo: cap(t), n: cont[t] }));
    montaGrupo(barraTipo, 'Elemento', tipoOpts, filtrosTipo, alternaTipo);
  }

  // contagens FACETADAS: cada opção mostra quantos registros restariam se ela fosse a única marcada
  // na sua categoria, respeitando o filtro da OUTRA categoria e a busca. Opção sem resultado fica
  // desabilitada (nada a exibir). Os filtros da MESMA categoria não influenciam as próprias
  // contagens — só as da outra categoria (Ação↔Elemento).
  function atualizaContagens(daAba) {
    const casaBusca = r => !termo || textoDe(r).includes(termo);
    const conta = (container, valoresDe, outroOk) => {
      if (!container) return;
      container.querySelectorAll('.hist-check').forEach(lab => {
        const inp = lab.querySelector('input');
        const n = daAba.filter(r => valoresDe(r).includes(inp.value) && outroOk(r) && casaBusca(r)).length;
        const nEl = lab.querySelector('.hist-check-n');
        if (nEl) nEl.textContent = n;
        lab.classList.toggle('is-empty', n === 0);
        inp.disabled = n === 0 && !inp.checked;
      });
    };
    conta(barraAcao, r => [r.acao], r => filtrosTipo.size === 0 || tiposDe(r).some(t => filtrosTipo.has(t)));
    conta(barraTipo, r => tiposDe(r), r => filtrosAcao.size === 0 || filtrosAcao.has(r.acao));
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
    if (expNote) expNote.hidden = agrupamento !== 'secao';   // o aviso só acompanha a exibição experimental

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
      (filtrosTipo.size === 0 || tiposDe(r).some(t => filtrosTipo.has(t))) &&
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

    if (agrupamento === 'tempo') {
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
    } else if (agrupamento === 'secao') {
      // mesma estrutura de container do modo "por tempo", mas o cabeçalho fixo é a SEÇÃO e, dentro
      // dela, os registros são agrupados POR SLIDE (mais alterado primeiro); cada slide preserva a
      // sua linha do tempo, agora marcada pela data — já que as alterações abrangem vários dias.
      agrupaPorSecao(regs).forEach(({ rotulo, itens }) => {
        const caixa = el('div', 'hist-monthbox');
        const h = el('h2', 'hist-month hist-month--secao');
        h.appendChild(el('span', 'hist-month-label', rotulo));
        h.appendChild(el('span', 'hist-month-count', plural(itens.length, 'alteração')));
        caixa.appendChild(h);
        caixa.appendChild(el('div', 'hist-gap'));   // faixa zebrada suave logo abaixo do título da seção
        const rolagem = el('div', 'hist-monthscroll');
        rolagem.addEventListener('scroll', agendaMarcas, { passive: true });
        agrupaPorSlide(itens).forEach(({ rotulo: nome, itens: ds }) => rolagem.appendChild(bloco(nome, ds, true)));
        caixa.appendChild(rolagem);
        lista.appendChild(caixa);
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
