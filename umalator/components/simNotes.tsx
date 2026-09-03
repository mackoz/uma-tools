import { Fragment, h } from 'preact';

import type { InfoEntry } from './InfoModal';

// Known modeling approximations and unimplemented mechanics, shown in the "Limitations"
// panel. A limitation is a deliberate approximation or an unimplemented mechanic -- the
// simulator behaves as designed, the design is just not a perfect match for the game.
// Known-wrong results and outright failures belong in the (forthcoming) Bugs panel instead.
export const LIMITATIONS: InfoEntry[] = [
	{
		summary:
			'Skills that need a specific race position are gated by an assumption, not your simulated placement.',
		body: (
			<p>
				The simulator does not track your live rank among the rest of the field
				each moment of the race. In <strong>Compare</strong> mode, a skill that
				requires a specific placement (e.g. "must be 6th or worse") has that
				requirement dropped entirely -- only the skill's other conditions
				(timing, corner, etc.) decide whether it can activate. In the{' '}
				<strong>Skill Chart</strong>, your running style is instead assumed to
				hold one fixed placement band for the whole race -- Runaway / Front
				Runner: 1st, Pace Chaser: 2nd-4th, Late Surger / End Closer: 5th-9th --
				and the field size is always assumed to be 9. So the skill is either
				eligible for your entire run or never fires at all, rather than varying
				moment to moment the way real position does.
			</p>
		),
	},
	{
		summary:
			'Lane movement is approximated in Compare mode, and switched off entirely in the Skill Chart.',
		body: (
			<Fragment>
				<p>
					Your lane movement in-game depends heavily on other umas -- overtake
					targets, blocking, and so on. In Compare mode we approximate it using
					logic adapted from another race simulator, which is good enough to
					observe the effect of lane-movement skills but not accurate enough for
					mechanics like Spot Struggle or Dueling.
				</p>
				<p>
					The Skill Chart turns lane movement off completely, in both the
					"Controlled" and "Full race" models, so any skill whose activation
					depends on lane position will not behave the same there as it does in
					Compare.
				</p>
			</Fragment>
		),
	},
	{
		summary:
			"Spot Struggle's side-by-side conditions depend on the simulator's approximate lane model.",
		body: (
			<p>
				Spot Struggle follows the game's own rules: it can happen at most once
				per race for Front Runners and once for Runaways, between umas within
				3.75m behind the frontmost uma of that running style and within about
				1.9m of her sideways, and an uma drops out early once she falls 5m
				behind -- or about 4.7m to the side of -- every other uma still
				struggling. The sideways half of those checks reads the simulator's lane
				model, which is only an approximation, so it will not always agree with
				the real game. In the Skill Chart, where lane movement is turned off
				entirely, the sideways checks are skipped and only the distance
				conditions apply.
			</p>
		),
	},
	{
		summary:
			'Pseudo-random skills based on the location of other umas use a best-effort estimate that may not perfectly match in-game behavior.',
		body: (
			<Fragment>
				<p>
					Skills conditioned on being blocked, on nearby umas, and similar are
					modeled with statistical distributions meant to approximate their
					in-game behavior. They should always find the correct minimum and
					maximum, but the reported mean and median can be off -- for example,
					skills with blocked conditions tend to read as better in races with
					more umas and worse with fewer. Use your judgement.
				</p>
				<p>
					Skills whose condition names end in <code>_random</code> (e.g.{' '}
					<code>phase_random</code>, <code>corner_random</code>,{' '}
					<code>straight_random</code>) are implemented identically to the
					in-game logic and have accurate mean/median values, as do skills based
					purely on course geometry with no blocked/surrounded conditions.
				</p>
			</Fragment>
		),
	},
	{
		summary: 'Skill cooldowns are not implemented.',
		body: (
			<p>
				Skills only ever activate once per race, even ones with an in-game
				cooldown like Professor of Curvature or Beeline Burst.
			</p>
		),
	},
	{
		summary:
			'Every skill is simulated at its base value -- level-based scaling is not modeled.',
		body: (
			<p>
				In-game, a skill's effect scales with its level, from 1.00x at level 1
				up to a level-10 ceiling that depends on what the skill affects -- 1.25x
				for target speed, 1.20x for acceleration, 1.18x for most other effects,
				but only 1.10x for stat-boost skills. The simulator always uses the
				unscaled, level-1 value, for unique skills as well as ordinary ones --
				there is no way to simulate a higher-leveled skill.
			</p>
		),
	},
	{
		summary:
			'Skills that combine "time since something happened" with a condition based on other umas can fire earlier than they realistically should.',
		body: (
			<p>
				The simulator picks one activation window ahead of time rather than
				re-checking every instant. If the other-umas condition is not satisfied
				in that pre-picked window, the skill simply fails to activate there
				instead of being able to fire later once the elapsed-time requirement is
				met -- so in practice these skills tend to cluster right at the
				elapsed-time threshold more than they should.
			</p>
		),
	},
	{
		summary:
			'The Skill Chart\'s default "Controlled" model turns off several race mechanics regardless of your Settings.',
		body: (
			<p>
				With Model set to "Controlled" (the default), position keeping is
				simplified and Rushed (kakari), Compete Fight, and Lead Competition are
				all disabled, even if you've turned them on in Settings. Switch Model to
				"Full race" in the Skill Chart's run settings if you need these to be
				simulated.
			</p>
		),
	},
	{
		summary:
			'The Course Chart never tracks HP, so every candidate full-spurts and Skill Wit Check is always off.',
		body: (
			<Fragment>
				<p>
					Unlike the Skill Chart and Uma Chart, the Course Chart requests no
					stamina model at all -- see this app's own docs (ADR-0017) for why.
					Every candidate reaches the final straight with a guaranteed full
					spurt, HP-only recovery skills and any skill conditioned on a specific
					HP percentage have nothing real to trigger on, and Skill Wit Check is
					forced off regardless of your Settings toggle.
				</p>
				<p>
					The biggest effect of this is on skills conditioned on the final spurt
					itself (e.g. "final spurt" / <code>is_lastspurt</code> conditions):
					since every candidate spurts from the same point regardless of its
					actual stamina, these skills activate more reliably here than they
					would in a real race where a stamina-light build might not reach a
					full spurt at all. A handful of other candidates -- mostly ones whose
					only effect is HP recovery, or whose trigger condition itself checks
					an HP percentage -- read as having no effect in this mode for the same
					reason.
				</p>
			</Fragment>
		),
	},
];

// Known-wrong results and outright failures, shown in the "Known bugs" panel. Unlike
// LIMITATIONS above, these are not deliberate approximations -- the simulator was meant to
// get these right and doesn't. Each of these is tracked with a stable ID in this project's
// internal work queue; keep that queue updated as the underlying bugs get fixed rather than
// editing this copy out of sync with it.
export const BUGS: InfoEntry[] = [
	{
		summary:
			"Some skills can't be simulated at all, and stop the whole run when included.",
		body: (
			<p>
				A skill that references an activation condition the simulator doesn't
				recognize stops the run with an error naming the condition, rather than
				being skipped and simulated without it. On Global this currently affects
				Trick (Front), Trick (Rear), Tantalizing Trick, Catch 'Em Off Guard, and
				Oppression; a further ~11 conditions used only by JP skills have the
				same problem.
			</p>
		),
	},
	{
		summary:
			'A skill combining two possible activation conditions can trigger in the wrong part of the race.',
		body: (
			<p>
				Restless Step is a confirmed case: on Kyoto 3000m, the skill's condition
				should still be checkable on the course's 2nd uphill, but the simulator
				only ever considers the 1st uphill as its trigger window -- so the skill
				can fail to activate on this course even though the real game would
				allow it.
			</p>
		),
	},
	{
		summary:
			'A handful of skills only ever show their first effect -- a documented second effect never happens, no matter what happens in the race.',
		body: (
			<p>
				Several unique skills define two different situations they can trigger
				under, each with a different effect. The simulator only ever places the
				first one; the second is silently dropped rather than approximated. This
				affects around three dozen unique skills across both JP and Global data,
				including Vodka's, Daiwa Scarlet's, and Narita Brian's uniques.
			</p>
		),
	},
	{
		summary:
			'A couple of skills that reference a specific corner behave inconsistently.',
		body: (
			<p>
				One skill's "not this corner" condition is currently treated as "any
				corner is fine," which is the opposite of what it should check.
				Separately, skills that should randomly trigger at one of several
				corners are supposed to pick one corner specifically -- most get this
				right, but a few skills with the exact same condition as already-correct
				ones don't, so two visually identical skills can behave differently in
				the sim.
			</p>
		),
	},
	{
		summary:
			'Skills that count how many recovery effects have happened also count stamina-draining debuffs as if they were heals.',
		body: (
			<p>
				A skill conditioned on "you've triggered N recovery skills" can be
				satisfied by debuffs that drain stamina instead, since both are
				implemented as the same kind of effect internally and the counter
				doesn't check which direction the effect actually went.
			</p>
		),
	},
	{
		summary:
			'Skills needing both a specific race phase and a specific corner can fail to activate right where the two happen to line up.',
		body: (
			<p>
				When a corner's start exactly coincides with the end of a race phase
				(one known case: Chukyo 1800m dirt), a skill checking both conditions
				can miss its activation window entirely. Ten specific skills have been
				individually patched around this, but the underlying timing mismatch
				isn't fixed for skills outside that list.
			</p>
		),
	},
	{
		summary: 'Skills gated on your betting popularity fire regardless of it.',
		body: (
			<p>
				A skill that should only work when you're the favorite, or only when
				you're not, is instead treated as always eligible -- the popularity
				requirement is silently ignored rather than checked. On Global this
				affects Long Shot ◎/○, Paddock Fright, Risk-Maker, Raise My Soul's
				Blade!, Laugh at the Odds, Go☆Go☆Goal!, and Target in Sight ◎/○. There's
				also no setting in the app to change your popularity from its fixed
				default, so even a correct check would have little to work with today.
			</p>
		),
	},
	{
		summary: 'Several small interface bugs.',
		body: (
			<p>
				Removing a debuff and then adding a different one can silently overwrite
				a debuff you already had, rather than adding a new slot. Longchamp has
				no name in the Global course list (the course itself works fine). The JP
				and Global apps share one language setting even though they're separate
				pages, so changing it in one silently changes the other. And a course
				with no stat-threshold requirement looks visually identical to one whose
				threshold data simply failed to load.
			</p>
		),
	},
];
