import type { MessageKey } from './en';

export const ptBR: Record<MessageKey, string> = {
  appTitle: 'Lapwing',
  routeName: 'Nome da rota',
  defaultRouteName: 'Rota de corrida',
  language: 'Idioma',

  // Theme
  theme: 'Tema',
  themeSystem: 'Sistema',
  themeLight: 'Claro',
  themeDark: 'Escuro',
  themeToggle: 'Tema: {name}. Clique para mudar.',
  appearanceTitle: 'Aparência',
  appearanceHint: 'Sistema segue a configuração do seu dispositivo e muda junto com ela.',

  navToday: 'Hoje',
  navRoutes: 'Rotas',
  navActivity: 'Análise',
  navTraining: 'Treinos',
  navHistory: 'Histórico',
  navInsights: 'Metas',
  navGear: 'Tênis',
  navSettings: 'Ajustes',
  loadingScreen: 'Carregando…',
  screenError: 'Não foi possível carregar esta tela.',

  // Confirmation dialogs (src/ui/confirm.ts)
  dlgCancel: 'Cancelar',
  dlgDelete: 'Excluir',
  dlgReplace: 'Substituir',
  dlgDisconnect: 'Desconectar',
  dlgRestore: 'Substituir e restaurar',
  dlgDeleteRun: 'Excluir corrida',
  dlgDeleteGoal: 'Excluir meta',
  dlgDeletePlan: 'Excluir plano',
  dlgDeleteWorkout: 'Excluir treino',
  dlgDeleteShoe: 'Excluir tênis',
  dlgReplaceSteps: 'Substituir etapas',
  dlgDisconnectStrava: 'Desconectar do Strava',
  dlgForgetStrava: 'Esquecer credenciais do Strava',
  dlgReplaceData: 'Substituir todos os dados?',

  open: 'Abrir GPX',
  export: 'Exportar GPX',
  undo: 'Desfazer (Ctrl+Z)',
  redo: 'Refazer (Ctrl+Y)',
  reverse: 'Inverter sentido',
  closeLoop: 'Fechar circuito (voltar ao início)',
  clear: 'Limpar rota',

  distance: 'Distância',
  elevation: 'Elevação',
  time: 'Tempo estimado',
  pace: 'Pace',
  paceUnit: 'min/km',

  routing: 'Buscando caminho…',
  hintEmpty: 'Clique no mapa para começar sua rota.',
  hintEditing:
    'Clique para adicionar pontos · arraste para mover · botão direito ou toque longo num ponto para apagá-lo · clique na linha para inserir um ponto · botão direito na linha para deixá-la reta (ou voltar a seguir caminhos).',

  routeFailed: 'Não foi possível achar um caminho ali, então foi usada uma linha reta.',
  gpxLoaded: '“{name}” aberto ({distance}).',
  gpxInvalid: 'Este arquivo não parece ser um GPX.',
  gpxEmpty: 'Nenhum ponto de trilha ou rota encontrado neste arquivo.',
  gpxReadError: 'Não foi possível ler este arquivo.',
  nothingToExport: 'Desenhe uma rota antes de exportar.',
  dropHint: 'Solte um arquivo GPX para abri-lo',
};
