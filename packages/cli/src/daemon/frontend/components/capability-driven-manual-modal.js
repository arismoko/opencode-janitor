import {
  useEffect,
  useMemo,
  useState,
} from 'https://esm.sh/preact@10.26.2/hooks';

function coerceInputValue(raw) {
  if (typeof raw !== 'string') {
    return raw;
  }

  const trimmed = raw.trim();
  if (/^[0-9]+$/.test(trimmed)) {
    return Number.parseInt(trimmed, 10);
  }

  return trimmed;
}

export function CapabilityDrivenManualModal({
  html,
  pickerRepoId,
  setPickerRepoId,
  capabilities,
  triggerReview,
}) {
  const agents = capabilities?.agents ?? [];
  const scopesById = useMemo(() => {
    const map = new Map();
    for (const scope of capabilities?.scopes ?? []) {
      map.set(scope.id, scope);
    }
    return map;
  }, [capabilities]);

  const [agentId, setAgentId] = useState('');
  const [scopeId, setScopeId] = useState('');
  const [inputs, setInputs] = useState({});
  const [note, setNote] = useState('');
  const [focusPath, setFocusPath] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    if (!pickerRepoId) {
      return;
    }

    const firstAgent = agents[0];
    if (!firstAgent) {
      setAgentId('');
      setScopeId('');
      setInputs({});
      setNote('');
      setFocusPath('');
      return;
    }

    const nextAgent = firstAgent.id;
    const nextScope = firstAgent.manualScopes[0] ?? '';
    setAgentId(nextAgent);
    setScopeId(nextScope);
    setInputs({});
    setNote('');
    setFocusPath('');
    setError('');
  }, [pickerRepoId, capabilities]);

  const selectedAgent = agents.find((agent) => agent.id === agentId);
  const availableScopes = selectedAgent?.manualScopes ?? [];
  const selectedScope =
    scopeId && availableScopes.includes(scopeId)
      ? scopeId
      : (availableScopes[0] ?? '');
  const scopeInputs = selectedScope
    ? (scopesById.get(selectedScope)?.inputs ?? [])
    : [];

  if (!pickerRepoId) return null;

  const submit = async () => {
    if (!selectedAgent) {
      setError('No selectable agents are available.');
      return;
    }

    const builtInput = {};
    for (const field of scopeInputs) {
      const raw = inputs[field.key] ?? '';
      const value = coerceInputValue(raw);
      const empty = value === '' || value === undefined || value === null;
      if (field.required && empty) {
        setError(`${field.key} is required for ${selectedScope}.`);
        return;
      }
      if (!empty) {
        builtInput[field.key] = value;
      }
    }

    try {
      await triggerReview(pickerRepoId, {
        agent: selectedAgent.id,
        ...(selectedScope ? { scope: selectedScope } : {}),
        ...(Object.keys(builtInput).length > 0 ? { input: builtInput } : {}),
        ...(note.trim().length > 0 ? { note: note.trim() } : {}),
        ...(focusPath.trim().length > 0 ? { focusPath: focusPath.trim() } : {}),
      });
      setPickerRepoId(null);
    } catch (submitError) {
      setError(
        submitError instanceof Error
          ? submitError.message
          : String(submitError),
      );
    }
  };

  return html`
    <div class="overlay" onClick=${() => setPickerRepoId(null)}>
      <div class="modal" onClick=${(event) => event.stopPropagation()}>
        <div style="padding:12px 12px 8px;">
          <strong>Trigger Manual Review</strong>
          <div class="muted" style="font-size:12px; margin-top:4px;">Configure agent and scope</div>
        </div>

        <div style="padding:0 12px 8px; display:grid; gap:8px;">
          <label class="muted" style="font-size:12px; display:grid; gap:4px;">
            Agent
            <select
              value=${selectedAgent?.id ?? ''}
              onChange=${(event) => {
                const nextAgent = event.currentTarget.value;
                setAgentId(nextAgent);
                const next = agents.find((agent) => agent.id === nextAgent);
                setScopeId(next?.manualScopes[0] ?? '');
                setInputs({});
                setError('');
              }}
            >
              ${agents.map(
                (agent) =>
                  html`<option value=${agent.id}>${agent.label}</option>`,
              )}
            </select>
          </label>

          <label class="muted" style="font-size:12px; display:grid; gap:4px;">
            Scope
            <select
              value=${selectedScope}
              onChange=${(event) => {
                setScopeId(event.currentTarget.value);
                setInputs({});
                setError('');
              }}
            >
              ${availableScopes.map((scope) => {
                const scopeDef = scopesById.get(scope);
                return html`<option value=${scope}>${scopeDef?.label ?? scope}</option>`;
              })}
            </select>
          </label>

          ${scopeInputs.map(
            (field) => html`
              <label class="muted" style="font-size:12px; display:grid; gap:4px;">
                ${field.description}
                <input
                  type="text"
                  value=${inputs[field.key] ?? ''}
                  placeholder=${field.flag}
                  onInput=${(event) => {
                    setInputs((prev) => ({
                      ...prev,
                      [field.key]: event.currentTarget.value,
                    }));
                    setError('');
                  }}
                />
              </label>
            `,
          )}

          <label class="muted" style="font-size:12px; display:grid; gap:4px;">
            Instruction (optional)
            <textarea
              rows="3"
              value=${note}
              placeholder="Optional instruction for this run"
              onInput=${(event) => {
                setNote(event.currentTarget.value);
                setError('');
              }}
            ></textarea>
          </label>

          <label class="muted" style="font-size:12px; display:grid; gap:4px;">
            Focus path (optional)
            <input
              type="text"
              value=${focusPath}
              placeholder="src/features/payments"
              onInput=${(event) => {
                setFocusPath(event.currentTarget.value);
                setError('');
              }}
            />
          </label>

          ${
            error
              ? html`<div style="color:#E86A6A; font-size:12px;">${error}</div>`
              : null
          }
        </div>

        <div style="padding:0 12px 12px; display:flex; gap:8px; justify-content:flex-end;">
          <button class="btn" onClick=${() => setPickerRepoId(null)}>Cancel</button>
          <button onClick=${submit}>Run Review</button>
        </div>
      </div>
    </div>
  `;
}
