#!/bin/bash
# Run once from inside a freshly created uma-tools worktree:
# initializes the submodule, links node_modules from the main checkout,
# and git-excludes the symlink so `git add -A` can never commit it.
set -euo pipefail

cd "$(git rev-parse --show-toplevel)"

git submodule update --init

main_checkout=$(dirname "$(git rev-parse --git-common-dir)")
if [ ! -e node_modules ]; then
	ln -s "$main_checkout/node_modules" node_modules
fi

# The exclude file git actually honors lives in the common dir (the one under
# .git/worktrees/<name>/info/ is never read); --git-path resolves it correctly.
exclude_file=$(git rev-parse --path-format=absolute --git-path info/exclude)
mkdir -p "$(dirname "$exclude_file")"
grep -qx node_modules "$exclude_file" 2>/dev/null || echo node_modules >> "$exclude_file"

echo "worktree ready: submodule initialized, node_modules linked and git-excluded"
