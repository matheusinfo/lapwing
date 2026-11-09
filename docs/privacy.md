<!-- docs-tree: docs/privacy.md | parent: docs/README.md -->
# Privacidade: onde ficam seus dados

> **Árvore:** [docs](README.md) › privacy
> **Resumo:** Tudo fica no seu navegador; só o mapa, o cálculo de caminhos e o Strava (opcional) usam a internet.
> **Código:** `src/data/db.ts`, `src/data/strava.ts`, `src/data/import.ts`, `src/data/strava-archive.ts`, `src/map/base.ts`, `src/screens/routes/route/router.ts`

## Em uma frase

O Lapwing **não tem servidor, não tem conta e não coleta nada**. Suas corridas, planos e metas ficam guardados **só no navegador** do aparelho que você está usando.

A exceção é opcional e fica a critério de quem publica o app: se o site também rodar o **servidor de sincronização** do Lapwing, seus dados (menos o login do Strava) ganham uma cópia nesse servidor, para aparecer em todos os seus aparelhos. O cartão **Sincronização** em **Ajustes** só aparece nesse caso. Ver [Sincronização](features/settings/sync.md).

## O que fica guardado no seu aparelho

| Onde | O que | Exemplos |
|---|---|---|
| **IndexedDB** (banco de dados do navegador, chamado `lapwing`) | Seus dados principais | corridas e seus pontos de GPS, planos e treinos, metas, configurações do atleta (FC máxima, zonas), conexão com o Strava |
| **localStorage** (chaves `lapwing:*`) | Preferências pequenas | idioma, tema, o percurso em edição e seu nome, o pace do editor, a posição do mapa, o plano de treino aberto, o período escolhido em Metas |
| **sessionStorage** | Dados temporários do login no Strava | um código de segurança que dura só até fechar a aba |

Não usamos cookies, ferramentas de estatística nem anúncios.

## O que sai do seu aparelho, e quando

| Serviço | Quando é usado | O que ele recebe |
|---|---|---|
| **[OpenFreeMap](https://openfreemap.org/)** | Sempre que um mapa aparece | Pedidos das "peças" do mapa da região que você está vendo. Como em qualquer site de mapas, isso revela a área visualizada. |
| **[BRouter](https://brouter.de/)** | Quando você adiciona ou move pontos em **Rotas** | As coordenadas de início e fim de cada trecho, para calcular o caminho. |
| **[Strava](https://www.strava.com/)** | Só se você conectar em **Ajustes** | O login autorizado por você e os pedidos para baixar suas atividades. |
| **Servidor de sincronização do próprio site** (`/api/sync/`) | Só se o site tiver um (cartão **Sincronização** em **Ajustes**) | Suas corridas, trajetos, planos, treinos, metas e configurações do atleta. O login do Strava não vai. |

Arquivos de corrida que você importa (GPX, FIT, TCX) são lidos **dentro do navegador** e não são enviados a ninguém.

O **arquivo `.zip` da sua conta do Strava** também é aberto só no navegador, sem subir para lugar nenhum. Ele traz muita coisa pessoal (fotos, perfil, seguidores, mensagens…), mas o Lapwing lê apenas a lista de atividades e os arquivos das corridas e caminhadas. O resto é ignorado e não fica guardado. Do que é importado, o app guarda o trajeto e os dados de cada atividade, o nome, a descrição (como anotação) e o número da atividade no Strava.

## Strava

- Para conectar, é preciso ser **assinante do Strava**: você cria um **app de API próprio** no Strava e informa o Client ID e o Client Secret no Lapwing.
- Essas chaves e os tokens de acesso ficam **só neste navegador**.
- O Lapwing pede apenas permissão de **leitura** das suas atividades.
- **Desconectar** revoga o acesso no Strava e apaga os tokens do aparelho. **Esquecer credenciais** apaga também o Client ID e o Client Secret.

Passo a passo em [features/settings/strava.md](features/settings/strava.md).

## Backups

- O arquivo de backup contém **todos os seus dados**. Guarde-o com o mesmo cuidado que você teria com fotos ou documentos pessoais.
- Por padrão, o backup **não inclui** as chaves e tokens do Strava. Você pode incluí-las marcando uma opção, se quiser levar a conexão para outro aparelho.

Detalhes em [features/settings/backup.md](features/settings/backup.md).

## Como apagar tudo

- **Uma corrida, plano, treino ou meta**: use o botão **Excluir** na tela correspondente.
- **Tudo de uma vez**: nas configurações do navegador, apague os **dados do site** do Lapwing. Faça um backup antes, se quiser guardar alguma coisa.
- **Acesso do Strava**: em **Ajustes**, clique em **Desconectar**. Você também pode revogar pelo site do Strava, em *Configurações → Meus aplicativos*.

## Cuidados

- Os dados ficam no **navegador**, então usar outro navegador, outro aparelho ou uma janela anônima mostra um Lapwing vazio.
- Alguns navegadores podem apagar dados de sites pouco usados. Fazer backup de vez em quando evita surpresas.

## Veja também

- [Serviços externos (detalhes técnicos)](architecture/external-services.md)
- [Armazenamento e migração](architecture/storage-and-migration.md)
- [Perguntas frequentes](faq.md)
