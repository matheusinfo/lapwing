<!-- docs-tree: docs/features/settings/appearance.md | parent: docs/features/settings/README.md -->
# Aparência — tema claro, escuro ou do sistema

> **Árvore:** [docs](../../README.md) › [features](../README.md) › [settings](README.md) › appearance
> **Resumo:** Escolha se o Lapwing usa cores claras, escuras ou acompanha o seu aparelho.
> **Tela:** `#/settings` (cartão **Aparência**) e o botão de tema no menu · **Código:** `src/screens/settings/appearance-section.ts`, `src/ui/theme.ts`

## Para que serve

Deixar o app confortável para os olhos: tema claro de dia, escuro à noite, ou automático.

## Como usar

**Pelos Ajustes:**

1. Abra **Ajustes** no menu.
2. No cartão **Aparência**, clique numa das três opções:
   - **Sistema**: segue a configuração do seu dispositivo e muda junto com ela.
   - **Claro**: sempre claro.
   - **Escuro**: sempre escuro.

**Pelo botão do menu:**

- O botão de tema (ícone de tela, sol ou lua) fica no menu, ao lado do seletor de idioma.
- Cada clique passa para a próxima opção: **Sistema → Claro → Escuro → Sistema**.
- Pare o mouse sobre o botão para ver o tema atual (“Tema: Sistema. Clique para mudar.”).

Os dois lugares mostram sempre a mesma escolha.

## Detalhes

- **Padrão:** **Sistema**.
- **O que muda:**
  - as cores de todas as telas (fundo, textos, cartões, botões);
  - os **mapas**, que trocam para um estilo de mapa escuro;
  - os **gráficos**, que são redesenhados com as cores do tema;
  - no celular, a cor da barra do navegador acompanha o fundo do app.
- **A tela é redesenhada** quando o tema efetivo muda, para mapas e gráficos pegarem as cores novas. Uma rota em edição é salva antes, então nada se perde.
- **No modo Sistema**, se o seu aparelho trocar sozinho de claro para escuro (por exemplo, ao anoitecer), o app troca junto, sem recarregar a página.
- **A escolha fica salva neste navegador** e é aplicada já na abertura do app, sem “piscar” na cor errada.
- A preferência de tema entra no backup e volta numa restauração ([backup.md](backup.md)).

## Dicas

- Use **Sistema** se o seu celular ou computador já alterna entre claro e escuro automaticamente.
- Correndo de manhã cedo com o celular na mão? O **Escuro** cansa menos a vista.

## Perguntas comuns

**Mudei o tema e a tela piscou. É normal?**
Sim. A tela é redesenhada para os mapas e gráficos pegarem as cores novas.

**Por que o tema mudou sozinho?**
Você está no modo **Sistema** e o seu aparelho trocou de tema.

**Posso mudar o idioma aqui?**
Não. O idioma fica no seletor **EN / PT** do menu.

## Veja também

- [Ajustes](README.md) · [Strava](strava.md) · [Backup](backup.md)
- [Temas e cores (técnico)](../../architecture/theming.md)
- [Armazenamento e chaves salvas (técnico)](../../architecture/storage-and-migration.md)
