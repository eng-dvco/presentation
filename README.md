# Apresentação — Manutenção do PISF (CMT Engenharia)

Site estático, em formato de slides, que apresenta as atividades de operação, manutenção e conservação de subestações (SE), Linhas de Transmissão (LT) e de Distribuição (LD) dos Eixos Norte e Leste do Projeto de Integração do Rio São Francisco (PISF) — Contrato 26/2022-MDR. Reúne registros fotográficos de campo, segurança do trabalho, eventos e óbices, organizados por área e tópico, além de um glossário técnico e um histórico de versões congeladas (snapshots). Material da CMT Engenharia, de autoria do Eng. Daniel Carvalho.

## Estrutura de diretórios

```text
presentation/
├── apresentação.html        # landing (porta de entrada)
├── assets/                  # fonts, icons, logos, media e img/ (banner, hero, slides/<área>/…)
├── public/
│   ├── definitions/         # glossário técnico
│   └── snapshots/           # cópias congeladas do site (snapshot-*/) — imutáveis
├── scripts/                 # JS (navegação, lightbox, cronograma, seleção)
├── slides/
│   ├── index.html           # conteúdo: grade de seções + slides
│   ├── selection.html       # histórico de versões/snapshots
│   ├── *-template.html      # moldes (fotos, documento, vídeo) — não versionados
│   └── slide-*.html         # um arquivo por slide de conteúdo
└── styles/                  # CSS (tokens + base + mosaico + seleção + específicos)
```

## Como executar localmente

Sirva por HTTP a partir da **raiz** (`presentation/`) — não funciona via `file://` (caminhos relativos, `<object>`/`<video>` e fontes externas falham).

```powershell
python -m http.server 8000
start http://localhost:8000/apresentação.html
```

As páginas de slide sobem um nível (`../`) para alcançar `styles/`, `assets/` e a landing; por isso o servidor deve apontar para a raiz, não para `slides/`.

## Navegação

`apresentação.html` (landing) → `slides/selection.html` (histórico) → `slides/index.html` (conteúdo) → `slides/slide-*.html` (cada slide). Cada slide é uma página própria: a logo leva ao índice e o breadcrumb à landing/conteúdo.

A navegação lateral entre seções e itens é **derivada automaticamente de `slides/index.html`** por `scripts/slide-nav.js` — para incluir, remover ou recategorizar um slide na navegação, basta editar a grade em `index.html`. (Os atributos `data-prev`/`data-next` nos slides são legados e não são lidos.)

## Tipos de página

Todas as páginas compartilham a mesma carcaça (head com CSS/fontes; `skip-link`, `header` com logo, `nav.breadcrumb`, `content-wrapper`, `footer`). Há três moldes de conteúdo em `slides/`:

- **Fotos** — qualquer `slide-*.html`; usa `mosaic-style.css`.
- **Documento** — `document-template.html`; PDF embutido via `<object>`.
- **Vídeo** — `video-template.html`; `<video>` com legendas.
- **Linha do tempo** — `timeline-template.html`; cronograma de atividades com `slide-tl.css` (filtros e alternância cronograma/tabela).

`slide-template.html` é o molde da **grade de seleção** (não um slide de fotos).

## Sistema de mosaico

Galerias usam `styles/mosaic-style.css`. O `.mosaic-container` é um grid de 2 colunas; modificadores ajustam:

- **Colunas do container:** `.uni-column`, `.tri-column`, `.quad-column`.
- **Largura/quebra por foto:** `.img-duo-column`, `.img-tri-column`, `.img-quad-column`.
- **Altura:** `.img-stretch` (mais alta), `.img-largest` (linha inteira).
- **Enquadramento:** `.img-contain`, `.img-fill`, `.img-mid-*` (`object-fit`/`object-position`).

Cada foto traz uma legenda `<p class="obs">`: use `invisible` para mantê-la no DOM sem exibir, e `obs-done`/`obs-pending` para marcar status (verde/vermelho).

## Convenções

- **Nomes em kebab-case:** `slide-<tópico>.html`; o CSS específico de um slide usa o mesmo nome (`slide-<tópico>.css`). Exceção: `descrição.txt` (com acento).
- **Imagens:** `assets/img/slides/<área>/<tópico>/`, com `<área>` ∈ `se`, `lt`, `ld`, `st`, `issues`, `events`; fotos numeradas (`<tópico>-1.jpeg`, …). Séries temporais usam subpastas por segmento/data.
- **`descrição.txt`:** quando presente numa pasta de tópico, descreve a atividade e serve de base para legendas/subtítulos; ao renumerar imagens, mantenha-o coerente com os nomes dos arquivos.
- **Design tokens:** cores, tipografia, bordas e espaçamentos ficam em `styles/variables.css`, carregado primeiro em todas as páginas.
- **CSS com nesting nativo:** aninhe pseudo-classes, modificadores e descendentes com o operador `&`, em vez de seletores irmãos planos.
- **Timestamp:** a cada alteração no conteúdo, atualize o `update-info` em `slides/index.html` no formato `DD-MM-AA (dia-da-semana, às XXhXX)`.
- **Snapshots imutáveis:** nunca edite arquivos sob `public/snapshots/` — são cópias históricas congeladas; toda alteração é feita apenas na raiz.

## Como adicionar um slide

1. Copie um slide de fotos existente para `slides/slide-<tópico>.html` (não use `slide-template.html`).
2. Crie `assets/img/slides/<área>/<tópico>/` com as fotos numeradas (e, opcionalmente, `descrição.txt`).
3. Ajuste o `h1.title-h1` e a classe do `span.section-icon` (`icon-safety`, `icon-substation`, `icon-transmission`, `icon-distribution`, `icon-events`, `icon-obstacles`, `icon-documents`…).
4. Monte o mosaico (container + classes `.img-*`), preenchendo `src`, `alt` e as legendas `obs`.
5. (Opcional) crie `styles/slide-<tópico>.css` e referencie no `<head>`.
6. Adicione o item na seção correta da grade em `slides/index.html` — isso já atualiza a navegação.
7. Atualize o `update-info`. Não toque em `public/snapshots/`.

## Acessibilidade

`<html lang="pt-BR">`; skip-link em todas as páginas; `alt` descritivo nas imagens; ícones decorativos com `aria-hidden`; foco visível (`:focus-visible`); estrutura semântica (`main`, `header`, `nav`, hierarquia de headings); vídeos com `<track kind="captions">`.

## Git

Repositório `github.com/eng-dvco/presentation` (branch `main`). O `.gitignore` exclui `.documents`, `**/*template.*` e `/assets/media`. Não há build/CI/deploy — a publicação é manual. Edite sempre na raiz, mantenha o `update-info` atualizado e preserve os snapshots.

## Autoria

Material da **CMT Engenharia** — PISF, Contrato 26/2022-MDR. © 2026 Eng. Daniel Carvalho.
