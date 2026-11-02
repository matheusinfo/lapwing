<!-- docs-tree: docs/getting-started/install-and-run.md | parent: docs/getting-started/README.md -->
# Instalar e rodar

> **Árvore:** [docs](../README.md) › [getting-started](README.md) › install-and-run
> **Resumo:** Do zero até o Lapwing aberto no navegador, e como publicar a versão final num site.
> **Código:** `package.json`, `vite.config.ts`, `index.html`

## Do que você precisa

- Um computador com **Windows, macOS ou Linux**.
- O **[Node.js](https://nodejs.org/)** na versão **20.19 ou mais nova**, ou **22.12 ou mais nova**. A versão "LTS" do site oficial serve.
- Um navegador atual: Chrome, Edge, Firefox ou Safari.

Para conferir a versão do Node, abra o terminal e digite:

```bash
node --version
```

## Rodar no seu computador

Dentro da pasta do projeto:

```bash
npm install     # baixa as dependências (só na primeira vez)
npm run dev     # inicia o app
```

O terminal mostra um endereço, normalmente **http://localhost:5173**. Abra esse endereço no navegador. Enquanto o comando estiver rodando, toda mudança no código aparece na hora.

Para parar, volte ao terminal e aperte **Ctrl + C**.

## Gerar a versão final

```bash
npm run build     # confere os tipos, roda as verificações e gera a pasta dist/
npm run preview   # abre a versão final localmente, para conferir
```

A pasta **`dist/`** contém o app completo: só arquivos estáticos (HTML, CSS, JavaScript). Não precisa de servidor especial nem de banco de dados.

## Publicar num site

Qualquer hospedagem de site estático serve: GitHub Pages, Netlify, Cloudflare Pages, Vercel ou o servidor web que você já tem. Basta enviar o conteúdo de `dist/`.

Tem um servidor com Docker? Um `docker compose up -d --build` na pasta do projeto já sobe o app pronto, sem instalar o Node. Veja [Rodar com Docker](docker.md).

Bom saber:

- O app usa endereços com `#` (como `#/history`), então **não é preciso** configurar redirecionamentos no servidor.
- O build assume que o app fica na **raiz** do domínio (`/`). Para publicar numa subpasta (por exemplo, `usuario.github.io/lapwing/`), ajuste a opção `base` no `vite.config.ts`.
- Se for usar o **Strava** (exige assinatura do Strava), cadastre o domínio do site no app de API do Strava. O passo a passo está em [features/settings/strava.md](../features/settings/strava.md).
- Use **HTTPS** no site publicado. Navegadores restringem alguns recursos em páginas sem HTTPS.

## Verificar se está tudo certo

```bash
npm test            # roda todos os testes automáticos
npm run typecheck   # confere os tipos do TypeScript
```

Se os dois terminarem sem erros, está tudo funcionando.

## Problemas comuns

| Sintoma | O que fazer |
|---|---|
| `npm: command not found` | O Node não está instalado ou o terminal precisa ser reaberto depois da instalação. |
| Erro dizendo que a versão do Node não é suportada | Atualize o Node para 20.19+ ou 22.12+. |
| A porta 5173 já está em uso | O Vite escolhe outra porta sozinho; use o endereço que aparecer no terminal. |
| O mapa fica em branco | O mapa precisa de internet para carregar. Confira a conexão. |

## Veja também

- [Rodar com Docker](docker.md)
- [Primeiros passos](first-steps.md)
- [Comandos](../reference/commands.md)
- [Ambiente de desenvolvimento](../development/setup.md)
