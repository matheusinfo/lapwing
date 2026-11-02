<!-- docs-tree: docs/features/settings/strava.md | parent: docs/features/settings/README.md -->
# Strava — conectar e sincronizar

> **Árvore:** [docs](../../README.md) › [features](../README.md) › [settings](README.md) › strava
> **Resumo:** Passo a passo para ligar o Lapwing à sua conta do Strava usando o seu próprio app de API, sincronizar corridas e resolver problemas. **Exige assinatura paga do Strava.**
> **Tela:** `#/settings` (cartão **Strava**) · **Código:** `src/screens/settings/strava-section.ts`, `src/data/strava.ts`

## Para que serve

Trazer suas corridas do Strava direto para o Lapwing, sem exportar arquivos um por um. É **opcional**: tudo no app funciona também com arquivos importados em **Análise**, inclusive o arquivo completo da sua conta do Strava, que não exige assinatura ([analysis.md](../analysis.md#trazer-todo-o-histórico-do-strava-arquivo-zip)).

Como o Lapwing não tem servidor, **você cria o seu próprio “app de API” no Strava** (leva uns 5 minutos). Ele dá ao Lapwing uma chave para conversar com o Strava em seu nome, direto do seu navegador.

## Requisito: assinatura do Strava

> **Para usar a sincronização com o Strava, é preciso ser assinante do Strava.** Desde junho de 2026, o Strava só permite criar e usar apps de API para quem tem uma assinatura paga. Sem assinatura, não é possível criar o app de API do passo a passo abaixo.

- O Lapwing não cobra nada e não tem ligação com o Strava; a assinatura é feita no próprio Strava.
- O token de acesso que aparece na página de API do Strava não serve sozinho: ele vem de um app de API (que exige assinatura), permite só leitura básica do perfil, não lista atividades e expira em 6 horas.
- No app, o cartão **Strava** mostra o selo **Assinantes do Strava** e, enquanto não há conexão, o aviso **Exige assinatura do Strava**, que indica o arquivo completo da conta e tem um link para soltar o `.zip` em **Análise**.
- **Não é assinante?** Você pode trazer suas corridas mesmo assim, sem API:
  1. **Todas de uma vez (recomendado):** no Strava, **Configurações → Minha conta → Baixar ou excluir sua conta → Solicitar arquivo**. Quando o e-mail com o link chegar (leva algumas horas), solte o `.zip` inteiro em **Análise**, sem descompactar. Veja [Trazer todo o histórico do Strava](../analysis.md#trazer-todo-o-histórico-do-strava-arquivo-zip).
  2. **Uma de cada vez:** abra a atividade no strava.com, clique em **⋯**, escolha **Exportar GPX** e solte o arquivo em **Análise**.
- As regras de acesso à API são definidas pelo Strava e podem mudar. Confira a [documentação para desenvolvedores do Strava](https://developers.strava.com/docs/getting-started/).

## Como usar

### Configuração (uma vez)

Antes de começar, confirme que sua conta do Strava tem assinatura ativa ([Requisito](#requisito-assinatura-do-strava)).

1. Abra **Ajustes** e vá ao cartão **Strava**. Abra **Configuração (uma vez)** se estiver fechado.
2. Entre em [strava.com/settings/api](https://www.strava.com/settings/api) (logado na sua conta) e crie um aplicativo de API. Qualquer nome e site servem (por exemplo, “Lapwing pessoal” e o endereço onde você abre o app).
3. No campo **Authorization Callback Domain**, coloque o domínio que o Lapwing mostra no passo 2 da tela. É o endereço onde você abre o app, sem `http://` e sem caminho: por exemplo `localhost` no seu computador, ou `seunome.github.io` se o app estiver publicado.
4. Salve. O Strava mostra o **Client ID** (um número) e o **Client Secret** (uma chave longa).
5. Copie os dois para os campos **Client ID** e **Client Secret** do Lapwing.
6. Clique em **Conectar com o Strava**.
7. Na página do Strava, autorize. **Deixe marcada** a opção de ver os dados das suas atividades.
8. O Strava devolve você ao Lapwing (aparece **Conectando ao Strava…**) e o cartão passa a mostrar **Conectado como *seu nome***.

### Sincronizar

1. Em **Importar**, escolha o intervalo:
   - **Desde a última sincronização** (na primeira vez, equivale aos últimos 30 dias)
   - **Últimos 30 dias**
   - **Últimos 12 meses**
   - **Tudo**
2. Clique em **Sincronizar agora**.
3. Acompanhe o progresso: **Procurando corridas novas… (*N* atividades encontradas)** e depois **Importando *x* / *y***. Se quiser parar, clique em **Cancelar**.
4. No fim, o **Resultado da sincronização** lista as corridas importadas e os números: importadas, que **já estavam no app**, **sem GPS (ignoradas)**, **com falha** e **outras atividades ignoradas**.

### Desconectar ou apagar as credenciais

- **Desconectar** (pede confirmação: **Desconectar do Strava**): revoga o acesso no Strava e apaga os tokens deste navegador. As corridas já importadas continuam no app. O Client ID e o Client Secret ficam guardados, para reconectar com um clique.
- **Esquecer credenciais** (aparece no formulário de conexão quando há credenciais salvas): apaga também o Client ID e o Client Secret deste navegador. Pede confirmação antes, porque não dá para desfazer.

## Detalhes

- **O que é importado:** atividades de corrida (**Run** e corrida virtual) viram **Corrida**, **TrailRun** vira **Trail**, **Walk** e **Hike** viram **Caminhada**. Outros esportes (bike, natação…) são ignorados.
- **Sem GPS:** atividades manuais ou de esteira, sem trajeto, são puladas.
- **Dados trazidos:** trajeto, horários, altitude, frequência cardíaca, cadência, temperatura e potência, quando existem. Depois disso, a corrida é igual a uma importada por arquivo.
- **Ordem:** da mais antiga para a mais nova.
- **Repetidas:** uma atividade é pulada se já existe no app com o mesmo número do Strava, ou se há uma corrida que começou até 60 segundos de diferença com distância parecida (até 50 m ou 2%, o que for maior). Assim, corridas já importadas por arquivo não se duplicam. As que vieram do `.zip` do Strava guardam o número do Strava e são reconhecidas na hora.
- **Retomada:** o app anota o progresso a cada atividade. Se você cancelar, perder a conexão ou bater no limite, o que já entrou fica, e **Desde a última sincronização** continua de onde parou. Uma atividade que falhou é tentada de novo na próxima vez.
- **Intervalo padrão:** **Últimos 30 dias** antes da primeira sincronização; depois, **Desde a última sincronização**.
- **Limite de uso do Strava:** o Strava limita quantos pedidos cada app de API pode fazer a cada 15 minutos e por dia. Cada corrida importada usa pelo menos um pedido, e a lista usa um pedido a cada 100 atividades. Quando o Strava informa, o app mostra **Uso da API do Strava: *x* / *limite* em 15 min, *y* / *limite* hoje.** Importar **Tudo** de uma vez pode bater no limite: espere e sincronize de novo.
- **Tokens** (as “senhas temporárias” do Strava) são renovados sozinhos quando expiram.
- **Onde fica cada coisa:** Client ID, Client Secret, tokens, nome do atleta e data da última sincronização ficam **só neste navegador, neste dispositivo**. Não existe servidor do Lapwing: o navegador fala direto com o Strava.
- **Backup:** por padrão, o backup **não** leva o Client Secret nem os tokens. Ao restaurar um backup assim em outro aparelho, digite o Client Secret de novo e conecte ([backup.md](backup.md)).
- **Outro aparelho ou outro endereço:** cada navegador conecta separadamente. Se você abrir o app em outro domínio, acrescente esse domínio no app de API do Strava (o campo aceita um domínio; troque quando precisar).

## Dicas

- Na primeira vez, use **Últimos 12 meses** ou **Tudo**; depois, **Desde a última sincronização** basta.
- Muitas corridas antigas? Uma alternativa é pedir o arquivo completo da sua conta do Strava e soltar o `.zip` em **Análise** (não gasta o limite da API). Depois, use a sincronização só para as corridas novas.
- Guarde o Client Secret num gerenciador de senhas. Você vai precisar dele em outro aparelho.

## Perguntas comuns e problemas

| Mensagem | O que fazer |
|---|---|
| **Preencha o Client ID e o Client Secret primeiro.** | Copie os dois do seu app de API no Strava. |
| **O acesso não foi autorizado no Strava.** | Você recusou na página do Strava. Clique em **Conectar com o Strava** e autorize. |
| **Não foi possível verificar o login no Strava. Tente conectar de novo.** | O retorno do Strava não bateu com o login iniciado aqui (por exemplo, outra aba). Conecte de novo nesta aba. |
| **O Strava recusou o Client ID ou o Client Secret.** | Confira se copiou os valores certos, sem espaços. |
| **O Strava não liberou acesso às suas atividades.** | Na autorização, a opção de ver atividades ficou desmarcada. Conecte de novo e deixe marcada. |
| **O acesso ao Strava expirou ou foi revogado. Conecte de novo.** | Você revogou o acesso no site do Strava, ou os tokens não valem mais. Conecte de novo. |
| **O limite de requisições do Strava foi atingido.** | Espere uns 15 minutos (ou até o dia seguinte, se foi o limite diário) e sincronize; ele continua de onde parou. |
| **Não foi possível acessar o Strava.** | Verifique a internet. |
| **O Strava retornou um erro.** | Problema do lado do Strava. Tente mais tarde. |

**O Strava diz que o “redirect_uri” é inválido.**
O **Authorization Callback Domain** do seu app de API não é o domínio onde o Lapwing está aberto. Corrija no Strava e tente de novo.

**Desconectei. Minhas corridas somem?**
Não. Só a ligação com o Strava é desfeita.

**Alguém mais vê meu Client Secret?**
Não, a menos que você compartilhe um backup feito com **Incluir login do Strava**.

## Veja também

- [Ajustes](README.md) · [Backup](backup.md) · [Aparência](appearance.md)
- [Análise — importar arquivos e o `.zip` do Strava](../analysis.md)
- [Privacidade](../../privacy.md)
- [Serviços externos: Strava (técnico)](../../architecture/external-services.md)
- [Modelo de dados (técnico)](../../architecture/data-model.md)
