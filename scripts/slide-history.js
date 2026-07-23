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
  let agrupar = true;    // AGRUPAMENTO: empilha registros semelhantes (mesma ação+tipo). Ligado por padrão.
  let detalhe = 'maximo';   // DETALHAMENTO: 'maximo' (cartão inteiro) | 'minimo' (uma linha por registro).
                            // ESTADO persistente: sobrevive a mudanças de aba/ordenação/agrupamento (o render o respeita).
  // seletor dos cartões de um dia, INCLUINDO os que estão dentro de um grupo empilhado (agrupamento) —
  // o marcador da timeline precisa achá-los mesmo aninhados num .hist-group.
  const CARTAO_SEL = '.hist-tl-body > .hist-card, .hist-tl-body > .hist-group > .hist-card';
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

  // papel de cada segmento do breadcrumb — vira uma pequena label. A estrutura é seção › slide ›
  // atividade e, nas SUB-PÁGINAS, seção › slide-mãe › sub-página › atividade. Ciente do tamanho `n`:
  // o 1º é a seção, o 2º o slide (ou documento), o ÚLTIMO a atividade e os do meio, a sub-página.
  const papelCrumb = (r, i, n) => i === 0 ? 'seção'
    : i === 1 ? (tiposDe(r).includes('documento') ? 'documento' : 'slide')
      : i === n - 1 ? 'subtítulo'
        : 'sub-página';

  // resolve segmentos "crus" do breadcrumb para nomes legíveis. O histórico guarda o estado de CADA
  // commit; num commit antigo o slide ainda não tinha seção nem nome próprio, então o diff caiu no
  // nome do ARQUIVO (…​.html) e na seção "—". Aqui trocamos esses segmentos pelo valor mais recente e
  // legível do MESMO link, deixando o caminho todo em nomes (seção › slide › atividade), não em paths.
  function breadcrumbLegivel(r) {
    const link = r.link || '';
    return (r.breadcrumb || []).map((seg, i) => {
      const s = (seg == null ? '' : String(seg)).trim();
      if (i === 0 && /^[—–-]$/.test(s)) return secaoDoLink(link) || seg;
      if (/^slide-|\.html$/.test(s)) return nomeDoLink(link) || prettify(link);
      return seg;
    });
  }

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
    const alvo = lista.querySelector('[data-id="' + (window.CSS && CSS.escape ? CSS.escape(id) : id) + '"]');
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

  // barra de TÍTULO do conteúdo DEFASADO, no topo do registro isolado: à esquerda o ícone de
  // obsolescência + "conteúdo obsoleto" (zebrado vermelho, via CSS); à direita um botão que salta ao
  // registro VIGENTE (realçando-o). Não é um <button>/<a> real — o cartão já é um <a> — mas role="button".
  function cabecaObsoleto(obs) {
    const head = el('div', 'hist-obsoleto-head');
    const titulo = el('span', 'hist-obsoleto-head-title');
    const ico = el('span', 'hist-obsoleto-icon');
    ico.setAttribute('aria-hidden', 'true');
    ico.innerHTML = '<svg viewBox="0 0 24 24" width="1em" height="1em" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><polyline points="12 7.5 12 12 15.5 14"/></svg>';
    titulo.appendChild(ico);
    titulo.appendChild(el('span', 'hist-obsoleto-head-txt', 'obsoleto'));
    head.appendChild(titulo);

    const irBtn = el('span', 'hist-obsoleto-goto');
    irBtn.tabIndex = 0;
    irBtn.setAttribute('role', 'button');
    irBtn.title = 'Ir para a versão atual (' + obs.commit + ')';
    irBtn.appendChild(el('span', 'hist-obsoleto-goto-txt', 'versão atual em ' + obs.commit));
    const seta = el('span', 'hist-obsoleto-goto-icon');
    seta.setAttribute('aria-hidden', 'true');
    seta.innerHTML = '<svg viewBox="0 0 24 24" width="1em" height="1em" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="5" y1="12" x2="19" y2="12"/><polyline points="12 5 19 12 12 19"/></svg>';
    irBtn.appendChild(seta);
    const ir = e => { e.preventDefault(); e.stopPropagation(); irParaRegistro(obs.id); };
    irBtn.addEventListener('click', ir);
    irBtn.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') ir(e); });
    head.appendChild(irBtn);
    return head;
  }

  // barra de TÍTULO "slide indisponível", no topo do conteúdo do registro cujo slide-alvo foi removido —
  // MESMO padrão do obsoleto (barra + corpo), porém VERMELHA. Não há botão à direita: não existe destino
  // para onde ir (o slide não existe mais), então o registro é apenas informativo (inerte).
  function cabecaIndisponivel() {
    const head = el('div', 'hist-obsoleto-head');
    head.title = 'O slide original foi removido — este registro é apenas informativo.';
    const titulo = el('span', 'hist-obsoleto-head-title');
    const ico = el('span', 'hist-obsoleto-icon');
    ico.setAttribute('aria-hidden', 'true');
    ico.innerHTML = '<svg viewBox="0 0 24 24" width="1em" height="1em" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m18.84 12.25 1.72-1.71a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="m5.17 11.75-1.71 1.71a5 5 0 0 0 7.07 7.07l1.71-1.71"/><line x1="8" y1="2" x2="8" y2="5"/><line x1="2" y1="8" x2="5" y2="8"/><line x1="16" y1="19" x2="16" y2="22"/><line x1="19" y1="16" x2="22" y2="16"/></svg>';
    titulo.appendChild(ico);
    titulo.appendChild(el('span', 'hist-obsoleto-head-txt', 'slide indisponível'));
    head.appendChild(titulo);
    return head;
  }

  // ── corpo de UMA parte (tipo + conteúdo). `a` é o CONTAINER onde o corpo entra (pode ser o cartão, um
  //    bloco de parte ou a faixa 'obsoleto'); `cardHref` é o href do CARTÃO, usado para navegar (o container
  //    pode ser um <div> sem href próprio). ──
  function corpoParte(a, r, p, cardHref) {
    const temDelta = p.de != null && p.para != null && p.de !== p.para;
    // um elemento DEFASADO é ISOLADO numa faixa própria (que recebe o zebrado); as demais
    // partes seguem direto no cartão
    const faixa = p.obsoleto ? el("div", "hist-obsoleto-body") : a;
    // a transferência usa um delta próprio (empilhado, com ícone de movimentação); os demais, o padrão
    const montarDelta = () => r.acao === 'transferência' ? deltaTransfer(p.de, p.para) : delta(p.de, p.para);

    // ── OBSERVAÇÃO: a legenda VINCULADA à(s) imagem(ns) que a receberam (sem envelope) ──
    if (p.tipo === 'observação') {
      // a legenda (resumo) de uma observação ADICIONADA ou REMOVIDA leva a label "observação" à esquerda
      // (como nas legendas das imagens). A MODIFICAÇÃO isolada (de→para) não leva — o próprio de/para já
      // a identifica e o topo do card diz OBSERVAÇÃO.
      if (temDelta) faixa.appendChild(delta(p.de, p.para));
      else if (p.resumo) faixa.appendChild(comRotulo('observação', el('span', 'hist-info-text', p.resumo)));
      if (p.imagens) { const t = tiras(p.imagens, true); if (t) faixa.appendChild(t); }

    // ── IMAGENS: legendas por faixa (1-2: X · 3-4: Y) + tira de miniaturas + metadados ──
    } else if (p.tipo === 'imagens') {
      const legendas = p.legendas || [];
      // a legenda ganha a label "observação" quando imagem e observação vêm JUNTAS: na adição de
      // imagens (imagem + legenda) ou num registro que UNE 'imagens' e 'observação' (ex.: 3c6891a).
      const uniaoImgObs = tiposDe(r).includes('imagens') && tiposDe(r).includes('observação');
      const legendaEl = texto => (r.acao === 'adição' || uniaoImgObs)
        ? comRotulo('observação', el('span', 'hist-info-text', texto))
        : el('p', 'hist-info-text', texto);
      if (temDelta) faixa.appendChild(montarDelta());   // transferência de imagens: origem → destino
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
            if (cardHref) location.href = cardHref;
          };
          g.addEventListener('click', irAoGrupo);
          g.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') irAoGrupo(e); });
          grupos.appendChild(g);
        });
        faixa.appendChild(grupos);
      } else {
        if (legendas.length === 1) faixa.appendChild(legendaEl(legendas[0].texto));
        if (p.imagens) { const t = tiras(p.imagens, false); if (t) faixa.appendChild(t); }
      }
      if (p.imagens) {
        const met = el('div', 'hist-meta');
        met.appendChild(el('span', 'hist-meta-item', plural(p.imagens.total, 'imagem')));
        if (p.imagens.pesoTotal) met.appendChild(el('span', 'hist-meta-item', p.imagens.pesoTotal));
        if (p.removidas) {
          // imagens TROCADAS por outras de mesmo nome (o diff as vê como "modificadas"). Singular/plural
          // certo e um tooltip explicando por que uma substituição acontece.
          const sub = el('span', 'hist-meta-item hist-meta-sub', p.removidas + (p.removidas === 1 ? ' substituída' : ' substituídas'));
          sub.title = 'A substituição pode ocorrer para atualizar quantitativos, obter uma melhor qualidade ou simplesmente corrigir erros ortográficos.';
          met.appendChild(sub);
        }
        faixa.appendChild(met);
      }

    // ── DEMAIS (título, subtítulo, nome/seção do slide, funções): de/para ou resumo ──
    } else {
      if (temDelta) faixa.appendChild(montarDelta());
      else if (p.resumo) faixa.appendChild(el('p', 'hist-resumo', p.resumo));
    }

    // ── DOCUMENTOS: extensão, versão, páginas, tamanho ──
    if (p.documento) {
      const d = p.documento;
      const met = el('div', 'hist-meta');
      // badge da extensão: com slide associado, vira o mesmo ATALHO da listagem de documentos (o "ir ↗"
      // sobreposto ao badge) — em repouso mostra "PDF"; ao pairar/focar troca por "↗" e leva ao slide.
      const ext = el('span', 'hist-meta-item hist-meta-ext' + (d.slide ? ' hist-meta-ext--goto' : ''));
      if (d.slide) {
        ext.tabIndex = 0;
        ext.setAttribute('role', 'link');
        ext.title = 'Ir para o slide relacionado';
        ext.appendChild(el('span', 'hist-ext-label', 'PDF'));
        const ir = e => { e.preventDefault(); e.stopPropagation(); location.href = base + d.slide; };
        ext.addEventListener('click', ir);
        ext.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') ir(e); });
      } else {
        ext.textContent = 'PDF';
      }
      met.appendChild(ext);
      if (d.versao) met.appendChild(el('span', 'hist-meta-item', 'versão ' + d.versao));
      if (d.paginas) met.appendChild(el('span', 'hist-meta-item', d.paginas + (d.paginas === '1' ? ' página' : ' páginas')));
      if (d.tamanho) met.appendChild(el('span', 'hist-meta-item', d.tamanho));
      faixa.appendChild(met);
    }

    // ── DEFASADO: esta alteração já foi superada por outra mais recente do mesmo elemento. O aviso
    //    virou a BARRA DE TÍTULO "conteúdo obsoleto" no topo do registro isolado (cabecaObsoleto),
    //    prependida à faixa logo abaixo — quando p.obsoleto. ──

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
      // um item da lista: "DD-MM-AA às HHhMM · COMMIT · valor". O separador "·" fica entre a data(+hora),
      // o commit e a informação alterada. `atual` marca o registro VIGENTE (topo da lista).
      const itemHist = info => {
        const it = el('div', 'hist-hist-item' + (info.atual ? ' is-current' : ''));
        it.tabIndex = 0;
        it.setAttribute('role', 'link');
        it.title = info.atual ? 'Registro atual (' + info.commit + ')' : 'Ir para este registro (' + info.commit + ')';
        it.appendChild(el('span', 'hist-hist-data', info.data + (info.hora ? ' às ' + horaBR(info.hora) : '')));
        it.appendChild(el('span', 'hist-hist-sep', '·'));
        it.appendChild(el('span', 'hist-hist-commit', info.commit));
        if (info.valor != null) {
          it.appendChild(el('span', 'hist-hist-sep', '·'));
          it.appendChild(el('span', 'hist-hist-valor', info.valor));
        }
        if (info.atual) it.appendChild(el('span', 'hist-hist-atual', 'atual'));
        const ir = e => { e.preventDefault(); e.stopPropagation(); irParaRegistro(info.id); };
        it.addEventListener('click', ir);
        it.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') ir(e); });
        return it;
      };
      // o registro VIGENTE encabeça a lista; abaixo dele, os que ele tornou obsoletos (mais recente → antigo)
      lst.appendChild(itemHist({ data: r.data, hora: r.hora, commit: r.commit, valor: p.para, id: r.id, atual: true }));
      p.substitui.forEach(s => lst.appendChild(itemHist({ data: s.data, hora: s.hora, commit: s.commit, valor: s.para, id: s.id })));
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
      faixa.appendChild(box);
    }
    if (faixa !== a) {
      // registro DEFASADO: barra de título vermelha no TOPO + o corpo cinza zebrado (faixa) abaixo
      const band = el('div', 'hist-obsoleto-band');
      band.appendChild(cabecaObsoleto(p.obsoleto));
      band.appendChild(faixa);
      a.appendChild(band);
    }
  }

  // ── um registro (pode reunir várias alterações do mesmo elemento, feitas no mesmo commit) ──
  function cartao(r) {
    const a = el('a', 'hist-card hist-card--' + slug(r.acao) + (r.alvoAusente ? ' hist-card--inerte' : ''));
    a.dataset.acao = r.acao;
    a.dataset.tipo = r.tipo;
    if (r.id) a.dataset.id = r.id;

    // clique no cartão INTEIRO: localiza todas as imagens do registro (foco geral). Se o slide-alvo não
    // existe mais (alvoAusente), o registro fica INERTE — sem href e sem clique —, pois levar a qualquer
    // destino sugeriria falsamente que a alteração ocorreu lá.
    const textoGeral = (r.tipo === 'título' ? (r.partes ? r.partes[0].para : r.para) : (r.breadcrumb || []).slice(-1)[0]) || null;
    if (!r.alvoAusente) {
      a.href = base + (r.link || 'slides/index.html');
      a.addEventListener('click', () => salvaFoco(r, focoImgs(r), textoGeral));
    }

    const topo = el('div', 'hist-card-top');
    topo.appendChild(badgeAcao(r.acao));
    topo.appendChild(el('span', 'hist-type', r.tipo));
    a.appendChild(topo);

    // canto superior direito: apenas o código do commit. O aviso "slide indisponível" deixou de ser um
    // marcador de canto e virou a BARRA DE TÍTULO do conteúdo (ver cabecaIndisponivel + a banda abaixo).
    const canto = el('div', 'hist-topinfo');
    canto.appendChild(el('span', 'hist-commit', r.commit));
    a.appendChild(canto);

    // sem título quando ele só repetiria o que já está à vista:
    //  • transferência (r.titulo já vem nulo);
    //  • modificação de título, subtítulo ou NOME DO SLIDE (o "para" do de→para já é o novo valor), só de
    //    observação, ou de IMAGENS (a legenda das imagens já se identifica e o subtítulo já vem no breadcrumb);
    //  • adição de subtítulo, imagens ou SLIDE inteiro (o título repete a atividade/slide, já no breadcrumb);
    //  • deleção de QUALQUER elemento (o de→para/resumo removido + o subtítulo no breadcrumb já dizem o quê e onde).
    const t = tiposDe(r);
    const semTitulo =
      t.includes('detalhe') ||   // post-scriptum: o resumo/de→para + o subtítulo no breadcrumb já bastam
      r.acao === 'deleção' ||    // deleção de qualquer elemento: o título só repetiria o já mostrado
      (r.acao === 'modificação' && (t.includes('título') || t.includes('subtítulo') || t.includes('nome do slide') || (t.length === 1 && t[0] === 'observação') || t.includes('imagens'))) ||
      (r.acao === 'adição' && (t.includes('subtítulo') || t.includes('imagens') || t.includes('slide')));
    if (r.titulo && !semTitulo) a.appendChild(el('h3', 'hist-card-title', r.titulo));

    // a transferência não mostra breadcrumb: origem e destino já vêm por extenso em "de" e "para".
    // (o dado permanece no registro — é o que agrupa a transferência por seção/slide nas outras vistas.)
    // breadcrumb horizontal (com a label do papel em cada segmento); a transferência não usa breadcrumb
    // — origem/destino já vêm por extenso, empilhados, em "de"/"para".
    if (r.breadcrumb && r.breadcrumb.length && r.acao !== 'transferência') {
      const bc = el('div', 'hist-crumbs');
      const crumbs = breadcrumbLegivel(r);
      crumbs.forEach((p, i) => {
        const seg = el('span', 'hist-crumb');
        if (i) seg.appendChild(el('span', 'hist-crumb-sep', '›'));   // separador DENTRO do segmento: nunca fica órfão numa linha
        seg.appendChild(el('span', 'hist-crumb-tag', papelCrumb(r, i, crumbs.length)));   // pequena label do papel
        seg.appendChild(document.createTextNode(p));
        bc.appendChild(seg);
      });
      a.appendChild(bc);
      a.appendChild(el('div', 'hist-crumb-div'));   // divisor tracejado: respiro entre o caminho e o corpo
    }

    // uma parte (registro simples) ou várias (consolidado). Quando o registro reúne DUAS OU MAIS
    // alterações com corpo, cada uma vira um bloco ROTULADO com o seu elemento (ex.: distinguir
    // "nome do slide" de "título", que de outra forma pareceriam duplicados) — à mesma distância
    // que separa os subcontainers "de" e "para". Uma parte só, ou registro simples, vai sem rótulo.
    // INDISPONÍVEL: o conteúdo (partes) entra numa BANDA — mesmo padrão do 'obsoleto' (barra de título
    // + corpo), porém VERMELHA. Título e breadcrumb ficam FORA dela (a identidade do registro); a banda
    // envolve só o corpo, com a barra "slide indisponível" no topo.
    let alvo = a;
    if (r.alvoAusente) {
      const band = el('div', 'hist-obsoleto-band hist-obsoleto-band--ausente');
      band.appendChild(cabecaIndisponivel());
      alvo = el('div', 'hist-obsoleto-body');
      band.appendChild(alvo);
      a.appendChild(band);
    }
    const partes = partesDe(r);
    if (partes.length > 1) {
      const ehDelta = p => p.de != null && p.para != null && p.de !== p.para;
      // rotula cada alteração com o seu elemento SÓ quando há 2+ TIPOS de delta distintos (ex.: "nome
      // do slide" vs "título", que de outra forma pareceriam duplicados).
      const rotular = new Set(partes.filter(ehDelta).map(p => p.tipo)).size > 1;
      // CADA parte vira um bloco próprio e, quando o registro é navegável, CLICÁVEL individualmente:
      // leva o usuário exatamente àquela alteração no slide (localiza as imagens + o texto DAQUELA parte),
      // em vez de tratar as várias modificações como um bloco único. Um divisor tracejado separa as partes,
      // e o "expandir histórico" de cada parte fica colado a ela (o divisor fica ABAIXO dele).
      const navegavel = !r.alvoAusente;
      partes.forEach(p => {
        const w = el('div', 'hist-parte' + (navegavel ? ' hist-parte--link' : ''));
        corpoParte(w, r, p, a.href);
        if (!w.childElementCount) return;   // parte sem corpo visível: pula
        if (rotular && ehDelta(p)) w.insertBefore(el('span', 'hist-parte-tipo', p.tipo), w.firstChild);
        if (navegavel) {
          w.tabIndex = 0;
          w.setAttribute('role', 'link');
          w.title = 'Localizar esta alteração no slide';
          const irAqui = e => {
            e.preventDefault(); e.stopPropagation();   // sobrepõe o clique geral do cartão
            salvaFoco(r, focoImgsGrupo(p.imagens), p.para != null ? p.para : (p.resumo || textoGeral));
            location.href = a.href;
          };
          w.addEventListener('click', irAqui);
          w.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') irAqui(e); });
        }
        alvo.appendChild(w);
      });
    } else {
      corpoParte(alvo, r, partes[0], a.href);
    }

    if (r.curadoria) alvo.appendChild(el('p', 'hist-nota', r.curadoria));
    return a;
  }

  // hora "17:42" → "17h42" (formato pedido)
  const horaBR = h => (h || '').replace(':', 'h');
  // "15-07-26" → "15/07": no agrupamento por slide os registros abrangem vários dias, então o
  // marcador exibe a DATA (o que varia ali) em vez do horário (o que varia dentro de um mesmo dia)
  const diaCurto = d => { const p = parse(d); return p ? String(p.dia).padStart(2, '0') + '/' + String(p.mes + 1).padStart(2, '0') : (d || ''); };

  // atualiza o MARCADOR sticky: texto (horário ou data, já formatado) + cor do ponto pela ação corrente.
  // `sub` é a 2ª linha opcional (o horário, no agrupamento por seção, sob a data).
  function setMark(mark, texto, acao, sub) {
    const t = mark.querySelector('.hist-mark-time');
    const d = mark.querySelector('.hist-dot');
    if (t.textContent !== texto) t.textContent = texto;
    const s = mark.querySelector('.hist-mark-sub');
    if (s) { const sv = sub || ''; if (s.textContent !== sv) s.textContent = sv; }
    const cls = 'hist-dot hist-dot--' + slug(acao || 'misto');
    if (d.className !== cls) d.className = cls;
  }

  // ── resumo inline de um dia COLAPSADO ──
  // Só é exibido quando o dia está recolhido (via CSS); expandido, dá lugar à linha do tempo. Para cada
  // alteração: a AÇÃO (adição, modificação…), o ELEMENTO que a recebeu (imagens — com a quantidade —,
  // observação, título…) e ONDE foi feita (o último segmento do breadcrumb).
  function montaResumoDia(registros) {
    const wrap = el('div', 'hist-day-summary');
    registros.forEach(r => {
      const item = el('div', 'hist-day-sum');
      item.appendChild(el('span', 'hist-day-sum-acao hist-day-sum-acao--' + slug(r.acao), r.acao));
      const qtd = partesDe(r).reduce((s, p) => s + (p.imagens ? p.imagens.total : 0), 0);
      const elem = tiposDe(r).map(t => (t === 'imagens' && qtd) ? 'imagens (' + qtd + ')' : t).join(', ');
      if (elem) item.appendChild(el('span', 'hist-day-sum-elem', elem));
      const local = (breadcrumbLegivel(r).slice(-1)[0] || '').toString().trim();
      if (local) {
        item.appendChild(el('span', 'hist-day-sum-em', 'em'));
        item.appendChild(el('span', 'hist-day-sum-local', local));
      }
      wrap.appendChild(item);
    });
    return wrap;
  }

  // ── um dia (colapsável): linha do tempo com MARCADOR STICKY ──
  // Em vez de repetir horário+ponto em cada registro, um único marcador desliza pela linha do
  // tempo (sticky) e, conforme o registro sob ele, atualiza o horário (00h00) e a COR do ponto
  // pela ação — verde/amarelo/vermelho. O cabeçalho (a data) também gruda no topo. Como as datas
  // e horários variam, cada dia tem a sua própria linha do tempo e o seu próprio marcador.
  // `titulo` é a data (por tempo/ação/seção→dia) ou o nome do slide (por seção→slide). Quando
  // `porSlide`, o marcador da linha do tempo exibe a DATA de cada registro em vez do horário.

  // AGRUPAMENTO (experimental): empilha 3+ cartões semelhantes (mesma ação+tipo) num "baralho" — cada um
  // cobre a metade de baixo do anterior (só o cabeçalho ação→breadcrumb, até o divisor tracejado, fica à
  // mostra) e o ÚLTIMO aparece INTEIRO como amostra. Um selo mostra a contagem; clicar expande para os
  // cartões individuais e espaçados (como sem o agrupamento). z-index crescente põe cada um sobre o de cima.
  function pilhaSemelhantes(cards) {
    const gid = 'hist-grp-' + (pilhaSemelhantes._n = (pilhaSemelhantes._n || 0) + 1);
    const grupo = el('div', 'hist-group is-stacked');
    grupo.id = gid;
    grupo.setAttribute('role', 'group');
    grupo.setAttribute('aria-label', cards.length + ' registros semelhantes agrupados');
    // empilhado: os cartões saem da tabulação (o SELO é a via de teclado p/ expandir); voltam ao expandir
    cards.forEach((c, k) => { c.style.zIndex = String(k + 1); c.tabIndex = -1; grupo.appendChild(c); });
    const selo = el('button', 'hist-group-badge');
    selo.type = 'button';
    const rotulo = () => cards.length + ' semelhantes';
    selo.setAttribute('aria-controls', gid);
    // nome acessível e aria-expanded do selo acompanham o estado (evita "expandir" enquanto já expandido)
    const marcaSelo = empilhado => {
      selo.textContent = empilhado ? rotulo() : 'recolher';
      selo.setAttribute('aria-expanded', String(!empilhado));
      selo.setAttribute('aria-label', empilhado ? ('Expandir o grupo de ' + cards.length + ' registros semelhantes') : 'Recolher o grupo');
    };
    marcaSelo(true);
    grupo.appendChild(selo);
    const alterna = () => {
      const empilhado = grupo.classList.toggle('is-stacked');
      marcaSelo(empilhado);
      cards.forEach(c => { if (empilhado) c.tabIndex = -1; else c.removeAttribute('tabindex'); });
      requestAnimationFrame(() => { centraTodos(diasVisiveis()); atualizaMarcas(); });
    };
    // EMPILHADO: qualquer clique EXPANDE e NÃO navega (captura, antes do handler do cartão-link).
    // EXPANDIDO: os cartões voltam a navegar; só o selo recolhe.
    grupo.addEventListener('click', e => {
      if (grupo.classList.contains('is-stacked')) { e.preventDefault(); e.stopPropagation(); alterna(); }
      else if (e.target.closest('.hist-group-badge')) { e.preventDefault(); e.stopPropagation(); alterna(); }
    }, true);
    return grupo;
  }

  // ícones de STATUS (mesmos das barras do Máximo): 'obsoleto' = relógio; 'slide indisponível' = vínculo quebrado
  const SVG_OBSOLETO = '<svg viewBox="0 0 24 24" width="1em" height="1em" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><polyline points="12 7.5 12 12 15.5 14"/></svg>';
  const SVG_AUSENTE = '<svg viewBox="0 0 24 24" width="1em" height="1em" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m18.84 12.25 1.72-1.71a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="m5.17 11.75-1.71 1.71a5 5 0 0 0 7.07 7.07l1.71-1.71"/><line x1="8" y1="2" x2="8" y2="5"/><line x1="2" y1="8" x2="5" y2="8"/><line x1="16" y1="19" x2="16" y2="22"/><line x1="19" y1="16" x2="22" y2="16"/></svg>';

  // ── DETALHAMENTO MÍNIMO: um registro por LINHA ──
  // [horário] [ícone da ação] [ação] [elemento (itálico)] "em" [local (itálico)] … [commit à direita].
  // É um <a> — leva ao conteúdo alterado (salvaFoco + realce/aura no destino), como o cartão; fica inerte
  // quando o slide-alvo sumiu. O `local` é o último segmento legível do breadcrumb.
  function linhaCompacta(r, marcaTempo) {
    const inerte = !!r.alvoAusente;
    const row = el(inerte ? 'div' : 'a', 'hist-row hist-row--' + slug(r.acao) + (inerte ? ' hist-row--inerte' : ''));
    row.dataset.acao = r.acao;
    if (r.id) row.dataset.id = r.id;   // permite localizar/realçar esta linha (mesma via do cartão)
    if (!inerte) {
      row.href = base + (r.link || 'slides/index.html');
      const textoGeral = (r.tipo === 'título' ? (r.partes ? r.partes[0].para : r.para) : (r.breadcrumb || []).slice(-1)[0]) || null;
      row.addEventListener('click', () => salvaFoco(r, focoImgs(r), textoGeral));
    }
    row.appendChild(el('span', 'hist-row-time', marcaTempo));
    const ico = iconeAcao(r.acao);
    if (ico) row.appendChild(ico);
    row.appendChild(el('span', 'hist-row-acao', r.acao));
    const qtd = partesDe(r).reduce((s, p) => s + (p.imagens ? p.imagens.total : 0), 0);
    const elem = tiposDe(r).map(t => (t === 'imagens' && qtd) ? 'imagens (' + qtd + ')' : t).join(', ');
    if (elem) row.appendChild(el('span', 'hist-row-elem', elem));
    const local = (breadcrumbLegivel(r).slice(-1)[0] || '').toString().trim();
    if (local) {
      row.appendChild(el('span', 'hist-row-em', 'em'));
      row.appendChild(el('span', 'hist-row-local', local));
    }
    // STATUS (junto ao commit, à direita): 'slide indisponível' (vínculo quebrado) ou 'obsoleto' (relógio) —
    // a MESMA indicação do detalhamento Máximo, para o dado ser consistente sob qualquer filtro.
    const stSvg = r.alvoAusente ? SVG_AUSENTE : (partesDe(r).some(p => p.obsoleto) ? SVG_OBSOLETO : null);
    if (stSvg) {
      const st = el('span', 'hist-row-status hist-row-status--' + (r.alvoAusente ? 'ausente' : 'obsoleto'));
      st.setAttribute('aria-hidden', 'true');
      st.title = r.alvoAusente ? 'Slide indisponível' : 'Registro obsoleto';
      st.innerHTML = stSvg;
      row.appendChild(st);
    }
    row.appendChild(el('span', 'hist-row-commit', r.commit));
    return row;
  }

  // AGRUPAMENTO no MÍNIMO ("mini-cabeçalho"): sequências de 3+ semelhantes (mesma ação+tipo) ficam sob um
  // cabeçalho recolhível com a contagem; as linhas individuais listadas (indentadas) abaixo, expandidas.
  function grupoMinimo(rows, sample) {
    const g = el('div', 'hist-rowgroup');
    const head = el('button', 'hist-rowgroup-head hist-row--' + slug(sample.acao));
    head.type = 'button';
    head.setAttribute('aria-expanded', 'true');
    head.appendChild(el('span', 'hist-rowgroup-caret', '▾'));
    const ico = iconeAcao(sample.acao);
    if (ico) head.appendChild(ico);
    head.appendChild(el('span', 'hist-rowgroup-acao', sample.acao));
    head.appendChild(el('span', 'hist-rowgroup-elem', sample.tipo));
    head.appendChild(el('span', 'hist-rowgroup-count', rows.length + ' registros'));
    const body = el('div', 'hist-rowgroup-body');
    rows.forEach(row => body.appendChild(row));
    head.addEventListener('click', () => {
      const col = g.classList.toggle('is-collapsed');
      head.setAttribute('aria-expanded', String(!col));
    });
    g.appendChild(head);
    g.appendChild(body);
    return g;
  }

  // corpo do dia no MÍNIMO: uma linha por registro; com AGRUPAMENTO, runs de 3+ semelhantes viram grupos.
  function corpoMinimo(registros, porSlide) {
    const body = el('div', 'hist-day-items hist-daymin');
    // por seção os registros abrangem vários dias → a linha traz DATA + horário; senão, só o horário
    const marca = r => porSlide ? (diaCurto(r.data) + ' · ' + horaBR(r.hora)) : horaBR(r.hora);
    const mkRow = r => linhaCompacta(r, marca(r));
    if (!agrupar) {
      registros.forEach(r => body.appendChild(mkRow(r)));
    } else {
      const chave = r => r.acao + '|' + r.tipo;
      const podeAgrupar = r => r.acao !== 'transferência' && r.breadcrumb && r.breadcrumb.length;
      let i = 0;
      while (i < registros.length) {
        if (!podeAgrupar(registros[i])) { body.appendChild(mkRow(registros[i])); i++; continue; }
        let j = i + 1;
        while (j < registros.length && podeAgrupar(registros[j]) && chave(registros[j]) === chave(registros[i])) j++;
        if (j - i >= 3) body.appendChild(grupoMinimo(registros.slice(i, j).map(mkRow), registros[i]));
        else for (let k = i; k < j; k++) body.appendChild(mkRow(registros[k]));
        i = j;
      }
    }
    return body;
  }

  function bloco(titulo, registros, porSlide) {
    const sec = el('section', 'hist-day' + (porSlide ? ' hist-day--slide' : '') + (detalhe === 'minimo' ? ' hist-day--min' : ''));
    const cab = el('button', 'hist-day-head');
    cab.type = 'button';
    cab.setAttribute('aria-expanded', 'true');
    cab.appendChild(el('span', 'hist-day-caret', '▾'));
    cab.appendChild(el('span', 'hist-day-date', titulo));
    cab.appendChild(el('span', 'hist-day-count', plural(registros.length, 'alteração')));

    // MÍNIMO: uma linha por registro (sem linha do tempo/marcador); o cabeçalho do dia só recolhe/expande.
    if (detalhe === 'minimo') {
      cab.addEventListener('click', () => {
        const fechado = sec.classList.toggle('is-collapsed');
        cab.setAttribute('aria-expanded', String(!fechado));
      });
      sec.appendChild(cab);
      sec.appendChild(corpoMinimo(registros, porSlide));
      return sec;
    }

    // MÁXIMO: linha do tempo com marcador sticky + cartões inteiros (agrupáveis em baralho).
    const marcaDe = r => porSlide ? diaCurto(r.data) : horaBR(r.hora);
    // por seção o marcador exibe a DATA (1ª linha, DD/MM); o HORÁRIO (HHhMM) vai numa 2ª linha abaixo
    const marcaSubDe = r => porSlide ? horaBR(r.hora) : '';

    const tl = el('div', 'hist-day-items hist-tl');
    const rail = el('div', 'hist-tl-rail');
    const mark = el('div', 'hist-mark');
    const markTxt = el('div', 'hist-mark-text');
    markTxt.appendChild(el('span', 'hist-mark-time'));
    if (porSlide) markTxt.appendChild(el('span', 'hist-mark-sub'));   // 2ª linha: horário (só por seção)
    mark.appendChild(markTxt);
    mark.appendChild(el('span', 'hist-dot'));
    rail.appendChild(mark);
    const corpo = el('div', 'hist-tl-body');
    const mkCard = r => {
      const c = cartao(r);
      c.dataset.hora = r.hora || '';
      c.dataset.marca = marcaDe(r);
      if (porSlide) c.dataset.marcaSub = marcaSubDe(r);
      return c;
    };
    if (!agrupar) {
      registros.forEach(r => corpo.appendChild(mkCard(r)));
    } else {
      // sequências de 3+ registros CONSECUTIVOS com a mesma (ação, tipo) viram uma pilha "baralho".
      const chave = r => r.acao + '|' + r.tipo;
      const podeAgrupar = r => r.acao !== 'transferência' && r.breadcrumb && r.breadcrumb.length;
      let i = 0;
      while (i < registros.length) {
        if (!podeAgrupar(registros[i])) { corpo.appendChild(mkCard(registros[i])); i++; continue; }
        let j = i + 1;
        while (j < registros.length && podeAgrupar(registros[j]) && chave(registros[j]) === chave(registros[i])) j++;
        if (j - i >= 3) corpo.appendChild(pilhaSemelhantes(registros.slice(i, j).map(mkCard)));
        else for (let k = i; k < j; k++) corpo.appendChild(mkCard(registros[k]));
        i = j;
      }
    }
    tl.appendChild(rail);
    tl.appendChild(corpo);
    if (registros[0]) setMark(mark, marcaDe(registros[0]), registros[0].acao, marcaSubDe(registros[0]));

    // resumo mostrado quando o dia é recolhido (ver montaResumoDia); no estado expandido fica oculto
    const resumo = montaResumoDia(registros);

    cab.addEventListener('click', () => {
      const fechado = sec.classList.toggle('is-collapsed');
      cab.setAttribute('aria-expanded', String(!fechado));
      requestAnimationFrame(() => { atualizaMarcas(); if (!fechado) centraTodos([sec]); });
    });
    sec.appendChild(cab);
    sec.appendChild(resumo);
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
      const card = day.querySelector(CARTAO_SEL);
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
    document.querySelectorAll('.hist-day:not(.is-collapsed)').forEach(day => {
      const c = day.querySelector(CARTAO_SEL);   // 1º cartão do dia (direto ou dentro de um grupo)
      if (c) _obsCentro.observe(c);
    });
    centraTodos(diasVisiveis());   // pass imediato p/ os dias já visíveis (sem "pulo" no load)
  }

  // percorre os dias visíveis e, em cada um, acha o registro sob a linha do marcador (busca
  // binária — os cartões estão em ordem vertical) para atualizar horário e cor. rAF-throttled.
  function atualizaMarcas() {
    document.querySelectorAll('.hist-day:not(.is-collapsed)').forEach(day => {
      const r = day.getBoundingClientRect();
      if (r.bottom <= 0 || r.top >= window.innerHeight) return;
      const mark = day.querySelector('.hist-mark');
      const cards = day.querySelectorAll(CARTAO_SEL);
      if (!mark || !cards.length) return;
      const linha = mark.getBoundingClientRect().top + mark.offsetHeight / 2 + 1;
      let lo = 0, hi = cards.length - 1, at = 0;
      while (lo <= hi) {
        const mid = (lo + hi) >> 1;
        if (cards[mid].getBoundingClientRect().top <= linha) { at = mid; lo = mid + 1; }
        else hi = mid - 1;
      }
      setMark(mark, cards[at].dataset.marca, cards[at].dataset.acao, cards[at].dataset.marcaSub);
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

  // ── microanimação do contador absorvido: cada caractere é um "rolo" ────────────────────────────
  // Respeita quem pediu menos movimento (e é o modo do verificador): aí tudo é definido direto.
  const reduzMov = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  // rola UMA célula: o caractere antigo sai (desliza + esmaece) e o novo entra do lado oposto.
  // 'down' = o valor AUMENTOU (novo desce do topo); 'up' = DIMINUIU (novo sobe de baixo). Seletivo:
  // se o caractere não mudou, não anima nada.
  function rolaCelula(cell, novo, dir) {
    const antigo = cell.firstElementChild;
    if (antigo && antigo.textContent === novo) return;   // inalterado: fica quieto
    if (!antigo || reduzMov) { cell.textContent = ''; cell.appendChild(el('span', 'ch', novo)); return; }
    const from = dir === 'up' ? 100 : -100;
    const entra = el('span', 'ch ch-abs', novo);
    cell.appendChild(entra);
    const dur = 430, ease = 'cubic-bezier(.2,.7,.2,1)';
    const aSai = antigo.animate([{ transform: 'translateY(0)', opacity: 1 }, { transform: 'translateY(' + (-from) + '%)', opacity: 0 }], { duration: dur, easing: ease, fill: 'forwards' });
    const aEnt = entra.animate([{ transform: 'translateY(' + from + '%)', opacity: 0 }, { transform: 'translateY(0)', opacity: 1 }], { duration: dur, easing: ease, fill: 'forwards' });
    aEnt.onfinish = () => { aSai.cancel(); aEnt.cancel(); antigo.textContent = novo; antigo.removeAttribute('style'); entra.remove(); };
  }

  // a célula SAI: o caractere desliza para fora + esmaece e a largura colapsa, então a célula é
  // removida. É o que anima o dígito que some quando o contador cai de dois para um dígito (14 → 5).
  function rolaSaida(cell, dir) {
    if (reduzMov) { cell.remove(); return; }
    cell.classList.add('is-saindo');   // deixa de contar como célula "ativa" enquanto anima
    const ch = cell.firstElementChild;
    const to = dir === 'up' ? -100 : 100;
    const w = cell.offsetWidth;
    cell.style.width = w + 'px';
    const dur = 430, ease = 'cubic-bezier(.2,.7,.2,1)';
    if (ch) ch.animate([{ transform: 'translateY(0)', opacity: 1 }, { transform: 'translateY(' + to + '%)', opacity: 0 }], { duration: dur, easing: ease, fill: 'forwards' });
    cell.animate([{ width: w + 'px' }, { width: '0px' }], { duration: dur, easing: ease, fill: 'forwards' }).onfinish = () => cell.remove();
  }

  // a célula ENTRA: espelho de rolaSaida. É o que anima o dígito que APARECE quando o contador sobe de
  // um para dois (ou mais) caracteres (7 → 35). Sem isto, a célula nova nascia vazia (0px) e, com o
  // overflow:hidden da célula, o dígito recém-chegado ficava recortado e só "surgia" ao final. Aqui o
  // caractere já entra ESTÁTICO (dá largura à célula) e a largura cresce de 0 enquanto ele rola para
  // dentro pelo lado oposto — mesma direção/tempo dos vizinhos que rolam.
  function rolaEntrada(cell, novo, dir) {
    const ch = cell.firstElementChild;
    if (!ch) { cell.appendChild(el('span', 'ch', novo)); return; }
    ch.textContent = novo;
    const from = dir === 'up' ? 100 : -100;
    const w = cell.offsetWidth;   // largura final, já com o dígito dentro
    const dur = 430, ease = 'cubic-bezier(.2,.7,.2,1)';
    cell.animate([{ width: '0px' }, { width: w + 'px' }], { duration: dur, easing: ease });
    ch.animate([{ transform: 'translateY(' + from + '%)', opacity: 0 }, { transform: 'translateY(0)', opacity: 1 }], { duration: dur, easing: ease });
  }

  // acerta uma ZONA (fila de células) ao texto alvo; anima só as que mudaram. anchor 'right' alinha
  // pela direita (dígitos do contador: a unidade permanece no lugar quando surge a dezena). As células
  // que saem animam (rolaSaida) e as que faltam são criadas na ponta certa antes do acerto.
  function zonaCells(zona, alvo, dir, anchor, fresh) {
    const chars = (alvo || '').split('');
    const ativas = () => [...zona.children].filter(c => !c.classList.contains('is-saindo'));
    // remove o excesso pelas pontas certas (anima a saída, mantendo a que fica no lugar)
    let cur = ativas();
    const excesso = cur.length - chars.length;
    if (excesso > 0) {
      (anchor === 'right' ? cur.slice(0, excesso) : cur.slice(cur.length - excesso))
        .forEach(cell => (fresh || reduzMov) ? cell.remove() : rolaSaida(cell, dir));
    }
    // cria as que faltam, na ponta certa — marcadas como NOVAS p/ animarem a ENTRADA (não a troca)
    const novas = new Set();
    for (let falta = chars.length - ativas().length; falta > 0; falta--) {
      const cell = el('span', 'hist-cur-ch');
      cell.appendChild(el('span', 'ch', ''));
      if (anchor === 'right') zona.insertBefore(cell, zona.firstChild); else zona.appendChild(cell);
      novas.add(cell);
    }
    // acerta cada célula ao caractere alvo: as recém-criadas ROLAM PARA DENTRO (rolaEntrada), as demais
    // trocam de valor (rolaCelula) — ambas animam só quando de fato mudam.
    ativas().forEach((cell, i) => {
      if (fresh || reduzMov) { cell.textContent = ''; cell.appendChild(el('span', 'ch', chars[i])); }
      else if (novas.has(cell)) rolaEntrada(cell, chars[i], dir);
      else rolaCelula(cell, chars[i], dir);
    });
  }

  // atualiza a linha absorvida: data (DD-MM-AA, células estáveis) + contador (dígitos rolam, alinhados
  // à direita) + palavra. A direção vem do delta do contador; `fresh` (1ª exibição) define direto,
  // sem rolo — o conteúdo entra junto com a expansão da altura.
  function atualizaCur(cur, data, countTxt) {
    const inner = cur.firstElementChild;
    if (!inner) return;
    const fresh = !cur.classList.contains('is-shown');
    const mNum = /^(\d+)([\s\S]*)$/.exec(countTxt || '');
    const num = mNum ? mNum[1] : '';
    const palavra = mNum ? mNum[2] : (countTxt || '');
    const nNovo = num ? +num : (cur._n || 0);
    const dir = nNovo > (cur._n || 0) ? 'down' : nNovo < (cur._n || 0) ? 'up' : (cur._dir || 'down');
    cur._dir = dir; cur._n = nNovo;
    let zData = inner.querySelector('.hist-cur-date');
    if (!zData) {
      zData = el('span', 'hist-cur-date');
      inner.appendChild(zData);
      inner.appendChild(el('span', 'hist-cur-sep', '·'));
      inner.appendChild(el('span', 'hist-cur-num'));
      inner.appendChild(el('span', 'hist-cur-word'));
    }
    zonaCells(zData, data, dir, 'left', fresh);
    zonaCells(inner.querySelector('.hist-cur-num'), num, dir, 'right', fresh);
    // o espaço entre o número e "alterações" precisa ser um NBSP: um espaço comum, à frente de um
    // inline-block, é aparado — e o valor saía colado ("10alterações")
    inner.querySelector('.hist-cur-word').textContent = palavra;
  }

  // o título do MÊS (único sticky) ABSORVE a data + contagem do dia atual: conforme os cabeçalhos
  // de dia deslizam para debaixo dele, a informação passa a ser exibida no próprio mês, mantendo a
  // continuidade da referência. O "dia atual" é o último cujo cabeçalho já passou por baixo do mês.
  // A ALTURA do título anima (expande antes de receber a info, recolhe ao devolvê-la) e os números
  // trocam de valor com um rolo por caractere.
  function atualizaMeses() {
    document.querySelectorAll('.hist-month:not(.hist-month--acao):not(.hist-month--secao)').forEach(mes => {
      const cur = mes.querySelector('.hist-month-cur');
      if (!cur) return;
      // a faixa zebrada ALTERNA para a versão gradiente (.is-merged) no MESMO instante da absorção
      // da data — quando o subtítulo some sob o título; em repouso fica sólida no lugar de sempre
      const band = mes.parentElement && mes.parentElement.querySelector('.hist-gap');
      const r = mes.getBoundingClientRect();
      if (r.bottom <= 0 || r.top >= window.innerHeight) {
        // fora da tela: recolhe (altura) e esmaece via CSS; mantém as células para a próxima vez
        cur.classList.remove('is-shown');
        if (band) band.classList.remove('is-merged');
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
        const dTxt = d ? d.textContent : '', cTxt = c ? c.textContent : '';
        const chave = dTxt + '|' + cTxt;
        // só mexe (e anima) quando o dia absorvido REALMENTE muda — não a cada quadro de scroll
        if (cur._chave !== chave) { atualizaCur(cur, dTxt, cTxt); cur._chave = chave; }
        cur.classList.add('is-shown');   // expande a altura e esmaece o conteúdo (via CSS)
        if (band) band.classList.add('is-merged');   // faixa ALTERNA para o gradiente que revela a lista
      } else {
        cur.classList.remove('is-shown');   // recolhe por animação (via CSS) e devolve a info ao dia
        if (band) band.classList.remove('is-merged');   // volta a ser a faixa sólida
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
    let bruto = ((r.breadcrumb && r.breadcrumb[0]) || '').replace(/\s+/g, ' ').trim();
    // seção "—" num commit antigo: adota a seção mais recente do MESMO slide (mesma resolução do
    // breadcrumb), para o grupo casar com o que o caminho passa a exibir
    if (!bruto || /^[—–-]$/.test(bruto)) bruto = (secaoDoLink(r.link) || '').replace(/\s+/g, ' ').trim();
    if (!bruto) return { chave: '__sem_secao__', rotulo: 'Sem seção' };
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
  // mapa GLOBAL link → seção mais recente e legível: repõe a seção "—" dos commits antigos pela que
  // o slide veio a ter. Mesma lógica de "o 1º visto (mais novo) é o atual".
  let _secoes = null;
  function secaoDoLink(link) {
    if (!_secoes) {
      _secoes = new Map();
      (dados.registros || []).forEach(r => {
        const sec = (r.breadcrumb || [])[0];
        if (r.link && sec && !/^[—–-]$/.test((sec + '').trim()) && !_secoes.has(r.link)) _secoes.set(r.link, sec);
      });
    }
    return _secoes.get(link) || null;
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

  // "240 alterações no total" / "1 alteração no total": o total de alterações de um container, ao lado
  // do seu título. Mesmo elemento (.hist-month-count) nos três agrupamentos — tempo, ação e seção.
  function contadorTotal(n) {
    return el('span', 'hist-month-count', n + (n === 1 ? ' alteração' : ' alterações') + ' no total');
  }

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
    if (expNote) expNote.hidden = agrupamento !== 'secao';   // a nota é específica da ordenação "por seção"

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
      const diasOrd = agrupaPorDia(regs);
      // total de alterações por mês (somado dos seus dias) — vai no título do container, como nos demais
      const totalMes = new Map();
      diasOrd.forEach(([dia, itens]) => {
        const p = parse(dia);
        const rot = p ? (MESES[p.mes].charAt(0).toUpperCase() + MESES[p.mes].slice(1)) + ' de ' + p.ano : '—';
        totalMes.set(rot, (totalMes.get(rot) || 0) + itens.length);
      });
      diasOrd.forEach(([dia, itens]) => {
        const p = parse(dia);
        const mes = p ? MESES[p.mes].charAt(0).toUpperCase() + MESES[p.mes].slice(1) : '—';
        const rotuloMes = p ? mes + ' de ' + p.ano : '—';
        if (rotuloMes !== mesAtual) {
          mesAtual = rotuloMes;
          const caixa = el('div', 'hist-monthbox');
          const mh = el('h2', 'hist-month');
          mh.appendChild(el('span', 'hist-month-label', rotuloMes));
          mh.appendChild(contadorTotal(totalMes.get(rotuloMes)));   // total do mês, à direita do rótulo
          const cur = el('span', 'hist-month-cur');   // data + contagem do dia, absorvidas ao rolar
          cur.appendChild(el('span', 'hist-month-cur-in'));   // wrapper recortado: anima a ALTURA (grid) e abriga as células que rolam
          mh.appendChild(cur);
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
        h.appendChild(contadorTotal(itens.length));
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
        h.appendChild(contadorTotal(doGrupo.length));
        caixa.appendChild(h);
        caixa.appendChild(el('div', 'hist-gap'));   // faixa zebrada suave logo abaixo do título da ação
        const rolagem = el('div', 'hist-monthscroll');
        rolagem.addEventListener('scroll', agendaMarcas, { passive: true });
        agrupaPorDia(doGrupo).forEach(([dia, itens]) => rolagem.appendChild(bloco(dia, itens)));
        caixa.appendChild(rolagem);
        lista.appendChild(caixa);
      });
    }
    // o detalhamento é ESTADO: o render apenas REFLETE o valor atual (não reativa "Máximo")
    marcaFold(detalhe === 'maximo');
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

  // toggle AGRUPAMENTO (experimental): Não / Sim — empilha registros semelhantes
  const botoesAgrupar = document.querySelectorAll('.hist-agroup .hist-agroup-btn');
  botoesAgrupar.forEach(b => b.addEventListener('click', () => {
    const alvo = b.dataset.agrupar === 'sim';
    if (alvo === agrupar) return;
    botoesAgrupar.forEach(x => { x.classList.remove('active'); x.setAttribute('aria-pressed', 'false'); });
    b.classList.add('active'); b.setAttribute('aria-pressed', 'true');
    agrupar = alvo;
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

  // DETALHAMENTO — par COM ESTADO: "Máximo" (cartão inteiro) e "Mínimo" (uma linha por registro). É um
  // MODO de renderização, não um colapso da lista: trocar de detalhamento RE-RENDERIZA, e o estado
  // (detalhe) sobrevive a mudanças de aba/ordenação/agrupamento — o render o reflete (marcaFold no fim).
  const btnMinimo = document.querySelector('#hist-collapse');
  const btnMaximo = document.querySelector('#hist-expand');
  const marcaFold = maximo => {
    if (btnMaximo) { btnMaximo.classList.toggle('active', maximo); btnMaximo.setAttribute('aria-pressed', String(maximo)); }
    if (btnMinimo) { btnMinimo.classList.toggle('active', !maximo); btnMinimo.setAttribute('aria-pressed', String(!maximo)); }
  };
  if (btnMaximo) btnMaximo.addEventListener('click', () => { if (detalhe === 'maximo') return; detalhe = 'maximo'; marcaFold(true); agendarRender(); });
  if (btnMinimo) btnMinimo.addEventListener('click', () => { if (detalhe === 'minimo') return; detalhe = 'minimo'; marcaFold(false); agendarRender(); });

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
      const alvo = lista.querySelector('[data-id="' + (window.CSS && CSS.escape ? CSS.escape(rec) : rec) + '"]');
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
