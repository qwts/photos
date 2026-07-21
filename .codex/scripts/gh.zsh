#!/bin/zsh
set -euo pipefail

readonly gh_subcommand="${1:-}"

case "$gh_subcommand" in
  --help | --version | api | auth | browse | cache | codespace | gist | help | issue | label | pr | project | release | repo | ruleset | run | search | secret | ssh-key | status | variable | workflow) ;;
  *)
    print -u2 -- "GitHub CLI subcommand requires normal Codex approval: ${gh_subcommand:-<missing>}"
    exit 64
    ;;
esac

if [[ -d "/opt/homebrew/bin" ]]; then
  export PATH="/opt/homebrew/bin:$PATH"
fi

readonly gh_executable="$(command -v gh || true)"

if [[ -z "$gh_executable" ]]; then
  print -u2 -- "GitHub CLI (gh) was not found on PATH"
  exit 127
fi

exec "$gh_executable" "$@"
