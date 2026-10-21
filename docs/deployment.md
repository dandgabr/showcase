# Publicação e domínio

## Fluxo automatizado

`.github/workflows/pages.yml` roda verificações em pull requests e publica somente a branch `main` (ou execução manual da própria `main`). O workflow gera `_site` com `scripts/prepare_pages.py`; o staging usa uma lista de arquivos permitidos. Pull requests não recebem segredos e não executam o job de deploy.

## GitHub Pages

1. No GitHub, confirme `dan.seg.br` em **Settings → Pages** da conta `dandgabr`, publicando o TXT de verificação solicitado pelo GitHub no Cloudflare e mantendo-o ativo.
2. Nas configurações de Pages deste repositório, escolha GitHub Actions como fonte e configure `coacus.dan.seg.br` como domínio personalizado.
3. No Cloudflare, confirme qual zona contém `dan.seg.br`. Se a zona for `dan.seg.br`, o campo Name do registro será `coacus`; se a zona for `seg.br`, use `coacus.dan`. Crie um CNAME apontando para `dandgabr.github.io`, com proxy desativado (**DNS only**). Antes, confira se há A, AAAA ou CNAME conflitantes para `coacus.dan.seg.br` e altere somente registros desse hostname. Preserve o TXT de verificação da conta e todos os outros hosts.
4. Confirme no painel que o registro está como **DNS only** e valide a propagação com `dig coacus.dan.seg.br CNAME +noall +answer` (resposta esperada: `dandgabr.github.io.`) e a verificação de propriedade com `dig TXT _github-pages-challenge-dandgabr.dan.seg.br +noall +answer`.
5. Em GitHub Pages, confirme que o domínio está salvo e aguarde o certificado ficar pronto. Se houver uma política CAA restritiva, ela precisa permitir `letsencrypt.org`. Ative **Enforce HTTPS** somente depois da emissão do certificado.
6. Valide `curl -I http://coacus.dan.seg.br` (redirecionamento para HTTPS) e `curl -I https://coacus.dan.seg.br` (conexão TLS sem erro), além do check de HTTPS nas configurações Pages. Propagação DNS e emissão do certificado podem levar algum tempo.

O TXT de verificação é específico da conta e deve ser copiado da interface GitHub. Não reutilize valores de exemplo.

## Manutenção

- Mantenha `LICENSE` sincronizado byte a byte com a licença do Coacus quando a licença upstream for atualizada.
- Revise o conteúdo de `THIRD-PARTY-NOTICES.md` ao adicionar bibliotecas, fontes ou recursos de terceiros.
- Em **Settings → Advanced Security**, habilite private vulnerability reporting e secret scanning/push protection quando disponíveis no plano do repositório.
- Dependabot acompanha versões de GitHub Actions; atualize pins de SHA após revisão.
- Mantenha a regra da branch `main` exigindo o check de verificação do workflow, bloqueando force push e exclusão.
- Confira o resultado do workflow e a URL HTTPS após cada publicação.
