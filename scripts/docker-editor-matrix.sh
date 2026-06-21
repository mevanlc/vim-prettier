#!/bin/sh
set -eu

ROOT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
DOCKERFILE="$ROOT_DIR/docker/editor-matrix.Dockerfile"
PLATFORM=${DOCKER_PLATFORM:-linux/amd64}
VIM_STABLE_VERSION=${VIM_STABLE_VERSION:-v9.1.2050}
COMMAND=${DOCKER_MATRIX_COMMAND:-"node scripts/vim-version.js && yarn --version && yarn install --frozen-lockfile && yarn test:smoke"}

usage() {
  cat <<'USAGE'
Usage: scripts/docker-editor-matrix.sh [target|all]

Targets:
  vim-8.2       Vim v8.2.5172
  vim-stable    Vim stable tag from VIM_STABLE_VERSION, default v9.1.2050
  nvim-0.9      Neovim v0.9.5
  nvim-stable   Neovim stable release
  all           Run every target

Environment:
  DOCKER_PLATFORM        Docker platform, default linux/amd64
  VIM_STABLE_VERSION     Vim tag for vim-stable, default v9.1.2050
  DOCKER_MATRIX_COMMAND  Command to run in /workspace inside the container

Examples:
  scripts/docker-editor-matrix.sh vim-8.2
  scripts/docker-editor-matrix.sh all
  DOCKER_MATRIX_COMMAND='yarn test:formatting:core' scripts/docker-editor-matrix.sh vim-stable
USAGE
}

target_flavor() {
  case "$1" in
    vim-8.2|vim-stable) printf '%s\n' vim ;;
    nvim-0.9|nvim-stable) printf '%s\n' nvim ;;
    *) return 1 ;;
  esac
}

target_version() {
  case "$1" in
    vim-8.2) printf '%s\n' v8.2.5172 ;;
    vim-stable) printf '%s\n' "$VIM_STABLE_VERSION" ;;
    nvim-0.9) printf '%s\n' v0.9.5 ;;
    nvim-stable) printf '%s\n' stable ;;
    *) return 1 ;;
  esac
}

run_target() {
  target=$1
  flavor=$(target_flavor "$target")
  version=$(target_version "$target")
  image="vim-prettier-editor-matrix:${target}"
  node_modules_volume="vim-prettier-editor-matrix-${target}-node-modules"
  yarn_cache_volume="vim-prettier-editor-matrix-yarn-cache"
  editor_executable=/usr/local/bin/editor-under-test
  editor_executable_args=

  if [ "$flavor" = nvim ]; then
    editor_executable_args=--headless
  fi

  printf 'Building %s (%s %s) for %s\n' "$target" "$flavor" "$version" "$PLATFORM"
  docker build \
    --platform "$PLATFORM" \
    --build-arg "EDITOR_FLAVOR=$flavor" \
    --build-arg "EDITOR_VERSION=$version" \
    -f "$DOCKERFILE" \
    -t "$image" \
    "$ROOT_DIR/docker"

  printf 'Running %s\n' "$target"
  docker run \
    --rm \
    --platform "$PLATFORM" \
    -e "VIM_EXECUTABLE=$editor_executable" \
    -e "VIM_EXECUTABLE_ARGS=$editor_executable_args" \
    -e PRETTIER_EXEC_CMD_PATH= \
    -e LOG_LEVEL=error \
    -e PRETTIER_FORMATTING_FIXTURE_LANE=all \
    -v "$ROOT_DIR:/workspace" \
    -v "$node_modules_volume:/workspace/node_modules" \
    -v "$yarn_cache_volume:/usr/local/share/.cache/yarn" \
    -w /workspace \
    "$image" \
    sh -lc "$COMMAND"
}

target=${1:-all}

case "$target" in
  -h|--help)
    usage
    exit 0
    ;;
  all)
    for matrix_target in vim-8.2 vim-stable nvim-0.9 nvim-stable; do
      run_target "$matrix_target"
    done
    ;;
  vim-8.2|vim-stable|nvim-0.9|nvim-stable)
    run_target "$target"
    ;;
  *)
    usage >&2
    exit 2
    ;;
esac
