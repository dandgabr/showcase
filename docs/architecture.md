# Arquitetura

## Visão geral

O showcase é um site estático, sem servidor de aplicação e sem dependências de runtime. GitHub Pages serve os arquivos; os módulos ES do navegador controlam a interface, acessibilidade, idioma, movimento, narrativa e catálogo.

## Catálogo remoto e cache

O navegador obtém o catálogo publicado em `dandgabr/Coacus`, sem copiar uma versão ao repositório showcase. `src/catalog-cache.mjs` usa IndexedDB com TTL de cinco minutos e retenção stale de até sete dias para permitir uma leitura anterior durante falhas de rede. O cache pertence ao perfil do navegador/dispositivo; não é compartilhado entre usuários. A busca, paginação e filtragem rodam localmente.

O catálogo é conteúdo público. O site não transmite termos de busca a um backend. A disponibilidade e o formato do catálogo dependem do repositório Coacus e da conectividade do visitante.

## Componentes

- `index.html`: conteúdo semântico e pontos de montagem da interface.
- `styles.css`: tokens, layout, temas solar/lunar, responsividade e movimento com suporte a movimento reduzido.
- `src/i18n.mjs`: idioma automático via preferências do navegador, português e inglês, com persistência local da escolha.
- `src/main.mjs`: inicialização, eventos de interface e integrações dos módulos.
- `src/site-core.mjs`: lógica de catálogo, busca, filtros e apresentação.
- `assets/lunar-solarpunk-hero.svg`: ilustração do showcase.
- `scripts/prepare_pages.py`: allowlist explícita do artefato publicado.

## Segurança e privacidade

Não existem segredos de deploy nem backend. O workflow de pull request recebe somente permissão de leitura. A publicação confiável usa permissões mínimas do GitHub Pages e OIDC. Dados de preferência e cache permanecem no navegador. O catálogo pode mudar independentemente deste repositório.
