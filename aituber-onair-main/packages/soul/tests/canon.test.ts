import { describe, expect, it } from 'vitest';
import {
  promoteCanonCandidate,
  retractCanonRevision,
  validateCanonCandidate,
} from '../src/index.js';
import { constitution, makeCanonCandidate } from './fixtures.js';

describe('versioned canon validation', () => {
  it('does not turn generated viewer history into lived fact', () => {
    const invented = makeCanonCandidate({
      involvesViewerIds: ['viewer-a'],
      realityClass: 'authored-history',
      evidenceEventIds: [],
    });

    const validation = validateCanonCandidate(constitution, invented);

    expect(validation.valid).toBe(false);
    expect(validation.reasonCodes).toContain(
      'viewer-canon-must-be-runtime-lived',
    );
    expect(validation.reasonCodes).toContain(
      'viewer-canon-requires-event-evidence',
    );
  });

  it('accepts viewer continuity only as runtime-lived evidence', () => {
    const observed = makeCanonCandidate({
      realityClass: 'runtime-lived',
      source: 'runtime-observation',
      involvesViewerIds: ['viewer-a'],
      evidenceEventIds: ['production-event-1'],
    });

    expect(validateCanonCandidate(constitution, observed).valid).toBe(true);
  });

  it('requires two independent review passes for major identity history', () => {
    const once = makeCanonCandidate({ impact: 'major', reviewPasses: 1 });
    const twice = makeCanonCandidate({ impact: 'major', reviewPasses: 2 });

    expect(validateCanonCandidate(constitution, once).reasonCodes).toContain(
      'canon-review-passes-insufficient',
    );
    expect(validateCanonCandidate(constitution, twice).valid).toBe(true);
  });

  it('blocks reflection-authored canon in forbidden factual domains', () => {
    const healthClaim = makeCanonCandidate({ domainTags: ['health'] });

    expect(
      validateCanonCandidate(constitution, healthClaim).reasonCodes,
    ).toContain('reflection-cannot-author-forbidden-domain');
  });

  it('requires monotonic versions and an explicit supersession edge', () => {
    const active = {
      ...makeCanonCandidate(),
      status: 'active' as const,
    };
    const missingEdge = makeCanonCandidate({ id: 'canon-2', version: 2 });
    const validNext = makeCanonCandidate({
      id: 'canon-2',
      version: 2,
      supersedesRevisionId: active.id,
    });

    expect(
      validateCanonCandidate(constitution, missingEdge, [active]).reasonCodes,
    ).toContain('canon-supersedes-active-revision-required');
    const promoted = promoteCanonCandidate(
      constitution,
      validNext,
      [active],
      4_000,
    );
    expect(promoted.status).toBe('active');
    expect(promoted.supersedesRevisionId).toBe(active.id);
  });

  it('retracts with a tombstone instead of deleting history', () => {
    const active = {
      ...makeCanonCandidate(),
      status: 'active' as const,
    };

    const retracted = retractCanonRevision(active, 5_000, 'contradicted');

    expect(retracted.status).toBe('retracted');
    expect(retracted.content).toBe(active.content);
    expect(retracted.validationCodes).toContain('contradicted');
  });
});
