<!-- docs-tree: docs/features/routes.md | parent: docs/features/README.md -->
# Rotas — criar percursos no mapa

> **Árvore:** [docs](../README.md) › [features](README.md) › routes
> **Resumo:** Desenhe um percurso de corrida clicando no mapa, veja distância, elevação e tempo estimado, e exporte como GPX.
> **Tela:** `#/routes` · **Código:** `src/screens/routes/`

## Para que serve

A tela **Rotas** é um editor de percursos. Você clica no mapa e o app liga os pontos seguindo ruas e caminhos. Serve para:

- descobrir quanto mede uma volta antes de sair para correr;
- planejar um treino longo com a distância certa;
- salvar o percurso como arquivo **GPX** (o formato de trajeto que relógios e apps como Strava e Garmin entendem).

É a tela que abre quando você entra no app.

## Como usar

1. Navegue no mapa até a sua região (arraste e use a roda do mouse ou dois dedos para aproximar).
2. **Clique no mapa** para pôr o primeiro ponto (a largada).
3. Clique de novo para pôr o próximo ponto. O app busca o caminho entre os dois (aparece **Buscando caminho…** no painel).
4. Continue clicando até terminar o percurso.
5. Para voltar ao ponto de partida, use o botão **Fechar circuito (voltar ao início)**.
6. Dê um nome à rota no campo **Nome da rota** (se ficar vazio, o nome é **Rota de corrida**).
7. Digite o seu **Pace** (ritmo, em minutos por quilômetro) para ver o **Tempo estimado**.
8. Clique em **Exportar GPX** para baixar o arquivo.

### Editar a rota

| Você quer… | Faça assim |
|---|---|
| Adicionar um ponto no fim | Clique no mapa |
| Mover um ponto | Arraste o ponto |
| Inserir um ponto no meio | Clique em cima da linha |
| Apagar um ponto | Botão direito no ponto (no celular: toque longo) |
| Deixar um trecho reto | Botão direito em cima da linha |
| Fazer o trecho voltar a seguir caminhos | Botão direito de novo na mesma linha |
| Desfazer / refazer | **Desfazer (Ctrl+Z)** / **Refazer (Ctrl+Y)** (também Ctrl+Shift+Z) |
| Correr no sentido contrário | **Inverter sentido** |
| Começar do zero | **Limpar rota** |

### Abrir um GPX que você já tem

- Clique em **Abrir GPX** e escolha o arquivo, ou
- arraste o arquivo para cima do mapa (aparece **Solte um arquivo GPX para abri-lo**).

O mapa se ajusta ao percurso e aparece o aviso “*nome* aberto (*distância*)”.

## Detalhes

- **Como o caminho é escolhido.** Cada trecho novo entre dois pontos é pedido ao serviço gratuito **BRouter**, no modo “mais curto” (`shortest`), que segue ruas e trilhas sem dar voltas por caminhos “mais bonitos”.
- **Linha reta automática.** O trecho fica reto quando:
  - o caminho pelas ruas é no máximo **12% mais longo** que a linha reta (quase a mesma coisa), ou
  - os dois pontos estão a menos de **30 m** um do outro.
- **Encaixe no caminho.** Se você clicar perto de uma rua (até **50 m**), o ponto “pula” para cima dela. Se clicar mais longe, o ponto fica onde você clicou e a linha é estendida até ele.
- **Trecho reto forçado.** Com o botão direito na linha, o trecho fica reto e continua reto mesmo se você mover os pontos. Útil para pista de atletismo, praia, parque aberto.
- **Quando o caminho falha.** Se o BRouter não responder em 15 segundos ou não achar caminho, o app usa uma linha reta e avisa: **Não foi possível achar um caminho ali, então foi usada uma linha reta.**
- **Inserir no meio não refaz o caminho.** Clicar na linha divide o trecho naquele ponto, sem buscar o caminho de novo.
- **Mover um ponto refaz o caminho** dos dois trechos ligados a ele (menos os trechos retos forçados).
- **GPX aberto fica como está.** Um percurso aberto de arquivo mantém o desenho exato do arquivo. Pontos que você adicionar depois seguem as regras normais.
- **Circuito fechado.** Depois de **Fechar circuito**, a largada e a chegada viram um único marcador. Mover esse marcador move as duas pontas.
- **Desfazer** guarda até 100 passos.
- **Botões desligados.** **Exportar GPX**, **Inverter sentido** e **Fechar circuito** só funcionam com pelo menos 2 pontos.
- **Estatísticas.** **Distância** em km; **Elevação** mostra quanto o percurso sobe (↑) e desce (↓), em metros, quando há dados de altitude; **Tempo estimado** = distância × pace.
- **Pace.** Formato `m:ss` (por exemplo `5:30`). O padrão é `6:00`. Se o valor for inválido, o campo fica marcado e o tempo some.
- **Arquivo exportado.** GPX 1.1 com o nome da rota. O nome do arquivo vem do nome da rota, sem acentos (por exemplo, “Volta no Parque” vira `volta-no-parque.gpx`).
- **Tudo fica salvo no navegador.** A rota, o nome, o pace e a posição do mapa são guardados automaticamente. Se você fechar a aba e voltar, a rota continua lá.
- **Mapa.** O mapa vem do OpenFreeMap (baseado no OpenStreetMap). No tema escuro, o mapa também fica escuro.

## Dicas

- Para medir uma volta no quarteirão, clique em 3 ou 4 esquinas e use **Fechar circuito**.
- Ponha pontos em todas as curvas importantes. Assim o caminho não “inventa” um atalho.
- Errou? Ctrl+Z desfaz na hora. **Limpar rota** não pede confirmação, mas também pode ser desfeito com Ctrl+Z.
- O GPX exportado pode ser enviado para o relógio (pelo app do fabricante) para seguir o percurso durante a corrida.

## Perguntas comuns

**Preciso de internet?**
Sim, para carregar o mapa e buscar os caminhos. Sem internet, os trechos ficam retos.

**Por que um trecho ficou reto se existe uma rua ali?**
Porque o caminho pela rua era quase igual à linha reta (até 12% mais longo) ou os pontos estavam muito perto. A distância quase não muda. Se o BRouter falhou, aparece um aviso.

**A rota some quando eu fecho o navegador?**
Não. Ela fica salva neste navegador. Mas ela some se você limpar os dados do site. Exporte o GPX para guardar.

**Posso salvar várias rotas?**
O editor guarda uma rota de cada vez. Para guardar outras, exporte cada uma em GPX e abra de novo quando quiser.

**Posso analisar a rota como uma corrida?**
Não aqui. Rotas desenhadas não têm horário. Para ver relatórios, importe uma corrida gravada em **Análise** ([analysis.md](analysis.md)).

## Veja também

- [Análise — importar corridas](analysis.md)
- [Primeiros passos](../getting-started/first-steps.md)
- [Atalhos do editor de rotas](../reference/commands.md)
- [Formato GPX](../reference/file-formats.md)
- [Motor de rotas (técnico)](../architecture/routing-engine.md)
- [Serviços externos: OpenFreeMap e BRouter](../architecture/external-services.md)
