import {
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'https://esm.sh/preact@10.26.2/hooks';
import { fmtClock } from '../../helpers.js';
import { SEV } from '../../ui-constants.js';
import {
  copyTextToClipboard,
  formatFindingAsXmlMarkdown,
  formatFindingsAsXmlMarkdown,
} from './finding-copy-format.js';
import {
  enrichmentKey,
  findEnrichmentDefinition,
  normalizeEnrichmentSection,
  renderEnrichmentSection,
} from './finding-enrichments/core/section-shell.js';
import { useEnrichmentRenderers } from './finding-enrichments/core/use-enrichment-renderers.js';
import { useSessionFollowMode } from './hooks/use-session-follow-mode.js';
import {
  renderMarkdownBlock,
  renderTextBlock,
} from './session/markdown-renderer.js';
import {
  renderTimelineEntry,
  renderToolCard,
  toolEventKey,
} from './session/timeline-renderers.js';

function formatUnreadLabel(count) {
  return `${count} new message${count === 1 ? '' : 's'}`;
}

function ReportDetailPanel({
  html,
  capabilities,
  selectedReport,
  detail,
  detailMode,
  setDetailMode,
  deleteReport,
  stopReview,
  resumeReview,
  transcript,
  sessionEvents,
  timelineBlocks,
  sessionHasMore,
  loadMoreSessionEvents,
  showFlash,
}) {
  const [toolCardsDefaultOpen, setToolCardsDefaultOpen] = useState(false);
  const notify = typeof showFlash === 'function' ? showFlash : () => {};
  const [toolCardsToggleVersion, setToolCardsToggleVersion] = useState(0);
  const [enrichmentExpandedOverrides, setEnrichmentExpandedOverrides] =
    useState(() => new Map());
  const detailScrollRef = useRef(null);

  const blocks = useMemo(
    () => (detailMode === 'session' ? timelineBlocks || [] : []),
    [detailMode, timelineBlocks],
  );

  const transcriptLength =
    typeof transcript === 'string' ? transcript.length : 0;
  const latestSessionEventId = useMemo(() => {
    if (!Array.isArray(sessionEvents) || sessionEvents.length === 0) {
      return 0;
    }
    let max = 0;
    for (const event of sessionEvents) {
      if (typeof event?.eventId === 'number' && event.eventId > max) {
        max = event.eventId;
      }
    }
    return max;
  }, [sessionEvents]);

  const isSessionMode =
    detailMode === 'session' || detailMode === 'session-raw';

  const { unreadCount, scrollToLatest } = useSessionFollowMode({
    isSessionMode,
    selectedReportId: selectedReport?.id,
    detailMode,
    latestSessionEventId,
    transcriptLength,
    detailScrollRef,
  });

  const enrichmentModel = useMemo(() => {
    const byFindingIndex = new Map();
    const allKeys = [];

    if (!detail || !Array.isArray(detail.findings)) {
      return { byFindingIndex, allKeys };
    }

    for (
      let findingIndex = 0;
      findingIndex < detail.findings.length;
      findingIndex += 1
    ) {
      const finding = detail.findings[findingIndex];
      const rawSections = Array.isArray(finding?.enrichments)
        ? finding.enrichments
        : [];

      for (
        let sectionIndex = 0;
        sectionIndex < rawSections.length;
        sectionIndex += 1
      ) {
        const section = normalizeEnrichmentSection(rawSections[sectionIndex]);
        if (!section) continue;

        const definition = findEnrichmentDefinition(
          capabilities,
          finding.agent,
          section.kind,
        );
        const key = enrichmentKey(finding, findingIndex, section, sectionIndex);
        const entry = {
          key,
          finding,
          findingIndex,
          section,
          sectionIndex,
          definition,
        };

        const list = byFindingIndex.get(findingIndex);
        if (list) {
          list.push(entry);
        } else {
          byFindingIndex.set(findingIndex, [entry]);
        }
        allKeys.push(key);
      }
    }

    return { byFindingIndex, allKeys };
  }, [capabilities, detail]);

  const requiredRendererKeys = useMemo(() => {
    const keys = new Set();
    for (const entries of enrichmentModel.byFindingIndex.values()) {
      for (const entry of entries) {
        if (typeof entry.definition?.renderer === 'string') {
          keys.add(entry.definition.renderer);
        }
      }
    }
    return [...keys].sort();
  }, [enrichmentModel]);

  useEnrichmentRenderers(requiredRendererKeys);

  const toggleToolCardsOpen = () => {
    setToolCardsDefaultOpen((current) => !current);
    setToolCardsToggleVersion((value) => value + 1);
  };

  const toggleEnrichmentForKey = (key, currentExpanded) => {
    setEnrichmentExpandedOverrides((previous) => {
      const next = new Map(previous);
      next.set(key, !currentExpanded);
      return next;
    });
  };

  const expandAllEnrichments = () => {
    const next = new Map();
    for (const key of enrichmentModel.allKeys) {
      next.set(key, true);
    }
    setEnrichmentExpandedOverrides(next);
  };

  const collapseAllEnrichments = () => {
    const next = new Map();
    for (const key of enrichmentModel.allKeys) {
      next.set(key, false);
    }
    setEnrichmentExpandedOverrides(next);
  };

  useEffect(() => {
    setEnrichmentExpandedOverrides(new Map());
  }, [selectedReport?.id]);

  const copyAllFindings = async () => {
    try {
      const findings = Array.isArray(detail?.findings) ? detail.findings : [];
      const payload = formatFindingsAsXmlMarkdown(findings);
      await copyTextToClipboard(payload);
      notify(`Copied ${findings.length} findings`);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      notify(`Copy failed: ${message}`, 'error');
    }
  };

  const copySingleFinding = async (finding) => {
    try {
      const payload = formatFindingAsXmlMarkdown(finding);
      await copyTextToClipboard(payload);
      notify('Copied finding');
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      notify(`Copy failed: ${message}`, 'error');
    }
  };

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
                  ${
                    detailMode === 'session' &&
                    html`
                      <button
                        class="btn"
                        onClick=${toggleToolCardsOpen}
                        title="Expand or collapse all tool cards"
                      >
                        ${toolCardsDefaultOpen ? 'Collapse tools' : 'Expand tools'}
                      </button>
                    `
                  }
                `
              }
              ${
                detailMode === 'findings' &&
                enrichmentModel.allKeys.length > 0 &&
                html`
                  <button class="btn" onClick=${expandAllEnrichments}>
                    Expand enrichments
                  </button>
                  <button class="btn" onClick=${collapseAllEnrichments}>
                    Collapse enrichments
                  </button>
                `
              }
              ${
                detailMode === 'findings' &&
                Array.isArray(detail?.findings) &&
                detail.findings.length > 0 &&
                html`
                  <button class="btn" onClick=${copyAllFindings}>
                    Copy all findings
                  </button>
                `
              }
              ${
                (selectedReport.status === 'queued' ||
                  selectedReport.status === 'running') &&
                html`
                  <button
                    class="btn"
                    onClick=${() => stopReview(selectedReport.id)}
                  >
                    Stop
                  </button>
                `
              }
              ${
                selectedReport.status === 'cancelled' &&
                html`
                  <button
                    class="btn"
                    onClick=${() => resumeReview(selectedReport.id)}
                  >
                    Resume
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
                ${detail.findings.map((finding, index) => {
                  const sections =
                    enrichmentModel.byFindingIndex.get(index) || [];

                  return html`
                    <article
                      class="find-card"
                      style=${`border-left-color:${SEV[finding.severity] || '#9c9690'};`}
                    >
                      <div class="row">
                        <strong style=${`color:${SEV[finding.severity] || '#9c9690'};`}>
                          ${finding.severity} · ${finding.domain}
                        </strong>
                        <div class="finding-row-actions">
                          <span class="mono subtle">${fmtClock(finding.createdAt)}</span>
                          <button
                            class="btn btn-compact"
                            onClick=${() => copySingleFinding(finding)}
                          >
                            Copy finding
                          </button>
                        </div>
                      </div>
                      <p style="margin:8px 0 6px;">${finding.evidence}</p>
                      <div class="mono" style="font-size:10px; color:var(--accent);">
                        ${finding.location}
                      </div>
                      <p class="muted" style="margin:8px 0 0;">${finding.prescription}</p>

                      ${sections.map((entry) => {
                        const defaultCollapsed =
                          typeof entry.section.collapsed === 'boolean'
                            ? entry.section.collapsed
                            : (entry.definition?.collapsedByDefault ?? true);
                        const override = enrichmentExpandedOverrides.get(
                          entry.key,
                        );
                        const expanded =
                          typeof override === 'boolean'
                            ? override
                            : !defaultCollapsed;

                        return renderEnrichmentSection(
                          html,
                          entry.section,
                          entry.definition,
                          expanded,
                          () => toggleEnrichmentForKey(entry.key, expanded),
                          finding,
                        );
                      })}
                    </article>
                  `;
                })}
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
                  ${blocks.map((block, index) => {
                    if (block.type === 'text') {
                      return renderTextBlock(html, block);
                    }
                    if (block.type === 'tool-call') {
                      const key =
                        block.key ||
                        toolEventKey(block.event) ||
                        `idx:${index}`;
                      return renderToolCard(html, block.event, {
                        defaultOpen: toolCardsDefaultOpen,
                        detailsKey: `${key}:${toolCardsToggleVersion}`,
                      });
                    }
                    return renderTimelineEntry(html, block.event, {
                      renderMarkdownBlock,
                    });
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
              unreadCount > 0 &&
              html`
                <div class="timeline-jump unread">
                  <button class="btn" onClick=${() => scrollToLatest()}>
                    ${formatUnreadLabel(unreadCount)}
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
      capabilities=${props.capabilities}
      selectedReport=${props.selectedReport}
      detail=${props.detail}
      detailMode=${props.detailMode}
      setDetailMode=${props.setDetailMode}
      deleteReport=${props.deleteReport}
      stopReview=${props.stopReview}
      resumeReview=${props.resumeReview}
      transcript=${props.transcript}
      sessionEvents=${props.sessionEvents}
      timelineBlocks=${props.timelineBlocks}
      sessionHasMore=${props.sessionHasMore}
      loadMoreSessionEvents=${props.loadMoreSessionEvents}
      showFlash=${props.showFlash}
    />
  `;
}
