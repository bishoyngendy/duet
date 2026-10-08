import { arr, bool, enm, nint, nstr, obj, str, strs, type Schema } from './schema.ts';

export const AGENTS = ['claude', 'codex'] as const;
export type AgentName = (typeof AGENTS)[number];

export const QUESTION_CATEGORIES = [
  'product',
  'requirements',
  'architecture',
  'implementation',
  'ux',
  'data',
  'security',
  'performance',
  'testing',
  'other',
] as const;

export const CONFLICT_CATEGORIES = [
  'equivalent',
  'implementation',
  'performance',
  'risk',
  'requirements',
  'architecture',
  'security',
  'constitution',
  'other',
] as const;

export const SEVERITIES = ['critical', 'high', 'medium', 'low', 'nit'] as const;

const Option = obj({ key: str('Short key, e.g. "A"'), label: str(), description: str() });

const Question = obj({
  id: str('Stable id, e.g. "Q1"'),
  text: str(),
  category: enm(QUESTION_CATEGORIES),
  blocking: bool('True if planning cannot responsibly proceed without an answer'),
  affects: strs('Parts of the system/spec this answer changes'),
  options: arr(Option),
  recommendation: nstr('Option key you recommend, or null'),
  rationale: str(),
});

const Position = obj({ recommendation: nstr('Option key'), rationale: str() });

export const MergedQuestion = obj({
  id: str('Stable id, e.g. "Q1"'),
  text: str(),
  category: enm(QUESTION_CATEGORIES),
  blocking: bool(),
  affects: strs(),
  options: arr(Option),
  claude: { anyOf: [Position, { type: 'null' }], description: "Claude's position, null if it didn't raise this" },
  codex: { anyOf: [Position, { type: 'null' }], description: "Codex's position, null if it didn't raise this" },
  status: enm(['consensus', 'split', 'single'], 'consensus = both recommend the same option'),
  suggested: nstr('Option key to pre-select for the user (consensus recommendation), else null'),
});

const Finding = obj({
  id: str(),
  severity: enm(SEVERITIES),
  file: nstr(),
  line: nint(),
  issue: str(),
  required_change: str(),
});

const ExtraSections = arr(obj({ heading: str(), body: str('Markdown') }), 'Sections the template asks for that no other field covers');

const PlanSchema = obj({
  summary: str(),
  technical_context: obj({
    language: str('Language/version, or "NEEDS CLARIFICATION: …"'),
    dependencies: str('Primary dependencies'),
    storage: str('Storage, or "N/A"'),
    testing: str('Test frameworks/commands'),
    platform: str('Target platform'),
    project_type: str('library / cli / web-service / mobile-app / …'),
    performance_goals: str('Performance goals, or "N/A"'),
    constraints: str('Constraints, or "N/A"'),
    scale: str('Scale/scope'),
  }),
  constitution_check: arr(
    obj({ principle: str(), status: enm(['pass', 'violation', 'justified']), note: str('Evidence; for "justified", why it is needed and the simpler alternative rejected') }),
    'One entry per constitution principle the plan touches',
  ),
  project_structure: str('The real source tree this feature touches (text tree), or "unchanged"'),
  architecture: str('Prose description of the approach and how it fits the existing system'),
  components: arr(obj({ name: str(), responsibility: str(), files: strs() })),
  data_model: str('Data/state changes, or "none"'),
  decisions: arr(obj({ topic: str(), choice: str(), rationale: str(), alternatives: strs() })),
  file_changes: arr(obj({ path: str(), change: enm(['create', 'modify', 'delete']), description: str() })),
  testing_strategy: str(),
  risks: arr(obj({ risk: str(), mitigation: str() })),
  rollout: str('Migration/rollout/feature-flag notes, or "none"'),
  contracts: arr(obj({ path: str('File name under contracts/, e.g. "api.md" or "events.schema.json"'), content: str() }), 'Interface/API contracts, if the feature has any'),
  quickstart: str('How to exercise and validate the feature end to end (markdown), or "none"'),
  open_questions: strs(),
  extra_sections: ExtraSections,
});

const Conflict = obj({
  id: str('e.g. "C1"'),
  topic: str(),
  category: enm(CONFLICT_CATEGORIES),
  claude_position: str(),
  codex_position: str(),
  resolution: nstr('How it was resolved, or null if it needs the user'),
  status: enm(['consensus', 'resolved', 'needs_user']),
  options: arr(Option, 'Choices to offer the user if it needs a decision'),
});

const Rebuttal = obj({
  agreements: strs('Points from the other model you agree with'),
  disagreements: arr(obj({ point: str(), other_position: str(), my_position: str(), reasoning: str() })),
  revisions: arr(obj({ point: str(), revised_position: str(), why: str() }), 'Where the other model changed your mind'),
  new_insights: strs(),
});

export const SCHEMAS: Record<string, Schema> = {
  Scan: obj({
    summary: str(),
    stack: strs(),
    relevant_areas: arr(obj({ path: str(), why: str() })),
    conventions: strs(),
    risks: strs(),
    suggested_features: arr(obj({ title: str(), summary: str() })),
  }),

  Decomposition: obj({
    rationale: str(),
    features: arr(
      obj({
        id: str('"F1", "F2", …'),
        slug: str('kebab-case, short'),
        title: str(),
        summary: str(),
        scope: str('What is in and out of scope for this feature'),
        depends_on: strs('Feature ids this builds on'),
      }),
    ),
  }),

  Research: obj({
    summary: str(),
    findings: arr(obj({ topic: str(), detail: str(), sources: strs('Files, docs or URLs') })),
    relevant_files: arr(obj({ path: str(), why: str() })),
    existing_patterns: strs(),
    options: arr(obj({ name: str(), pros: strs(), cons: strs() })),
    recommendation: str(),
    risks: strs(),
    open_questions: strs(),
  }),

  Rebuttal,

  ResearchSynthesis: obj({
    summary: str(),
    consensus: strs(),
    disagreements: arr(obj({ topic: str(), claude: str(), codex: str(), assessment: str() })),
    key_files: arr(obj({ path: str(), why: str() })),
    recommended_approach: str(),
    risks: strs(),
    open_questions: strs(),
  }),

  Questions: obj({
    no_blocking_unknowns: bool('True if you have no blocking questions left'),
    questions: arr(Question),
  }),

  MergedQuestions: obj({ questions: arr(MergedQuestion) }),

  Spec: obj({
    title: str(),
    summary: str(),
    user_stories: arr(
      obj({
        id: str('"US1", "US2", … in priority order'),
        title: str(),
        priority: enm(['P1', 'P2', 'P3', 'P4', 'P5'], 'P1 = the MVP'),
        story: str('The user journey in plain language'),
        why_priority: str(),
        independent_test: str('How this story alone can be tested and delivers value'),
      }),
    ),
    functional_requirements: arr(obj({ id: str('FR-001'), text: str('"System MUST …"; mark unknowns "[NEEDS CLARIFICATION: …]"') })),
    non_functional_requirements: arr(obj({ id: str('NFR-001'), text: str() })),
    key_entities: arr(obj({ name: str(), description: str('What it represents and its key attributes, no implementation') })),
    acceptance_criteria: arr(obj({ id: str('AC-001'), story: nstr('User story id it belongs to, or null'), given: str(), when: str(), then: str() })),
    success_criteria: arr(obj({ id: str('SC-001'), text: str('Measurable, technology-agnostic outcome') })),
    edge_cases: strs(),
    out_of_scope: strs(),
    assumptions: strs(),
    needs_clarification: strs('Open questions the spec could not settle (empty once clarified)'),
    extra_sections: ExtraSections,
  }),

  Plan: PlanSchema,

  PlanSynthesis: obj({
    plan: PlanSchema,
    conflicts: arr(Conflict),
    questions: arr(MergedQuestion, 'New ambiguities the user must decide (non-minor conflicts are added automatically)'),
  }),

  Challenge: obj({
    findings: arr(
      obj({
        id: str(),
        category: enm(['architecture', 'security', 'migration', 'performance', 'edge_case', 'testing', 'product', 'rollback', 'other']),
        severity: enm(SEVERITIES),
        issue: str(),
        failure_scenario: str(),
        suggested_fix: str(),
      }),
    ),
  }),

  ChallengeSynthesis: obj({
    plan: PlanSchema,
    accepted: arr(obj({ id: str(), source: enm(['claude', 'codex']), change_made: str() })),
    rejected: arr(obj({ id: str(), source: enm(['claude', 'codex']), reason: str() })),
    questions: arr(MergedQuestion),
  }),

  PlanFinal: obj({ plan: PlanSchema }),

  Tasks: obj({
    tasks: arr(
      obj({
        id: str('"T001", …'),
        title: str(),
        phase: enm(['setup', 'foundational', 'story', 'polish'], "Spec Kit's task phases"),
        story: nstr('User story id (e.g. "US1") for phase "story", else null'),
        description: str('Self-contained brief: what to build, where, and how it fits the plan'),
        depends_on: strs(),
        files_in_scope: strs('Glob patterns of files this task may touch'),
        acceptance: strs(),
        test_command: nstr('Command that verifies this task, or null to use project checks'),
      }),
    ),
  }),

  Implementation: obj({
    summary: str(),
    files_changed: strs(),
    tests_added: strs(),
    addressed_findings: arr(obj({ id: str(), how: str() })),
    disputed_findings: arr(obj({ id: str(), why: str() }), 'Findings you believe are wrong, with reasoning'),
    concerns: strs(),
  }),

  Review: obj({
    status: enm(['approved', 'changes_required']),
    summary: str(),
    findings: arr(Finding),
    acceptance: arr(obj({ criterion: str(), met: bool(), note: str() })),
  }),

  Converge: obj({
    status: enm(['converged', 'issues']),
    summary: str(),
    acceptance: arr(obj({ id: str(), met: bool(), evidence: str() })),
    findings: arr(Finding),
  }),

  AgentTest: obj({ ok: bool(), model: str('Your model name'), command_output: str('Exact stdout of the command you ran'), wrote_file: bool() }),
};

export type Severity = (typeof SEVERITIES)[number];
export type MergedQ = {
  id: string;
  text: string;
  category: string;
  blocking: boolean;
  affects: string[];
  options: { key: string; label: string; description: string }[];
  claude: { recommendation: string | null; rationale: string } | null;
  codex: { recommendation: string | null; rationale: string } | null;
  status: 'consensus' | 'split' | 'single';
  suggested: string | null;
};
export type Answer = { id: string; question: string; choice: string; label: string };
export type Feature = { id: string; slug: string; title: string; summary: string; scope: string; depends_on: string[] };
export type Task = {
  id: string;
  title: string;
  /** Absent in runs made before Spec Kit phases. */
  phase?: 'setup' | 'foundational' | 'story' | 'polish';
  story?: string | null;
  description: string;
  depends_on: string[];
  files_in_scope: string[];
  acceptance: string[];
  test_command: string | null;
};
