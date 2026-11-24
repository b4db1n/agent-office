/**
 * Office Steward — settings key lists.
 *
 * Browser-safe on purpose: the panel imports this module, so it must not pull
 * in the Node-only helpers that live in settings.mjs.
 */

export const SETTINGS_KEYS = Object.freeze([
  'lead',
  'leadModel',
  'specialistModel',
  'agentModels',
  'language',
  'appearance',
  'notifications',
  'visibleControls',
  'parallelism',
  'budget',
  'advisor',
  'departments',
]);

/**
 * Keys that are stored and validated but read by no behaviour yet. They stay in
 * the schema so existing saved values are not lost, and the panel shows them as
 * stored-but-inactive instead of offering a control that would do nothing.
 */
export const INACTIVE_SETTINGS = Object.freeze([
  'language',
  'appearance',
  'notifications',
  'visibleControls',
]);
