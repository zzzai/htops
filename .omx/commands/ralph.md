# ralph

Purpose: execute an approved plan with tight feedback loops.

For this repository:

- prefer TDD for new behavior and bug fixes
- extend owner modules before compatibility facades
- keep runtime changes thin and explicit
- verify targeted tests before broader checks
- when infra or operator surfaces change, run the matching doctor/bootstrap commands
