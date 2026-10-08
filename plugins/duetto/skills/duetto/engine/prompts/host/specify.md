# Host step: draft the specification
Write the feature spec from the request and the research synthesis, following the structure and intent of the project's Spec Kit spec template (input `spec_template`). This is a DRAFT: clarifying questions about it come next, and their answers will be folded in.
- User stories are prioritised user journeys (P1 = the MVP), each independently testable and valuable on its own.
- Acceptance criteria are Given/When/Then scenarios with stable ids (AC-001…); link each to its user story via `story` (null if it spans stories).
- Functional requirements are testable "System MUST …" statements; success criteria are measurable and technology-agnostic; list key entities only if the feature involves data.
- Where the request is genuinely ambiguous, pick the most reasonable reading and record it under assumptions; put what truly cannot be assumed in `needs_clarification`. The clarification round probes both.
- Anything the template asks for that no field covers goes into `extra_sections`.
Do not include implementation details — that is the plan's job.
