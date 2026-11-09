<!-- docs-tree: docs/features/settings/README.md | parent: docs/features/README.md -->
# Ajustes — aparência, zonas de treino, sincronização, Strava e backup

> **Árvore:** [docs](../../README.md) › [features](../README.md) › settings
> **Resumo:** Índice da tela **Ajustes**: tema do app, zonas de frequência cardíaca e de pace, sincronização entre aparelhos (quando o site tem servidor), sincronização opcional com o Strava e backup dos seus dados.
> **Tela:** `#/settings` · **Código:** `src/screens/settings/`

## Para que serve

A tela **Ajustes** tem até cinco cartões, nesta ordem:

1. **Aparência**: escolher o tema **Sistema**, **Claro** ou **Escuro**.
2. **Zonas de treino**: suas zonas de frequência cardíaca e de pace, editadas à mão ou calculadas pelas suas corridas.
3. **Sincronização** (só aparece se o site tem o servidor do Lapwing): os mesmos dados em todos os aparelhos.
4. **Strava** (**Opcional**): trazer suas corridas direto do Strava, sem baixar GPX um por um. **Exige assinatura paga do Strava.**
5. **Backup e restauração**: baixar um arquivo com todos os seus dados e restaurá-lo depois, aqui ou em outro aparelho.

O idioma não fica aqui: use o seletor **EN / PT** no menu.

## Árvore

```
settings/
├── README.md       — este índice
├── appearance.md   — tema Sistema, Claro ou Escuro e o botão de tema do menu
├── zones.md        — zonas de FC e de pace: editar, calcular pelas corridas, voltar ao padrão
├── sync.md         — sincronização entre aparelhos pelo servidor do Lapwing (opcional)
├── strava.md       — criar o app de API, conectar, sincronizar e resolver problemas
└── backup.md       — baixar backup (com ou sem login do Strava) e restaurar (adicionar ou substituir)
```

- [Aparência — tema claro, escuro ou do sistema](appearance.md)
- [Zonas de treino — frequência cardíaca e pace](zones.md)
- [Sincronização — os mesmos dados em todos os aparelhos](sync.md)
- [Strava — conectar e sincronizar](strava.md)
- [Backup — baixar e restaurar seus dados](backup.md)

## Veja também

- [Índice de funcionalidades](../README.md)
- [Privacidade](../../privacy.md)
- [Perguntas frequentes](../../faq.md)
