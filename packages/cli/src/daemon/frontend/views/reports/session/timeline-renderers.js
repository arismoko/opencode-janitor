import { fmtClock } from '../../../helpers.js';

function formatDuration(durationMs) {
  if (typeof durationMs !== 'number' || Number.isNaN(durationMs)) return '';
  return durationMs >= 1000
    ? `${(durationMs / 1000).toFixed(1)}s`
    : `${Math.max(1, Math.round(durationMs))}ms`;
}

function formatToolValue(value) {
  if (value === undefined || value === null) return '';
  if (typeof value === 'string') return value;
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

export function toolEventKey(event) {
  const payload = event?.payload || {};
  if (typeof payload.callId === 'string' && payload.callId.length > 0) {
    return `call:${payload.callId}`;
  }
  if (typeof payload.partId === 'string' && payload.partId.length > 0) {
    return `part:${payload.partId}`;
  }
  return null;
}

export function renderToolCard(html, event, options = {}) {
  const p = event.payload || {};
  const tool = p.tool || '?';
  const title = p.title || tool;
  const callId = typeof p.callId === 'string' ? p.callId : '';
  const duration = formatDuration(p.durationMs);
  const timeLabel = typeof event.ts === 'number' ? fmtClock(event.ts) : '';

  const status =
    event.topic === 'session.tool.completed'
      ? 'completed'
      : event.topic === 'session.tool.error'
        ? 'error'
        : 'running';
  const statusLabel =
    status === 'completed' ? 'done' : status === 'error' ? 'error' : 'running';
  const statusIcon =
    status === 'completed' ? '✓' : status === 'error' ? '✗' : '◷';

  const input = formatToolValue(p.input);
  const output = formatToolValue(status === 'error' ? p.error : p.output);
  const outputLabel = status === 'error' ? 'Error' : 'Output';

  return html`
    <details
      key=${options.detailsKey}
      class=${`timeline-tool ${status}`}
      open=${Boolean(options.defaultOpen)}
    >
      <summary class="tool-summary">
        <span class=${`tool-status-icon ${status}`}>${statusIcon}</span>
        <span class=${`tool-status ${status}`}>${statusLabel}</span>
        <span class="tool-title">${title}</span>
        ${duration && html`<span class="tool-meta mono subtle">${duration}</span>`}
        ${timeLabel && html`<span class="tool-meta mono subtle">${timeLabel}</span>`}
        ${
          callId &&
          html`<span class="tool-meta mono subtle">id ${callId.slice(0, 10)}</span>`
        }
      </summary>
      <div class="tool-body">
        ${
          input &&
          html`
            <section class="tool-section">
              <div class="tool-section-label">Input</div>
              <pre class="tool-block"><code>${input}</code></pre>
            </section>
          `
        }
        ${
          output &&
          html`
            <section class="tool-section">
              <div class="tool-section-label">${outputLabel}</div>
              <pre class="tool-block"><code>${output}</code></pre>
            </section>
          `
        }
      </div>
    </details>
  `;
}

function renderSeparator(html, event, label, statusClass = '') {
  const ts = typeof event?.ts === 'number' ? fmtClock(event.ts) : '';
  return html`
    <div class=${`timeline-separator ${statusClass}`.trim()}>
      <span>${label}</span>
      ${ts && html`<span class="mono subtle">${ts}</span>`}
    </div>
  `;
}

export function renderTimelineEntry(html, event, deps) {
  const topic = event.topic || '';

  if (topic.startsWith('session.tool.')) {
    return renderToolCard(html, event);
  }

  if (topic === 'session.text') {
    const text = event.payload?.text || event.message || '';
    return html`
      <article class="timeline-text">
        ${deps.renderMarkdownBlock(html, text)}
      </article>
    `;
  }

  if (topic === 'session.step.start') {
    return renderSeparator(html, event, 'Step started');
  }

  if (topic === 'session.step.finish') {
    const p = event.payload || {};
    const reason = p.reason ? `: ${p.reason}` : '';
    const cost = typeof p.cost === 'number' ? ` ($${p.cost.toFixed(4)})` : '';
    return renderSeparator(html, event, `Step finished${reason}${cost}`);
  }

  if (topic === 'review_run.succeeded') {
    return renderSeparator(
      html,
      event,
      event.message || 'Review succeeded',
      'status-ok',
    );
  }
  if (topic === 'review_run.failed') {
    return renderSeparator(
      html,
      event,
      event.message || 'Review failed',
      'status-error',
    );
  }
  if (topic === 'review_run.requeued') {
    return renderSeparator(
      html,
      event,
      event.message || 'Review requeued',
      'status-warn',
    );
  }

  if (topic === 'session.idle') {
    return renderSeparator(html, event, 'Session idle');
  }

  if (topic === 'session.error') {
    return renderSeparator(
      html,
      event,
      `Session error: ${event.message || ''}`,
      'status-error',
    );
  }

  if (topic === 'session.delta') {
    return null;
  }

  if (topic.startsWith('session.')) {
    return renderSeparator(
      html,
      event,
      `${topic.replace('session.', '').toUpperCase()}: ${event.message || ''}`,
    );
  }

  return null;
}
