export const SAVED_CREDENTIAL_MASK = '••••••••••••••••';

export interface CredentialInputPresentation {
  inputValue: string;
  readOnly: boolean;
  showSavedStatus: boolean;
  showReplaceAction: boolean;
}

export function getCredentialInputPresentation(
  value: string,
  isServerManaged: boolean,
  isReplacing: boolean,
): CredentialInputPresentation {
  const showingSavedMask = isServerManaged && !isReplacing;
  return {
    inputValue: showingSavedMask ? SAVED_CREDENTIAL_MASK : value,
    readOnly: showingSavedMask,
    showSavedStatus: showingSavedMask,
    showReplaceAction: showingSavedMask,
  };
}
