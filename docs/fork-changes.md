# Fork changes (preserved from the original README)

This page preserves, verbatim, the changelog the previous maintainer ("Jecht") wrote when forking Umalator. It documents real simulation-accuracy decisions — keep it around even as the rest of the docs get restructured, since the *reasoning* behind these choices (not just the diff) matters for anyone touching `uma-skill-tools/`.

**Several claims below are no longer differentiators from upstream.** Upstream independently implemented rushed/kakari, downhill mode, and wisdom-gated skill activation, and independently fixed the same 60m-spurt and section-modifier bugs, all in its own engine repo after this fork split off — see the convergence table in [upstream-comparison.md](upstream-comparison.md#where-both-converged-independently) before assuming any of "improvements" below is still unique to this fork.

For the ongoing dated changelog (new umas, UI tweaks, etc.), see the in-app "Changelog" panel in Umalator itself rather than this file.

---

An umalator fork

Umalator is a great CM-planning tool to check where skills proc and how effective they are - but on Global it has been used and abused as a race simulator (i.e. comparing 2 umas with different pow, wit, etc or running 'stamina calculations' by brute-forcing recovery skill length gains in the skill chart).

Comparing 2 umas in the vacuum of a simulation is inherently flawed regardless, and should never, ever be the end-all decider of which uma you use. But if we're going to have a tool that lets you compare 2 umas, it should at least be somewhat accurate.

## 'Improvements'
- Implemented wit variance mechanics: Downhill Mode, Rushed, Skill Proc Chance.
  - This is primarily for accurate spurt rate calculations - which after cross-referencing with in-game packet data umalator with wit variance gives you an accurate spurt rate within a few %
- Extended position keep functionality
  - Allow customization of pacer uma (skills, wit/pow, etc).
  - Allow more than 1 pacer uma (i.e. simulating 2 fronts, or 2 runaways, 1 runaway, etc).
  - Implemented mee1080 position keeping logic to observe the effects of position keep beyond early-race.
- Desynced uma 1 and 2 race solver RNG in compare mode - there is an option to re-enable RNG sync when wit variance is turned off.
- Removed HP consumption when using the skill/uma chart.
  - Spurt/survival rate is the only thing that should ever be used to determine course stam requirements - people have been abusing the skill chart to check at what point recovery skills stop giving +L which has resulted in a lot of misinformation RE: stam requirements (hai refdoc)

  TODO: Remove stam skills from the skill chart entirely (unless they have a velocity component)
- Aaaand something that's not exactly an improvement... and makes the sim run slower... and maybe should be disabled... lane movement! We can now evaluate the effectiveness of lane movement skills which is fairly niche, but interesting nonetheless.

One thing that's not an improvement is the code quality (and not all of it is my fault >x< - this is actually a fork of a fork: https://github.com/IHATEJEKUTO/VFalator-Umalator-Fork-Yeah) buuut at least I fixed some of the base umalator bugs.

## Bug fixes
- Fixed start dash acceleration. In the original umalator, there is no start dash modifier on the 1st acceleration frame, and the start dash modifier incorrectly carries over for 1 frame after start dash.
- Fixed velocity clamping. In the original umalator, when a targetspeed skill runs out and an uma is decelerating, they will incorrectly slow down below their target speed for 1 frame.
- Fixed skill chart trigger region desync caused by skills that target other umas.
- Fixed non-full spurts. In the original umalator, full spurts are always delayed by 60m + candidate delay distance.
- Fixed section modifier applying beyond late-race.

## Bugs I dunno how to fix
- Static/dynamic conditions do not interact properly because of how trigger regions are implemented. The most prevalent example of this is Restless on Kyoto 3000m.
  The immediate trigger region is the 1st uphill (pre-calculated), and then in the race solver the dynamic condition is resolved (accumulatetime >= 5s).
  After 5s the uma is already on the 2nd uphill (outside the pre-calculated trigger region) so the skill never activates. Not sure how to properly fix this.

  (This is the same underlying issue documented more generally in the [`OrOperator` FIXME](architecture.md#known-issues) — see `docs/architecture.md`.)
