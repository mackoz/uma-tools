#!/bin/bash
# PR status + cross-link summary across the three repos, replacing the `for … gh pr view
# --repo --json … | gh pr edit --body …` sequence CLAUDE.md's ticket found ~55x in recent
# transcripts.
#
#   scripts/pr-status.sh [TICKET-ID] [--link] [--dry-run]
#
#   TICKET-ID    optional; narrows each repo's `gh pr list` with
#                --search "<TICKET-ID> in:title" instead of listing every open PR
#   --link       mutating: for each PR missing a sibling link, append
#                `Engine PR: <url>` / `Code PR: <url>` / `Plans PR: <url>` lines to its
#                body (never overwrite; appended after a blank line). Refused when more
#                than one open PR matched in a repo and no TICKET-ID was given
#                (ambiguous which PR to edit).
#   --dry-run    print every `gh pr edit` that --link would run, prefixed [dry-run], and
#                exit 0 without running any
#
# Needs `gh` authenticated; each repo without it is reported, not treated as fatal.
set -euo pipefail

usage() {
	cat <<'EOF'
usage: scripts/pr-status.sh [TICKET-ID] [--link] [--dry-run]

Prints one line per open PR across engine/code/plans: repo, #N, draft?,
mergeable, review decision, a checks summary (SUCCESS/FAILURE/PENDING counts
from the status check rollup), head branch, and which of the other two repos'
PRs it links to in its body (engine ✓/–, code ✓/–, plans ✓/–), detected by
scanning the body for `mackoz/<repo>#N`, `<repo>#N`, or the sibling PR's full
URL.

  TICKET-ID   optional; narrows the search in each repo to
              `gh pr list --search "<TICKET-ID> in:title"` instead of every
              open PR
  --link      mutating: for each PR missing a sibling link, append
              `Engine PR: <url>` / `Code PR: <url>` / `Plans PR: <url>` lines
              to its body via `gh pr edit --body-file` (appended after a
              blank line, never overwriting existing body text). Refused
              when more than one open PR matched in a repo and no TICKET-ID
              was given -- ambiguous which PR to edit.
  --dry-run   print the `gh pr edit` commands --link would run, prefixed
              [dry-run], and exit 0 without running any
  --help      print this usage and exit 0

Needs `gh` authenticated. A repo where `gh` is missing or unauthenticated is
reported and skipped, not treated as a fatal error.
EOF
}

ticket_id=""
do_link=0
dry_run=0

for arg in "$@"; do
	case "$arg" in
		--help) usage; exit 0 ;;
		--link) do_link=1 ;;
		--dry-run) dry_run=1 ;;
		-*) echo "pr-status.sh: unknown argument: $arg" >&2; exit 1 ;;
		*)
			if [ -n "$ticket_id" ]; then
				echo "pr-status.sh: only one TICKET-ID may be given" >&2
				exit 1
			fi
			ticket_id="$arg"
			;;
	esac
done

# Clear positional params first -- `source` inherits this script's
# leftover "$@" otherwise, which would feed repo-env.sh's own arg parser
# whatever flags this script was called with (e.g. --fetch, --dry-run).
set --
source "$(dirname "${BASH_SOURCE[0]}")/repo-env.sh"

if ! command -v gh >/dev/null 2>&1 || ! gh auth status >/dev/null 2>&1; then
	echo "pr-status.sh: gh not available or not authenticated" >&2
	exit 1
fi

gh_repo_slug() {
	local dir="$1"
	git -C "$dir" remote get-url origin 2>/dev/null \
		| sed -E 's#^git@github\.com:##; s#^https://github\.com/##; s#\.git$##'
}

# No associative arrays below -- macOS ships bash 3.2 by default, which
# doesn't have them (`declare -A` requires bash 4+). Three fixed slots, so a
# small per-slot helper (dir/default-branch style, matching the other four
# scripts) stands in for a lookup table.
slot_dir() {
	case "$1" in
		engine) echo "$UMA_ENGINE_REPO" ;;
		code) echo "$UMA_CODE_REPO" ;;
		plans) echo "$UMA_PLANS_REPO" ;;
	esac
}

slots="engine code plans"
engine_slug="" code_slug="" plans_slug=""
engine_json="" code_json="" plans_json=""

for slot in $slots; do
	dir="$(slot_dir "$slot")"
	if [ ! -d "$dir" ] || ! git -C "$dir" rev-parse --is-inside-work-tree >/dev/null 2>&1; then
		echo "$slot: not present ($dir)"
		continue
	fi
	slug="$(gh_repo_slug "$dir")"
	search_args=()
	if [ -n "$ticket_id" ]; then
		search_args=(--search "$ticket_id in:title")
	fi
	json="$(gh pr list --repo "$slug" --state open "${search_args[@]}" \
		--json number,title,url,isDraft,mergeable,reviewDecision,headRefName,body,statusCheckRollup 2>/dev/null || echo '[]')"
	case "$slot" in
		engine) engine_slug="$slug"; engine_json="$json" ;;
		code) code_slug="$slug"; code_json="$json" ;;
		plans) plans_slug="$slug"; plans_json="$json" ;;
	esac
done

# Collect every PR's URL/repo#N form once, so cross-link detection can check
# a body against every sibling PR found in this same run.
all_refs_node_input="{"
first=1
for slot in $slots; do
	case "$slot" in
		engine) slug="$engine_slug"; json="$engine_json" ;;
		code) slug="$code_slug"; json="$code_json" ;;
		plans) slug="$plans_slug"; json="$plans_json" ;;
	esac
	[ -n "$json" ] || continue
	if [ $first -eq 0 ]; then all_refs_node_input+=","; fi
	first=0
	all_refs_node_input+="\"$slot\":{\"slug\":\"$slug\",\"prs\":$json}"
done
all_refs_node_input+="}"

node -e '
	const data = JSON.parse(process.argv[1]);
	const doLink = process.argv[2] === "1";
	const dryRun = process.argv[3] === "1";

	const slots = ["engine", "code", "plans"];
	const label = { engine: "Engine", code: "Code", plans: "Plans" };

	function refForms(slug, num) {
		const [owner, repo] = slug.split("/");
		return [`${slug}#${num}`, `${repo}#${num}`, `https://github.com/${slug}/pull/${num}`];
	}

	function checksSummary(rollup) {
		if (!rollup || rollup.length === 0) return "no checks";
		const counts = {};
		for (const c of rollup) {
			const s = c.conclusion || c.status || "PENDING";
			counts[s] = (counts[s] || 0) + 1;
		}
		return Object.entries(counts).map(([k, v]) => `${k}:${v}`).join(",");
	}

	// Ambiguity check for --link: more than one open PR in a repo with no
	// ticket ID given.
	if (doLink && !process.argv[4]) {
		for (const slot of slots) {
			const prs = data[slot] ? data[slot].prs : [];
			if (prs.length > 1) {
				console.error(`pr-status.sh: --link refused -- ${slot} has ${prs.length} open PRs matched and no TICKET-ID was given (ambiguous)`);
				process.exit(1);
			}
		}
	}

	for (const slot of slots) {
		if (!data[slot]) {
			continue;
		}
		const slug = data[slot].slug;
		const prs = data[slot].prs;
		if (prs.length === 0) {
			console.log(`${slot}: no open PRs`);
			continue;
		}
		for (const pr of prs) {
			const linkStatus = {};
			for (const other of slots) {
				if (other === slot || !data[other]) continue;
				let found = false;
				for (const otherPr of data[other].prs) {
					const forms = refForms(data[other].slug, otherPr.number);
					if (forms.some((f) => (pr.body || "").includes(f))) {
						found = true;
						break;
					}
				}
				linkStatus[other] = found;
			}
			const linksStr = slots
				.filter((s) => s !== slot)
				.map((s) => `${s} ${data[s] ? (linkStatus[s] ? "✓" : "–") : "–"}`)
				.join(", ");
			console.log(
				`${slot}: #${pr.number}${pr.isDraft ? " (draft)" : ""} mergeable=${pr.mergeable || "UNKNOWN"} review=${pr.reviewDecision || "NONE"} checks=[${checksSummary(pr.statusCheckRollup)}] head=${pr.headRefName} links: ${linksStr}`,
			);

			if (doLink) {
				const missing = slots.filter((s) => s !== slot && data[s] && data[s].prs.length > 0 && !linkStatus[s]);
				if (missing.length === 0) continue;
				const lines = missing.map((s) => {
					const otherPr = data[s].prs[0];
					return `${label[s]} PR: https://github.com/${data[s].slug}/pull/${otherPr.number}`;
				});
				const appendText = "\n\n" + lines.join("\n") + "\n";
				if (dryRun) {
					console.log(`[dry-run] gh pr edit ${pr.number} --repo ${slug} --body-file <appended body>`);
					for (const l of lines) console.log(`[dry-run]   ${l}`);
				} else {
					const fs = require("fs");
					const os = require("os");
					const path = require("path");
					const { execFileSync } = require("child_process");
					const newBody = (pr.body || "") + appendText;
					const tmp = path.join(os.tmpdir(), `pr-status-body-${slot}-${pr.number}.md`);
					fs.writeFileSync(tmp, newBody, "utf8");
					execFileSync("gh", ["pr", "edit", String(pr.number), "--repo", slug, "--body-file", tmp]);
					fs.unlinkSync(tmp);
					console.log(`  linked: appended ${missing.join(", ")}`);
				}
			}
		}
	}
' "$all_refs_node_input" "$do_link" "$dry_run" "$ticket_id"
