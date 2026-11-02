<!-- docs-tree: docs/features/settings/backup.md | parent: docs/features/settings/README.md -->
# Backup — baixar e restaurar seus dados

> **Árvore:** [docs](../../README.md) › [features](../README.md) › [settings](README.md) › backup
> **Resumo:** Baixe um arquivo com todos os seus dados do Lapwing e restaure-o depois, neste ou em outro aparelho.
> **Tela:** `#/settings` (cartão **Backup e restauração**) · **Código:** `src/screens/settings/backup-section.ts`, `src/data/backup.ts`

## Para que serve

Seus dados ficam guardados **só neste navegador**. Se você limpar os dados do navegador, trocar de computador ou o navegador apagar o armazenamento, eles somem. O backup é um arquivo com tudo, para guardar em lugar seguro ou levar para outro aparelho.

O cartão mostra no topo quantos registros você tem de cada tipo de dado (corridas, trajetos GPS, planos, treinos, metas, configurações…).

## Como usar

### Baixar um backup

1. Abra **Ajustes** e vá ao cartão **Backup e restauração**.
2. Em **Baixar um backup**, escolha as opções:
   - **Incluir login do Strava (tokens e chave secreta)**: desligada por padrão. Leia o aviso antes de ligar.
   - **Compactar o arquivo (.json.gz)**: desligada por padrão. Deixa o arquivo bem menor. Só aparece se o navegador consegue compactar.
3. Clique em **Baixar backup**. Aparece **Backup baixado: *nome do arquivo***.

O arquivo se chama `lapwing-backup-AAAA-MM-DD.json` (ou `.json.gz` se compactado), com a data de hoje.

### Restaurar de um arquivo

1. Em **Restaurar de um arquivo**, clique em **Escolha um arquivo de backup** ou solte o arquivo ali (`.json` ou `.json.gz`).
2. Confira o **Conteúdo do backup**: data de criação, quantos registros de cada tipo e se o login do Strava está incluído.
3. Escolha como restaurar:
   - **Adicionar aos dados atuais** (padrão): mantém o que já existe. Registros iguais (mesmo identificador) são trocados pelos do arquivo.
   - **Substituir os dados atuais**: apaga os dados atuais de cada tipo que existe no arquivo e depois restaura o arquivo.
4. Clique em **Restaurar**.
5. Se escolheu substituir, confirme na janela **Substituir todos os dados?** com **Substituir e restaurar**. Isso não pode ser desfeito.
6. Ao final aparece **Restauração concluída**, com quantos registros voltaram e quantas **Preferências**.

## Detalhes

- **O que entra no backup:** todos os seus dados (corridas com seus trajetos, planos e treinos, metas, seus dados de frequência cardíaca, conexão com o Strava) e as preferências do app guardadas no navegador (por exemplo, tema, idioma, a rota em edição e o pace da tela **Rotas**).
- **Login do Strava fica de fora por padrão.** Sem a opção ligada, o arquivo leva só o Client ID; o Client Secret e os tokens não vão. Quem tiver um arquivo **com** login pode acessar sua conta do Strava, então só inclua se for guardá-lo em lugar privado.
- **Restaurar um backup sem login do Strava** não apaga o login que já existe neste aparelho (**Login do Strava não incluído; o login deste aparelho é mantido**). Num aparelho novo, digite o Client Secret e conecte de novo ([strava.md](strava.md)).
- **Substituir mexe só nos tipos que estão no arquivo.** Um tipo de dado que não está no backup fica como está.
- **Tudo ou nada.** A restauração é feita de uma vez só. Se der erro, nada é alterado (**A restauração falhou e nada foi alterado**).
- **Backups do Route Maker.** O Lapwing se chamava Route Maker antes. Backups feitos naquela época continuam sendo restaurados normalmente, inclusive as preferências.
- **Versões diferentes do app:**
  - Arquivo de uma versão mais nova, mas compatível: restaura, com o aviso de que alguns dados podem não aparecer certo.
  - Formato mais novo que este app entende: **Este backup foi feito por uma versão mais nova do Lapwing. Atualize o app para restaurá-lo.**
  - Dados desconhecidos no arquivo são ignorados, e o app avisa quais.
- **Outras mensagens:** **Este arquivo não é um backup do Lapwing.**, **Este arquivo de backup está danificado ou incompleto.**, **Este navegador não abre backups compactados. Use um arquivo .json sem compactação.**

## Dicas

- **Faça um backup antes de limpar os dados do navegador**, trocar de navegador ou reinstalar o sistema.
- Faça backups regulares, por exemplo uma vez por mês, e guarde em mais de um lugar (pendrive, nuvem).
- Para levar tudo para outro aparelho: baixe aqui, abra o Lapwing no outro aparelho e restaure com **Adicionar aos dados atuais**.
- Para deixar um aparelho idêntico ao backup, use **Substituir os dados atuais**.
- Para guardar só um plano de treino, use a exportação **Lapwing (.json)** na tela **Treinos** ([training.md](../training.md)).

## Perguntas comuns

**Posso abrir o backup em outro programa?**
É um arquivo JSON comum (texto). Dá para abrir num editor de texto, mas ele foi feito para ser restaurado no Lapwing.

**Restaurei com “Adicionar” e apareceram corridas repetidas?**
Não deveria: registros com o mesmo identificador são trocados, não duplicados. Corridas importadas de novo a partir do GPX ganham outro identificador, então podem coexistir com as do backup.

**O backup inclui as rotas que desenhei?**
Inclui a rota que está aberta no editor **Rotas**. Para guardar várias rotas, exporte cada uma em GPX.

## Veja também

- [Ajustes](README.md) · [Strava](strava.md) · [Aparência](appearance.md)
- [Privacidade](../../privacy.md)
- [Formato do arquivo de backup](../../reference/file-formats.md)
- [Armazenamento e migração Route Maker → Lapwing (técnico)](../../architecture/storage-and-migration.md)
- [Modelo de dados (técnico)](../../architecture/data-model.md)
