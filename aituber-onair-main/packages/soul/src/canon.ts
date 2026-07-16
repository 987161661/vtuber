import type { CanonRevisionV1, SoulConstitutionV1 } from './contracts.js';
import { deepClone, hashValue, unique } from './utils.js';

export interface CanonValidationResultV1 {
  valid: boolean;
  requiredReviewPasses: number;
  reasonCodes: readonly string[];
}

export function hashCanonContent(content: string): string {
  return hashValue(content.trim());
}

export function validateCanonCandidate(
  constitution: SoulConstitutionV1,
  candidate: CanonRevisionV1,
  existing: readonly CanonRevisionV1[] = [],
): CanonValidationResultV1 {
  const reasons: string[] = [];
  const requiredReviewPasses = candidate.impact === 'major' ? 2 : 1;
  if (candidate.personaId !== constitution.personaId) {
    reasons.push('canon-persona-mismatch');
  }
  if (!candidate.content.trim()) reasons.push('canon-content-empty');
  if (candidate.status !== 'candidate') {
    reasons.push('canon-validation-requires-candidate');
  }
  if (candidate.contentHash !== hashCanonContent(candidate.content)) {
    reasons.push('canon-content-hash-mismatch');
  }
  if (
    candidate.involvesViewerIds.length > 0 &&
    candidate.realityClass !== 'runtime-lived'
  ) {
    reasons.push('viewer-canon-must-be-runtime-lived');
  }
  if (
    candidate.involvesViewerIds.length > 0 &&
    candidate.evidenceEventIds.length === 0
  ) {
    reasons.push('viewer-canon-requires-event-evidence');
  }
  if (
    candidate.domainTags.some((domain) =>
      constitution.truthPolicy.forbiddenDeceptionDomains.includes(domain),
    ) &&
    candidate.source === 'reflection'
  ) {
    reasons.push('reflection-cannot-author-forbidden-domain');
  }
  if (candidate.reviewPasses < requiredReviewPasses) {
    reasons.push('canon-review-passes-insufficient');
  }
  const active = existing.find(
    (revision) =>
      revision.canonKey === candidate.canonKey && revision.status === 'active',
  );
  if (active && candidate.version <= active.version) {
    reasons.push('canon-version-not-monotonic');
  }
  if (active && candidate.supersedesRevisionId !== active.id) {
    reasons.push('canon-supersedes-active-revision-required');
  }
  return {
    valid: reasons.length === 0,
    requiredReviewPasses,
    reasonCodes: reasons.length === 0 ? ['canon-candidate-valid'] : reasons,
  };
}

export function promoteCanonCandidate(
  constitution: SoulConstitutionV1,
  candidate: CanonRevisionV1,
  existing: readonly CanonRevisionV1[],
  now: number,
): CanonRevisionV1 {
  const validation = validateCanonCandidate(constitution, candidate, existing);
  if (!validation.valid) {
    throw new Error(
      `Invalid canon candidate: ${validation.reasonCodes.join(',')}`,
    );
  }
  return {
    ...deepClone(candidate),
    status: 'active',
    validationCodes: unique([
      ...candidate.validationCodes,
      ...validation.reasonCodes,
    ]),
    updatedAt: now,
  };
}

export function retractCanonRevision(
  revision: CanonRevisionV1,
  now: number,
  reasonCode: string,
): CanonRevisionV1 {
  if (revision.status === 'candidate') {
    throw new Error('A candidate should be rejected, not retracted');
  }
  return {
    ...deepClone(revision),
    status: 'retracted',
    validationCodes: unique([...revision.validationCodes, reasonCode]),
    updatedAt: now,
  };
}
