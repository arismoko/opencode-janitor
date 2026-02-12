const INDENT = '  ';

function indent(level) {
  return INDENT.repeat(level);
}

function escapeXml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&apos;');
}

function toKebabCase(value) {
  return String(value)
    .replace(/([a-z0-9])([A-Z])/g, '$1-$2')
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function toTagName(key) {
  const normalized = toKebabCase(key);
  const candidate = normalized || 'value';
  return /^[a-z_]/.test(candidate) ? candidate : `field-${candidate}`;
}

function isPrimitive(value) {
  return (
    value === null ||
    typeof value === 'string' ||
    typeof value === 'number' ||
    typeof value === 'boolean'
  );
}

function primitiveMarkdown(value) {
  if (value === null) return '`null`';
  if (typeof value === 'boolean') return `\`${String(value)}\``;
  if (typeof value === 'number') return String(value);
  return String(value);
}

function renderMultilineText(text, level) {
  return String(text)
    .split('\n')
    .map((line) => `${indent(level)}${escapeXml(line)}`);
}

function renderTagWithMarkdown(tag, markdownText, level) {
  const text = String(markdownText);
  if (!text.includes('\n')) {
    return [`${indent(level)}<${tag}>${escapeXml(text)}</${tag}>`];
  }

  return [
    `${indent(level)}<${tag}>`,
    ...renderMultilineText(text, level + 1),
    `${indent(level)}</${tag}>`,
  ];
}

function renderArrayAsMarkdownList(tag, arrayValue, level) {
  if (arrayValue.length === 0) {
    return [`${indent(level)}<${tag}></${tag}>`];
  }

  const lines = [`${indent(level)}<${tag}>`];
  for (const item of arrayValue) {
    lines.push(`${indent(level + 1)}- ${escapeXml(primitiveMarkdown(item))}`);
  }
  lines.push(`${indent(level)}</${tag}>`);
  return lines;
}

function renderObjectFields(value, level) {
  const lines = [];
  for (const key of Object.keys(value)) {
    lines.push(...renderTaggedValue(toTagName(key), value[key], level));
  }
  return lines;
}

function renderItemValue(value, level) {
  if (isPrimitive(value)) {
    return renderTagWithMarkdown('item', primitiveMarkdown(value), level);
  }

  if (Array.isArray(value)) {
    const containsComplex = value.some(
      (entry) => entry !== null && typeof entry === 'object',
    );
    if (!containsComplex) {
      return renderArrayAsMarkdownList('item', value, level);
    }

    const lines = [`${indent(level)}<item>`];
    for (const entry of value) {
      lines.push(...renderItemValue(entry, level + 1));
    }
    lines.push(`${indent(level)}</item>`);
    return lines;
  }

  const record = value && typeof value === 'object' ? value : {};
  const keys = Object.keys(record);
  if (keys.length === 0) {
    return [`${indent(level)}<item></item>`];
  }

  return [
    `${indent(level)}<item>`,
    ...renderObjectFields(record, level + 1),
    `${indent(level)}</item>`,
  ];
}

function renderTaggedValue(tag, value, level) {
  if (isPrimitive(value)) {
    return renderTagWithMarkdown(tag, primitiveMarkdown(value), level);
  }

  if (Array.isArray(value)) {
    const containsComplex = value.some(
      (entry) => entry !== null && typeof entry === 'object',
    );
    if (!containsComplex) {
      return renderArrayAsMarkdownList(tag, value, level);
    }

    const lines = [`${indent(level)}<${tag}>`];
    for (const entry of value) {
      lines.push(...renderItemValue(entry, level + 1));
    }
    lines.push(`${indent(level)}</${tag}>`);
    return lines;
  }

  const record = value && typeof value === 'object' ? value : {};
  const keys = Object.keys(record);
  if (keys.length === 0) {
    return [`${indent(level)}<${tag}></${tag}>`];
  }

  return [
    `${indent(level)}<${tag}>`,
    ...renderObjectFields(record, level + 1),
    `${indent(level)}</${tag}>`,
  ];
}

export function formatFindingAsXmlMarkdown(finding) {
  const source = finding && typeof finding === 'object' ? finding : {};
  const lines = ['<finding>', ...renderObjectFields(source, 1), '</finding>'];
  return lines.join('\n');
}

export function formatFindingsAsXmlMarkdown(findings) {
  const list = Array.isArray(findings) ? findings : [];
  const lines = ['<findings>'];

  for (let index = 0; index < list.length; index += 1) {
    const finding = list[index];
    const source = finding && typeof finding === 'object' ? finding : {};
    lines.push(`${indent(1)}<finding index="${index + 1}">`);
    lines.push(...renderObjectFields(source, 2));
    lines.push(`${indent(1)}</finding>`);
  }

  lines.push('</findings>');
  return lines.join('\n');
}

export async function copyTextToClipboard(text) {
  let clipboardError = null;

  if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(text);
      return;
    } catch (error) {
      clipboardError = error;
    }
  }

  if (typeof document !== 'undefined') {
    const textarea = document.createElement('textarea');
    textarea.value = text;
    textarea.setAttribute('readonly', 'readonly');
    textarea.style.position = 'fixed';
    textarea.style.top = '-9999px';
    textarea.style.left = '-9999px';
    textarea.style.opacity = '0';
    document.body.appendChild(textarea);

    try {
      textarea.focus();
      textarea.select();
      textarea.setSelectionRange(0, textarea.value.length);
      if (document.execCommand && document.execCommand('copy')) {
        return;
      }
    } catch (error) {
      clipboardError = error;
    } finally {
      textarea.remove();
    }
  }

  const message =
    clipboardError instanceof Error
      ? clipboardError.message
      : 'Clipboard API unavailable';
  throw new Error(`Unable to copy to clipboard: ${message}`);
}
