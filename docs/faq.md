<!-- docs-tree: docs/faq.md | parent: docs/README.md -->
# Perguntas frequentes

> **Árvore:** [docs](README.md) › faq
> **Resumo:** Respostas curtas para as dúvidas mais comuns de quem usa o Lapwing.
> **Código:** —

## Sobre o app

**Preciso criar uma conta?**
Não. É só abrir e usar.

**O Lapwing é pago?**
Não. O código é aberto, sob a licença MIT.

**Funciona no celular?**
Sim. As telas se ajustam a telas pequenas, e o menu vai para a parte de baixo.

**Funciona sem internet?**
Em parte. Seus dados estão no aparelho, mas o mapa, o cálculo de caminhos no editor de rotas e o Strava precisam de conexão.

**Por que "Lapwing"?**
É o nome em inglês do quero-quero, um passarinho que vive correndo pelos gramados. O app se chamava Route Maker antes; seus dados antigos foram trazidos automaticamente.

## Dados

**Onde ficam minhas corridas?**
No navegador deste aparelho. Veja [Privacidade](privacy.md).

**Abri em outro computador e está tudo vazio. Perdi tudo?**
Não. Os dados ficam no navegador onde você os colocou. Para levá-los a outro lugar, faça um backup em **Ajustes** e restaure no outro computador.

**Como evito perder meus dados?**
Faça um backup em **Ajustes → Backup e restauração** de vez em quando, principalmente antes de limpar os dados do navegador.

## Rotas

**O caminho saiu reto, mas eu queria que seguisse a rua.**
Quando o caminho pela rua é quase igual à linha reta, o Lapwing usa a reta. Clique com o botão direito na linha para alternar entre "seguir caminhos" e "reta".

**Quero passar por uma pista ou um campo aberto.**
Clique com o botão direito no trecho para deixá-lo reto.

**Apareceu uma linha tracejada laranja.**
O cálculo do caminho falhou, por exemplo por falta de internet, e o Lapwing usou uma reta no lugar. Tente mover o ponto de novo.

## Corridas e treinos

**Quais arquivos de corrida o Lapwing aceita?**
GPX, FIT e TCX, de qualquer relógio ou app, também compactados em `.gz`, e o `.zip` com o arquivo completo da sua conta do Strava. Veja [Análise](features/analysis.md#importar-corridas).

**Importei uma corrida duas vezes. Vai duplicar?**
Não. Corridas com o mesmo número do Strava, ou que começaram com até 1 minuto de diferença e têm quase a mesma distância, são reconhecidas e puladas.

**Marquei um treino como feito sem importar a corrida. Ele conta no "Corrido"?**
Sim. Um treino marcado como feito sem corrida ligada conta a distância planejada dele. Se depois você importar a corrida, vale a distância real.

**Como coloco um treino no meu relógio Garmin?**
Exporte o treino em **FIT** e copie o arquivo para a pasta `GARMIN/NewFiles` do relógio conectado ao computador. Veja [Treinos](features/training.md).

**As previsões de prova são confiáveis?**
São estimativas a partir dos seus melhores tempos recentes. A previsão da maratona tende a ser otimista se você ainda não fez corridas longas (25 km ou mais). Veja [Metas](features/insights.md).

## Strava

**Preciso do Strava para usar o Lapwing?**
Não. Você pode importar arquivos GPX, FIT ou TCX de qualquer relógio ou app.

**Como trago todo o meu histórico do Strava sem ser assinante?**
Peça o arquivo da sua conta: no Strava, **Configurações → Minha conta → Baixar ou excluir sua conta → Solicitar arquivo**. O Strava manda um link por e-mail depois de algumas horas. Solte o `.zip` inteiro em **Análise**, sem descompactar: as corridas e caminhadas entram de uma vez, com o nome e a descrição do Strava. Veja [Análise](features/analysis.md#trazer-todo-o-histórico-do-strava-arquivo-zip).

**Preciso ser assinante do Strava para sincronizar?**
Sim. Desde junho de 2026, o Strava só libera o acesso à API (que o Lapwing usa para sincronizar) para quem tem assinatura paga. Sem assinatura, importe o arquivo completo da sua conta (resposta acima) ou exporte corridas em GPX, uma a uma, e importe em **Análise**. Veja [Strava](features/settings/strava.md#requisito-assinatura-do-strava).

**Por que tenho que criar um "app de API" no Strava?**
Como o Lapwing não tem servidor, cada pessoa usa a própria chave do Strava. Isso leva uns 5 minutos, exige assinatura do Strava e está explicado em [Strava](features/settings/strava.md).

**Apareceu um aviso de limite de uso.**
O Strava limita quantos pedidos podem ser feitos a cada 15 minutos. Espere um pouco e sincronize de novo; o Lapwing continua de onde parou.

## Aparência

**Como mudo para o tema escuro?**
Clique no botão de tema no menu, ou vá em **Ajustes → Aparência**. A opção **Sistema** segue a configuração do seu aparelho.

## Veja também

- [Primeiros passos](getting-started/first-steps.md)
- [Guia das telas](features/README.md)
- [Glossário](reference/glossary.md)
