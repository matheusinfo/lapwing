<!-- docs-tree: docs/features/analysis.md | parent: docs/features/README.md -->
# Análise — importar corridas e ler o relatório

> **Árvore:** [docs](../README.md) › [features](README.md) › analysis
> **Resumo:** Importe arquivos GPX, FIT ou TCX (também `.gz`) de qualquer relógio, ou o arquivo `.zip` completo exportado do Strava, e veja um relatório completo de cada corrida.
> **Tela:** `#/activity` (importar e listar) e `#/activity/<id>` (relatório) · **Código:** `src/screens/activity/`, `src/data/import.ts`, `src/data/strava-archive.ts`

## Para que serve

A tela **Análise** (título **Analisar corrida**) tem duas partes:

- **Importar**: você solta arquivos de atividade (GPX, FIT ou TCX) ou o arquivo completo exportado do Strava, e eles viram corridas salvas no app.
- **Relatório**: para cada corrida, o app mostra números, mapa colorido, gráficos, parciais por km, zonas de frequência cardíaca, carga de treino e um espaço para anotações.

As corridas importadas aqui alimentam todas as outras telas: **Treinos**, **Histórico** e **Metas**.

## Como usar

### Importar corridas

1. Abra **Análise** no menu.
2. Arraste os arquivos para a área **Solte arquivos de atividade aqui** (pode soltar em qualquer lugar da página), ou clique nela para escolher. Dá para selecionar vários de uma vez. O app aceita:
   - **GPX**, **FIT** e **TCX**, de qualquer relógio ou app (Strava, Garmin, Coros, Polar, Suunto…);
   - esses mesmos arquivos compactados em **`.gz`** (por exemplo `corrida.fit.gz`), sem precisar descompactar;
   - o **`.zip` da exportação do Strava**, com todas as suas atividades de uma vez (veja abaixo).
3. Com **um** arquivo de atividade, o app abre o relatório direto.
4. Com **vários** arquivos (ou um `.zip`), aparece uma barra de progresso (**Lendo o arquivo…** e depois **Importando *x* de *y*…**) com o botão **Cancelar**. No fim, o **Resultado da importação** mostra os totais e uma lista (veja [O que acontece com cada atividade](#o-que-acontece-com-cada-atividade)).
5. Abaixo, **Suas corridas** lista as 30 mais recentes. **Ver tudo no Histórico** leva à lista completa.

Se nenhum arquivo for de um tipo aceito, o app avisa: **Escolha arquivos GPX, FIT, TCX ou ZIP.**

### Trazer todo o histórico do Strava (arquivo .zip)

O jeito mais rápido de trazer **todas** as suas corridas do Strava de uma vez. **Funciona sem assinatura do Strava.**

1. No Strava (site), vá em **Configurações → Minha conta → Baixar ou excluir sua conta** e clique em **Solicitar arquivo**.
2. Espere o e-mail do Strava com o link para baixar. Costuma levar algumas horas.
3. Baixe o arquivo `.zip` e solte-o **inteiro** em **Análise**, sem descompactar.
4. Acompanhe a barra de progresso. Um arquivo com algumas centenas de atividades costuma levar poucos segundos.

O que o app faz com o arquivo:

- Importa **corridas**, **trail runs** e **caminhadas** (trilhas e hikes viram **Caminhada**).
- Ignora, e conta no resultado, as atividades de **outros tipos** (musculação, bike, natação…), as **registradas à mão** no Strava (sem arquivo) e as **sem GPS** (esteira, indoor).
- Cada corrida mantém o **nome** que ela tem no Strava e a **descrição** vira **Anotações**.
- O app guarda o número da atividade no Strava. Assim, se depois você conectar o Strava em **Ajustes** ou importar o arquivo de novo, as corridas que já estão no app são reconhecidas e puladas.
- O resto do arquivo (fotos, rotas, perfil, seguidores…) é ignorado. Nada sai do seu navegador ([Privacidade](../privacy.md)).

### Baixar uma corrida só

O app mostra este passo a passo em **Como trazer minhas corridas do Strava?**:

1. Abra a atividade no strava.com (no navegador, não no app do celular).
2. Clique no menu **⋯** do lado esquerdo da atividade.
3. Escolha **Exportar GPX** e solte o arquivo baixado no Lapwing.

No Garmin Connect (site), abra a atividade e procure a opção de exportar no menu da atividade. O arquivo original (FIT), o TCX e o GPX servem; se o download vier em `.zip`, pode soltar o `.zip` direto.

Prefere não baixar arquivos? Se você é assinante do Strava, conecte o Strava em **Ajustes** e sincronize ([settings/strava.md](settings/strava.md)).

### O que acontece com cada atividade

O **Resultado da importação** mostra um total por situação (por exemplo **12 importada(s)**, **3 já estavam no app**) e uma linha por arquivo:

| Etiqueta | Total | O que quer dizer |
|---|---|---|
| **Importada** | **N importada(s)** | Deu certo. Clique no nome para abrir o relatório. |
| **Já importada** | **N já estavam no app** | A corrida já existia no app (link **Ver corrida**). |
| **Sem GPS (esteira ou indoor)** | **N sem GPS** | A atividade não tem trajeto, então não dá para analisar. |
| **Registrada à mão** | **N registrada(s) à mão (sem arquivo)** | Só no `.zip` do Strava: atividade digitada à mão no Strava, sem arquivo. |
| **Outro tipo** | **N de outros tipos ignorada(s)** | Só no `.zip`: outro esporte (bike, musculação…). |
| **Não é um arquivo GPX, FIT ou TCX**, **Não foi possível ler este arquivo**, **Formato não suportado** ou **Não foi possível salvar (o armazenamento do navegador está cheio?)** | **N com erro** | O arquivo foi pulado. |

- Em importações grandes (mais de 20 itens), a lista mostra só as importadas e os erros, e no máximo 20 linhas, seguidas de **e mais N**.
- Se nada mudou, aparece **Nada novo para importar.**
- **Cancelar** para a importação na hora: aparece **Importação cancelada. As atividades importadas até aqui foram mantidas.** Para continuar depois, solte o mesmo arquivo de novo: o que já entrou é pulado como repetido.

### Ler o relatório

O relatório tem, de cima para baixo:

1. **Cabeçalho**: nome da corrida (clique para renomear), tipo (**Corrida**, **Trail**, **Caminhada** ou **Atividade**), data e hora, nome do arquivo, e os botões **Comparar**, **Exportar GPX** e **Excluir**.
2. **Números principais**: **Distância**, **Tempo em movimento**, **Tempo total** (com quanto tempo você ficou parado), **Pace médio**, **Melhor 1 km**, **Ganho de elevação**, **Perda de elevação**, **Elevação mín. / máx.**, **FC média**, **FC máxima**, **Cadência média**, **Cadência máxima**, **Temperatura**, **Potência média** e **Potência máxima**. Só aparece o que o arquivo tem.
3. **Percurso**: o mapa com o trajeto colorido. Em **Colorir por**, escolha **Pace** ou **Frequência cardíaca**. A legenda vai de **mais lento** a **mais rápido** (ou de **menor** a **maior**).
4. **Melhores esforços**: seu tempo mais rápido dentro da corrida em **400 m**, **1 km**, **1 milha**, **5 km**, **10 km** e **Meia maratona** (só as distâncias que a corrida cobre).
5. **Carga de treino**: **TRIMP** e **Desacoplamento aeróbico** (veja Detalhes).
6. **Ao longo da corrida**: gráficos de pace, frequência cardíaca, elevação, cadência e potência pela distância. Passe o mouse sobre um gráfico para ver o mesmo ponto em todos e no mapa.
7. **Blocos rápidos (intervalados)**: aparece quando o app encontra trechos claramente mais rápidos que o seu pace habitual naquela corrida (por exemplo, tiros).
8. **Parciais por km**: uma linha por quilômetro, com pace, tempo, FC, subida/descida e cadência. Os km **Mais rápido** e **Mais lento** ganham uma etiqueta. O último trecho incompleto aparece separado.
9. **Zonas de treino**: quanto tempo você passou em cada zona de **frequência cardíaca** e de **pace**. As zonas são definidas em **Ajustes** (link **Editar zonas em Ajustes**).
10. **Como foi?**: **Esforço (PSE 1–10)** e **Anotações**.

## Detalhes

- **Detecção de repetidas.** Uma atividade é considerada **Já importada** quando já existe no app uma com o **mesmo número do Strava**, ou uma que começou **até 60 segundos** antes ou depois com distância a menos de **50 m** de diferença. É a mesma regra da sincronização com o Strava, então uma corrida que veio por arquivo e pela sincronização não se duplica. Arquivos sem horário só são reconhecidos pelo número do Strava.
- **Tipo da atividade** vem do próprio arquivo (no `.zip` do Strava, da lista de atividades do Strava). Se não houver tipo, o app assume corrida. Arquivos soltos de outros esportes são importados como **Atividade**; no `.zip`, eles são ignorados.
- **Altitude estranha em alguns relógios.** Alguns relógios gravam a altitude como exatamente −1 m nos pontos intermediários. O app reconhece esse padrão nos arquivos FIT e descarta esses valores, para o **Ganho de elevação** não sair enorme.
- **Arquivo sem horários.** Sem horário não dá para calcular pace e tempo. O app avisa: **Este arquivo não tem horários, então não dá para calcular pace e tempo.**
- **Tempo em movimento** desconta as paradas. **Tempo total** vai do primeiro ao último ponto.
- **Pace** é o tempo para percorrer 1 km, em min/km. Quanto menor, mais rápido.
- **Cadência** é medida em passos por minuto (spm), contando os dois pés.
- **Zonas de treino.** São 5 zonas de FC (**Z1 Recuperação**, **Z2 Resistência**, **Z3 Moderado**, **Z4 Limiar**, **Z5 Máximo**) e, se você definir, 5 de pace. Sem zonas próprias, as de FC são por % da FC máxima (60, 70, 80 e 90%) e não há zonas de pace. Edite, calcule pelas suas corridas ou volte ao padrão em **Ajustes → Zonas de treino** ([settings/zones.md](settings/zones.md)). A FC máxima e a de repouso (padrão 190 e 60 bpm) também ficam lá e valem para o app inteiro (zonas, TRIMP, Histórico e alertas em Metas).
- **TRIMP** (carga de treino) são minutos “pesados” pelo esforço do coração: quanto mais alta a FC, mais cada minuto conta. Cerca de 50 é uma hora leve; 150 ou mais é um treino forte. Etiquetas: **Leve** (abaixo de 50), **Moderado** (50–99), **Forte** (100–199), **Muito forte** (200 ou mais).
- **Desacoplamento aeróbico** compara a primeira e a segunda metade da corrida: quanto a FC subiu para o mesmo pace. **Estável** abaixo de 5%, **Alguma deriva** de 5% a 10%, **Deriva alta** a partir de 10%. Precisa de FC, horários e pelo menos 20 minutos.
- **PSE** (percepção subjetiva de esforço) é a sua nota de 1 (muito leve) a 10 (máximo). Ela é usada nos alertas de **Metas** e aparece em **Comparar**.
- **Salvamento automático.** Nome, PSE e anotações são salvos assim que você muda (aparece **Salvo.**).
- **Exportar GPX** baixa a corrida completa, com horários, altitude, FC, cadência, temperatura e potência.
- **Excluir** pede confirmação (**Excluir corrida**) e não pode ser desfeito.
- **Comparar** abre a tela de comparação já com esta corrida escolhida ([compare.md](compare.md)).

## Dicas

- Importe o histórico inteiro de uma vez com o arquivo `.zip` do Strava, sem descompactar. Os repetidos são pulados, então dá para soltar o arquivo de novo sem medo.
- Se você sabe sua FC máxima real (de um teste ou prova), ajuste-a em **Ajustes → Zonas de treino**, ou use **Calcular pelas minhas corridas**. Zonas e carga ficam muito mais corretas.
- Use **Anotações** para clima, local, como estavam as pernas. Você agradece daqui a alguns meses.

## Perguntas comuns

**Meu relógio só exporta FIT ou TCX. Funciona?**
Sim. O app lê GPX, FIT e TCX, inclusive compactados em `.gz`.

**Não sou assinante do Strava. Como trago todas as minhas corridas?**
Peça o arquivo da sua conta no Strava (**Configurações → Minha conta → Baixar ou excluir sua conta → Solicitar arquivo**) e solte o `.zip` inteiro em **Análise**. Veja [Trazer todo o histórico do Strava](#trazer-todo-o-histórico-do-strava-arquivo-zip).

**Por que algumas atividades do `.zip` não entraram?**
O app só importa corridas, trail runs e caminhadas com GPS. Musculação, bike, esteira e atividades registradas à mão aparecem contadas no resultado, mas não são importadas.

**Cancelei a importação no meio. Perdi o que já tinha entrado?**
Não. O que já foi importado fica. Solte o arquivo de novo para continuar; as corridas que já estão no app são puladas.

**Por que não aparecem zonas nem TRIMP?**
O arquivo não tem frequência cardíaca. As zonas de pace só aparecem depois de definidas em **Ajustes → Zonas de treino**.

**Importei a mesma corrida do Strava e de um arquivo. Ficou duplicada?**
Normalmente não: o app compara o número do Strava (quando há) ou o horário de início e a distância, e pula a repetida.

**Excluí uma corrida sem querer. Dá para recuperar?**
Só importando o arquivo de novo ou restaurando um backup ([settings/backup.md](settings/backup.md)).

## Veja também

- [Histórico](history.md) · [Comparar](compare.md) · [Treinos](training.md)
- [Sincronizar com o Strava](settings/strava.md)
- [Formatos de arquivo (GPX, FIT, TCX e o `.zip` do Strava)](../reference/file-formats.md)
- [Privacidade](../privacy.md)
- [Métricas e cálculos (técnico)](../architecture/analysis-and-metrics.md)
- [Modelo de dados (técnico)](../architecture/data-model.md)
- [Glossário](../reference/glossary.md)
