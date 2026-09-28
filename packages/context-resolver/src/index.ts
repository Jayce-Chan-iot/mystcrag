export {
  MANUAL_SOURCE_WEIGHT,
  QUESTIONNAIRE_SOURCE_WEIGHT,
  resolveManualContext,
  resolveQuestionnaireContext,
  type DirectContextInput
} from "./questionnaire.js";
export {
  TAROT_SOURCE_WEIGHT,
  resolveTarotContext,
  tarotSubjectForCard,
  type TarotKnowledgeRule
} from "./tarot.js";
export { mergeContexts } from "./merge.js";
export {
  ORACLE_DESIGN_RULE_VERSION,
  ORACLE_SOURCE_WEIGHT,
  deriveOracleDesignSignal,
  resolveOracleContext
} from "./oracle.js";
