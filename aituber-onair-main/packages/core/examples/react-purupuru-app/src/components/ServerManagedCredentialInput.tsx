import { useState } from 'react';
import { getCredentialInputPresentation } from '../lib/credentialInputPresentation';

interface ServerManagedCredentialInputProps {
  id: string;
  value: string;
  isServerManaged: boolean;
  disabled?: boolean;
  placeholder: string;
  onChange: (value: string) => void;
}

/**
 * Keeps a saved credential visibly present without returning its plaintext to
 * the browser. Replacing a server-managed value is an explicit user action so
 * the fixed mask can never be submitted as if it were a real credential.
 */
export function ServerManagedCredentialInput({
  id,
  value,
  isServerManaged,
  disabled = false,
  placeholder,
  onChange,
}: ServerManagedCredentialInputProps) {
  const [isReplacing, setIsReplacing] = useState(false);
  const [draft, setDraft] = useState<string | null>(null);

  // A producer sanitizes browser settings shortly after each edit. Keep the
  // draft locally until the field loses focus so that sanitizing the first
  // character never replaces the input with a mask mid-entry.
  const isEditing = draft !== null;
  const isEditable = isReplacing || isEditing;

  const presentation = getCredentialInputPresentation(
    value,
    isServerManaged,
    isEditable,
  );
  const statusId = `${id}-status`;

  return (
    <>
      <div className="settings-credential-row">
        <input
          id={id}
          type="password"
          value={isEditing ? draft : presentation.inputValue}
          readOnly={presentation.readOnly}
          aria-describedby={presentation.showSavedStatus ? statusId : undefined}
          autoComplete="new-password"
          spellCheck={false}
          onChange={(event) => {
            const nextValue = event.target.value;
            setDraft(nextValue);
            onChange(nextValue);
          }}
          onBlur={() => setDraft(null)}
          placeholder={placeholder}
          disabled={disabled}
        />
        {presentation.showReplaceAction && (
          <button
            type="button"
            className="settings-credential-replace"
            onClick={() => {
              setIsReplacing(true);
              setDraft('');
            }}
            disabled={disabled}
          >
            更换密钥
          </button>
        )}
      </div>
      {presentation.showSavedStatus && (
        <p
          id={statusId}
          className="settings-field-hint settings-credential-status"
        >
          <span aria-hidden="true">✓</span> 已安全保存，原文不回显。
        </p>
      )}
    </>
  );
}
