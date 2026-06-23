# Apresentação — Manutenção do PISF (CMT Engenharia)

Site estático, em formato de slides, das atividades de operação e manutenção de subestações (SE), linhas de transmissão (LT) e de distribuição (LD) dos Eixos Norte e Leste do Projeto de Integração do Rio São Francisco (PISF). Reúne registros fotográficos de campo, segurança do trabalho, eventos, óbices e cronogramas, organizados por área e tópico, além de um glossário técnico e snapshots históricos.

## Como executar

Não há build. Sirva por HTTP a partir da **raiz** `presentation/` — não funciona via `file://`, pois as páginas usam caminhos relativos:

```powershell
python -m http.server 8000
start http://localhost:8000/apresentação.html
```

## Estrutura

```text
presentation/
├── apresentação.html   # porta de entrada (landing)
├── slides/             # index.html (grade de conteúdo) + slide-*.html + moldes (*-template.html)
├── styles/             # CSS — tokens em variables.css (carregado primeiro)
├── scripts/            # JS — navegação, lightbox, cronograma
├── assets/             # imagens, ícones, logos e fontes
└── public/             # definitions/ (glossário) e snapshots/ (cópias congeladas, imutáveis)
```

## Princípios

- **Edição direta** — sem build, CI ou deploy; a publicação é manual e toda alteração é feita na raiz.
- **Navegação automática** — a barra lateral é derivada de `slides/index.html` por `scripts/slide-nav.js`; para incluir, remover ou recategorizar um slide, edite a grade em `index.html`.
- **Snapshots imutáveis** — nunca edite `public/snapshots/`; são cópias históricas congeladas.

## Autoria

Material da **CMT Engenharia** — PISF, Contrato 26/2022-MDR. Autoria do Eng. Daniel Carvalho.
Repositório: `github.com/eng-dvco/presentation`.
