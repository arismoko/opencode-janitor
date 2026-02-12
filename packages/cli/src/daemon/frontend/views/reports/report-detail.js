import hljs from 'https://esm.sh/highlight.js@11.11.1/lib/core';
import bash from 'https://esm.sh/highlight.js@11.11.1/lib/languages/bash';
import diff from 'https://esm.sh/highlight.js@11.11.1/lib/languages/diff';
import javascript from 'https://esm.sh/highlight.js@11.11.1/lib/languages/javascript';
import json from 'https://esm.sh/highlight.js@11.11.1/lib/languages/json';
import markdown from 'https://esm.sh/highlight.js@11.11.1/lib/languages/markdown';
import plaintext from 'https://esm.sh/highlight.js@11.11.1/lib/languages/plaintext';
import typescript from 'https://esm.sh/highlight.js@11.11.1/lib/languages/typescript';
import xml from 'https://esm.sh/highlight.js@11.11.1/lib/languages/xml';
import yaml from 'https://esm.sh/highlight.js@11.11.1/lib/languages/yaml';
import { Marked } from 'https://esm.sh/marked@17.0.2';
import { markedHighlight } from 'https://esm.sh/marked-highlight@2.2.3';
import {
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'https://esm.sh/preact@10.26.2/hooks';
import { fmtClock } from '../../helpers.js';
import { SEV } from '../../ui-constants.js';

const AUTO_SCROLL_NEAR_PX = 48;
const MARKDOWN_CACHE_MAX = 200;

hljs.registerLanguage('bash', bash);
hljs.registerLanguage('shell', bash);
hljs.registerLanguage('sh', bash);
hljs.registerLanguage('diff', diff);
hljs.registerLanguage('javascript', javascript);
hljs.registerLanguage('js', javascript);
hljs.registerLanguage('typescript', typescript);
hljs.registerLanguage('ts', typescript);
hljs.registerLanguage('json', json);
hljs.registerLanguage('markdown', markdown);
hljs.registerLanguage('md', markdown);
hljs.registerLanguage('xml', xml);
hljs.registerLanguage('html', xml);
hljs.registerLanguage('yaml', yaml);
hljs.registerLanguage('yml', yaml);
hljs.registerLanguage('text', plaintext);
hljs.registerLanguage('plaintext', plaintext);

const markdownRenderer = new Marked(
  markedHighlight({
    langPrefix: 'hljs language-',
    emptyLangClass: 'hljs',
    highlight(code, lang) {
      const normalized = String(lang || '')
        .trim()
        .toLowerCase();
      if (normalized && hljs.getLanguage(normalized)) {
        return hljs.highlight(code, { language: normalized }).value;
      }
      return hljs.highlightAuto(code).value;
    },
  }),
);
markdownRenderer.setOptions({ gfm: true, breaks: true });
markdownRenderer.use({
  renderer: {
    html() {
      // Drop raw HTML blocks/inline tags from model output.
      return '';
    },
  },
});

const markdownCache = new Map();

function markdownToHtml(source) {
  const text = typeof source === 'string' ? source : String(source ?? '');
  if (text.length === 0) return '';

  const cached = markdownCache.get(text);
  if (cached) return cached;

  const rendered = markdownRenderer.parse(text);
  const html = typeof rendered === 'string' ? rendered : String(rendered ?? '');

  if (markdownCache.size >= MARKDOWN_CACHE_MAX) {
    markdownCache.clear();
  }
  markdownCache.set(text, html);
  return html;
}

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

function renderMarkdownBlock(html, text) {
  const rendered = markdownToHtml(text);
  if (!rendered) return null;
  return html`
    <div class="timeline-markdown" dangerouslySetInnerHTML=${{ __html: rendered }}></div>
  `;
}

function renderToolCard(html, event) {
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

  const input = formatToolValue(p.input);
  const output = formatToolValue(status === 'error' ? p.error : p.output);
  const outputLabel = status === 'error' ? 'Error' : 'Output';

  return html`
    <details class=${`timeline-tool ${status}`} open=${status !== 'completed'}>
      <summary class="tool-summary">
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

function renderTimelineEntry(html, event) {
  const topic = event.topic || '';

  if (topic.startsWith('session.tool.')) {
    return renderToolCard(html, event);
  }

  if (topic === 'session.text') {
    const text = event.payload?.text || event.message || '';
    return html`
      <article class="timeline-text">
        ${renderMarkdownBlock(html, text)}
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

function groupedSessionEvents(sessionEvents) {
  const blocks = [];
  let deltaBuffer = [];

  const flushDeltas = () => {
    if (deltaBuffer.length === 0) return;
    blocks.push({
      type: 'delta-text',
      text: deltaBuffer
        .map((event) =>
          typeof event.payload?.delta === 'string'
            ? event.payload.delta
            : event.message || '',
        )
        .join(''),
    });
    deltaBuffer = [];
  };

  for (const event of sessionEvents) {
    if (event.topic === 'session.delta') {
      deltaBuffer.push(event);
      continue;
    }

    if (event.topic === 'session.text' && deltaBuffer.length > 0) {
      const deltaPartId = deltaBuffer[deltaBuffer.length - 1]?.payload?.partId;
      const textPartId = event.payload?.partId;
      if (!deltaPartId || !textPartId || deltaPartId !== textPartId) {
        flushDeltas();
      } else {
        deltaBuffer = [];
      }
      blocks.push({ type: 'event', event });
      continue;
    }

    flushDeltas();
    blocks.push({ type: 'event', event });
  }
  flushDeltas();

  return blocks;
}

function ReportDetailPanel({
  html,
  selectedReport,
  detail,
  detailMode,
  setDetailMode,
  deleteReport,
  transcript,
  sessionEvents,
  sessionHasMore,
  loadMoreSessionEvents,
}) {
  const [autoScrollEnabled, setAutoScrollEnabled] = useState(true);
  const [showJumpToLatest, setShowJumpToLatest] = useState(false);
  const detailScrollRef = useRef(null);
  const nearBottomRef = useRef(true);

  const blocks = useMemo(
    () =>
      detailMode === 'session' ? groupedSessionEvents(sessionEvents || []) : [],
    [detailMode, sessionEvents],
  );

  const transcriptLength =
    typeof transcript === 'string' ? transcript.length : 0;
  const isSessionMode =
    detailMode === 'session' || detailMode === 'session-raw';

  const scrollToLatest = (behavior = 'smooth') => {
    const element = detailScrollRef.current;
    if (!element) return;
    element.scrollTo({ top: element.scrollHeight, behavior });
    nearBottomRef.current = true;
    setShowJumpToLatest(false);
  };

  useEffect(() => {
    const element = detailScrollRef.current;
    if (!element || !isSessionMode) {
      setShowJumpToLatest(false);
      nearBottomRef.current = true;
      return undefined;
    }

    const onScroll = () => {
      const remaining =
        element.scrollHeight - element.scrollTop - element.clientHeight;
      const nearBottom = remaining <= AUTO_SCROLL_NEAR_PX;
      nearBottomRef.current = nearBottom;
      setShowJumpToLatest(!nearBottom);
    };

    onScroll();
    element.addEventListener('scroll', onScroll, { passive: true });
    return () => element.removeEventListener('scroll', onScroll);
  }, [isSessionMode, selectedReport?.id]);

  useEffect(() => {
    if (!isSessionMode) return;
    if (!autoScrollEnabled || !nearBottomRef.current) return;

    const element = detailScrollRef.current;
    if (!element) return;

    requestAnimationFrame(() => {
      element.scrollTop = element.scrollHeight;
      nearBottomRef.current = true;
      setShowJumpToLatest(false);
    });
  }, [
    isSessionMode,
    detailMode,
    blocks.length,
    transcriptLength,
    selectedReport?.id,
    autoScrollEnabled,
  ]);

  return html`
    <div class="panel">
      ${
        selectedReport &&
        detail &&
        html`
          <div class="detail-head">
            <div>
              <div>
                <strong>${selectedReport.agent}</strong> ·
                <span class="mono">${(selectedReport.repoPath || '').split('/').pop()}</span>
              </div>
              <div class="muted" style="font-size:11px; margin-top:4px;">
                ${selectedReport.errorMessage || `Session ${selectedReport.sessionId || '-'}`}
              </div>
            </div>
            <div class="detail-actions">
              <button
                class="btn"
                onClick=${() =>
                  setDetailMode(
                    detailMode === 'findings' ? 'session' : 'findings',
                  )}
              >
                ${detailMode === 'findings' ? 'Session' : 'Findings'}
              </button>
              ${
                isSessionMode &&
                html`
                  <button
                    class="btn"
                    onClick=${() =>
                      setDetailMode(
                        detailMode === 'session-raw'
                          ? 'session'
                          : 'session-raw',
                      )}
                    title="Toggle raw transcript view"
                  >
                    ${detailMode === 'session-raw' ? 'Structured' : 'Raw'}
                  </button>
                  <button
                    class="btn"
                    onClick=${() => setAutoScrollEnabled((enabled) => !enabled)}
                    title="Keep timeline pinned to latest events"
                  >
                    ${autoScrollEnabled ? 'Auto-scroll on' : 'Auto-scroll off'}
                  </button>
                `
              }
              <button class="btn" onClick=${deleteReport}>Delete</button>
            </div>
          </div>
          <div
            class=${`detail-scroll ${isSessionMode ? 'session-scroll' : ''}`}
            ref=${detailScrollRef}
          >
            ${
              detailMode === 'findings' &&
              html`
                ${
                  detail.findings.length === 0 &&
                  html`<div class="find-card subtle">No findings for this report.</div>`
                }
                ${detail.findings.map(
                  (finding) =>
                    html`
                      <article
                        class="find-card"
                        style=${`border-left-color:${SEV[finding.severity] || '#9c9690'};`}
                      >
                        <div class="row">
                          <strong style=${`color:${SEV[finding.severity] || '#9c9690'};`}>
                            ${finding.severity} · ${finding.domain}
                          </strong>
                          <span class="mono subtle">${fmtClock(finding.createdAt)}</span>
                        </div>
                        <p style="margin:8px 0 6px;">${finding.evidence}</p>
                        <div class="mono" style="font-size:10px; color:var(--accent);">
                          ${finding.location}
                        </div>
                        <p class="muted" style="margin:8px 0 0;">${finding.prescription}</p>
                      </article>
                    `,
                )}
              `
            }

            ${
              detailMode === 'session' &&
              html`
                <div class="session-timeline">
                  ${
                    blocks.length === 0 &&
                    html`<div class="find-card subtle">No session events available yet.</div>`
                  }
                  ${blocks.map((block) => {
                    if (block.type === 'delta-text') {
                      return html`
                        <article class="timeline-text">
                          ${renderMarkdownBlock(html, block.text)}
                        </article>
                      `;
                    }
                    return renderTimelineEntry(html, block.event);
                  })}
                  ${
                    sessionHasMore &&
                    html`
                      <div style="padding:8px 10px;">
                        <button class="btn" onClick=${loadMoreSessionEvents}>
                          Load more events
                        </button>
                      </div>
                    `
                  }
                </div>
              `
            }

            ${
              detailMode === 'session-raw' &&
              html`
                <pre class="transcript">${
                  transcript || 'No session transcript available yet.'
                }</pre>
              `
            }

            ${
              isSessionMode &&
              showJumpToLatest &&
              html`
                <div class="timeline-jump">
                  <button class="btn" onClick=${() => scrollToLatest()}>
                    Jump to latest
                  </button>
                </div>
              `
            }
          </div>
        `
      }
      ${
        (!selectedReport || !detail) &&
        html`<div class="detail-head muted">Select a report to view details.</div>`
      }
    </div>
  `;
}

export function renderReportDetail(props) {
  const { html } = props;
  return html`
    <${ReportDetailPanel}
      html=${props.html}
      selectedReport=${props.selectedReport}
      detail=${props.detail}
      detailMode=${props.detailMode}
      setDetailMode=${props.setDetailMode}
      deleteReport=${props.deleteReport}
      transcript=${props.transcript}
      sessionEvents=${props.sessionEvents}
      sessionHasMore=${props.sessionHasMore}
      loadMoreSessionEvents=${props.loadMoreSessionEvents}
    />
  `;
}
