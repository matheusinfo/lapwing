import './coach.css';
import type { ScreenMount } from '../../app/screen';
import { getAll, getSettings, listActivities } from '../../data/db';
import { getLang, onLangChange } from '../../i18n';
import { confirmDialog } from '../../ui/confirm';
import { loadEfforts } from '../history/efforts';
import type { Goal } from '../insights/goals';
import { predictionRuns } from '../insights/predictions';
import { loadActivePlan } from '../training/active-plan';
import type { PlannedWorkout, TrainingPlan } from '../training/types';
import { CoachError, coachStatus, streamChat, type CoachMessage } from './api';
import { buildSnapshot, predictionWindowStart } from './context';
import {
  clearConversation,
  displayTurns,
  loadConversation,
  runTurn,
  saveConversation,
  type Conversation,
  type Turn,
  type TurnOutcome,
} from './conversation';
import { t, type CoachKey } from './i18n';
import { renderMarkdown } from './markdown';
import { runTool } from './tools';

const esc = (s: string) =>
  s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

const ICONS = {
  send: '<path d="M22 2 11 13"/><path d="M22 2 15 22l-4-9-9-4z"/>',
  stop: '<rect x="6" y="6" width="12" height="12" rx="2"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  coach: '<path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/><path d="M8 9h8M8 13h5"/>',
  tool: '<circle cx="11" cy="11" r="7"/><path d="m21 21-4.3-4.3"/>',
};
const icon = (name: keyof typeof ICONS) => `<svg viewBox="0 0 24 24" aria-hidden="true">${ICONS[name]}</svg>`;

const SUGGESTIONS: CoachKey[] = ['suggestWeek', 'suggestReady', 'suggestRace', 'suggestPaces'];
const TOOL_LABEL: Record<string, CoachKey> = {
  list_runs: 'tool_list_runs',
  get_run_details: 'tool_get_run_details',
  get_training_plan: 'tool_get_training_plan',
  get_current_route: 'tool_get_current_route',
};
const toolLabel = (name: string) => (TOOL_LABEL[name] ? t(TOOL_LABEL[name]) : name);

type Status = 'checking' | 'unavailable' | 'not_configured' | 'ready';

/** What is shown under the question while the coach answers. */
interface Live {
  text: string;
  tools: string[];
  /** Status line: thinking, reading data, using a tool. */
  status: string;
}

/** Reads everything the snapshot needs and builds it. */
async function buildContext(signal: AbortSignal): Promise<string> {
  const [activities, settings, plans, workouts, goals] = await Promise.all([
    listActivities(),
    getSettings(),
    getAll<TrainingPlan>('plans'),
    getAll<PlannedWorkout>('workouts'),
    getAll<Goal>('goals'),
  ]);
  const now = Date.now();
  const efforts = await loadEfforts(predictionRuns(activities, predictionWindowStart(now)), signal);
  signal.throwIfAborted();
  return buildSnapshot({ activities, settings, plans, workouts, goals, efforts, activePlanId: loadActivePlan() }, now);
}

function errorText(err: unknown): string {
  if (err instanceof CoachError) {
    const key = `err_${err.code}` as CoachKey;
    const known = ['auth', 'rate_limit', 'busy', 'overloaded', 'network', 'not_configured', 'too_large', 'bad_request'];
    return known.includes(err.code) ? t(key, { message: err.message }) : t('err_generic', { message: err.message });
  }
  return t('err_generic', { message: err instanceof Error ? err.message : String(err) });
}

const OUTCOME_NOTE: Partial<Record<TurnOutcome, CoachKey>> = {
  refused: 'refused',
  truncated: 'truncated',
  too_many_steps: 'tooManySteps',
};

/** Coach: a chat with Claude about the athlete's own training data. */
export const mount: ScreenMount = (root) => {
  root.classList.add('cch-root');
  root.innerHTML = `
    <div class="cch-page">
      <header class="cch-header">
        <div class="cch-heading">
          <h1 data-k="title"></h1>
          <p class="muted" data-k="subtitle"></p>
        </div>
        <button type="button" class="btn small" data-action="new">${icon('plus')}<span data-k="newChat"></span></button>
      </header>
      <div class="cch-thread" aria-live="polite"></div>
      <form class="cch-composer">
        <textarea rows="1" maxlength="4000" enterkeyhint="send"></textarea>
        <button type="submit" class="btn primary cch-send"></button>
      </form>
    </div>`;
  const thread = root.querySelector<HTMLElement>('.cch-thread')!;
  const form = root.querySelector<HTMLFormElement>('.cch-composer')!;
  const input = form.querySelector('textarea')!;
  const sendBtn = form.querySelector<HTMLButtonElement>('.cch-send')!;
  const newBtn = root.querySelector<HTMLButtonElement>('[data-action="new"]')!;

  let status: Status = 'checking';
  let conversation = loadConversation();
  let live: Live | null = null;
  /** Error or note shown after the last bubble (not stored). */
  let notice: { text: string; kind: 'error' | 'note' } | null = null;
  let job: AbortController | null = null;
  let disposed = false;
  let frame = 0;

  // ---- Rendering ----

  function translateStatic(): void {
    root.querySelectorAll<HTMLElement>('[data-k]').forEach((el) => (el.textContent = t(el.dataset.k as CoachKey)));
    input.placeholder = t('placeholder');
    newBtn.title = t('newChatTitle');
  }

  const toolsHtml = (tools: string[]) =>
    tools.length
      ? `<div class="cch-tools">${[...new Set(tools)]
          .map((name) => `<span class="cch-tool">${icon('tool')}${esc(t('toolDone', { what: toolLabel(name) }))}</span>`)
          .join('')}</div>`
      : '';

  function bubble(turn: Turn): string {
    if (turn.role === 'user') return `<div class="cch-msg cch-user"><div class="cch-bubble">${esc(turn.text)}</div></div>`;
    return `<div class="cch-msg cch-coach">
      <div class="cch-avatar">${icon('coach')}</div>
      <div class="cch-bubble">${toolsHtml(turn.tools)}<div class="cch-md">${renderMarkdown(turn.text)}</div></div>
    </div>`;
  }

  function liveHtml(l: Live): string {
    return `<div class="cch-msg cch-coach cch-live">
      <div class="cch-avatar">${icon('coach')}</div>
      <div class="cch-bubble">${toolsHtml(l.tools)}
        <div class="cch-md">${renderMarkdown(l.text)}</div>
        ${l.status ? `<p class="cch-status"><span class="cch-dots"><i></i><i></i><i></i></span>${esc(l.status)}</p>` : ''}
      </div>
    </div>`;
  }

  function introHtml(): string {
    return `<div class="cch-intro">
      <div class="cch-intro-icon">${icon('coach')}</div>
      <h2>${esc(t('introTitle'))}</h2>
      <p class="muted">${esc(t('introText'))}</p>
      <div class="cch-suggestions">
        ${SUGGESTIONS.map((k) => `<button type="button" class="cch-chip" data-suggest="${k}">${esc(t(k))}</button>`).join('')}
      </div>
      <p class="muted cch-privacy">${esc(t('privacyNote'))}</p>
    </div>`;
  }

  function setupHtml(): string {
    const text = status === 'not_configured' ? t('notConfiguredText') : t('unavailableText');
    return `<div class="card cch-setup">
      <h2 class="card-title">${esc(t('unavailableTitle'))}</h2>
      <p>${esc(text)}</p>
      <button type="button" class="btn" data-action="retry">${esc(t('retry'))}</button>
    </div>`;
  }

  const nearBottom = () => thread.scrollHeight - thread.scrollTop - thread.clientHeight < 80;

  function render(): void {
    const stick = nearBottom();
    let html = '';
    if (status === 'checking') html = `<p class="muted cch-center">${esc(t('checking'))}</p>`;
    else if (status !== 'ready') html = setupHtml();
    else {
      const turns = displayTurns(conversation?.messages ?? []);
      if (!turns.length && !live) html = introHtml();
      else html = turns.map(bubble).join('') + (live ? liveHtml(live) : '');
    }
    if (notice) html += `<p class="cch-notice ${notice.kind === 'error' ? 'is-error' : ''}">${esc(notice.text)}</p>`;
    thread.innerHTML = html;
    if (stick || live) thread.scrollTop = thread.scrollHeight;
    renderComposer();
  }

  /** Re-renders only the live bubble (many times per second while streaming). */
  function renderLive(): void {
    if (frame) return;
    frame = requestAnimationFrame(() => {
      frame = 0;
      if (disposed || !live) return;
      const stick = nearBottom();
      const el = thread.querySelector('.cch-live');
      if (el) el.outerHTML = liveHtml(live);
      else render();
      if (stick) thread.scrollTop = thread.scrollHeight;
    });
  }

  function renderComposer(): void {
    const ready = status === 'ready';
    input.disabled = !ready;
    newBtn.disabled = !ready || Boolean(job) || !conversation?.messages.length;
    if (job) {
      sendBtn.innerHTML = icon('stop');
      sendBtn.title = t('stop');
      sendBtn.disabled = false;
      sendBtn.classList.add('is-stop');
    } else {
      sendBtn.innerHTML = icon('send');
      sendBtn.title = t('send');
      sendBtn.disabled = !ready || !input.value.trim();
      sendBtn.classList.remove('is-stop');
    }
    sendBtn.setAttribute('aria-label', sendBtn.title);
  }

  function autoGrow(): void {
    input.style.height = 'auto';
    input.style.height = `${Math.min(input.scrollHeight, 200)}px`;
  }

  // ---- Asking ----

  async function ask(question: string): Promise<void> {
    const text = question.trim();
    if (!text || job || status !== 'ready') return;
    const controller = new AbortController();
    job = controller;
    notice = null;
    input.value = '';
    autoGrow();

    const before = conversation;
    live = { text: '', tools: [], status: conversation ? t('thinking') : t('readingData') };
    // Show the question right away.
    const pending: CoachMessage = { role: 'user', content: text };
    const base: Conversation = conversation ?? { version: 1, context: '', createdAt: Date.now(), messages: [] };
    conversation = { ...base, messages: [...base.messages, pending] };
    render();

    try {
      const context = base.context || (await buildContext(controller.signal));
      conversation = { ...conversation, context };
      live.status = t('thinking');
      renderLive();
      const lang = getLang();
      const result = await runTurn(
        conversation.messages,
        {
          send: (messages, signal) => {
            if (live) {
              // A new round after tool results: separate it from the text before.
              if (live.text && !live.text.endsWith('\n\n')) live.text += '\n\n';
              live.status = t('thinking');
              renderLive();
            }
            return streamChat(
              { messages, context, lang },
              {
                onText: (delta) => {
                  if (!live) return;
                  live.text += delta;
                  live.status = '';
                  renderLive();
                },
                onTool: (name) => {
                  if (!live) return;
                  live.tools.push(name);
                  live.status = t('usingTool', { what: toolLabel(name) });
                  renderLive();
                },
              },
              signal,
            );
          },
          runTool: (name, toolInput) => runTool(name, toolInput),
          onStep: (messages) => {
            if (conversation) saveConversation({ ...conversation, messages });
          },
        },
        controller.signal,
      );
      if (disposed) return;
      conversation = { ...conversation, messages: result.messages };
      saveConversation(conversation);
      const note = OUTCOME_NOTE[result.outcome];
      if (note) notice = { text: t(note), kind: 'note' };
    } catch (err) {
      // Nothing of this question is kept (also when leaving the screen mid-answer).
      conversation = before;
      if (conversation) saveConversation(conversation);
      else clearConversation();
      if (disposed) return;
      // Put it back in the box to try again.
      input.value = text;
      autoGrow();
      notice = controller.signal.aborted ? { text: t('stopped'), kind: 'note' } : { text: errorText(err), kind: 'error' };
      if (err instanceof CoachError && err.code === 'not_configured') void check();
    } finally {
      if (job === controller) job = null;
      live = null;
    }
    if (!disposed) {
      render();
      input.focus();
    }
  }

  async function check(): Promise<void> {
    status = 'checking';
    render();
    const s = await coachStatus();
    if (disposed) return;
    status = !s.available ? 'unavailable' : s.configured ? 'ready' : 'not_configured';
    render();
  }

  // ---- Events ----

  form.addEventListener('submit', (e) => {
    e.preventDefault();
    if (job) job.abort();
    else void ask(input.value);
  });
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) {
      e.preventDefault();
      if (!job) void ask(input.value);
    }
  });
  input.addEventListener('input', () => {
    autoGrow();
    renderComposer();
  });
  root.addEventListener('click', (e) => {
    const target = e.target as HTMLElement;
    const chip = target.closest<HTMLElement>('[data-suggest]');
    if (chip) {
      void ask(t(chip.dataset.suggest as CoachKey));
      return;
    }
    if (target.closest('[data-action="retry"]')) void check();
  });
  newBtn.addEventListener('click', async () => {
    if (job) return;
    const ok = await confirmDialog({
      title: t('newChat'),
      message: t('confirmNew'),
      confirmLabel: t('newChat'),
      tone: 'danger',
    });
    if (!ok || disposed) return;
    conversation = null;
    notice = null;
    clearConversation();
    render();
    input.focus();
  });

  const stopLang = onLangChange(() => {
    translateStatic();
    render();
  });

  translateStatic();
  render();
  void check();

  return () => {
    disposed = true;
    job?.abort();
    cancelAnimationFrame(frame);
    stopLang();
    root.classList.remove('cch-root');
  };
};
