import { cloneElement, h, toChildArray } from 'preact';

import './IntroText.css';

export function INTRO(props) {
	return <div id="REALINTROTEXT"></div>;
}

// Pull the first text content out of a vnode tree -- used below to read a
// release's <summary>DATE</summary> without assuming a fixed shape beyond
// "the summary's first text is the date".
function firstText(node) {
	if (node == null) return '';
	if (typeof node === 'string' || typeof node === 'number') return String(node);
	if (Array.isArray(node)) {
		for (const child of node) {
			const text = firstText(child);
			if (text) return text;
		}
		return '';
	}
	if (node.props && node.props.children != null)
		return firstText(node.props.children);
	return '';
}

// The newest release is expanded by default and everything below it collapsed,
// derived from list position — do not put `open` on individual <details class="release">
// entries. Adding a new dated section at the top of the list is all that's needed.
// If a future edit appends instead of prepends (or a merge reorders two
// entries), the wrong one would expand silently -- the console.warn below is
// the tripwire for that; it doesn't change which entry expands, only flags it.
function ReleaseList(props) {
	const releases = toChildArray(props.children).filter(
		(release) => release != null && typeof release === 'object',
	);
	if (releases.length > 1) {
		const dates = releases.map((release) => {
			const summary = toChildArray(release.props?.children).find(
				(child) => child && child.type === 'summary',
			);
			return summary ? firstText(summary.props.children).trim() : '';
		});
		const sorted = [...dates].sort().reverse();
		if (dates.some((date, i) => date !== sorted[i])) {
			console.warn(
				'[ReleaseList] changelog entries are not in descending date order -- ' +
					'the newest entry is still expanded by list position, not by date:',
				dates,
			);
		}
	}
	return (
		<div class="releaseList">
			{releases.map((release, i) =>
				i === 0 ? cloneElement(release, { open: true }) : release,
			)}
		</div>
	);
}

export function IntroText(props) {
	return (
		<div id="introtext">
			<details open={true}>
				<summary>Changelog</summary>
				<ReleaseList>
					<details class="release">
						<summary>2026-09-01</summary>
						<ul>
							<li>
								Each skill in the Shop Skills panel now has a{' '}
								<strong>hint level</strong> field (0–5), matching the game's own
								SP-discount hints — type a digit to set it and jump to the next
								field, or use the arrow keys to nudge one up or down. A hint is
								earned per skill, not per shop rung, so a ○/◎ pair shares a
								single field (set on whichever row owns it) that discounts both
								purchase steps; gold skills always get their own separate field.
								Existing saved hint levels migrate automatically. Enter your SP
								budget next to the Shop Skills button, and a new{' '}
								<strong>Buy list</strong> strip above the chart table shows up
								to three different purchase options, each with its estimated
								gain, SP cost, and skill count — clicking one highlights those
								skills' rows in the chart and pops open a detail card above the
								strip listing each skill with its icon and hint-discounted price
								(click again, press Escape, or click elsewhere to close it;
								hover an option for its full skill list without opening the
								card). Gains are estimates: each option sums the chart's
								already-measured per-skill gains rather than re-simulating the
								combination, so skills that interact with each other won't be
								reflected exactly. Rows the chart eliminated early now sort
								below the surviving ones, so the default view leads with the
								skills that matter.
							</li>
						</ul>
					</details>
					<details class="release">
						<summary>2026-08-30</summary>
						<ul>
							<li>
								The Skill Chart's filter row now has a{' '}
								<strong>Shop Skills</strong> button: click it to open a picker
								pre-narrowed to skills that can actually activate on this course
								for this uma's run style, and choose exactly the set your career
								run's shop screen is offering — the button then reads "Shop
								Skills — N Selected". A running view of the shortlist sits in a
								panel to the picker's right, split into what's in the pool
								versus what can't activate here (shown dimmed and struck-through
								with an explanatory tooltip instead of silently vanishing).
								Picking a skill that has a shop prerequisite — a gold built on
								top of a white, say — automatically adds that prerequisite too,
								shown indented beneath it; removing a prerequisite removes
								everything shortlisted on top of it, since the shop itself never
								lets you hold one without the other. Any non-empty shortlist
								replaces the Rarity/Type filters entirely (the shortlist is the
								filter, so those two rows grey out) rather than combining with
								them.
							</li>
						</ul>
					</details>
					<details class="release">
						<summary>2026-08-29</summary>
						<ul>
							<li>
								Equipping the <strong>Runaway</strong> skill now switches a
								horse's <strong>Strategy</strong> to Runaway automatically, and
								vice versa -- picking Runaway from the Strategy dropdown equips
								the skill, and unequipping the skill drops the strategy back to
								Front Runner. This matches the in-game rule that the skill is
								what unlocks the running style; a horse could previously be set
								to run Runaway without having the skill, or have the skill
								without the strategy actually being set to Runaway.
							</li>
						</ul>
					</details>
					<details class="release">
						<summary>2026-08-28</summary>
						<ul>
							<li>
								The Skill Chart's <strong>Hide Inherited Uniques</strong> toggle
								is now a <strong>Rarity</strong> row: All, Normal, Rare, Unique
								(inherited uniques -- a character's own uniques are evaluated in
								the Uma Chart tab instead), and, on JP, Evolved. It's
								single-select, so narrowing from All to one rarity hides
								non-matching rows immediately, but switching between rarities or
								widening back to All needs a re-run -- the one combination the
								old toggle could express that this can't is "everything except
								inherited uniques".
							</li>
						</ul>
					</details>
					<details class="release">
						<summary>2026-08-26</summary>
						<ul>
							<li>
								The Skill Chart's run settings now include a{' '}
								<strong>Pruning</strong> slider, alongside Model and Preset. It
								controls how quickly the adaptive ladder stops sampling a skill
								that looks unpromising -- lower finishes faster and is more
								likely to cut a skill that would've turned out fine; higher
								keeps marginal skills sampling longer at the cost of runtime.
								The default (50) reproduces the exact same behavior as before
								this change; the runtime estimate next to Run reflects the
								current setting.
							</li>
						</ul>
					</details>
					<details class="release">
						<summary>2026-08-25</summary>
						<ul>
							<li>
								The skill picker now supports keyboard navigation: arrow keys
								move a cursor through the filtered skill grid (Up/Down by row,
								Left/Right by column), Enter adds the highlighted skill, and{' '}
								<strong>`</strong> jumps back to the search box with its text
								selected so the next query overwrites the last one. Typing keeps
								refining the search live even while the cursor is elsewhere in
								the grid.
							</li>
							<li>
								Fixed <strong>Spot Struggle</strong> lasting the same amount of
								time no matter how good a uma's Front Runner (or Runaway)
								aptitude was. How long a spot struggle lasts is supposed to
								scale with that aptitude grade -- roughly 1.1x at S down to 0.1x
								at G -- but the simulator was treating every uma as though she
								had an A. Umas with a poor Front Runner aptitude were spending
								far longer in a spot struggle than they should have, burning the
								extra stamina that comes with it; umas with an S aptitude now
								struggle slightly longer than before. Simulation numbers will
								shift for any run where a spot struggle happens.
							</li>
							<li>
								<strong>Spot Struggle</strong> now uses the game's real trigger
								and exit rules (per{' '}
								<a href="https://hakuraku.moe/notes/spot-struggle">
									hakuraku.moe's replay-frame analysis
								</a>{' '}
								of the game's own parameters) instead of the rough approximation
								it had before. It can now only happen once per race for Front
								Runners and once for Runaways (previously a second, separate one
								could start later on); umas join it based on how far behind the
								frontmost uma of their running style they are, rather than how
								far they are from each other; Runaways use the same 3.75m range
								as Front Runners instead of a wider 5m; being side by side now
								matters, both for joining and for dropping out; and an uma can
								now drop out early once she falls behind everyone else still
								struggling, which previously never happened. Spot Struggle will
								trigger noticeably less often than before, so simulation numbers
								will shift for runs involving Front Runners or Runaways.
							</li>
						</ul>
					</details>
					<details class="release">
						<summary>2026-08-24</summary>
						<ul>
							<li>
								Fixed a bug where a <strong>Rushed</strong> (kakari) uma calmed
								down early far less often than it should have. The check for its
								every-3-seconds chance to snap out of it had a timing bug that
								made only the first of its three rolls actually fire, so a
								Rushed uma's chance to calm down early was about 55% instead of
								the intended ~90.9%. Rushed umas used to stay Rushed for close
								to the maximum duration much more than in the real game and
								burned correspondingly more stamina. Rushed umas now calm down
								at close to the intended rate, so simulation numbers will shift
								for any run where a uma gets Rushed. The corresponding entry in
								the Known bugs panel has been removed.
							</li>
						</ul>
					</details>
					<details class="release">
						<summary>2026-08-23</summary>
						<ul>
							<li>
								UI refresh (now complete): the whole app runs on a single
								design-token stylesheet in both light and dark mode. Buttons,
								inputs, dropdowns, toggles, cards, and all the tab strips were
								restyled with a cleaner, more consistent look — flat
								accent-colored Run button, subtler borders and shadows, one
								shared blue accent, and matching underline-style tabs for the
								top nav, the Compare/Skill Chart/Uma Chart switcher, and the Uma
								1/Uma 2 tabs. The left sidebar icons show labels on hover, and
								the ⓘ icon there opens this About/changelog panel any time — it
								no longer disappears after your first run. The uma editor, the
								Umas tab, the Skill Chart (including expanded row details and
								the skill list), the expanded side-by-side uma view, the OCR
								import dialog, and the results tables all follow the same design
								language and are fully readable in dark mode, and the uma editor
								pane stretches a bit with your window instead of being locked to
								one width. If anything looks broken or unreadable (especially in
								dark mode), please report it.
							</li>
						</ul>
					</details>
					<details class="release">
						<summary>2026-08-22</summary>
						<ul>
							<li>
								Added a <strong>Limitations</strong> panel (the warning-triangle
								icon in the left sidebar, under Settings) listing the
								simulator's known modeling approximations and gaps — position/
								placement-dependent skills, lane movement, pseudo-random skills,
								skill cooldowns, level scaling, and what the Skill Chart's
								default "Controlled" model turns off. This replaces the old
								"Caveats" section that used to sit above the Compare-mode
								results pane and vanished for good the moment you ran a
								simulation; two of its claims were also corrected in the move
								(lane movement is not simulated at all in the Skill Chart, and
								unique skills are simulated at level 1's unscaled base value,
								not "level 3★").
							</li>
							<li>
								Added a <strong>Known bugs</strong> panel (the bug icon right
								below Limitations) listing currently-open bugs that give a wrong
								result rather than an intentional approximation — a Rushed uma
								recovering early far less often than it should, skill activation
								conditions that can crash the simulation, activation-timing and
								corner-condition edge cases on a handful of named skills, a
								recovery counter that also counts draining debuffs, and a few
								small interface bugs. Also fixed the Limitations/Known-bugs
								panels silently swallowing a click on any other sidebar or
								mobile-bar button while one of them was open (it just closed the
								open panel instead of switching) — a pre-existing issue in the
								Limitations panel above that only became obvious once there were
								two panels to switch between.
							</li>
							<li>
								<strong>Global only:</strong> added 22 umas/outfits that aren't
								released on Global yet -- 11 new characters (Aston Machan,
								Yamanin Zephyr, Nakayama Festa, Wonder Acute, Zenno Rob Roy,
								Daitaku Helios, Shinko Windy, Mr. C.B., Twin Turbo, Daiichi
								Ruby, Symboli Kris S) and 11 new alt costumes on umas Global
								already has (including Mejiro Ardan's Ballroom outfit, Neige
								Émeraude). Datamined from the Global client's own staged text
								and ported from JP's already-implemented mechanics for these
								umas, using JP's original release order as the cutoff (through
								2023-03-29). They're off by default -- enable{' '}
								<strong>Show Unreleased Umas</strong> in Settings to plan around
								them (e.g. for an upcoming Champion's Meeting or an inherited
								unique) before they're actually playable.
							</li>
							<li>
								Fixed a bug in the simulation engine that made certain skills
								(anything with a two-stage "activates again once you've already
								used it" effect, like Twin Turbo's unique) hang the simulation
								indefinitely instead of running, with no error shown.
							</li>
							<li>
								<strong>Global only:</strong> fixed the unreleased umas above
								not actually being inheritable — their unique skills were
								missing the separate "inherited" skill entry, so none of them
								could be found in the "+ Add Skill" picker on a different uma,
								which was the whole point of adding them. Also moved Hokko
								Tarumae behind the <strong>Show Unreleased Umas</strong> toggle:
								she was already in the roster but isn't actually live on Global
								either, and had been showing up regardless of the setting.
							</li>
						</ul>
					</details>
					<details class="release">
						<summary>2026-08-21</summary>
						<ul>
							<li>
								Rewrote the statistical Skill Chart's sampling engine. It ran up
								to 25x more simulation than it needed to (every candidate skill
								got a fixed, large sample count with no early elimination),
								which made Thorough take upwards of 15-30 minutes; it now uses
								an adaptive round ladder — a small first pass across every
								candidate, then progressively larger passes on only the skills
								that still look competitive — so a full Thorough run typically
								finishes in a couple of minutes, and the table now fills in
								progressively round by round instead of staying blank until the
								very end.
							</li>
							<li>
								Added a working <strong>Stop</strong> button next to Run for the
								Skill Chart — it now actually halts the workers within a couple
								of seconds and keeps whatever partial results were already
								computed, instead of quietly burning CPU in the background after
								you'd moved on.
							</li>
							<li>
								Skill Wit Check (previously Compare-mode only) now also applies
								to the Skill Chart, and is exposed as a toggle in the Chart-mode
								Settings pane — default on, matching Compare. With it on,
								Expected gain reflects this uma's actual wisdom-check proc
								chance instead of assuming every check succeeds, and the chart's
								Proc column shows the real rate driving that number.
							</li>
							<li>
								The Skill Chart's Controlled model now calculates real HP,
								spurt, and recovery behavior (previously it used a no-op HP
								model that assumed unlimited stamina), so HP-only recovery
								skills are no longer excluded from the candidate list and can be
								ranked like any other skill.
							</li>
							<li>
								Reworked the Skill Chart's results table down to six columns
								(Skill, Gain with its confidence interval, Typical P10-P90,
								Helps, Proc, n) that actually fit instead of clipping; the
								numbers that used to crowd the table — time saved, SP cost,
								Wilson intervals, and so on — moved into the row's expanded
								detail. Rows that were screened out early or never activated
								still show their sample count and a result, instead of a blank
								line.
							</li>
							<li>
								Moved the Skill Chart's Model and Preset selectors out from
								inside the results area (where they were unreachable until a run
								had already finished with whatever defaults happened to be set)
								to the run-settings row above it, alongside an estimated-runtime
								hint for the current preset.
							</li>
							<li>
								Fixed the O(n²) resampling of pacemaker skill triggers in the
								simulation engine (affects Full-race Skill Chart runs and
								Compare mode with a virtual pacemaker at high sample counts) —
								pacer skill trigger points are now sampled once per race slot
								instead of being regenerated on every single scenario.
							</li>
							<li>
								Fixed the Skill Chart's "Skill" column header being unclickable
								(it was the only column that couldn't be used to sort
								alphabetically) and having its text clipped off at the left edge
								of the table.
							</li>
							<li>
								Added a <strong>Hide Inherited Uniques</strong> toggle next to
								the Skill Chart's icon filters, to exclude a character's
								inherited unique skills (e.g. "Warning Shot! (inherited)") from
								the candidate pool — a character's own (non-inherited) unique
								skills were already excluded from the Skill Chart automatically.
							</li>
						</ul>
					</details>
					<details class="release">
						<summary>2026-08-20</summary>
						<ul>
							<li>
								Fixed Pace Down mode's speed penalty using the wrong value in
								mid-race (was always 0.915x instead of 0.945x mid-race after the
								1.5th anniversary).
							</li>
							<li>
								Fixed Pace Down mode ending too late in mid-race after the 1.5th
								anniversary.
							</li>
							<li>
								Fixed importing an uma (single or roster) crashing when it
								carries a skill with no simulator data (Carnival Bonus and ~330
								similar cases) — those skills are now skipped instead of
								erroring.
							</li>
							<li>
								Added support for roster imports with a per-uma creation date,
								so the Umas tab’s "Created" sort and date badge work on
								freshly-exported rosters.
							</li>
							<li>
								Updated the roster export tool link (it moved to
								uma.guide/roster-viewer).
							</li>
							<li>
								Fixed 4 skill conditions that crashed the simulation instead of
								computing: <em>Dreams Donned with Pride!</em> (Special Week
								[Ruler of Japan]'s unique and its inherited copy),{' '}
								<em>Presents from X</em> (Biwa Hayahide [Rouge Caroler]'s unique
								and its inherited copy), <em>Defeatist</em>, and{' '}
								<em>Racing Spirit: Wit</em>.
							</li>
							<li>
								Skills that reference a still-unsupported condition (currently{' '}
								<em>Trick (Front)</em>, <em>Trick (Rear)</em>,{' '}
								<em>Tantalizing Trick</em>, <em>Catch 'Em Off Guard</em>, and{' '}
								<em>Oppression</em>) now show a clear error naming the condition
								instead of leaving the run stuck on "Simulation Running..."
								forever.
							</li>
						</ul>
					</details>
					<details class="release">
						<summary>2026-08-19</summary>
						<ul>
							<li>
								Synced game data: 11 new JP umas, 1 new Global uma (Yukino
								Bijin), 236 new JP skills, 40 new Global skills, 12 new Global
								courses, plus missing alt-costume outfits and icons backfilled
								on umas we already had (Global: Winning Ticket [Dream
								Deliverer], Agnes Digital [Fanatic♡Jiangshi], Narita Taishin
								[Difference Engineer], Smart Falcon [Twilight Triumph], Meisho
								Doto [Dot-o'-Lantern]).
							</li>
							<li>
								Fixed corner/straight positions on 105 Global courses that had
								drifted from the correct geometry (corner lengths and straight
								boundaries were off by a few meters to tens of meters).
							</li>
							<li>
								Updated Global CM presets from CM 11 (Aquarius Cup) up to CM 24
								(Aries Cup 2), fixing a mislabeled entry along the way. CM 19-24
								use estimated dates since they haven't run in Global yet.
							</li>
							<li>
								Fixed a bug where 3 skills (Nothing Ventured, Risky Business,
								It's All or Nothing) drained 100% of max HP instead of the
								intended small amount. In-game this is a random roll — 60%
								chance of 0%, 30% chance of -2%, 10% chance of -4% — but we
								don't yet model per-activation randomness for this effect, so
								for now every activation is hardcoded to the -4% worst case (the
								roll's actual value 10% of the time).
							</li>
							<li>
								Fixed a rare case where a very-low-speed uma's last-spurt
								calculation could silently fail.
							</li>
							<li>
								Fixed skill conditions checking whether an uma is currently
								Rushed, or has been Rushed at all this race — they were being
								ignored entirely (21 skills affected).
							</li>
							<li>
								Fixed a crash affecting 4 skills that check other umas' running
								styles for being Rushed: <em>Frenzied Front Runners</em>,{' '}
								<em>Frenzied Pace Chasers</em>, <em>Frenzied Late Surgers</em>,
								and <em>Frenzied End Closers</em>.
							</li>
							<li>
								Added a drag-to-resize splitter between the top pane and the
								skill/uma chart table, so the table can be given more room
								instead of always getting whatever space is left over.
								Double-click the splitter to reset to the default layout; your
								chosen height is remembered per-browser.
							</li>
						</ul>
					</details>
				</ReleaseList>
			</details>
			<details>
				<summary>Older Changelog (previous maintainers)</summary>
				<div class="releaseList">
					<details class="release">
						<summary>2026-06-14</summary>
						<ul>
							<li>New Umas.</li>
							<li>
								No further updates will be made, will be on vacation for 2
								weeks! - Jecht
							</li>
						</ul>
					</details>
					<details class="release">
						<summary>2026-03-07</summary>
						<ul>
							<li>Fixed style aptitude applying to skill wit check.</li>
							<li>Improved skill picker UI.</li>
							<li>Added skill type filtering for skill chart.</li>
						</ul>
					</details>
					<details class="release">
						<summary>2026-02-19</summary>
						<ul>
							<li>
								Merged UI changes from fork https://github.com/TheCing/uma-tools
							</li>
							<li>Merged accumulatetime bugfix from upstream.</li>
							<li>Added umas tab.</li>
						</ul>
					</details>
					<details class="release">
						<summary>2026-02-06</summary>
						<ul>
							<li>Restructured the UI.</li>
						</ul>
					</details>
					<details class="release">
						<summary>2026-01-10</summary>
						<ul>
							<li>
								<details>
									<summary>Added dueling.</summary>
									Dueling is an extremely non-trivial (and arguably pointless)
									mechanic to simulate as it is entirely based on lobby
									compositions which are not predictable. Using in-game data,
									we've approximated the dueling frequency of each strategy
									which is the best we can do for now.
								</details>
							</li>
							<li>
								Added the skill proc graphs from the skill chart to compare mode
								(expand the skill on the left side and click 'View Proc Data')
							</li>
						</ul>
					</details>
					<details class="release">
						<summary>2025-12-11</summary>
						<ul>
							<li>
								Added back simplified wit toggles just in-case people want to
								experiment with them.
							</li>
						</ul>
					</details>
					<details class="release">
						<summary>2025-12-06</summary>
						<ul>
							<li>
								<details>
									<summary>
										Removed Wit Variance toggle as it is no longer relevant -
										wit-related mechanics are now always enabled.
									</summary>
									If you still want to observe race variance where skills proc
									in different locations, or 1 uma procs a recovery skill and
									the other doesn't, you can turn off 'Sync RNG' - though this
									means you will need to run more samples to achieve accurate
									mean/median length results.
								</details>
							</li>
							<li>Synced fork with alpha123 latest changes.</li>
						</ul>
					</details>
					<details class="release">
						<summary>2025-11-30</summary>
						<ul>
							<li>Fixed non-full spurts always being delayed by 60m.</li>
							<li>
								Added cute utools graphs to skill/uma chart when you click on a
								skill.
							</li>
						</ul>
					</details>
					<details class="release">
						<summary>2025-11-29</summary>
						<ul>
							<li>Updated global data.</li>
							<li>Fixed umalator target speed clamping during deceleration.</li>
							<li>Fixed last spurt candidate selection logic.</li>
							<li>
								Fixed skills that target other umas (i.e. HRice unique) causing
								desync issues with skill charts.
							</li>
						</ul>
					</details>
					<details class="release">
						<summary>2025-11-14</summary>
						<ul>
							<li>Updated skill/uma/track data to latest global version.</li>
							<li>Added Spot Struggle simulation.</li>
							<li>
								Added basic lane movement simulation (primarily for Dodging
								Danger/Prudent Positioning).
							</li>
							<li>
								Added spurt/stamina survival rate. Initial comparisons with
								in-game spurt rate shows that vfalator is actually more accurate
								than mee1080, but more testing is needed.
							</li>
							<li>Fixed start delay logic.</li>
							<li>
								Fixed early-race velocity bug causing umas to accelerate faster
								than they should.
							</li>
							<li>
								... and probably other stuffs I forgot since there hasn't been a
								changelog in a while...
							</li>
						</ul>
					</details>
					<details class="release">
						<summary>2025-10-09</summary>
						<ul>
							<li>Fixed downhills not working</li>
						</ul>
					</details>
					<details class="release">
						<summary>2025-10-07</summary>
						<ul>
							<li>Implemented rushed status effect</li>
							<li>
								Implemented downhill speed-up mode along with the 60% HP
								consumption reduction. Special thanks to Transparent Dino and
								Justus0246 for the math
							</li>
							<li>
								Virtual pacemaker for nerds who want to relive the glory days of
								Urara PDM
							</li>
							<li>
								YOU CAN NOW FORCE SKILLS ACTIVATIONS AT CERTAIN DISTANCES!!!
								LIKE PROFESSOR OF CURVATURE ON A STRAIGHT!
							</li>
							<li>
								Enhanced Spurt Calculations coded by Transparent Dino, used the
								Me1080 formula
							</li>
						</ul>
					</details>
					<details class="release">
						<summary>2025-08-17</summary>
						<ul>
							<li>
								<strong>
									Fix to use proper data for hills from the current global
									version instead of an approximation using data from a later
									patch
								</strong>{' '}
								(thanks to <a href="https://github.com/mikumifa">mikumifa</a>)
							</li>
							<li>Update game data</li>
							<li>
								Fix a bug where very low stamina on long courses could cause the
								simulator to freeze
							</li>
						</ul>
					</details>
					<details class="release">
						<summary>2025-07-28</summary>
						<ul>
							<li>
								Add caveats section describing the implementation of the
								simulator
							</li>
							<li>
								Allow selecting debuff skills multiple times to simulate
								multiple debuffers
							</li>
							<li>Minor UI improvements</li>
						</ul>
					</details>
					<details class="release">
						<summary>2025-07-26</summary>
						<ul>
							<li>
								Update Tokyo 2400m course to remove the hill at the start to
								match a game bug where skills do not activate on that hill or
								the hill does not exist
							</li>
							<li>Implement per-section int roll target speed modifier</li>
							<li>
								Simulate skills with the post_number condition more accurately
							</li>
							<li>
								Implement the random_lot condition (used by Lucky Seven/Super
								Lucky Seven)
							</li>
							<li>Minor UI improvements</li>
						</ul>
					</details>
					<details class="release">
						<summary>2025-07-21</summary>
						<ul>
							<li>Update game data</li>
							<li>Implement debuff skills</li>
							<li>
								<details>
									<summary>
										Fix the implementation of skills with the corner_random
										condition to be more accurate to mechanics of the global
										release
									</summary>
									Primarily affects Swinging Maestro/Corner Recovery, Professor
									of Curvature/Corner Adept, and the strategy/distance corner
									skills
								</details>
							</li>
							<li>
								Fix an issue where skills weren't displayed on the chart if they
								were still active at the end of a simulation run
							</li>
							<li>Added changelog</li>
							<li>Minor UI fixes</li>
						</ul>
					</details>
					<details class="release">
						<summary>2025-07-17</summary>
						<ul>
							<li>Run simulations in a background thread for responsiveness</li>
							<li>
								<details>
									<summary>Major improvements to the skill chart mode</summary>
									<ul>
										<li>
											Click rows in the skill efficacy table to show that run on
											the course chart
										</li>
										<li>
											Radio buttons in table headers to select the statistic
											displayed on the course chart
										</li>
										<li>
											Show a popup with skill information and length histogram
											when clicking icons in the skill efficacy table
										</li>
										<li>
											Double-click rows on the skill efficacy table to add them
											to the simulated uma musume
										</li>
									</ul>
								</details>
							</li>
							<li>Changes to the skill chart mode to feel more responsive</li>
						</ul>
					</details>
					<details class="release">
						<summary>2025-07-16</summary>
						<ul>
							<li>Initial implementation of the skill chart mode</li>
						</ul>
					</details>
					<details class="release">
						<summary>2025-07-13</summary>
						<ul>
							<li>Initial release of the global version</li>
							<li>Miscellaneous UI improvements</li>
							<li>Bug fixes</li>
						</ul>
					</details>
				</div>
			</details>
			<details>
				<summary>Credits</summary>
				<dl id="credits">
					<dt>alpha123</dt>
					<dd>
						The original Umalator — race simulation engine, skill condition
						system, and UI
					</dd>
					<dt>Transparent Dino</dt>
					<dd>
						Enhanced Spurt calculator (taken from mee1080), Virtual Pacemaker,
						Downhills, Rushed
					</dd>
					<dt>jechtoff2dudes</dt>
					<dd>
						Frontrunner Overtake/Speedup mode, Dragging Skill Markers,
						Downhills, Skill Activation check
					</dd>
					<dt>Kachi</dt>
					<dd>
						Fixing all the bugs and UI issues, mood, UI improvements, rewriting
						poskeep, reworking RNG, uniques chart (utools at home), spot
						struggle/dueling, lane movement
					</dd>
					<dt>mackoz</dt>
					<dd>
						Game data syncs, Global course geometry and Champions Meeting
						presets, skill condition and race mechanics fixes, roster import
						fixes, resizable skill chart
					</dd>
				</dl>
			</details>
			<footer id="sourcelinks">
				Original Umalator Source code:{' '}
				<a href="https://github.com/alpha123/uma-skill-tools">simulator</a>,{' '}
				<a href="https://github.com/alpha123/uma-tools">UI</a>
				<br />
				Forked from{' '}
				<a href="https://github.com/kachi-dev/uma-tools">kachi-dev</a>:{' '}
				<a href="https://github.com/kachi-dev/uma-skill-tools">simulator</a>,{' '}
				<a href="https://github.com/kachi-dev/uma-tools">UI</a>
			</footer>
		</div>
	);
}
