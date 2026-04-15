# team

Purpose: parallelize only the work that is truly independent.

For this repository:

- split by disjoint write scope
- do not parallelize changes that all hinge on `src/runtime.ts`
- good candidates:
  - one worker on docs
  - one worker on tests
  - one worker on serving/query code
- bad candidates:
  - overlapping runtime routing changes
  - two workers editing the same report renderer
  - urgent blocking diagnosis that the main path needs immediately
