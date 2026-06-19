# AGENTS.md

## Compatibility Revival Spec

This repository has not had sustained maintenance, so do not assume the current
`package.json`, lockfile, Docker image, or docs accurately describe supported
Prettier, Vim, Neovim, Node, or parser-plugin versions.

The immediate goal is to turn compatibility from guesswork into a tracked,
tested support policy. Prefer small, evidence-backed changes over broad
modernization.

## Operating Rules

- Work on `dev/compatibility-revival` for this effort unless directed otherwise.
- Keep runtime fixes small and separately reviewable.
- Do not silently drop legacy support. If support is removed, document the reason
  and provide migration notes.
- Treat async formatting as data-loss-sensitive. Add tests before changing async
  buffer replacement, write behavior, or buffer-switch handling.
- Preserve project-local Prettier behavior. A user's project-local Prettier and
  config should take precedence over bundled fallback tooling.
- Do not use dependency upgrades as proof of compatibility. Every Prettier/plugin
  major bump needs fixture coverage.
- Keep README and `doc/prettier.txt` in sync when user-facing behavior changes.

## Proposed Support Matrix

Use this as the starting hypothesis, not as a final promise.

### Blocking Editor Targets

- Vim 8.2 latest patch with `+job` and `+channel`.
- Vim 9.1 or latest stable Vim.
- Neovim 0.9 latest patch.
- Neovim 0.10 or latest stable Neovim.

### Discovery-Only Editor Targets

- Vim 7.4.
- Vim 8.0 and 8.1.
- Neovim 0.4.x.

These should not be advertised as supported unless CI proves they work. The code
already uses APIs and method-call syntax that are unlikely to be Vim 7 safe.

### Blocking Prettier Targets

- Prettier 3 latest as the primary target.
- Prettier 3.0.3 to validate the current 1.0.0-era package baseline.
- Prettier 2.8.8 as a project-local legacy target.

### Discovery-Only Prettier Targets

- Prettier 1.x. Prefer the existing `release/0.x` path for users that need this
  unless a maintainer explicitly chooses to restore active support.

### Language Coverage

Core Prettier languages to test across Prettier 2.8.8 and 3.x:

- JavaScript, JSX, MJS, CJS.
- TypeScript and TSX.
- CSS, SCSS, Less.
- JSON and YAML.
- HTML and Vue.
- GraphQL.
- Markdown and MDX.

External plugin languages to validate primarily against Prettier 3-compatible
plugin versions:

- PHP.
- Ruby.
- XML.
- Lua.
- Svelte.

## Known Baseline Findings

- `yarn install --frozen-lockfile` succeeds, but current PHP and Svelte parser
  plugin versions report Prettier 1/2 peer compatibility while the package ships
  Prettier 3.0.3.
- `yarn test` on Vim 9.1 originally failed all formatting tests with
  `E930: Cannot use :redir inside execute()`, caused by version detection in
  `autoload/prettier/resolver/config.vim` calling `prettier#PrettierCli()` under
  `redir`.
- `yarn lint` is not reproducible locally because `vint` is expected on `PATH`
  but is not declared in npm dependencies.
- No GitHub Actions workflow currently defines a compatibility matrix.
- The Dockerfile is old and uses Alpine 3.8 plus unpinned `testbed/vim:latest`.
- Docs and runtime filetype support have drifted.

## Current Branch Progress

- Fixed the Vim 9 `redir` failure by making Prettier CLI version detection call
  the resolved executable directly instead of routing through `:PrettierCli`
  inside `redir`.
- Added a focused vim-driver regression test for config version detection inside
  `execute()`.
- Made the Jest/Vim harness use `tests/vimrc` with `-u NONE` so local tests load
  this checkout instead of a user's installed vim-prettier runtime.
- After those fixes, `yarn test` on local Vim 9.1 reaches formatting assertions:
  15 tests pass and 16 fail.
- Remaining core snapshot failures are compatibility deltas rather than the
  original Vim 9 harness failure: GraphQL, SCSS, YAML, and Vue differ from the
  stored snapshots under the current Prettier 3.0.3 toolchain.
- Remaining external plugin failures are no-op formatting for Lua, PHP, Ruby,
  and XML, consistent with stale or unresolved bundled parser plugins.
- Added an initial GitHub Actions smoke workflow. It runs the Vim 9 config
  version regression as a blocking check and runs the full formatting suite as
  non-blocking discovery until plugin compatibility is restored.
- Updated targeted Prettier 3.0.3 snapshots for GraphQL, SCSS, Vue, and YAML
  after confirming those were core formatter deltas.
- Added explicit `plugins` CLI config support and scoped automatic bundled
  plugin loading for PHP and XML to Prettier executables under this checkout.
  PHP and XML fixture tests now pass with the current bundled packages.
- Lua and Ruby fixture tests still fail as no-op formatting. Current bundled Lua
  and Ruby plugin versions are not viable Prettier 3 targets and need separate
  support decisions before being advertised.
- Split formatting tests into a blocking known-passing lane and a quarantined
  Lua/Ruby lane, so CI no longer hides regressions in already-passing fixtures
  behind expected plugin-language failures.
- CI now runs an explicit `vim --version` capability check for `+job` and
  `+channel` in the blocking Vim jobs, plus a blocking `git diff --check` job.
- Added targeted config resolver tests for `g:prettier#config#plugins` and made
  the smoke lane run config resolver tests, not only the original Vim 9
  regression.
- Added project-local Prettier resolver tests proving buffer-tree lookup wins
  over Vim cwd lookup and bundled PHP plugin injection is skipped for
  project-local Prettier outside this checkout.

## Review Findings After b538e29

- At `b538e29`, CI full formatting discovery was non-blocking, so regressions
  in already-passing languages could be hidden.
- The blocking smoke test only protects the Vim 9 `execute()`/config-version
  regression. It does not protect actual formatting, PHP/XML plugin loading,
  async behavior, or project-local Prettier behavior.
- Project-local Prettier behavior is not fully proven because executable
  resolution still uses `getcwd()`, not the buffer's file tree.
- PHP/XML passing is scoped to bundled fallback tooling from this checkout and
  should not be treated as a project-local guarantee.
- Lua/Ruby no-op fixture failures are due to no plugin wiring in their
  ftplugins. Separate direct checks indicate the bundled plugin versions are not
  viable Prettier 3 targets.
- Svelte remains an unmeasured plugin-language gap despite being documented and
  bundled.
- Lint/tooling reproducibility is still incomplete because `vint` is missing,
  Node/Yarn expectations are not pinned or documented, and CI still lacks an
  editor/Prettier matrix beyond the current Ubuntu Vim lanes.

## Work Stages

### Stage 0: Restore a Runnable Baseline

- [x] Fix Vim 9 `redir` failure in Prettier version detection.
- [x] Add a focused regression test for version detection inside vim-driver
  `execute()`.
- [x] Run the full formatting suite and classify remaining failures by cause.
- [x] Record whether failures are harness, Vim compatibility, Prettier core, or
  external parser-plugin failures.

### Stage 1: Define Reproducible Tooling

- [x] Add an initial CI smoke workflow for the known Vim 9 regression and
  non-blocking full-suite discovery.
- [x] Split Jest formatting tests into blocking known-passing and quarantined
  known-failing lanes.
- [x] Harden CI with explicit Vim version/feature checks and `git diff --check`.
- [ ] Add CI with an editor and Prettier compatibility matrix after smoke lanes
  are stable.
- [ ] Resolve `vint` reproducibility through a pinned container or installable
  local deps.
- [ ] Replace or deprecate the current Dockerfile path.
- [ ] Document supported Node and Yarn/package-manager versions.

### Stage 2: Prettier and Plugin Compatibility

- [x] Update classified Prettier 3.0.3 core snapshots for GraphQL, SCSS, Vue,
  and YAML without changing plugin-language snapshots broadly.
- [x] Add explicit plugin argument support for PHP/XML bundled fallback tests.
- [x] Add targeted plugin config tests for `g:prettier#config#plugins`, including
  string, list, empty, invalid, and paths with spaces.
- [x] Add project-local Prettier tests proving bundled plugin injection does not
  override local Prettier/plugins.
- [ ] Validate core Prettier language fixtures on Prettier 2.8.8 and 3.x.
- [ ] Audit bundled parser-plugin versions for PHP, Ruby, XML, Lua, and Svelte.
- [ ] Decide Lua/Ruby/Svelte support policy together before advertising or
  removing any plugin-language support.
- [ ] Decide whether bundled plugin support remains in scope.
- [ ] If bundled plugins remain supported, add explicit plugin resolution without
  breaking project-local Prettier/plugin behavior.
- [ ] Add or update fixtures for each supported plugin language.

### Stage 3: Command and Resolver Hardening

- [x] Fix resolver to search for Prettier from the buffer's file tree, not only
  `getcwd()`.
- [ ] Avoid mutating buffer filetype defaults when merging overrides.
- [ ] Make command construction shell-safe for spaces, quotes, and Windows.
- [ ] Prefer argv-list job/system APIs where Vim/Neovim support allows.
- [ ] Expand config-file discovery for modern Prettier config names.

### Stage 4: Async Safety

- [ ] Track async jobs per buffer instead of with one global running flag.
- [ ] Reset job state on every exit path.
- [ ] Capture and compare `b:changedtick` before replacing async output.
- [ ] Ensure manual `:PrettierAsync` does not unexpectedly write to disk.
- [ ] Add tests for buffer switching, stale output, ignored files, and quickfix
  behavior.

### Stage 5: Docs and Release Prep

- [ ] Sync README and `doc/prettier.txt`.
- [ ] Document supported Vim, Neovim, Node, Prettier, and parser-plugin versions.
- [ ] Document bundled fallback vs project-local Prettier behavior.
- [ ] Add migration notes for unsupported legacy combinations.
- [ ] Cut a prerelease only after CI is green for the declared matrix.

## Verification Commands

- `yarn install --frozen-lockfile`
- `yarn test`
- `yarn lint`
- `git diff --check`

If a command is not runnable, document the exact failure and whether it is a
tooling gap or a product regression.

## Review Checklist

- Does the change improve measured compatibility, or only update assumptions?
- Does it preserve project-local Prettier and config resolution?
- Are known-passing formatting languages protected by blocking CI?
- Do project-local Prettier/plugin tests prove bundled fallback is not overriding
  local tooling?
- Does CI run explicit Vim version/feature checks and `git diff --check`?
- Does it affect async buffer replacement or writes?
- Does it change support policy, install behavior, or user-facing commands?
- Are README and help docs updated when behavior changes?
- Are failures classified instead of hidden by broad snapshot updates?
