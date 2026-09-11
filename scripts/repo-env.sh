#!/usr/bin/env bash
# Derives UMA_CODE_REPO, UMA_ENGINE_REPO, UMA_PLANS_REPO -- the three repo paths every
# skill/script in this project's three-repo loop was re-deriving independently (PIPE-67).
# Sourceable (`source scripts/repo-env.sh`) and runnable (`bash scripts/repo-env.sh --print`).
#
#   source scripts/repo-env.sh          exports all three vars into the current shell
#   bash scripts/repo-env.sh --print    prints three `export NAME="value"` lines (for a
#                                        SessionStart hook writing to $CLAUDE_ENV_FILE, or
#                                        `eval "$(bash scripts/repo-env.sh --print)"`)
#   bash scripts/repo-env.sh --check    exits 1 and names any of the three paths that
#                                        isn't a git work tree (e.g. no sibling plans clone)
#
# A variable already set in the calling environment wins over the derivation below --
# a per-machine override needs nothing but `export UMA_PLANS_REPO=/somewhere/else` before
# sourcing this. Works when the plans symlink/sibling clone is absent (a checkout without
# the private plans repo): the derivation still produces a path, --print still emits it,
# --check just reports it as not a git work tree instead of erroring out itself.
#
# Safe under `set -u` when sourced from bash: every variable reference below has a
# default. Uses `return`, not `exit`, when sourced (detected via BASH_SOURCE vs $0) so
# sourcing this into an interactive or scripted shell can't kill it.

_uma_repo_env_run() {
	local script_source="${BASH_SOURCE[0]:-}"
	if [ -z "$script_source" ] && [ -n "${ZSH_VERSION:-}" ]; then
		# zsh has no BASH_SOURCE; ${(%):-%x} is its own equivalent (current
		# sourced-file path). Routed through `eval` on a single-quoted string so
		# bash's own parser (which reads this whole file even for branches it
		# doesn't take) never sees the zsh-only `(%)` syntax and errors out.
		script_source="$(eval 'print -r -- ${(%):-%x}' 2>/dev/null)"
	fi
	: "${script_source:=$0}"
	local script_dir
	script_dir="$(cd -P "$(dirname "$script_source")" >/dev/null 2>&1 && pwd)"

	# UMA_CODE_REPO: this script lives at <code repo>/scripts/repo-env.sh, so the repo
	# root is its parent directory's toplevel -- works from a worktree too, since
	# `rev-parse --show-toplevel` resolves per-worktree, not to the main checkout.
	local code_repo="${UMA_CODE_REPO:-}"
	if [ -z "$code_repo" ]; then
		code_repo="$(git -C "$script_dir/.." rev-parse --show-toplevel 2>/dev/null)"
		if [ -z "$code_repo" ]; then
			code_repo="$(cd -P "$script_dir/.." >/dev/null 2>&1 && pwd)"
		fi
	fi

	local engine_repo="${UMA_ENGINE_REPO:-$code_repo/uma-skill-tools}"

	# UMA_PLANS_REPO: prefer the (gitignored) `plans` symlink inside the code repo --
	# resolved with `cd -P`, not `readlink -f` (no GNU coreutils on stock macOS) -- and
	# fall back to the sibling-directory convention `<code repo>/../uma-tools-plans`
	# normalized the same way, for a checkout with no symlink at all.
	local plans_repo="${UMA_PLANS_REPO:-}"
	if [ -z "$plans_repo" ]; then
		if [ -e "$code_repo/plans" ]; then
			plans_repo="$(cd -P "$code_repo/plans" >/dev/null 2>&1 && pwd)"
		fi
		if [ -z "$plans_repo" ]; then
			local code_parent
			code_parent="$(cd -P "$code_repo/.." >/dev/null 2>&1 && pwd)"
			plans_repo="${code_parent:-$code_repo/..}/uma-tools-plans"
		fi
	fi

	export UMA_CODE_REPO="$code_repo"
	export UMA_ENGINE_REPO="$engine_repo"
	export UMA_PLANS_REPO="$plans_repo"

	local action="${1:-}"
	local rc=0
	case "$action" in
		--print)
			printf 'export UMA_CODE_REPO=%q\n' "$UMA_CODE_REPO"
			printf 'export UMA_ENGINE_REPO=%q\n' "$UMA_ENGINE_REPO"
			printf 'export UMA_PLANS_REPO=%q\n' "$UMA_PLANS_REPO"
			;;
		--check)
			local name repo_dir
			for name in UMA_CODE_REPO UMA_ENGINE_REPO UMA_PLANS_REPO; do
				eval "repo_dir=\"\$$name\""
				if [ -z "$repo_dir" ] || ! git -C "$repo_dir" rev-parse --is-inside-work-tree >/dev/null 2>&1; then
					echo "repo-env.sh --check: $name ($repo_dir) is not a git work tree" >&2
					rc=1
				fi
			done
			;;
		"")
			: # sourced with no args -- the exports above are the whole point
			;;
		*)
			echo "repo-env.sh: unknown option: $action (expected --print or --check)" >&2
			rc=1
			;;
	esac
	return $rc
}

# Under `zsh scripts/repo-env.sh` (direct execution, no BASH_SOURCE) this takes the "sourced"
# branch and ends in `return`, which zsh treats as `exit` at a script's top level -- correct
# exit code, just by a different route than bash. Don't "fix" it into an `exit` here: that
# would kill an interactive zsh that sources this file.
if [ "${BASH_SOURCE[0]:-}" != "$0" ]; then
	_uma_repo_env_run "$@"
	_uma_repo_env_rc=$?
	unset -f _uma_repo_env_run
	return $_uma_repo_env_rc
else
	_uma_repo_env_run "${1:---print}"
	_uma_repo_env_rc=$?
	unset -f _uma_repo_env_run
	exit $_uma_repo_env_rc
fi
