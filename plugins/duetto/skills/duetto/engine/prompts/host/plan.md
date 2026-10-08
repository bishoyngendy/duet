# Host step: synthesize the plan
Compare both plans and both plan rebuttals. Produce one merged plan, and a conflicts list covering every point where the plans differ:
- category "equivalent" when both are fine and you just picked one (status consensus/resolved);
- minor categories (implementation/performance/risk) you may resolve with a resolution;
- requirements/architecture/security/constitution conflicts: status "needs_user" with 2-4 options (keys "claude"/"codex" for the two positions are fine).
Follow the structure and intent of the project's Spec Kit plan template (input `plan_template`); anything it asks for that no field covers goes into `extra_sections`. Add any NEW product ambiguity you notice to questions. The plan must be consistent with the spec and any user decisions so far.
