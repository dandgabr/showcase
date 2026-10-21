# Coacus Showcase

Uma página estática e interativa que apresenta capacidades, catálogo e formas de trabalho do [Coacus](https://github.com/dandgabr/Coacus). O showcase combina uma narrativa solar e lunar com demonstrações de interface, movimento, visualização e pesquisa.

**Site:** <https://coacus.dan.seg.br>

**Código:** <https://github.com/dandgabr/showcase>

## Como funciona

O site não usa backend. HTML, CSS e módulos JavaScript são publicados no GitHub Pages. Ao abrir o Atlas, o navegador busca `catalog/catalog.json` diretamente no repositório Coacus e mantém uma cópia no IndexedDB deste dispositivo por cinco minutos. Se a rede falhar, uma cópia anterior pode ser usada por até sete dias. A busca e os filtros são executados localmente.

O catálogo é dado público do Coacus. Esta página não executa agentes, não instala skills e não envia consultas a um serviço próprio.

## Desenvolvimento local

Requer Python 3 e Node.js 22 ou superior; o projeto não tem dependências de runtime npm.

```sh
python3 -m http.server 4173 --bind 127.0.0.1
```

Abra <http://127.0.0.1:4173>.

## Verificações

```sh
node --test tests/*.test.mjs
PYTHONDONTWRITEBYTECODE=1 python3 -m unittest discover -s tests -v
python3 assets/validate-hero.py
python3 scripts/prepare_pages.py _site
```

`scripts/prepare_pages.py` cria uma pasta de publicação com uma lista explícita de arquivos do site. Scripts de validação, testes, documentação interna e artefatos locais não entram no deploy.

## Estrutura

- `index.html`, `styles.css`, `src/`: interface, estilos e módulos do navegador.
- `assets/lunar-solarpunk-hero.svg`: ilustração vetorial principal.
- `scripts/prepare_pages.py`: staging de arquivos permitidos para Pages.
- `tests/`: testes de módulos, artefato de deploy e comportamento visual.
- `docs/architecture.md`: arquitetura e dados.
- `docs/deployment.md`: publicação, domínio e manutenção.
- `.github/workflows/pages.yml`: validação e publicação pelo GitHub Actions.

## Publicação

Pull requests executam as verificações sem credenciais. A publicação ocorre apenas na branch `main` ou por execução manual confiável dessa branch. Veja [docs/deployment.md](docs/deployment.md) para o fluxo GitHub Pages, DNS no Cloudflare e verificações operacionais.

## Licença e créditos

Este repositório usa GNU Affero General Public License v3.0 (AGPL-3.0), conforme o repositório Coacus. Consulte [LICENSE](LICENSE) e [THIRD-PARTY-NOTICES.md](THIRD-PARTY-NOTICES.md). Copyright do showcase: © 2026 Daniel Gonçalves Araujo. O texto de licença completo e os direitos dos autores originais permanecem em `LICENSE`.

## Segurança

Não coloque credenciais, tokens ou dados privados neste repositório. Consulte [SECURITY.md](SECURITY.md) para reportar vulnerabilidades.
