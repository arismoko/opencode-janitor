import { resolveFindingEnrichmentRenderer } from './registry.js';

function formatPatternLabel(label) {
  if (typeof label !== 'string' || !label) return '-';
  return label.toLowerCase().replaceAll('_', ' ');
}

export function findingBaseKey(finding, index) {
  if (typeof finding?.id === 'string' && finding.id.length > 0) {
    return finding.id;
  }
  return `${finding?.reviewRunId || 'run'}:${finding?.location || 'loc'}:${index}`;
}

export function normalizeEnrichmentSection(section) {
  if (!section || typeof section !== 'object') return null;
  if (typeof section.kind !== 'string' || section.kind.length === 0)
    return null;
  if (
    typeof section.version !== 'number' ||
    !Number.isFinite(section.version)
  ) {
    return null;
  }
  if (!section.payload || typeof section.payload !== 'object') return null;

  return {
    kind: section.kind,
    version: section.version,
    payload: section.payload,
    collapsed:
      typeof section.collapsed === 'boolean' ? section.collapsed : undefined,
  };
}

export function findEnrichmentDefinition(capabilities, agentId, sectionKind) {
  const agent = capabilities?.agents?.find((item) => item.id === agentId);
  if (!agent || !Array.isArray(agent.findingEnrichments)) {
    return null;
  }

  return (
    agent.findingEnrichments.find(
      (definition) => definition.kind === sectionKind,
    ) || null
  );
}

export function enrichmentKey(finding, findingIndex, section, sectionIndex) {
  const base = findingBaseKey(finding, findingIndex);
  return `${base}:${sectionIndex}:${section.kind}:v${section.version}`;
}

export function renderEnrichmentSection(
  html,
  section,
  definition,
  expanded,
  onToggle,
  finding,
) {
  const title = definition?.title || formatPatternLabel(section.kind);
  const renderSection = resolveFindingEnrichmentRenderer(definition?.renderer);
  const rendered = renderSection({
    html,
    section,
    definition,
    payload: section.payload,
    finding,
  });
  const summaryChips = rendered?.summaryChips ?? null;
  const body = rendered?.body ?? null;
  const chevron = expanded ? '▾' : '▸';

  return html`
    <section class="finding-enrichment">
      <button class="enrichment-summary" onClick=${onToggle}>
        <span class="enrichment-title">${chevron} ${title}</span>
        <span class="enrichment-summary-chips">${summaryChips}</span>
      </button>
      ${expanded && html`<div class="enrichment-content">${body}</div>`}
    </section>
  `;
}
