# Upstream architecture (plain-English version)

This is the same content as [upstream-architecture.md](upstream-architecture.md) — how upstream (`alpha123/uma-tools`) is built — but rewritten without code snippets, file/line citations, or unexplained jargon. If you want to verify a specific claim or need the exact location of something in the code, use the technical version; this one is for understanding the shape of the thing.

It's a snapshot of someone else's project at a specific point in time, not a live view — see [Snapshot](#snapshot) at the bottom for when this was written and how to check if it's changed since.

## There isn't one single "upstream" to point at — there are four

Normally when people say "upstream," they mean one specific, current version of the code. Here, that turns out not to be true, and it matters enough to explain up front.

The simulation engine (the part that actually calculates race outcomes) lives in a separate mini-project that upstream's main app pulls in as a dependency — similar to how an app might depend on a specific version of a library. That dependency is locked to a specific, older snapshot of the engine. Meanwhile, the engine's own project has kept moving and has newer work that upstream's app isn't using yet.

So there are two versions of "upstream's engine" you could look at:

- **The locked snapshot** — what you'd actually get today if you set up upstream's project from scratch. Older, dated mid-2025.
- **The engine project's latest version** — newer, dated early 2026, sitting unused by the app that's supposed to depend on it.

Here's the twist: neither of those two matches what upstream's own app code actually expects. The app calls a handful of functions that don't exist in *either* version above. That only makes sense if the author has a third, private version of the engine on their own computer that was never published anywhere — newer than both public versions, and not something anyone outside can look at.

So: the locked snapshot, the engine project's latest public version, and the author's own unpublished version, plus this fork, are effectively four different reference points, not two. Everything below is explicitly marked as describing the locked snapshot or the engine's newer public version — never the private one, since there's nothing to look at.

## The engine, at the locked snapshot

This section walks through the engine the way [architecture.md](architecture.md) walks through this fork's engine, so the two can be compared side by side.

### How the pieces fit together

The engine is made of about a dozen files, each handling one job, that build on each other:

- A handful of small foundational files with no dependencies of their own — geometry helpers, a random number generator, basic type definitions.
- A course-data file that reads track information (corners, straights, hills) for a given race.
- A condition-matching layer that figures out, for a given skill, roughly where on the course it's allowed to activate.
- A parser that reads the game's skill-condition text (things like "activate when in 2nd place during the final stretch") and turns it into something the engine can evaluate.
- The physics core, which simulates one horse running one race.
- A "stamina policy" module that can be swapped out — either a real stamina model, or a do-nothing version that pretends the horse never gets tired (useful for tools that don't care about stamina).
- One file at the top of all of this — the "builder" — which is the actual entry point everything else uses. You hand it a horse's stats, a course, and a list of skills, and it hands back a fully configured simulation ready to run.

Two files reference each other in a technically circular way, but it's harmless — the reference is used only for type-checking during development, not at runtime, so it doesn't actually create a loop when the code runs.

### The entry point: the "builder"

Think of the builder as a form you fill out step by step — pick a horse, pick a course, pick the weather, add skills — where each step just hands you back the same form to keep filling out. Once it's fully filled out, you call one final method to actually produce a race simulation.

That final method is unusual: instead of returning one result, it hands control back and forth with whoever's using it. It produces one simulated race attempt, pauses, and waits to be told either "give me the next one" or "redo that exact same one over again" — which is how the tool can re-roll a single unlucky outcome without needing to restart the whole race from scratch.

Here's what actually happens, in order, when you ask it to build a race:

1. **Apply the horse's base stats**, including a rule where any stat above a certain very high threshold gets diminishing returns rather than a full 1:1 bonus, and a small bonus or penalty based on the horse's mood.
2. **Split off two separate random-number streams** — one that will drive the main horse, one for a pacer horse (a second, simplified horse used only as a moving reference point, not a real competitor). The pacer's stream gets created even if there's no pacer in this race at all, purely so that two side-by-side comparison runs stay in sync with each other.
3. **If there's a pacer horse, finish preparing its stats immediately** — unlike the main horse, whose stat adjustments are deliberately delayed (see step 8).
4. **Set up the whole racecourse as one big "anything can happen here" zone**, which every skill's activation condition will narrow down from.
5. **Work out where each skill is allowed to activate**, by parsing its condition text and intersecting it with the course. A few notable rough edges here: if two different situations could each let the skill fire, the engine deliberately only keeps track of the first one (which the code itself admits is a bug for at least one specific character's unique skill); and if a skill's condition genuinely can never be satisfied on this course, it's given a activation window that can never be reached, rather than being removed outright.
6. **Splice in a couple of special-cased pseudo-skills** that approximate specific in-game techniques that aren't modeled as real skills.
7. **Decide exactly where inside each skill's allowed window it will actually trigger**, using per-skill randomness. Some skills trigger immediately whenever they become available; others trigger at a random point, drawn from different probability shapes depending on the skill.
8. **Only now, after all the trigger points are already decided, does the engine finalize the horse's adjusted stats** — course bonuses, ground condition penalties, and so on. This ordering is deliberate: some skill conditions look at the horse's *original* stats, so those must exist before stat adjustments are applied, but the adjustments themselves must exist before the physics simulation runs.
9. **Loop over however many simulated attempts were requested**, building one fully-specified race per attempt.
10. **Save a snapshot of the random-number state** before each attempt, specifically so that if this attempt needs to be redone, it can be redone identically.
11. **If there's a pacer, build a second, simplified simulation for it** — no stamina tracking, no skills of its own beyond what was explicitly given to it.
12. **Assign the stamina model** — at this locked-snapshot version, this is hardcoded: the main horse always gets the real stamina model, the pacer always gets the do-nothing one. There's no way to plug in something different.
13. **Hand back the finished simulation, one attempt at a time**, and wait for the "next" or "redo" signal described above.

There's also a "fork" feature — clone the entire builder, including its exact random-number state, so two independent builders will produce identical randomness. This is the mechanism that makes an apples-to-apples A/B comparison between two horses possible: both simulations experience the "same race," random luck and all, except for whatever variable is actually being compared.

**ELI5:** the builder is like a recipe card you fill in one line at a time — horse, course, weather, skills — and then hand to a chef who cooks one full race simulation per request, always in the same fixed order of steps, and who can redo the exact same dish on demand if you don't like how it turned out.

### The physics loop — what happens every tick of the simulation

The simulation advances in small time slices, and on each slice it does the same sequence of work: pause if the horse hasn't left the gate yet, otherwise take a half-step forward based on current speed and acceleration, actually move the horse, drain its stamina, advance a bunch of internal timers, check if it's entering or leaving a hill, check what phase of the race it's in, check if any skills should activate right now, check if it should ease off the pace (a technique some horses use early in a race), check if it's time to start the final sprint, recalculate target speed, apply all the accumulated speed/acceleration bonuses, finish the acceleration step, handle the moment a horse's opening sprint ends, and reset any one-time-only bonuses before the next tick.

One detail worth knowing: the horse's position is updated *before* the engine checks what phase it's in or whether any skills should fire. That means if a skill activates on this tick, its effect only shows up starting *next* tick's movement, not this one.

The engine uses only three independent sources of randomness inside the actual physics loop — one general-purpose one, one used only for a specific "random gold skill" shuffle mechanic, and one used only for a specific pacing-effect distance roll. A fourth, separate one lives inside the stamina model, used for a "should I accept a slightly worse final sprint" decision.

**ELI5:** every tiny slice of time, the simulation runs through the same fixed checklist for the horse — move it, drain some stamina, see if anything special should happen, adjust its speed — always in the same order, over and over, until it crosses the finish line.

### How skill conditions get read

Skill conditions are written in a small custom mini-language, like `distance_rate>=50&distance_rate<=60`. The engine has a small parser dedicated to reading this — it understands three kinds of operators (comparisons like "greater than," "and," "or"), each with a fixed priority so a longer condition gets grouped the same way every time. There's no way to use parentheses to override that priority — the language was kept intentionally simple.

**ELI5:** skill conditions are little sentences in the game's own shorthand, and this file is the piece that reads those sentences and figures out what they actually mean.

### The random number generator

Here's a genuinely interesting technical detail: the class used for randomness here is a real implementation of something called a "cellular automaton" — a mathematical pattern-generation technique (the same broad idea behind Conway's Game of Life, though a much simpler one-dimensional version) repurposed to produce well-distributed random numbers. The author left extensive notes about testing its statistical quality.

This matters for comparison purposes: this fork has a class with the exact same name, but it isn't the same implementation at all — it's actually just a rebranded wrapper around a completely different, off-the-shelf random number library. Same name, different thing under the hood, on each side.

**ELI5:** upstream built its own custom "dice roller" from a neat mathematical trick and tested it carefully. This fork has something with the same label on the box, but a totally different, ordinary dice roller inside.

### What each file is responsible for

In short: one file is the physics engine for a single horse; one is the entry-point builder described above; one reads skill-condition text; one figures out where a condition is allowed to be true and turns it into a runtime check; one decides exactly when inside that window a skill fires; one handles stamina; one handles course geometry; one is a basic geometry helper for "this stretch of track, from here to here"; one defines a horse's stats and running style; one defines shared race settings like weather and ground condition; and one provides the random number generator described above.

Outside of these dozen or so files, there's also a folder of small command-line utilities (for things like bulk-generating result tables) and a folder of automated tests.

**ELI5:** each file has one clear job — reading conditions, running physics, tracking stamina, generating randomness — and they're wired together through the one entry-point file described earlier.

### What upstream's engine deliberately doesn't try to do (at the locked snapshot)

This is on purpose, not a bug — the project's own documentation says so directly:

- **It only simulates one horse at a time**, with an optional second "pacer" horse that exists purely as a moving reference point — it's never actually raced against, never blocked, never overtaken, and doesn't affect who wins.
- **The "ease off the pace" mechanic is only partially modeled** — just the early-race version, deliberately capped short of how long it actually lasts in the real game, because that's the part the author cared about getting right.
- **There's no lane-changing or side-to-side movement simulation at all.** Any game mechanic that depends on which lane a horse is in is treated as if it simply never happens.
- **At this snapshot, there's no "getting boxed in and fighting for position" mechanic, no late-race head-to-head dueling mechanic, no "horse gets overly excited and hard to control" mechanic, and no downhill-speed-boost mechanic.** (Some of these do exist in the engine's newer, not-yet-adopted version — see the next section.)
- **The pacer horse is just a clock with legs** — a second full simulation running alongside the real one, purely so other mechanics have something to measure distance against.

**ELI5:** upstream's engine is built to answer "how would this one horse perform," not "how would this whole race play out" — anything that requires multiple horses actually interacting with each other is out of scope by design.

## What changed in the engine's newer, not-yet-adopted version

Interestingly, two mechanics this fork's own comparison notes describe as things *only the fork* added — a horse getting overly excited and hard to control, and a downhill speed boost — actually **do** exist in upstream's engine too, just in the newer version the app hasn't picked up yet:

- **"Overly excited" mechanic added.** A horse can now randomly enter a state, early in the race, where it becomes harder to control for a stretch. The two random rolls involved (whether it happens, and how long it lasts) are both made immediately at the start of the race rather than only when needed, specifically so the amount of randomness consumed doesn't vary based on the horse's stats — otherwise it would throw off any side-by-side comparison between two horses.
- **Downhill speed boost added.** A horse can now get a temporary speed boost while running downhill, checked and re-checked periodically for as long as the downhill lasts, with its own dedicated randomness per hill so that getting the boost on one hill doesn't affect the odds on a later hill.
- **A JP-vs-Global behavioral toggle was removed from the engine entirely** — a small stat calculation that used to differ between the JP and Global versions of the game is now the same for both.
- **Skills can now optionally be gated by the horse's own stat**, so a lower-stat horse can genuinely fail to use a skill it has, not just activate it at a less favorable moment.
- **The stamina model became swappable**, rather than being hardcoded to always use the real one.
- **A handful of new or newly-implemented skill conditions were added or fixed** — including a condition based on popularity, which used to be a no-op stub.
- **The random-number generator was simplified slightly** for performance, at the cost of throwing away half of each internal calculation rather than reusing it.
- **A subtle math fix landed in the "when should the final sprint start" calculation**, plus a safety fallback for horses whose stats are so low the original formula didn't handle them sensibly.
- **The probability-shape math for randomly-timed skills was reworked** to be more statistically sound when only a few simulated attempts are requested — the author's own comments call the old approach "mathematically suspect" and describes the fix as still imperfect but a clear improvement.

**ELI5:** it turns out upstream did eventually build "getting overly excited" and "downhill speed boost" too — this fork just built its own version first, and each side did it independently without knowing about the other's.

## The apps built on top of the engine

### The different tools in the repo

Upstream's main tool is a race comparison app — pick two horses and a course, and see who wins and by how much, plus a chart mode and a stamina calculator. There's a JP version and a separate Global version of this same tool, where the "Global version" isn't actually separate code — it's the exact same source code, just built a second time pointed at a different set of game data.

Alongside that: a standalone tool for visualizing where on a course a given skill is allowed to activate (also built twice, JP and Global); a support-card build planner that uses an optimization solver to figure out the best skill purchases for a given budget; a small utility for exporting course diagrams as images; a Wordle-style guessing game themed around the horses; an unrelated Wordle-style color-guessing game that just happens to live in the same repository; and a "rank your favorite horses" tool that has no equivalent anywhere in this fork.

**ELI5:** it's one shared simulation engine underneath several different small apps built on top of it, most of them variations on "compare or explore horses and races," plus a couple of just-for-fun extras.

### How the "JP version" and "Global version" of an app relate

Rather than maintaining two separate copies of the same app, upstream's build process takes the *same* source code and compiles it twice with different settings — once pointed at the Japanese game's data, once pointed at the Global game's data. A build-time flag lets small pieces of the code branch based on which version is being built (for example, showing a different label, or using a different default). This fork works exactly the same way for its own JP/Global split.

**ELI5:** it's one set of blueprints, built twice with different labels swapped in — not two separate buildings.

### How the app keeps track of what you've entered

This is one of the more distinctive design choices in upstream's codebase: rather than reaching for an existing state-management approach, the author built a custom one from scratch — a small toolkit for "pointing at" a specific piece of nested data (like "this horse's third skill slot") and updating just that piece without disturbing anything else, paired with a way of storing the app's data outside of the UI framework's own state system entirely, so re-renders only happen exactly when something relevant actually changed.

This fork does not have this custom system at all — it instead uses a well-known, off-the-shelf library for the same purpose (Immutable data structures), which is a much more standard approach.

**ELI5:** upstream built its own custom filing-and-updating system for tracking what you've typed into the app; this fork instead uses a popular, ready-made library that does the same job.

### The shared building blocks

Both projects have a folder of shared, reusable pieces used across multiple apps — the horse stat editor, the skill list/picker, the course diagram renderer, language switching, tooltips. Upstream's version notably does *not* have a separate, reusable "skill picker" piece — the same picker interface is instead written out twice, once for each place that needs it, rather than being shared.

Upstream-only pieces: a manager for saving your horse builds to your browser's local storage, browsable in a sortable table; a calculator that reproduces the game's own internal "score" formula for a horse (the author's own notes say it's translated from a program written in an unusual, very terse programming language, with the original pasted in as a reference); and a full screenshot-import feature — point it at a screenshot of your horse's stat screen from the actual game, and it reads the stats and skills off the image automatically, entirely inside your browser, using bundled image-recognition and text-recognition software.

This fork does have a screenshot-import feature too, but it works completely differently: instead of reading the image locally in your browser, it's sent off to an external AI service to be interpreted. Same feature, opposite approach — one keeps everything on your device, the other calls out over the network.

**ELI5:** most of the reusable pieces are similar on both sides. The screenshot-import feature exists on both sides but works in opposite ways — upstream reads your screenshot entirely on your own computer; this fork sends it to an outside service instead.

### Running simulations in the background

Both this fork and upstream run their race simulations on background threads so the page doesn't freeze while crunching numbers, using four of them at once. In upstream's version, the app doesn't wait for a fully precise final answer before showing you *something* — it shows a rough result almost immediately and then quietly refines it, posting sharper and sharper numbers as more simulated attempts complete, so you watch the answer sharpen in real time instead of staring at a loading spinner.

**ELI5:** upstream shows you a rough answer right away and keeps improving it live in front of you, instead of making you wait for the final, fully-accurate number.

### Handling different languages

The app supports Japanese and two flavors of English (a general English translation, and Global's own official in-game terminology, which differs from the fan translation in places — for instance "Wit" versus "Wisdom" as a stat name). Language preference is remembered between visits, and skill names get slotted into the right language automatically based on which version of the app you're using.

**ELI5:** the app can display in Japanese or one of two English styles, and remembers which one you picked last time.

### Outside libraries and tools it relies on

A full copy of a popular table-rendering library's core logic is bundled directly into the repository, along with a hand-written adapter so it works with the specific UI framework this project uses (since no ready-made adapter exists for that combination). A drag-and-drop library is used for the "rank your favorite horses" tool. A large, general-purpose computer-vision library and a text-recognition library are bundled for the screenshot-import feature, including the actual trained language models for Japanese and English text recognition, so nothing needs to be downloaded from the internet at the moment someone uses that feature.

**ELI5:** a handful of well-known open-source tools are bundled directly into the project rather than fetched from the internet on demand — most notably the computer-vision and text-recognition software behind the screenshot-import feature.

### Turning game files into the data the apps use

The apps' underlying uma/skill/course data is extracted from the actual game's files using a set of small scripts, one script per kind of data, run in a specific order against a copy of the game's database file. The full end-to-end sequence — run this script, then this one, then this one, then rebuild the app — is only written down anywhere for the Global side; on the JP side, the same process exists but has to be done by hand, one script at a time, from memory.

**ELI5:** there's a documented, one-command way to refresh Global's game data, but refreshing JP's game data still requires someone to manually run several scripts in the right order.

### How the site gets published

Upstream has no automated deployment process of any kind — no continuous-integration setup, nothing that runs automatically when code is pushed. Publishing an update means: someone builds the apps on their own computer, checks the built output into the project alongside the source code, and pushes it, at which point the hosting service (GitHub Pages) just serves whatever was checked in directly, with no additional build step happening at deploy time. This fork does have an automated build-and-publish step (see [deployment.md](deployment.md)), which is one of the clearer improvements it made over upstream.

Anonymous usage analytics are collected on Global builds only, and only outside of local development mode — nothing is collected on the Japanese version of the app.

There's no automated way to check that the project's types are internally consistent (that job is normally handled by a separate tool most TypeScript projects run as part of their build, which isn't wired up here) — on either side. Type-related bugs can slip through undetected on both this fork and upstream.

**ELI5:** upstream publishes updates by hand — build it locally, commit the result, push. This fork automated that step; upstream hasn't.

## Known rough spots in upstream, straight from the code's own comments

The codebase is honest about its own weak points, in comments left by the original author:

- One logic branch for combining two conditions with "or" is flagged by the author as "technically completely broken" in certain edge cases — though safe in practice because no currently-released skill happens to trigger the exact combination that would expose it. Worth noting: this exact same issue exists, unfixed, in this fork too — it predates the fork.
- A specific list of skill IDs is hardcoded as a temporary patch for how corner-related skills are detected, explicitly marked "temporary" by the author and called out as more important to get right on Global than on JP.
- A known bug affects one specific character's unique skill, where an alternate racing style makes the skill apply two effects when it should only apply one — the author's own comment flags it directly.
- The author isn't fully confident that stamina is being drained at the correct rate mathematically — a code comment says so outright.
- Two specific unique skills are identified in the code using a fairly fragile trick (checking for an oddly specific numeric coincidence) rather than something more robust, with the author noting they'd like a better solution eventually.
- The way randomly-timed skills from different probability shapes get combined when a condition requires two of them together is described by the author as a temporary stopgap, not the mathematically ideal solution.
- A mechanic that lets a skill trigger separately on multiple corners currently only ever fires on the earliest one, even when it's theoretically supposed to be able to fire on more than one — full support for that hasn't been built yet.
- The project's own documentation openly lists a known inaccuracy: skills combining a "time elapsed" condition with a probability-based condition tend to activate too early, more often than they should.

Two more issues are worth flagging specifically because **they're true in this fork as well**, meaning they're inherited problems rather than something either side introduced on its own: a vendored autocomplete component sits completely unused in both projects, and one of the smaller apps (the Wordle-style guessing game) can't actually be built from a clean install on either side, because of a missing dependency that was never added to the project's package list.

**ELI5:** the original author left honest notes in the code about known weak spots and half-finished ideas, rather than pretending everything is airtight — several of those same weak spots turn out to exist in this fork too, since this fork started from upstream's code in the first place.

## Snapshot

This page reflects the same commits as the technical version:

- **Upstream `uma-tools`:** `cdb7ead`, 2026-08-18
- **Upstream `uma-skill-tools`, locked-snapshot reference:** `6ba5ca0`, 2025-07-31
- **Upstream `uma-skill-tools`, newer public reference:** `8b3f5e2`, 2026-03-17

See [upstream-architecture.md#snapshot](upstream-architecture.md#snapshot) for the exact commands to refresh this against newer commits — the process is identical, this page is just a rewrite of the same underlying research.
