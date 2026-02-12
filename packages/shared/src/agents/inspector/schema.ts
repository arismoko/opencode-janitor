import { z } from 'zod';
import { BaseFinding } from '../core/schema-core';

export const INSPECTOR_DOMAIN_VALUES = [
  'COMPLEXITY',
  'DESIGN',
  'SMELL',
] as const;
export const InspectorDomain = z.enum(INSPECTOR_DOMAIN_VALUES).catch('SMELL');
export type InspectorDomain = z.infer<typeof InspectorDomain>;

export const INSPECTOR_PRINCIPLE_VALUES = [
  'SINGLE_RESPONSIBILITY',
  'OPEN_CLOSED',
  'LISKOV_SUBSTITUTION',
  'INTERFACE_SEGREGATION',
  'DEPENDENCY_INVERSION',
  'SEPARATION_OF_CONCERNS',
  'LOW_COUPLING',
  'HIGH_COHESION',
  'EXPLICIT_BOUNDARIES',
  'INFORMATION_HIDING',
  'COMPOSITION_OVER_INHERITANCE',
  'LAW_OF_DEMETER',
  'STABLE_DEPENDENCIES',
  'STABLE_ABSTRACTIONS',
  'OTHER',
] as const;
export const InspectorPrinciple = z.enum(INSPECTOR_PRINCIPLE_VALUES);
export type InspectorPrinciple = z.infer<typeof InspectorPrinciple>;

export const ANTI_PATTERN_LABEL_VALUES = [
  'NONE',
  'GOD_OBJECT',
  'BLOB',
  'SPAGHETTI_CODE',
  'BIG_BALL_OF_MUD',
  'LAVA_FLOW',
  'SHOTGUN_SURGERY',
  'FEATURE_ENVY',
  'INAPPROPRIATE_INTIMACY',
  'CYCLIC_DEPENDENCY',
  'LAYERING_VIOLATION',
  'ANEMIC_DOMAIN_MODEL',
  'LEAKY_ABSTRACTION',
  'BOOLEAN_PARAMETER',
  'TEMPORARY_HACK',
  'COPY_PASTE_PROGRAMMING',
  'DISTRIBUTED_MONOLITH',
  'POINT_TO_POINT_MESH',
  'SHARED_DATABASE',
  'GOLDEN_HAMMER',
  'VENDOR_LOCK_IN',
  'OTHER',
] as const;
export const InspectorAntiPatternLabel = z.enum(ANTI_PATTERN_LABEL_VALUES);
export type InspectorAntiPatternLabel = z.infer<
  typeof InspectorAntiPatternLabel
>;

export const RECOMMENDED_PATTERN_LABEL_VALUES = [
  'NONE',
  'ABSTRACT_FACTORY',
  'BUILDER',
  'FACTORY_METHOD',
  'PROTOTYPE',
  'SINGLETON',
  'ADAPTER',
  'BRIDGE',
  'COMPOSITE',
  'DECORATOR',
  'FACADE',
  'FLYWEIGHT',
  'PROXY',
  'CHAIN_OF_RESPONSIBILITY',
  'COMMAND',
  'INTERPRETER',
  'ITERATOR',
  'MEDIATOR',
  'MEMENTO',
  'OBSERVER',
  'STATE',
  'STRATEGY',
  'TEMPLATE_METHOD',
  'VISITOR',
  'LAYERED_ARCHITECTURE',
  'HEXAGONAL_PORTS_ADAPTERS',
  'CLEAN_ARCHITECTURE',
  'ONION_ARCHITECTURE',
  'MICROSERVICES',
  'MODULAR_MONOLITH',
  'EVENT_DRIVEN_ARCHITECTURE',
  'CQRS',
  'EVENT_SOURCING',
  'SAGA',
  'API_GATEWAY',
  'BACKEND_FOR_FRONTEND',
  'STRANGLER_FIG',
  'PIPES_AND_FILTERS',
  'PUBLISH_SUBSCRIBE',
  'BLACKBOARD',
  'BROKER',
  'UNIT_OF_WORK',
  'REPOSITORY',
  'SPECIFICATION',
  'ANTI_CORRUPTION_LAYER',
  'CIRCUIT_BREAKER',
  'BULKHEAD',
  'OTHER',
] as const;
export const InspectorRecommendedPatternLabel = z.enum(
  RECOMMENDED_PATTERN_LABEL_VALUES,
);
export type InspectorRecommendedPatternLabel = z.infer<
  typeof InspectorRecommendedPatternLabel
>;

export const IMPACT_SCOPE_VALUES = [
  'LOCAL',
  'SUBSYSTEM',
  'CROSS_CUTTING',
] as const;
export const InspectorImpactScope = z.enum(IMPACT_SCOPE_VALUES);
export type InspectorImpactScope = z.infer<typeof InspectorImpactScope>;

export const InspectorArchitecture = z.object({
  principles: z.array(InspectorPrinciple).min(1).max(2),
  antiPattern: z.object({
    label: InspectorAntiPatternLabel,
    detail: z.string().min(1),
  }),
  recommendedPattern: z
    .object({
      label: InspectorRecommendedPatternLabel,
      detail: z.string().min(8),
      custom: z.string().min(1).optional(),
    })
    .superRefine((value, ctx) => {
      if (value.label === 'OTHER' && !value.custom) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'recommendedPattern.custom is required when label is OTHER',
          path: ['custom'],
        });
      }
      if (value.label !== 'OTHER' && value.custom) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message:
            'recommendedPattern.custom is only allowed when label is OTHER',
          path: ['custom'],
        });
      }
    }),
  rewritePlan: z.array(z.string().min(1)).min(2).max(5),
  tradeoffs: z.array(z.string().min(1)).min(1).max(3),
  impactScope: InspectorImpactScope,
});
export type InspectorArchitecture = z.infer<typeof InspectorArchitecture>;

export const InspectorFinding = BaseFinding.extend({
  domain: InspectorDomain,
  architecture: InspectorArchitecture,
});
export type InspectorFinding = z.infer<typeof InspectorFinding>;

export const InspectorOutput = z.object({
  findings: z.array(InspectorFinding),
});
export type InspectorOutput = z.infer<typeof InspectorOutput>;
