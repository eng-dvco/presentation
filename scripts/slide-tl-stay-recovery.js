'use strict';
/* ── Layout serpenteante + ícones de tipo (escopo .tl-wrap) ───────────────────
   Carregado SOMENTE por slide-tl-stay-recovery.html, DEPOIS de slide-tl.js.

   O slide-tl.js desenha uma espinha HORIZONTAL (y fixo) e força min-width no
   .tl-entries — ambos pressupõem UMA fileira e são incompatíveis com o wrap. Ele
   ignora containers .tl-wrap (vide isWrapTimeline lá); aqui:
     • injeta um ícone de tipo (autoportante/estaiada) em cada estrutura;
     • embrulha window._tlUpdateSpineRange (exposto pelo slide-tl.js e chamado após
       cada filtro/ordenação/troca de visão) para redesenhar a espinha SERPENTEANTE
       nas posições REAIS dos nós (várias fileiras).

   Veio de um teste A/B contra a versão de rolagem horizontal; venceu e virou a
   única. O maquinário horizontal segue em slide-tl.js, hoje sem nenhum slide que
   o exercite. */
(function tlWrapSnake() {
  const roots = document.querySelectorAll('.tl-wrap');
  if (!roots.length) return;
  const DOT_R = 6;
  const ns = 'http://www.w3.org/2000/svg';

  // ── ícones de tipo de estrutura (arquivos SVG via máscara recolorível) ──
  //    autoportante → transmission-tower-black.svg | estaiada → cable-stayed-tower-black.svg
  //    (definidos como .icon-tower-* em components.css; a cor vem do .icon-mask)
  const LABEL = { estaiada: 'Estaiada', autoportante: 'Autoportante' };

  function injectIcons() {
    roots.forEach(root => root.querySelectorAll('.tl-entry').forEach(e => {
      const pill = e.querySelector('.tl-entry-code-pill');
      if (!pill || pill.querySelector('.tl-type-icon')) return;
      let type = (e.dataset.type || 'estaiada').toLowerCase();
      if (type !== 'autoportante') type = 'estaiada';
      const span = document.createElement('span');
      span.className = 'tl-type-icon icon-mask icon-tower-' + type;
      span.title = LABEL[type];
      span.setAttribute('aria-label', 'Tipo: ' + LABEL[type]);
      pill.insertBefore(span, pill.firstChild);
    }));
  }

  // ── espinha serpenteante: passa pelos centros dos pontos VISÍVEIS, ligando
  //    linhas consecutivas com uma curva de retorno suave ──
  function drawSnake(entriesEl) {
    if (entriesEl.offsetParent === null) return;               // oculto (visão tabela)

    const visible = [...entriesEl.children].filter(el =>
      el.classList && el.classList.contains('tl-entry') && el.style.display !== 'none');
    if (!visible.length) {
      if (entriesEl._tlSnake) { entriesEl._tlSnake.remove(); entriesEl._tlSnake = null; }
      entriesEl._tlSnakePath = null; entriesEl._tlSnakeD = null;
      return;
    }

    // cada estrutura contribui com dois pontos: a TRASEIRA (dot, à esquerda) e a
    // FRENTE (borda direita do painel). A serpente atravessa cada container (dot→frente,
    // atrás do card) e conecta sempre a FRENTE de um à TRASEIRA do próximo — inclusive
    // entre fileiras. Passa um pouco ALÉM do dot (OVER) p/ transição suave.
    const nodes = visible.map(e => {
      const dot = e.querySelector('.tl-dot');
      const panel = e.querySelector('.tl-entry-panel');
      const dotCx = e.offsetLeft + (dot ? dot.offsetLeft : 0) + DOT_R;
      // A spline passa pelo CENTRO VERTICAL do container de dados (.tl-entry-panel),
      // não pelo dot (que fica no topo do container). Assim os pontos de conexão de
      // fileiras consecutivas ficam equidistantes da travessia → "U" SIMÉTRICOS.
      const panelCy = panel ? (e.offsetTop + panel.offsetTop + panel.offsetHeight / 2)
                            : (e.offsetTop + (dot ? dot.offsetTop : 0) + DOT_R);
      // dot CONCÊNTRICO à spline: por padrão o dot fica no TOPO do container, mas a
      // linha passa pelo CENTRO dele (panelCy). Desloca o dot verticalmente p/ que seu
      // centro coincida com a linha. offsetTop independe de transform → Δ é estável
      // entre redesenhos (idempotente). O ::after (pulso) acompanha o dot.
      if (dot && panel) {
        const dotCenter = e.offsetTop + dot.offsetTop + DOT_R;
        dot.style.transform = 'translateY(' + (panelCy - dotCenter).toFixed(2) + 'px)';
      }
      const frontX = panel ? (e.offsetLeft + panel.offsetLeft + panel.offsetWidth) : (dotCx + 44);
      return { dotCx: dotCx, panelCy: panelCy, frontX: frontX };
    });

    const OVER = 6;    // a linha passa um pouco além do dot (antes e depois)
    const TURN = 16;   // reta entre o conteúdo da fileira e a vertical onde o "U" começa
    const f = v => v.toFixed(1);
    const isTurn = i => nodes[i + 1] && Math.abs(nodes[i + 1].panelCy - nodes[i].panelCy) >= 4;

    // ── CANAL da serpente ───────────────────────────────────────────────────────
    // Antes cada "U" era ancorado na própria fileira: o de saída na FRENTE do último
    // card dela, o de chegada no DOT do primeiro card da seguinte. Como as fileiras não
    // terminam no mesmo x — larguras de card variam e a contagem de cards por fileira
    // muda com a viewport (já medimos 789 numa e 596 na de baixo) —, cada curva saía de
    // uma vertical diferente e as pontas não se alinhavam.
    //
    // Agora TODAS as trocas compartilham as MESMAS duas verticais: bx (saída) e ax
    // (chegada). São tangentes à mesma reta, independentemente de qual fileira parte
    // para qual. bx nasce da fileira que avança mais à direita entre as que fazem
    // curva — assim o canal nunca corta um card.
    const outs = [], ins = [], pitches = [];
    for (let i = 0; i < nodes.length - 1; i++) {
      if (!isTurn(i)) continue;
      outs.push(nodes[i].frontX);
      ins.push(nodes[i + 1].dotCx);
      pitches.push(Math.abs(nodes[i + 1].panelCy - nodes[i].panelCy));
    }
    // AMPLITUDE única. Um semicírculo puro força R = Δy/4, então fileiras com alturas
    // ligeiramente diferentes davam bojos diferentes (18.3 vs 18.5). Fixando R no menor
    // que todas as trocas comportam, o "U" vira: quarto de arco → reta vertical → quarto
    // de arco. A reta absorve a diferença de altura e o bojo fica idêntico em todas.
    const maxFront = outs.length ? Math.max.apply(null, outs) : 0;
    const minDot = ins.length ? Math.min.apply(null, ins) : 0;
    let turn = TURN;
    let R = pitches.length ? Math.min.apply(null, pitches) / 4 : 0;

    // O "U" avança (turn + R) além do card mais adiantado, à direita, e além do dot mais
    // recuado, à esquerda. Nada disso pode sair da caixa desenhável (.tl-entries): acima
    // de 640px o .tl-axis-section (overflow:hidden) AMPUTA o bojo — chegamos a perder 297
    // pixels de traço —, e abaixo disso ele é pintado fora do cartão da seção, sobre o
    // fundo da página. O CSS reserva uma calha à direita (padding-right) que acomoda a
    // curva inteira nas larguras normais; aqui garantimos o caso patológico, em que os
    // cards ocupam a faixa toda e não sobra calha nenhuma.
    //
    // Aperta turn e R na MESMA proporção — é o que preserva a simetria, já que a extensão
    // de cada ponta é exatamente (turn + R) dos dois lados.
    if (pitches.length) {
      const room = Math.min(entriesEl.clientWidth - 1 - maxFront, minDot - 1);
      const need = turn + R;
      if (need > room) {
        const k = Math.max(0, room) / need;
        turn *= k;
        R *= k;
      }
    }
    const bx = maxFront + turn;   // vertical de saída (direita)
    const ax = minDot - turn;     // vertical de chegada (esquerda)

    let d = 'M ' + f(nodes[0].dotCx - OVER) + ' ' + f(nodes[0].panelCy);
    for (let i = 0; i < nodes.length; i++) {
      const n = nodes[i];
      d += ' L ' + f(n.frontX) + ' ' + f(n.panelCy);                 // trás → frente (horizontal, atrás do card)
      const nx = nodes[i + 1];
      if (!nx) break;
      if (!isTurn(i)) {
        d += ' L ' + f(nx.dotCx - OVER) + ' ' + f(nx.panelCy);       // mesma fileira: frente(A) → trás(B)
      } else {
        const midY = (n.panelCy + nx.panelCy) / 2;
        d += ' L ' + f(bx) + ' ' + f(n.panelCy);                                      // avança até a vertical de saída
        d += ' A ' + f(R) + ' ' + f(R) + ' 0 0 1 ' + f(bx + R) + ' ' + f(n.panelCy + R);
        d += ' L ' + f(bx + R) + ' ' + f(midY - R);                                   // reta vertical (0 na troca de menor altura)
        d += ' A ' + f(R) + ' ' + f(R) + ' 0 0 1 ' + f(bx) + ' ' + f(midY);           // fecha o "U" de saída (bojo à direita)
        d += ' L ' + f(ax) + ' ' + f(midY);                                           // travessia (p/ a esquerda)
        d += ' A ' + f(R) + ' ' + f(R) + ' 0 0 0 ' + f(ax - R) + ' ' + f(midY + R);
        d += ' L ' + f(ax - R) + ' ' + f(nx.panelCy - R);
        d += ' A ' + f(R) + ' ' + f(R) + ' 0 0 0 ' + f(ax) + ' ' + f(nx.panelCy);     // fecha o "U" de chegada (bojo à esquerda)
      }
    }

    // geometria inalterada (redesenho disparado por um relayout que não moveu nada):
    // nada a fazer. Evita churn de DOM e fecha qualquer laço de realimentação com o
    // ResizeObserver abaixo.
    let path = entriesEl._tlSnakePath;
    if (entriesEl._tlSnakeD === d && path && path.isConnected) return;

    // reaproveita o <svg> existente: só o atributo "d" muda entre redesenhos
    if (!path || !path.isConnected) {
      const svg = document.createElementNS(ns, 'svg');
      svg.setAttribute('class', 'tl-snake');
      svg.setAttribute('aria-hidden', 'true');
      path = document.createElementNS(ns, 'path');
      path.setAttribute('fill', 'none');
      path.setAttribute('stroke', 'rgba(0,0,0,0.18)');
      path.setAttribute('stroke-width', '1.5');
      path.setAttribute('stroke-linecap', 'round');
      path.setAttribute('stroke-linejoin', 'round');
      svg.appendChild(path);
      entriesEl.insertBefore(svg, entriesEl.firstChild);
      entriesEl._tlSnake = svg;
      entriesEl._tlSnakePath = path;
      entriesEl.classList.add('has-spine-svg');                // esconde o ::before CSS
    }
    path.setAttribute('d', d);
    entriesEl._tlSnakeD = d;
  }

  function drawAll() {
    roots.forEach(root => root.querySelectorAll('.tl-entries').forEach(drawSnake));
  }

  // redesenho coalescido: vários gatilhos (fontes, imagens, resize) podem cair no
  // mesmo frame — desenhamos uma única vez por frame
  let raf = 0;
  function schedule() {
    if (raf) return;
    raf = requestAnimationFrame(function () { raf = 0; drawAll(); });
  }

  // ── ordena os trechos pela sequência de SEs de cada linha (linha 2: …E2→E3→E4→E6…,
  //    logo E2-E3 vem antes de E4-E6). Normaliza travessões p/ comparar por nome. ──
  const DASH = s => s.replace(/[‐-―]/g, '-');
  const TRECHO_ORDER = ['E0-E1', 'E2-E3', 'E3-E4', 'E4-E6', 'E6-E5', 'BNM-N3', 'N3-N2', 'N2-N1'];
  function reorderTrechos() {
    roots.forEach(root => root.querySelectorAll('.tl-trechos').forEach(cont => {
      const rank = it => { const n = it.querySelector('.tl-trecho-name'); const i = n ? TRECHO_ORDER.indexOf(DASH(n.textContent.trim())) : -1; return i < 0 ? 99 : i; };
      [...cont.querySelectorAll(':scope > .tl-trecho')].sort((a, b) => rank(a) - rank(b)).forEach(it => cont.appendChild(it));
    }));
  }

  // embrulha o _tlUpdateSpineRange (já embrulhado pelo slide-tl.js): após o cálculo
  // horizontal compartilhado, redesenha a serpente. Assim, todo filtro/ordenação/
  // volta-ao-cronograma que chama _tlUpdateSpineRange também atualiza a serpente.
  const prev = window._tlUpdateSpineRange;
  window._tlUpdateSpineRange = function () { if (prev) prev(); drawAll(); };

  reorderTrechos();
  injectIcons();                                   // síncrono: antes do lock de largura do painel (fonts.ready)

  // A visão TABELA é construída pelo slide-tl.js lendo os .tl-entry na ordem do DOM — e
  // isso já aconteceu quando chegamos aqui. Como acabamos de REORDENAR os trechos, a
  // tabela ficou com a ordem do HTML enquanto o cronograma mostra a nova: divergiam, e
  // bastavam dois cliques em "Código" (voltando à MESMA ordenação) para a tabela se
  // reordenar sozinha, do nada. _tlUpdateTableView só espelha visibilidade e zebra —
  // não reconstrói. Reconstruímos aqui, de fato, para as duas visões nascerem iguais.
  if (window._tlRebuildTable) {
    document.querySelectorAll('.tl-axis-section').forEach(function (sec) { window._tlRebuildTable(sec); });
  }
  if (window._tlUpdateTableView) window._tlUpdateTableView();   // espelha filtros + restripa a zebra

  // Desenha JÁ, com as métricas da fonte de fallback. Antes esperávamos
  // document.fonts.ready — as 4 famílias remotas do Google Fonts —, e até lá o slide
  // ficava sem serpente (ou, pior, com a espinha reta do script-base). O layout usa
  // font-display:swap, então o texto já está posicionado; ao trocar a fonte as caixas
  // mudam de largura e o ResizeObserver abaixo redesenha sobre a geometria nova.
  drawAll();

  if ('ResizeObserver' in window) {
    // Observa as faixas (mudança de largura/quebra de fileira) E os painéis (a troca
    // de fonte muda a métrica do texto sem necessariamente mudar a quebra, e o
    // slide-tl.js trava a largura deles em fonts.ready). Qualquer relayout que mova
    // um nó redesenha a serpente — sem depender de quando as fontes chegam.
    const ro = new ResizeObserver(schedule);
    roots.forEach(function (root) {
      root.querySelectorAll('.tl-entries, .tl-entry-panel').forEach(function (el) { ro.observe(el); });
    });
  } else {
    document.fonts.ready.then(schedule);
    window.addEventListener('resize', schedule);
  }
})();
