<!-- docs-tree: docs/features/coach.md | parent: docs/features/README.md -->
# Treinador — converse sobre seus treinos

> **Árvore:** [docs](../README.md) › [features](README.md) › coach
> **Resumo:** Um chat com o Claude (Anthropic) que lê suas corridas, seu plano, suas metas e suas zonas para responder dúvidas, avaliar treinos e simular provas. Precisa do servidor do treinador com uma chave de API.
> **Tela:** `#/coach` · **Código:** `src/screens/coach/`, `coach/` (servidor), `scripts/build-coach.mjs`

## Para que serve

O **Treinador** é um chat com um treinador de corrida que conhece os seus dados. Exemplos do que perguntar:

- “Como foi minha última semana de treinos?”
- “Simule minha prova na rota aberta no editor de rotas: tempo final, estratégia de ritmo e parciais.”
- “Estou no caminho certo para o objetivo do meu plano?”
- “Quais paces devo usar nos treinos leves, de limiar e intervalados?”
- “O que achou do longão de domingo? Minha frequência cardíaca subiu muito no fim?”

As respostas usam os seus números: volume das últimas semanas, corridas recentes, melhores esforços, previsões de prova e VDOT (de **Metas**), forma e alertas de carga, o plano ativo de **Treinos** e as zonas de **Ajustes**.

## Como usar

1. Clique em **Treinador** no menu.
2. Escolha uma das sugestões ou escreva sua pergunta. **Enter** envia; **Shift+Enter** pula linha.
3. A resposta aparece enquanto é escrita. Quando o treinador precisa de mais detalhes, ele consulta seus dados sozinho e mostra o que olhou (por exemplo **Consultou suas corridas**).
4. Para interromper, clique no botão quadrado (**Parar**). A pergunta volta para a caixa de texto.
5. **Nova conversa** apaga a conversa atual e faz o treinador ler seus dados de novo.

### Simular uma prova num percurso

1. Em **Rotas**, abra o GPX da prova (ou desenhe o percurso).
2. No **Treinador**, peça a simulação. Ele lê a rota aberta no editor, com a altimetria quilômetro a quilômetro, e cruza com seus treinos.

## Detalhes

- **O que o treinador recebe.** No começo de cada conversa o app monta um resumo dos seus dados (perfil e zonas, volume semanal das últimas 12 semanas, as 15 atividades mais recentes, melhores esforços e previsões dos últimos 90 dias, forma e alertas, plano ativo e metas). Esse resumo vale para a conversa inteira.
- **Consultas.** Durante a conversa ele pode pedir ao app: a lista de corridas de um período, os detalhes de uma corrida (parciais por km, FC, altimetria, tempo nas zonas), o plano de treino completo e a rota aberta em **Rotas**. Essas consultas rodam no seu navegador, com os dados mais recentes.
- **Onde fica a conversa.** Só neste navegador (`localStorage`, chave `lapwing-coach:conversation`). Ela não entra no backup nem na sincronização entre aparelhos.
- **Modelo.** Claude Opus 5.5, com raciocínio adaptativo e esforço médio. Se o modelo recusar uma pergunta por política de segurança, a API tenta outro modelo automaticamente.
- **Limites.** Até 20 perguntas por minuto (todas as abas e aparelhos juntos) e 3 respostas ao mesmo tempo. Conversas muito longas podem passar do limite: comece uma **Nova conversa**.
- **Saúde.** O treinador não é médico. Para dor que não passa, dor no peito, tontura ou lesão, ele orienta procurar um profissional.

## Privacidade

Cada pergunta envia ao **Claude (Anthropic)**, pelo servidor do treinador do próprio site, o resumo dos seus treinos, a conversa e o resultado das consultas (nomes, datas, distâncias, paces, FC e anotações das corridas consultadas, e a rota aberta no editor). Nada disso é enviado enquanto você não usa o Treinador. Ver [Privacidade](../privacy.md).

## Para quem publica o app

O treinador precisa do **servidor do treinador** (`coach/`), um pequeno servidor Node que guarda a chave da API da Anthropic. O navegador nunca vê a chave: ele fala só com `/api/coach/` do próprio site.

### Chave de API

1. Crie uma chave em [platform.claude.com](https://platform.claude.com/) (**API keys**).
2. Copie `.env.example` para `.env` na raiz do projeto e preencha `ANTHROPIC_API_KEY=`. O `.env` está no `.gitignore` e nunca vai para o repositório.

### Rodar

```bash
npm run coach                                    # gera coach/dist/server.mjs e sobe em 127.0.0.1:8001, lendo o .env
LAPWING_COACH_URL=http://127.0.0.1:8001 npm run dev   # o Vite repassa /api/coach/ para ele
```

Em produção, `npm run build:coach` gera um único arquivo, `coach/dist/server.mjs` (com o SDK da Anthropic embutido), que roda com `node` 20 ou mais novo, sem `node_modules`. Também há uma imagem:

```bash
docker build -f coach/Dockerfile -t lapwing-coach .
docker run -d --env-file .env -p 127.0.0.1:8001:8001 lapwing-coach
```

O servidor web do app deve repassar `/api/coach/` para ele **sem buffer** (a resposta chega em partes). No nginx:

```nginx
location /api/coach/ {
    proxy_pass http://127.0.0.1:8001;
    proxy_http_version 1.1;
    proxy_buffering off;
    client_max_body_size 8m;
    proxy_read_timeout 600s;
}
```

**Proteja o endereço.** O servidor não tem login: quem alcança `/api/coach/` gasta a sua chave. Deixe o site atrás de algo que autentique (por exemplo, Cloudflare Access), como no servidor de [sincronização](settings/sync.md).

### Variáveis

| Variável | Padrão | O que faz |
|---|---|---|
| `ANTHROPIC_API_KEY` | — | Chave da API. Sem ela, a tela mostra que o treinador não está configurado |
| `ANTHROPIC_AUTH_TOKEN` | — | Alternativa à chave, enviada como `Authorization: Bearer` |
| `ANTHROPIC_WORKSPACE_ID` | — | ID do workspace (`wrkspc_…`). Obrigatório para chaves que não pertencem a um workspace, como as chaves de usuário (`sk-ant-usr-…`); sem ele a API responde “not scoped to a workspace” |
| `COACH_MODEL` | `claude-opus-5-5` | Modelo |
| `COACH_EFFORT` | `medium` | Esforço do raciocínio: `low`, `medium`, `high`, `xhigh` ou `max` |
| `COACH_MAX_TOKENS` | `64000` | Tamanho máximo de cada resposta |
| `COACH_RATE_PER_MIN` | `20` | Perguntas por minuto aceitas |
| `COACH_FALLBACKS` | ligado | `off` desliga o modelo reserva em caso de recusa |
| `COACH_HOST` / `COACH_PORT` | `127.0.0.1` / `8001` | Endereço do servidor (`0.0.0.0` na imagem Docker) |

### API

| Endpoint | O que faz |
|---|---|
| `GET /api/coach/status` | `{ app: "lapwing-coach", configured, model }`; o app usa para saber se há treinador |
| `POST /api/coach/chat` | `{ messages, context, lang }` → linhas NDJSON: `{t:"text"}` (trecho da resposta), `{t:"tool"}` (consulta iniciada), `{t:"done", message}` (mensagem final) ou `{t:"error", code}` |
| `GET /healthz` | Verificação de saúde |

O navegador guarda a conversa e roda as consultas (`src/screens/coach/tools.ts`); o servidor fixa o modelo, as instruções e as ferramentas (`coach/prompt.ts`), aplica os limites e repassa a resposta em streaming (`coach/app.ts`). As instruções e o resumo ficam em cache na API durante a conversa, o que barateia as perguntas seguintes.

## Perguntas comuns

**A tela diz que o treinador não está configurado.** O site não tem o servidor do treinador, ou ele está sem `ANTHROPIC_API_KEY`. Veja [Para quem publica o app](#para-quem-publica-o-app).

**“A chave de API foi recusada.”** Confira a chave no `.env` do servidor e reinicie-o.

**“Esta chave de API não está presa a um workspace.”** Chaves de usuário (`sk-ant-usr-…`) agem em nome da pessoa e não de um workspace, então cada pedido precisa dizer qual workspace usar. Copie o ID (`wrkspc_…`) na página **Workspaces** do Console e coloque em `ANTHROPIC_WORKSPACE_ID` no `.env`. Outra saída é criar uma chave dentro de um workspace.

**Importei uma corrida no meio da conversa e ele não viu no resumo.** O resumo é do começo da conversa, mas o treinador consulta os dados atuais quando precisa. Peça para ele olhar a corrida, ou comece uma **Nova conversa**.

## Veja também

- [Metas — previsões de prova e alertas](insights.md)
- [Treinos — planos e treinos estruturados](training.md)
- [Rotas — abrir o GPX da prova](routes.md)
- [Zonas de treino](settings/zones.md)
- [Privacidade](../privacy.md)
