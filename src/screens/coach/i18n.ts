import { defineMessages } from '../../i18n';

const en = {
  title: 'Coach',
  subtitle: 'Ask about your runs, your plan or your next race.',
  newChat: 'New conversation',
  newChatTitle: 'Start over (the coach reads your data again)',
  placeholder: 'Ask your coach…',
  send: 'Send',
  stop: 'Stop',
  you: 'You',
  coach: 'Coach',
  thinking: 'Thinking…',
  readingData: 'Reading your training data…',
  usingTool: 'Looking at {what}…',
  tool_list_runs: 'your runs',
  tool_get_run_details: 'a run',
  tool_get_training_plan: 'your training plan',
  tool_get_current_route: 'the route in the editor',
  toolDone: 'Looked at {what}',

  introTitle: 'Your running coach',
  introText:
    'It reads your runs, your plan, your goals and your zones, and answers with your own numbers. Try one of these:',
  suggestWeek: 'How did my last week of training go?',
  suggestRace: 'Simulate my race on the route open in the route editor: finish time, pacing and splits.',
  suggestReady: 'Am I on track for my plan’s goal?',
  suggestPaces: 'Which paces should I use for easy runs, tempo and intervals?',
  privacyNote: 'Each question sends a summary of your training to Claude (Anthropic) through this site’s coach server.',

  checking: 'Connecting to the coach…',
  unavailableTitle: 'The coach isn’t set up on this site',
  unavailableText:
    'The coach needs Lapwing’s coach server with an Anthropic API key. Put the key in the .env file (ANTHROPIC_API_KEY) and start the server: see docs/features/coach.md.',
  notConfiguredText:
    'The coach server is running but has no API key. Put it in the .env file (ANTHROPIC_API_KEY) and restart the server.',
  retry: 'Try again',

  err_auth: 'The API key was refused. Check ANTHROPIC_API_KEY in the server’s .env.',
  err_workspace:
    'This API key isn’t tied to a workspace. Put the workspace ID (wrkspc_…) in ANTHROPIC_WORKSPACE_ID in the server’s .env and restart it.',
  err_rate_limit: 'The API is rate limiting requests. Wait a little and try again.',
  err_busy: 'Too many questions in a short time. Wait a minute and try again.',
  err_overloaded: 'Claude is overloaded right now. Try again in a moment.',
  err_network: 'Could not reach the coach. Check your connection.',
  err_not_configured: 'The coach server has no API key.',
  err_too_large: 'This conversation got too long. Start a new one.',
  err_bad_request: 'The coach couldn’t process this request: {message}',
  err_generic: 'Something went wrong: {message}',
  refused: 'The coach couldn’t answer this one. Try asking in a different way.',
  truncated: '(The answer was cut short.)',
  tooManySteps: 'The coach took too many steps to answer. Try a more specific question.',
  stopped: 'Stopped.',
  confirmNew: 'Start a new conversation? This one will be deleted.',
};

type Key = keyof typeof en;

const ptBR: Record<Key, string> = {
  title: 'Treinador',
  subtitle: 'Pergunte sobre suas corridas, seu plano ou sua próxima prova.',
  newChat: 'Nova conversa',
  newChatTitle: 'Começar de novo (o treinador lê seus dados outra vez)',
  placeholder: 'Pergunte ao seu treinador…',
  send: 'Enviar',
  stop: 'Parar',
  you: 'Você',
  coach: 'Treinador',
  thinking: 'Pensando…',
  readingData: 'Lendo seus dados de treino…',
  usingTool: 'Consultando {what}…',
  tool_list_runs: 'suas corridas',
  tool_get_run_details: 'uma corrida',
  tool_get_training_plan: 'seu plano de treino',
  tool_get_current_route: 'a rota do editor',
  toolDone: 'Consultou {what}',

  introTitle: 'Seu treinador de corrida',
  introText:
    'Ele lê suas corridas, seu plano, suas metas e suas zonas, e responde com os seus próprios números. Experimente:',
  suggestWeek: 'Como foi minha última semana de treinos?',
  suggestRace: 'Simule minha prova na rota aberta no editor de rotas: tempo final, estratégia de ritmo e parciais.',
  suggestReady: 'Estou no caminho certo para o objetivo do meu plano?',
  suggestPaces: 'Quais paces devo usar nos treinos leves, de limiar e intervalados?',
  privacyNote: 'Cada pergunta envia um resumo dos seus treinos ao Claude (Anthropic) pelo servidor do treinador deste site.',

  checking: 'Conectando ao treinador…',
  unavailableTitle: 'O treinador não está configurado neste site',
  unavailableText:
    'O treinador precisa do servidor do treinador do Lapwing com uma chave de API da Anthropic. Coloque a chave no arquivo .env (ANTHROPIC_API_KEY) e suba o servidor: veja docs/features/coach.md.',
  notConfiguredText:
    'O servidor do treinador está no ar, mas sem chave de API. Coloque-a no arquivo .env (ANTHROPIC_API_KEY) e reinicie o servidor.',
  retry: 'Tentar de novo',

  err_auth: 'A chave de API foi recusada. Confira ANTHROPIC_API_KEY no .env do servidor.',
  err_workspace:
    'Esta chave de API não está presa a um workspace. Coloque o ID do workspace (wrkspc_…) em ANTHROPIC_WORKSPACE_ID no .env do servidor e reinicie-o.',
  err_rate_limit: 'A API está limitando as requisições. Espere um pouco e tente de novo.',
  err_busy: 'Muitas perguntas em pouco tempo. Espere um minuto e tente de novo.',
  err_overloaded: 'O Claude está sobrecarregado agora. Tente de novo em instantes.',
  err_network: 'Não foi possível falar com o treinador. Confira sua conexão.',
  err_not_configured: 'O servidor do treinador está sem chave de API.',
  err_too_large: 'Esta conversa ficou longa demais. Comece uma nova.',
  err_bad_request: 'O treinador não conseguiu processar este pedido: {message}',
  err_generic: 'Algo deu errado: {message}',
  refused: 'O treinador não pôde responder esta. Tente perguntar de outro jeito.',
  truncated: '(A resposta foi cortada.)',
  tooManySteps: 'O treinador precisou de passos demais para responder. Tente uma pergunta mais específica.',
  stopped: 'Interrompido.',
  confirmNew: 'Começar uma nova conversa? Esta será apagada.',
};

export type CoachKey = Key;
export const t = defineMessages<Key>({ en, 'pt-BR': ptBR });
