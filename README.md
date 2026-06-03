# Apresentação — Manutenção do PISF (CMT Engenharia)

Site estático que apresenta, em formato de slides, as atividades de operação, manutenção e conservação de subestações (SE), Linhas de Transmissão (LT) e de Distribuição (LD) dos Eixos Norte e Leste do Projeto de Integração do Rio São Francisco (PISF), no âmbito do Contrato 26/2022-MDR. Reúne registros fotográficos de campo, ocorrências de segurança do trabalho, eventos e óbices, organizados por área e tópico, além de um glossário técnico e um histórico de versões congeladas (snapshots). É material de apresentação da CMT Engenharia, de autoria do Eng. Daniel Carvalho.

## Sumário

- [Estrutura de diretórios](#estrutura-de-diretórios)
- [Arquitetura das páginas](#arquitetura-das-páginas)
- [Sistema de mosaico](#sistema-de-mosaico)
- [Seções e navegação](#seções-e-navegação)
- [Design system / CSS](#design-system--css)
- [Convenções de conteúdo](#convenções-de-conteúdo)
- [Como executar localmente](#como-executar-localmente)
- [Como adicionar um novo slide](#como-adicionar-um-novo-slide)
- [Acessibilidade](#acessibilidade)
- [Git e contribuição](#git-e-contribuição)
- [Autoria](#autoria)

## Estrutura de diretórios

```text
presentation/
├── apresentação.html
├── .gitignore
├── .documents/
├── assets/
│   ├── fonts/
│   ├── icons/
│   ├── img/
│   │   ├── banner/
│   │   ├── charts/
│   │   ├── hero/
│   │   ├── placeholder/
│   │   └── slides/
│   │       ├── se/
│   │       ├── lt/
│   │       ├── ld/
│   │       ├── st/
│   │       ├── issues/
│   │       └── events/
│   ├── logos/
│   └── media/
├── public/
│   ├── definitions/
│   │   ├── civil-construction/
│   │   └── electrical/
│   └── snapshots/
│       ├── snapshot-20251113141200/
│       ├── snapshot-20260226074230/
│       └── snapshot-20260415161444/
├── slides/
│   ├── index.html
│   ├── selection.html
│   ├── slide-template.html
│   ├── document-template.html
│   ├── video-template.html
│   ├── video-placeholder.html
│   └── slide-*.html
└── styles/
```

## Arquitetura das páginas

### Fluxo de navegação

```text
apresentação.html (Landing)
    ├─ Logo CMT ───────────────────────► slides/selection.html  (Histórico)
    └─ "ir para o histórico →" ────────► slides/selection.html  (Histórico)

slides/selection.html (Histórico / snapshots)
    ├─ Logo ──► apresentação.html
    └─ section.additional-group (h2 "Histórico" › h3 "Reuniões"):
       INDEFINIDA ──► slides/index.html  (produção atual)
       15-04-2026 ──► public/snapshots/snapshot-20260415161444/slides/selection.html
       25-02-2026 ──► public/snapshots/snapshot-20260226074230/slides/selection.html
       13-11-2025 ──► public/snapshots/snapshot-20251113141200/slides/selection.html
       (demais datas de 2025/2024: desabilitadas)

slides/index.html (Conteúdo / produção atual)
    ├─ Logo ──► apresentação.html
    ├─ "❮ IR PARA O HISTÓRICO" ──► slides/selection.html
    └─ selection-grid: 6 seções + 30 slides + bloco "Documentos Recebidos"

slides/slide-*.html (cada slide de conteúdo)
    ├─ Logo ──► slides/index.html
    └─ breadcrumb: início (apresentação.html) › conteúdo (index.html) › atual
```

A `apresentação.html` (raiz) é a porta de entrada. A partir dela, **tanto a logo da CMT quanto o CTA "ir para o histórico →" levam à página de versões** (`slides/selection.html`). A página de conteúdo (`slides/index.html`) é alcançada pela entrada "INDEFINIDA" do histórico. Cada slide individual é uma página HTML própria em `slides/`.

### Tipos de página e templates

Há três templates base de **conteúdo** (slide de fotos, documento e vídeo). Todos compartilham a mesma carcaça HTML (cabeçalho com `charset`, `viewport`, favicons claro/escuro, links de CSS, fontes do Google) e a mesma estrutura de corpo: `skip-link`, `main.main-container#main-content`, `header.flex-header-container` (com `div.title-header-h1` e a logo), `nav.breadcrumb`, `div.content-container > div.content-wrapper` e `footer`.

| Tipo          | Arquivo de referência                                           | CSS adicional          | Conteúdo do `content-wrapper`                                                                                        |
| ------------- | ---------------------------------------------------------------- | ---------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| Slide (fotos) | qualquer `slides/slide-*.html` (ex.: `slide-ac-repair.html`) | `mosaic-style.css`   | `title-header-h2` + `mosaic-container` (galeria de fotos)                                                           |
| Documento     | `slides/document-template.html`                                | `document-style.css` | `figure.document-container` com `<object type="application/pdf">` e fallback de download                            |
| Vídeo        | `slides/video-template.html`                                   | `video-style.css`    | `figure.video-container` com `<video controls>`, `<track kind="captions" srclang="pt-BR">` e fallback de download |

Além desses, existe o `slides/slide-template.html`, que **não é um slide de fotos**: ele carrega `slide-selection.css` e serve de molde para uma grade de seleção (`selection-grid`), com seções de exemplo como `section-administration` ("Administrativo"), `section-worksheets` ("Planilhas de Controle"), `section-documentation` ("Documentação") e `section-media` ("Mídia") — seções que não aparecem no `index.html` atual.

Os templates são ignorados pelo Git (`**/*template.*`). Não há instâncias concretas de páginas de documento em `slides/` — apenas o `document-template.html`. Para vídeo existe a instância de exemplo `slides/video-placeholder.html`.

### Anatomia de um slide de fotos

O ícone de seção é um `<span>` **irmão** do `h1`, dentro de `div.title-header-h1` (não fica dentro do `h1`):

```html
<header class="flex-header-container" aria-label="Cabeçalho">
  <div class="title-header-h1">
    <span class="section-icon icon-substation" aria-hidden="true"></span>
    <h1 class="title-h1">Título do Slide</h1>
  </div>
  <a class="flex-logo-container" href="../slides/index.html" aria-label="Voltar para a seleção">
    <img class="logo cmt" src="../assets/logos/cmt-hd.jpg" alt="Logo CMT" />
  </a>
</header>

<!-- ...breadcrumb... -->

<div class="content-wrapper">
  <!-- Primeira seção de fotos -->
  <div class="title-header-h2">
    <h2 class="title-h2">Nome da Seção</h2>
  </div>
  <div class="mosaic-container">
    <div class="img img-default img-mid-mid">
      <img src="../assets/img/slides/se/topico/foto-1.jpeg" alt="descrição da foto" />
      <p class="obs obs-default">legenda opcional</p>
    </div>
    <!-- mais divs .img -->
  </div>

  <!-- Seção adicional opcional -->
  <div class="title-header-h2">
    <h2 class="title-h2">Outra Seção</h2>
  </div>
  <div class="mosaic-container">
    <!-- imagens -->
  </div>
</div>
```

Ícones de seção disponíveis (no `span.section-icon`): `icon-safety`, `icon-substation`, `icon-transmission`, `icon-distribution`, `icon-events`, `icon-obstacles`, `icon-documents`.

Os slides de manutenção de LT (`slide-lt-maintenance-*.html`) carregam o CSS extra `slide-lt-maintenance.css` e adicionam um menu de navegação interno (`ul.nav-list` com `li.selected-item`) que alterna entre os segmentos (GERAL, CPISF, BNM-N3, E0-E1, E0-E2, E2-E3, E3-E4). Esses slides organizam grupos de fotos com `title-header-h3` e `date-subtitle` (ex.: `<h4>22-04-26</h4>`).

## Sistema de mosaico

O layout de galeria é controlado por `styles/mosaic-style.css`. O container base `.mosaic-container` é um `grid` de 2 colunas (`gap: 24px`), com modificadores de número de colunas, e cada foto fica em uma `div.img` (altura padrão 360px).

| Classe do container   | Colunas     | Efeito                                |
| --------------------- | ----------- | ------------------------------------- |
| `.mosaic-container` | 2 (padrão) | Grade 2×N, imagens a 360px de altura |
| `.uni-column`       | 1           | Coluna única                         |
| `.tri-column`       | 3           | Três colunas                         |
| `.quad-column`      | 4           | Quatro colunas                        |

Mapeamento prático entre número de fotos e classe de imagem (guia de uso; as alturas vêm das classes `.img-*`):

| Fotos        | Container                         | Classe da imagem    | Altura | Resultado                                 |
| ------------ | --------------------------------- | ------------------- | ------ | ----------------------------------------- |
| 1            | `.mosaic-container`             | `.img-largest`    | auto   | Imagem cheia (`grid-column: 1 / -1`)    |
| 2            | `.mosaic-container`             | `.img-default`    | 360px  | Grade lado a lado                         |
| 2 (alta)     | `.mosaic-container`             | `.img-stretch`    | 540px  | Grade mais alta                           |
| 3            | `.mosaic-container.tri-column`  | `.img-stretch`    | 540px  | Linha de 3                                |
| 4            | `.mosaic-container`             | `.img-default`    | 360px  | Grade 2×2                                |
| 4+           | `.mosaic-container.quad-column` | `.img-default`    | 360px  | Linha de 4                                |
| 2 full-width | `.mosaic-container`             | `.img-duo-column` | 360px  | Cada uma ocupa 2 colunas e quebra a linha |

Classes auxiliares por foto:

- **Largura / quebra de linha:** `.img-duo-column` (`span 2`), `.img-tri-column` (`span 3`), `.img-quad-column` (`span 4`).
- **Altura:** `.img-stretch` (apenas aumenta a altura para 540px); `.img-largest` (altura `auto`, ocupa `grid-column: 1 / -1`).
- **Ajuste de `object-fit`:** `.img-contain` (mantém proporção, `contain`), `.img-fill` (estica, `fill`).
- **Posicionamento (`object-position`):** `.img-mid-top`, `.img-mid-mid` (padrão), `.img-mid-bottom`, `.img-mid-right`.

Comportamento interativo: zoom 1.03× no hover/focus; clique em `.img-default` expande para 1.75× (`zoom-out`, `max-height: 50dvh`, `z-index: 9999`); a classe `.transient` desabilita o zoom (cursor `grab`). Em telas até 1350px o zoom é desativado; em 768px as colunas voltam a `auto` e altura 360px; em 576px o container vira `flex` em coluna. Cada `.img::before` exibe, via `counter-increment`, o número sequencial da foto em um selo no canto superior esquerdo (auxílio de leitura/a11y).

### Convenção das legendas (`obs` / `invisible`)

As legendas de foto usam `<p class="obs obs-default">`:

```html
<p class="obs obs-default">adensamento</p>                  <!-- legenda visível -->
<p class="obs obs-default invisible"></p>                   <!-- presente no HTML, oculta -->
<p class="obs obs-done">solicitação do CPISF atendida</p>   <!-- status concluído (verde) -->
```

- `.obs-default` — estilo padrão de texto.
- `.obs-done` — estilo de conclusão (fundo verde `--color-green-alpha-50`; usa `circle-check.svg` como máscara em `::before`).
- `.invisible` — oculta visualmente a legenda mantendo-a no DOM.

## Seções e navegação

A página de conteúdo (`slides/index.html`) organiza os slides em uma grade (`selection-grid`) de seções temáticas, nesta ordem (ordem do DOM):

| # | Classe CSS               | Título (H2)         | Ícone                | Itens |
| - | ------------------------ | -------------------- | --------------------- | ----- |
| 1 | `section-safety`       | ST — Segurança     | `icon-safety`       | 2     |
| 2 | `section-substation`   | SE — Subestação   | `icon-substation`   | 11    |
| 3 | `section-transmission` | LT — Transmissão   | `icon-transmission` | 7     |
| 4 | `section-distribution` | LD — Distribuição | `icon-distribution` | 7     |
| 5 | `section-events`       | Eventos              | `icon-events`       | 1     |
| 6 | `section-obstacles`    | Óbices              | `icon-obstacles`    | 2     |

Total: 30 slides.

> Alguns slides agregam mais de um tópico num único arquivo (vários blocos `title-header-h2` + `mosaic-container`): `slide-transformer-cleaning.html` reúne 4 tópicos (buchas do transformador, retificador, chave-seccionadora e isoladores), `slide-tag-replacement.html` reúne 2 (etiquetas de identificação e meio-fio/canaleta) e `slide-resistance-measurement.html` reúne 2 (resistência de isolamento e resistência ôhmica), cada um com pasta de imagens distinta em `assets/img/slides/se/`.

Após a grade vem o bloco "Documentos Recebidos" (`div.title-header-h2` com `icon-documents` + `div.mosaic-container > div.list.list-cell-1` contendo um `<ol>`), que lista 11 PDFs e 5 planilhas XLSX (os mesmos arquivos de `.documents/`). O cabeçalho da página exibe um `update-info` ("Última atualização em 03-06-26 (quarta-feira, às 09h30)") e um `alert-banner` ("Versão demonstrativa | Apenas imagens disponíveis").

Cada seção da grade tem `background-image` próprio (banners em `assets/img/banner/`, incluindo `documents.png`), `background-blend-mode: saturation` sobre `--color-black-alpha-75` e transição de fundo no hover. Os itens (`.item`, `.opener-item`) podem assumir os status `pending`, `partial` ou `outdated`, com cores correspondentes.

### Histórico (`selection.html`) e snapshots imutáveis

A página de histórico (`slides/selection.html`) usa uma `section.additional-group` com um cabeçalho `h2` "Histórico", um `h3` "Reuniões" e, abaixo, blocos `.collection.reunion-collection` por ano:

- **2026:** `INDEFINIDA` → `slides/index.html` (produção atual); `15-04-2026` e `25-02-2026` → snapshots correspondentes.
- **2025:** `13-11-2025` → snapshot; demais datas desabilitadas (`.disabled`, sem snapshot).
- **2024:** todas as entradas desabilitadas.

| Snapshot                    | Data/hora         |
| --------------------------- | ----------------- |
| `snapshot-20251113141200` | 13/11/2025, 14h12 |
| `snapshot-20260226074230` | 26/02/2026, 07h42 |
| `snapshot-20260415161444` | 15/04/2026, 16h14 |

Cada snapshot em `public/snapshots/` é uma cópia congelada do site naquela data, contendo `assets/`, `slides/`, `styles/` e um `index.html` como página inicial (alguns também incluem uma pasta `public/` aninhada). As entradas do histórico apontam para `snapshot-XXX/slides/selection.html`. **Snapshots são imutáveis: nunca edite arquivos dentro de `public/snapshots/`, mesmo durante refatorações que afetem todo o repositório.** Eles registram o estado do site ao longo do tempo; qualquer alteração deve ser feita apenas na raiz do projeto.

## Design system / CSS

Os design tokens ficam em `styles/variables.css`, carregado em primeiro lugar em todas as páginas.

### Cores (extrato)

| Token                  | Valor                      | Uso                              |
| ---------------------- | -------------------------- | -------------------------------- |
| `--color-white`      | `rgba(225, 225, 225, 1)` | Texto e ícones claros           |
| `--color-grey`       | `rgba(190, 190, 190, 1)` | Texto secundário                |
| `--color-black`      | `rgba(32, 32, 32, 1)`    | Fundos escuros                   |
| `--color-green`      | `rgba(0, 255, 150, 1)`   | Breadcrumb, hover, sucesso, foco |
| `--color-dark-green` | `rgba(5, 80, 50)`        | Detalhes/fundos de sucesso       |
| `--color-red`        | `rgba(250, 80, 80, 1)`   | Alertas, status `pending`      |
| `--color-yellow`     | `rgba(255, 230, 80, 1)`  | Avisos, status `partial`       |
| `--color-orange`     | `rgba(255, 185, 80, 1)`  | Status `outdated`              |
| `--color-purple`     | `rgba(100, 80, 255, 1)`  | Destaque                         |

A maioria das cores possui variantes de opacidade `-alpha-75`, `-alpha-50`, `-alpha-25` e `-alpha-10` (há também variantes `dark-*` para vermelho, amarelo e verde). Há ainda tokens de fundo (`--background-white`, `--background-grey`, `--background-black-alpha-*`, etc.) e a máscara `--mask-fade: linear-gradient(90deg, #0000, #000 75%)`.

### Tipografia

- Famílias: `--font-family-general: "Roboto Mono"`; `--font-family-code: "JetBrains Mono"`.
- Fontes do Google carregadas nas páginas: Edu SA Beginner, Fondamento, Roboto Flex e Roboto Mono (nos slides, no index e no selection); Quicksand na landing.
- Tamanhos escalonados a partir de `2.5rem`: `--font-size-h1` (2.5rem) … `--font-size-h6` (0.625rem); `--font-size-content` (1.5rem); `--font-size-icon` (2.5rem).
- Pesos de `--font-weight-thinnest` (100) a `--font-weight-boldest` (700).
- Multiplicadores responsivos `--font-size-multiplier-*` (de `xxxs` 0.35 a `xxxl` 1.65; `md` = 1 é o padrão), aplicados via `--font-multiplier`, recalculado por breakpoint.

### Bordas

| Token                | Valor       |
| -------------------- | ----------- |
| `--border-round`   | `50%`     |
| `--border-big`     | `3rem`    |
| `--border-item`    | `0.75rem` |
| `--border-general` | `0.5rem`  |
| `--border-smaller` | `0.25rem` |

### Papel de cada arquivo CSS

| Arquivo                       | Responsabilidade                                                                                                                                                                                                                                                                |
| ----------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `variables.css`             | Design tokens canônicos (cores, fontes, tamanhos, pesos, bordas, padding, máscaras, backgrounds). Carregado primeiro em todas as páginas.                                                                                                                                    |
| `slide-style.css`           | Base de todas as páginas: reset, headings, links,`main-container`, header/breadcrumb, footer, `.section-icon` (máscaras por seção), carrossel, `.obs`, tooltips, a11y (`focus-visible`, `skip-link`) e os breakpoints (com overrides de `--font-multiplier`).   |
| `slide-selection.css`       | Grade de navegação (`index.html`/`selection.html` e `slide-template.html`): `.selection-grid`, seções com `background-image` e `blend-mode`, cards com status (`pending`/`partial`/`outdated`), `.opener-item` e o `.additional-group` do histórico. |
| `mosaic-style.css`          | Galerias de imagem:`.mosaic-container`, `.img`, zoom/transform, contadores CSS e indicadores de posição.                                                                                                                                                                  |
| `document-style.css`        | Visualizador de PDF (`.document-container`, `.document-caption`); `<object>` ocupando boa parte da viewport.                                                                                                                                                              |
| `video-style.css`           | Player de vídeo (`.video-container`, `.video-caption`); `<video>` com `max-height` em dvh.                                                                                                                                                                             |
| `main.css`                  | Estilos da landing (`apresentação.html`): background hero, `.central-content`, botão `.redirect`, fonte Quicksand no parágrafo.                                                                                                                                       |
| `slide-lt-maintenance.css`  | Slides de manutenção de LT:`nav-list` com `selected-item`, `title-header-h3` e `date-subtitle`.                                                                                                                                                                       |
| `slide-tag-replacement.css` | Mínimo:`.img-bigger` (`height: auto; grid-column: 1 / -1;`) para imagens que ocupam a coluna inteira.                                                                                                                                                                      |

Os ícones de seção usam a técnica de máscara: `.section-icon` aplica `mask-image` de um SVG sobre `background-color: var(--color-white)`, recolorindo o ícone. Mapa de classe → SVG (em `slide-style.css`): `.icon-safety`→`safety.svg`, `.icon-substation`→`substation.svg`, `.icon-transmission`→`lt-tower.svg`, `.icon-distribution`→`ld-pole.svg`, `.icon-events`→`events.svg`, `.icon-obstacles`→`obstacle.svg`, `.icon-documents`→`documents.svg`.

Breakpoints principais (em `slide-style.css` e `slide-selection.css`): 992px, 768px, 576px e 386px, com redução progressiva da tipografia via `--font-multiplier`/`--font-size-multiplier-*`.

### Convenção de nesting com `&`

O CSS usa nesting nativo: regras relacionadas (pseudo-classes, modificadores e descendentes) são aninhadas com o operador `&` em vez de seletores irmãos planos. Exemplo real de `mosaic-style.css`:

```css
.img {
  width: 100%;
  height: 360px;
  border: 4px solid rgba(255, 255, 255, 0.15);
  border-radius: var(--border-item);
  overflow: hidden;

  & > img {
    object-fit: cover;
    object-position: center;
    width: 100%;
    height: 100%;
    transition: transform 0.3s ease-out;

    &:hover,
    &:focus {
      transform: scale(1.03);
    }
  }

  &::before {
    counter-increment: img-position;
    content: counter(img-position);
    /* selo de numeração no canto */
  }
}
```

## Convenções de conteúdo

- **Nomenclatura kebab-case:** os nomes de arquivo usam minúsculas com hífens. Slides: `slide-<tópico>.html`; documentos: `document-<tópico>.html`; CSS por slide: `slide-<tópico>.css` (correspondência direta com o HTML de mesmo nome). Exceção: `descrição.txt`, em português com acento.
- **Organização de imagens:** `assets/img/slides/<área>/<tópico>/`, onde `<área>` é uma das `se`, `lt`, `ld`, `st`, `issues`, `events`. Tópicos com séries temporais (caso de `lt/lt-maintenance/`) usam subpastas por segmento e data, por exemplo `lt/lt-maintenance/E0-E1/13-05-26/`. As imagens dentro de um tópico são numeradas (`ac-1.jpeg`, `cable-1.jpg`, `label-2.jpeg`, `1.jpeg`).
- **`descrição.txt`:** quando presente em um tópico, contém uma única linha de texto que descreve a atividade e é usada como legenda ou subtítulo (`h2`). Exemplo (`se/ac-repair/descrição.txt`): "Realização do reparo na condensadora dos ares condicionados AC-BT-01 e AC-BT-02 da sala do banco de baterias da Subestação SE-E5." Nem todos os tópicos possuem o arquivo (há 9 ao todo).
- **CSS por slide de mesmo nome:** quando um slide precisa de estilos próprios, o CSS recebe o mesmo nome do HTML (ex.: `slide-tag-replacement.css` ↔ `slide-tag-replacement.html`).
- **Timestamp em `update-info`:** a cada alteração, atualize o carimbo de data em `slides/index.html` no formato `DD-MM-AA (dia-da-semana, às XXhXX)` — por exemplo, `02-06-26 (terça-feira, às 16h15)`.
- **Snapshots imutáveis:** nunca edite arquivos sob `public/snapshots/`; eles são registros históricos congelados.

## Como executar localmente

O projeto precisa ser servido por HTTP — não funciona corretamente abrindo os arquivos via `file://`. A partir da **raiz** do projeto:

```powershell
# A partir da raiz do projeto (presentation/)
python -m http.server 8000
# Em seguida, abra no navegador:
start http://localhost:8000/apresentação.html
```

Por que HTTP e não `file://`:

- Os caminhos relativos (`../styles/`, `../assets/`, `./slides/`) não resolvem de forma confiável sob `file://`.
- Recursos embutidos via `<object>`/`<video>` (PDFs e vídeos) falham por restrições de segurança.
- As fontes externas do Google podem ser bloqueadas no contexto `file://`.

O servidor deve apontar para a **raiz** (`presentation/`), e não para `slides/`, pois as páginas de slide sobem um nível com `../` para alcançar `styles/`, `assets/` e a `apresentação.html`.

## Como adicionar um novo slide

1. **Copie um slide de fotos existente** (ex.: `slides/slide-ac-repair.html`) para `slides/slide-<tópico>.html`, usando kebab-case no `<tópico>`. Esse padrão já carrega `variables.css`, `slide-style.css` e `mosaic-style.css`, e inclui `header`/`breadcrumb`/`footer`. (Não use `slide-template.html` para isto — ele é o molde da grade de seleção, não de um slide de fotos.)
2. **Crie a pasta de imagens** em `assets/img/slides/<área>/<tópico>/` (área = `se`, `lt`, `ld`, `st`, `issues` ou `events`) e adicione as fotos numeradas (`<tópico>-1.jpeg`, ...). Opcionalmente crie um `descrição.txt` com a legenda/subtítulo.
3. **Defina o título e o ícone:** no `div.title-header-h1`, ajuste o `h1.title-h1` e o `span.section-icon`, escolhendo a classe apropriada (`icon-substation`, `icon-transmission`, `icon-distribution`, `icon-safety`, `icon-events`, `icon-obstacles` ou `icon-documents`).
4. **Monte o mosaico:** escolha o container (`.mosaic-container`, `.tri-column`, `.quad-column`, ...) e as classes de cada `.img` (`.img-default`, `.img-largest`, `.img-stretch`, posicionamento `.img-mid-*`) conforme o número de fotos, preenchendo `src`, `alt` e as legendas `<p class="obs obs-default">` (use `invisible` para ocultar).
5. **(Opcional) CSS dedicado:** se precisar de estilos próprios, crie `styles/slide-<tópico>.css` (mesmo nome do HTML) e referencie-o no `<head>` do slide.
6. **Vincule na grade:** adicione o item do novo slide na seção correta de `slides/index.html` (`section-safety`, `section-substation`, `section-transmission`, `section-distribution`, `section-events` ou `section-obstacles`).
7. **Atualize o timestamp:** ajuste o `update-info` em `slides/index.html` para o momento da alteração, no formato `DD-MM-AA (dia-da-semana, às XXhXX)`.
8. **Não toque nos snapshots:** a alteração é feita apenas na raiz; `public/snapshots/` permanece intacto.

## Acessibilidade

- **Skip-link:** toda página de conteúdo inicia com `<a class="skip-link" href="#main-content">Pular para o conteúdo</a>`, que aparece ao receber foco (`.skip-link:focus { top: 0; }`).
- **Idioma:** `<html lang="pt-BR">` em todas as páginas; vídeos incluem `<track kind="captions" srclang="pt-BR">`.
- **Imagens:** cada `<img>` possui atributo `alt` descritivo.
- **Ícones decorativos e regiões:** o `<object>` de PDF usa `aria-label`; os ícones de seção (`.section-icon`) são puramente visuais (`pointer-events: none`) e marcados como decorativos (`aria-hidden="true"`).
- **Foco visível:** `*:focus-visible { outline: 2px solid var(--color-green); outline-offset: 2px; }`.
- **Estrutura semântica:** uso de `main`, `header`, `nav.breadcrumb`, `figure`/`figcaption` e hierarquia de headings (`h1`→`h4`); legendas ocultas usam `.invisible` permanecendo no DOM.

## Git e contribuição

- **Repositório:** `github.com/eng-dvco/presentation`.
- **Branch:** `main`.
- **Remoto:** `origin` → `https://github.com/eng-dvco/presentation`.
- **`.gitignore`:** três linhas — `.documents` (documentos internos), `**/*template.*` (arquivos de template) e `/assets/media` (mídia pesada e PDFs embutidos) não são versionados.
- Não há configuração de build, CI/CD ou deploy no repositório; a publicação é manual.

Fluxo recomendado: edite sempre na raiz do projeto, mantenha o `update-info` de `slides/index.html` atualizado, preserve os snapshots e faça commits descritivos em `main`.

## Autoria

Material de apresentação da **CMT Engenharia**, no contexto do PISF (Contrato 26/2022-MDR).

© 2026 Eng. Daniel Carvalho.
