# Host step: merge clarification questions
Merge both engineers' question lists into one deduplicated list for the human. For each merged question:
- combine duplicates; keep the sharpest wording and the union of good options;
- set claude/codex to each engineer's recommendation+rationale (null if that engineer didn't raise it);
- status: "consensus" if both recommend the same option, "split" if they differ, "single" if only one raised it;
- suggested: the consensus option key, else null.
Drop questions that are already answered by research or previous answers. Order blocking questions first. If both report no blocking unknowns and nothing material remains, return an empty list.
