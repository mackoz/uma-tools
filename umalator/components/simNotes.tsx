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
				hold one fixed placement band for the whole race -- Front Runner: 1st,
				Pace Chaser: 2nd-4th, Late Surger / End Closer: 5th-9th -- and the field
				size is always assumed to be 9. So the skill is either eligible for your
				entire run or never fires at all, rather than varying moment to moment
				the way real position does.
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
					The Skill Chart's default "Controlled" model turns lane movement off
					completely, so any skill whose activation depends on lane position
					will not behave the same there as it does in Compare.
				</p>
			</Fragment>
		),
	},
	{
		summary:
			"Spot Struggle ignores the game's LaneGap condition and is based solely on distance between umas.",
		body: (
			<p>
				Due to the difficulty of accurately simulating lane movement, Spot
				Struggle is instead activated when two or more Front Runner umas are
				within 3.75m of one another (5m for Runaway).
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
				up to 1.20x at level 10. The simulator always uses the unscaled, level-1
				value, for unique skills as well as ordinary ones -- there is no way to
				simulate a higher-leveled skill.
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
];
