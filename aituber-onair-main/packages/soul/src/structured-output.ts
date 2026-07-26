import { Ajv, type ValidateFunction } from 'ajv';

export type JsonSchemaV1 = Readonly<Record<string, unknown>>;

export interface StrictStructuredOutputProtocol<T> {
  readonly id: string;
  readonly version: '1.0';
  readonly schema: JsonSchemaV1;
  parse(raw: string): T;
}

export function createStrictStructuredOutputProtocol<T>(options: {
  id: string;
  schema: JsonSchemaV1;
}): StrictStructuredOutputProtocol<T> {
  const ajv = new Ajv({ allErrors: true, strict: true });
  const validate: ValidateFunction<unknown> = ajv.compile(options.schema);
  return Object.freeze({
    id: options.id,
    version: '1.0' as const,
    schema: options.schema,
    parse(raw: string): T {
      let value: unknown;
      try {
        value = JSON.parse(raw.trim()) as unknown;
      } catch (error) {
        throw new Error(`${options.id} is not valid JSON: ${String(error)}`);
      }
      if (!validate(value)) {
        const details = (validate.errors ?? [])
          .slice(0, 5)
          .map((error) => `${error.instancePath || '/'} ${error.message ?? 'is invalid'}`)
          .join('; ');
        throw new Error(`${options.id} violates its strict schema: ${details}`);
      }
      return value as T;
    },
  });
}

const boundedNumber = (minimum = 0, maximum = 1) => ({
  type: 'number',
  minimum,
  maximum,
});
const stringArray = {
  type: 'array',
  items: { type: 'string', minLength: 1 },
  maxItems: 32,
};

export const SOUL_SEMANTIC_PROPOSAL_SCHEMA_V1: JsonSchemaV1 = {
  $id: 'https://aituber-onair.local/schema/soul-semantic-proposal-v1.json',
  type: 'object',
  additionalProperties: false,
  required: [
    'protocolVersion',
    'confidence',
    'attribution',
    'evidence',
    'candidates',
  ],
  properties: {
    protocolVersion: { const: '1.0' },
    confidence: boundedNumber(),
    attribution: {
      enum: ['self', 'viewer', 'environment', 'mixed', 'unknown'],
    },
    evidence: {
      type: 'array',
      maxItems: 16,
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['dimension', 'value', 'confidence', 'reasonCode'],
        properties: {
          dimension: {
            enum: [
              'goal-progress',
              'identity-respect',
              'novelty',
              'controllability',
              'social-evaluation',
              'attention-competition',
              'certainty',
            ],
          },
          value: boundedNumber(-1, 1),
          confidence: boundedNumber(),
          reasonCode: { type: 'string', minLength: 1, maxLength: 128 },
          goalId: { type: 'string', minLength: 1, maxLength: 128 },
          goalFamily: { type: 'string', minLength: 1, maxLength: 128 },
        },
      },
    },
    candidates: {
      type: 'array',
      minItems: 1,
      maxItems: 3,
      items: {
        type: 'object',
        additionalProperties: false,
        required: [
          'id',
          'action',
          'truthMode',
          'goalEffects',
          'relationshipBenefit',
          'programValue',
          'novelty',
          'repetitionCost',
          'interruptionCost',
          'manipulationRisk',
          'factSafetyRisk',
          'socialRisks',
          'reasonCodes',
        ],
        properties: {
          id: { type: 'string', minLength: 1, maxLength: 128 },
          action: {
            enum: [
              'answer',
              'ask-followup',
              'acknowledge',
              'disclose',
              'tease',
              'invite-support',
              'set-boundary',
              'repair',
              'open-topic',
              'shift-focus',
              'delay',
              'refuse',
              'remain-silent',
            ],
          },
          truthMode: {
            enum: [
              'literal',
              'uncertain-disclosure',
              'privacy-deflection',
              'playful-fiction',
              'character-canon',
              'social-cover',
            ],
          },
          utterance: { type: 'string', maxLength: 1_000 },
          targetActorId: { type: 'string', minLength: 1, maxLength: 256 },
          goalEffects: {
            type: 'array',
            maxItems: 16,
            items: {
              type: 'object',
              additionalProperties: false,
              required: ['goalId', 'progress'],
              properties: {
                goalId: { type: 'string', minLength: 1, maxLength: 128 },
                progress: boundedNumber(-1, 1),
              },
            },
          },
          relationshipBenefit: boundedNumber(-1, 1),
          programValue: boundedNumber(-1, 1),
          novelty: boundedNumber(),
          repetitionCost: boundedNumber(),
          interruptionCost: boundedNumber(),
          manipulationRisk: boundedNumber(),
          factSafetyRisk: boundedNumber(),
          socialRisks: {
            type: 'array',
            uniqueItems: true,
            items: {
              enum: [
                'coercive-cta',
                'dependency',
                'exclusivity',
                'punishment',
                'fabricated-rival',
                'high-stakes-deception',
                'viewer-fact-invention',
              ],
            },
          },
          reasonCodes: stringArray,
        },
      },
    },
  },
};

export const SOUL_REFLECTION_PROPOSAL_SCHEMA_V1: JsonSchemaV1 = {
  $id: 'https://aituber-onair.local/schema/soul-reflection-proposal-v1.json',
  type: 'object',
  additionalProperties: false,
  required: [
    'protocolVersion',
    'goalWeightDeltas',
    'beliefProposals',
    'canonProposals',
    'reasonCodes',
  ],
  properties: {
    protocolVersion: { const: '1.0' },
    goalWeightDeltas: {
      type: 'array',
      maxItems: 32,
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['goalId', 'delta', 'evidenceEventIds', 'reasonCode'],
        properties: {
          goalId: { type: 'string', minLength: 1 },
          delta: boundedNumber(-1, 1),
          evidenceEventIds: stringArray,
          reasonCode: { type: 'string', minLength: 1 },
        },
      },
    },
    beliefProposals: {
      type: 'array',
      maxItems: 64,
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['id', 'proposition', 'confidence', 'evidenceEventIds'],
        properties: {
          id: { type: 'string', minLength: 1 },
          proposition: { type: 'string', minLength: 1, maxLength: 2_000 },
          confidence: boundedNumber(),
          evidenceEventIds: stringArray,
        },
      },
    },
    canonProposals: {
      type: 'array',
      maxItems: 32,
      items: {
        type: 'object',
        additionalProperties: false,
        required: [
          'id',
          'canonKey',
          'content',
          'realityClass',
          'impact',
          'evidenceEventIds',
          'involvesViewerIds',
          'domainTags',
        ],
        properties: {
          id: { type: 'string', minLength: 1 },
          canonKey: { type: 'string', minLength: 1 },
          content: { type: 'string', minLength: 1, maxLength: 4_000 },
          realityClass: {
            enum: ['runtime-lived', 'simulated-offline', 'authored-history', 'dream'],
          },
          impact: { enum: ['low', 'major'] },
          evidenceEventIds: stringArray,
          involvesViewerIds: stringArray,
          domainTags: stringArray,
        },
      },
    },
    reasonCodes: stringArray,
  },
};
