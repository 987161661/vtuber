import { describe, expect, it } from 'vitest';
import {
  getCredentialInputPresentation,
  SAVED_CREDENTIAL_MASK,
} from '../../examples/react-purupuru-app/src/lib/credentialInputPresentation';

describe('ServerManagedCredentialInput', () => {
  it('renders a durable saved mask without exposing a credential value', () => {
    const presentation = getCredentialInputPresentation('', true, false);

    expect(presentation).toEqual({
      inputValue: SAVED_CREDENTIAL_MASK,
      readOnly: true,
      showSavedStatus: true,
      showReplaceAction: true,
    });
  });

  it('keeps an unsaved input editable and does not show a false saved state', () => {
    const presentation = getCredentialInputPresentation('', false, false);

    expect(presentation).toEqual({
      inputValue: '',
      readOnly: false,
      showSavedStatus: false,
      showReplaceAction: false,
    });
  });

  it('shows a blank editable field only after replacement is requested', () => {
    const presentation = getCredentialInputPresentation('', true, true);

    expect(presentation).toEqual({
      inputValue: '',
      readOnly: false,
      showSavedStatus: false,
      showReplaceAction: false,
    });
  });
});
