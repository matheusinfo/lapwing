// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_SETTINGS } from '../src/data/types';

vi.mock('../src/data/db', () => ({
  listActivities: async () => [],
  getSettings: async () => ({ ...DEFAULT_SETTINGS }),
  getAll: async () => [],
  getActivity: async () => undefined,
  getTrack: async () => [],
  onDataChange: () => () => {},
}));

const { mount } = await import('../src/screens/coach/index');
const { setLang } = await import('../src/i18n');
const { STORAGE_KEY } = await import('../src/screens/coach/conversation');

// ---- Fake coach server ----

type Handler = (body: { messages: unknown[]; context: string; lang: string }) => Response;
let chat: Handler[] = [];
let status: () => Response;
const requests: { messages: unknown[]; context: string; lang: string }[] = [];

const ndjson = (...events: unknown[]) =>
  new Response(events.map((e) => JSON.stringify(e)).join('\n') + '\n', {
    headers: { 'Content-Type': 'application/x-ndjson' },
  });
const json = (body: unknown, code = 200) => new Response(JSON.stringify(body), { status: code });

beforeEach(() => {
  setLang('pt-BR');
  localStorage.clear();
  chat = [];
  requests.length = 0;
  status = () => json({ app: 'lapwing-coach', configured: true, model: 'claude-opus-5-5' });
  // jsdom has no layout: animation frames run right away.
  vi.stubGlobal('requestAnimationFrame', (fn: FrameRequestCallback) => {
    fn(0);
    return 1;
  });
  vi.stubGlobal('fetch', async (url: string, init?: RequestInit) => {
    if (url.endsWith('status')) return status();
    const body = JSON.parse(String(init?.body));
    requests.push(body);
    const next = chat.shift();
    if (!next) throw new Error('unexpected chat request');
    return next(body);
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
  document.body.innerHTML = '';
});

async function settle(): Promise<void> {
  for (let i = 0; i < 20; i++) await new Promise((r) => setTimeout(r, 0));
}

async function screen(): Promise<{ root: HTMLElement; unmount: () => void }> {
  const root = document.createElement('div');
  document.body.append(root);
  const unmount = mount(root, {}) as () => void;
  await settle();
  return { root, unmount };
}

function ask(root: HTMLElement, text: string): void {
  const input = root.querySelector('textarea')!;
  input.value = text;
  input.dispatchEvent(new Event('input'));
  root.querySelector('form')!.dispatchEvent(new Event('submit', { cancelable: true }));
}

describe('Coach screen', () => {
  it('explains how to set it up when there is no coach server', async () => {
    status = () => new Response('<html>not found</html>', { status: 404 });
    const { root, unmount } = await screen();
    expect(root.querySelector('.cch-setup')?.textContent).toContain('ANTHROPIC_API_KEY');
    expect(root.querySelector('textarea')!.disabled).toBe(true);
    unmount();
  });

  it('says when the server has no API key', async () => {
    status = () => json({ app: 'lapwing-coach', configured: false });
    const { root, unmount } = await screen();
    expect(root.querySelector('.cch-setup')?.textContent).toContain('sem chave de API');
    unmount();
  });

  it('asks a suggested question, runs a tool and shows the answer', async () => {
    chat.push(
      () =>
        ndjson(
          { t: 'text', text: 'Vou ver suas corridas.' },
          { t: 'tool', name: 'list_runs' },
          {
            t: 'done',
            message: {
              content: [
                { type: 'thinking', thinking: '', signature: 's1' },
                { type: 'text', text: 'Vou ver suas corridas.' },
                { type: 'tool_use', id: 'tu1', name: 'list_runs', input: {} },
              ],
              stop_reason: 'tool_use',
            },
          },
        ),
      () =>
        ndjson(
          { t: 'text', text: 'Sua semana teve **0 km**.' },
          { t: 'done', message: { content: [{ type: 'text', text: 'Sua semana teve **0 km**.' }], stop_reason: 'end_turn' } },
        ),
    );
    const { root, unmount } = await screen();
    expect(root.querySelector('.cch-intro')).not.toBeNull();
    root.querySelector<HTMLElement>('[data-suggest="suggestWeek"]')!.click();
    await settle();

    expect(requests).toHaveLength(2);
    expect(requests[0].lang).toBe('pt-BR');
    expect(requests[0].context).toContain('No activities imported yet.');
    expect(requests[0].messages).toEqual([{ role: 'user', content: 'Como foi minha última semana de treinos?' }]);
    // The tool ran here and its result went back with the same snapshot.
    expect(requests[1].context).toBe(requests[0].context);
    const result = (requests[1].messages[2] as { content: { type: string; tool_use_id: string; content: string }[] }).content[0];
    expect(result).toMatchObject({ type: 'tool_result', tool_use_id: 'tu1' });
    expect(result.content).toContain('No activities');

    const bubbles = root.querySelectorAll('.cch-msg');
    expect(bubbles).toHaveLength(2);
    expect(bubbles[1].querySelector('.cch-tool')?.textContent).toContain('suas corridas');
    expect(bubbles[1].querySelector('.cch-md')?.innerHTML).toContain('<strong>0 km</strong>');

    // Saved, thinking blocks included, and shown again after leaving the screen.
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY)!);
    expect(saved.messages).toHaveLength(4);
    expect(saved.messages[1].content[0]).toEqual({ type: 'thinking', thinking: '', signature: 's1' });
    unmount();
    const again = await screen();
    expect(again.root.querySelectorAll('.cch-msg')).toHaveLength(2);
    again.unmount();
  });

  it('keeps nothing of a failed question and puts it back in the box', async () => {
    chat.push(() => ndjson({ t: 'error', code: 'auth', message: 'invalid x-api-key' }));
    const { root, unmount } = await screen();
    ask(root, 'Qual meu pace de limiar?');
    await settle();
    expect(root.querySelector('.cch-notice.is-error')?.textContent).toContain('chave de API foi recusada');
    expect(root.querySelector('textarea')!.value).toBe('Qual meu pace de limiar?');
    expect(root.querySelectorAll('.cch-msg')).toHaveLength(0);
    expect(localStorage.getItem(STORAGE_KEY)).toBeNull();
    unmount();
  });

  it('reuses the conversation snapshot for later questions', async () => {
    const answer = (text: string) => () =>
      ndjson({ t: 'done', message: { content: [{ type: 'text', text }], stop_reason: 'end_turn' } });
    chat.push(answer('Um.'), answer('Dois.'));
    const { root, unmount } = await screen();
    ask(root, 'Primeira');
    await settle();
    ask(root, 'Segunda');
    await settle();
    expect(requests[1].context).toBe(requests[0].context);
    expect(requests[1].messages).toHaveLength(3);
    expect([...root.querySelectorAll('.cch-msg')].map((m) => m.textContent?.trim())).toEqual([
      'Primeira',
      'Um.',
      'Segunda',
      'Dois.',
    ]);
    unmount();
  });
});
