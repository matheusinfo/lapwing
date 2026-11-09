import { defineMessages } from '../../i18n';

const en = {
  title: 'Sync',
  intro:
    'This site has a Lapwing server: your runs, plans and goals are kept there too and show up on every device that opens this address.',
  localOnly: 'The Strava login stays on each device. Connect Strava on each one if you use it.',
  stateIdle: 'Up to date',
  stateSyncing: 'Syncing…',
  stateError: 'Could not sync. Trying again shortly.',
  stateOffline: 'No connection. Changes are sent when you are back online.',
  stateAuth: 'Your session has expired. Reload the page to sign in again.',
  lastSync: 'Last sync: {date}',
  never: 'Not synced yet',
  pending: '{count} changes waiting to be sent',
  syncNow: 'Sync now',
  reload: 'Reload',
  synced: 'Sync complete.',
};

type Key = keyof typeof en;
export type SyncKey = Key;

export const ts = defineMessages<Key>({
  en,
  'pt-BR': {
    title: 'Sincronização',
    intro:
      'Este site tem um servidor do Lapwing: suas corridas, planos e metas também ficam guardados nele e aparecem em todos os aparelhos que abrem este endereço.',
    localOnly: 'O login do Strava fica em cada aparelho. Se usar o Strava, conecte em cada um.',
    stateIdle: 'Tudo sincronizado',
    stateSyncing: 'Sincronizando…',
    stateError: 'Não foi possível sincronizar. Tentando de novo em instantes.',
    stateOffline: 'Sem conexão. As mudanças são enviadas quando a internet voltar.',
    stateAuth: 'Sua sessão expirou. Recarregue a página para entrar de novo.',
    lastSync: 'Última sincronização: {date}',
    never: 'Ainda não sincronizado',
    pending: '{count} mudanças aguardando envio',
    syncNow: 'Sincronizar agora',
    reload: 'Recarregar',
    synced: 'Sincronização concluída.',
  },
});
