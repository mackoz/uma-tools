import { Map as ImmMap, Record } from 'immutable';
import skillmeta from '../skill_meta.json';
import type skills from '../uma-skill-tools/data/jp/skill_data.json';

export function isDebuffSkill(id: string) {
	// iconId 3xxxx is the debuff icons
	// i think this basically matches the intuitive behavior of being able to add multiple debuff skills and not other skills;
	// e.g. there are some skills with both a debuff component and a positive component and typically it doesnt make sense to
	// add multiple of those
	//
	// Deliberately the raw skillmeta[id].iconId, not the resolved (guessed) icon from
	// components/SkillIcons.ts -- PIPE-2 review, round 2: this is a semantic classification, and
	// the resolved id is a *display* guess derived from (rarity, effect type), not a real signal
	// of what the skill actually does. Verified against today's data that this distinction is
	// currently a no-op either way -- none of the 136 zero-icon skills resolve to a 3xxxx icon --
	// but the raw check is the semantically-correct one regardless, and switching it would encode
	// a display guess as a mechanics fact for whatever the next data refresh introduces. See
	// UI-19 for actually keying this off effect data instead of any icon id.
	return skillmeta[id].iconId[0] == '3';
}

// 大逃げ (Global: "Runaway") -- in game this skill is what unlocks the 大逃げ/Oonige running
// style, so umalator keeps `strategy` and this skill in lockstep (UI-25). Single id: groupId
// 20205 has no inherited/evolved/pink variant in either the JP or Global dataset.
export const OONIGE_SKILL_ID = '202051';
export const OONIGE_SKILL_GROUP = skillmeta[OONIGE_SKILL_ID].groupId; // '20205'

// `skills` is keyed by groupId, not skill id -- use these instead of `.has(OONIGE_SKILL_ID)`,
// which tests keys and would silently never match (this was UI-25's actual bug).
// Typed against HorseState['skills'] (not a plain ImmMap<string,string>) to match SkillSet's
// literal-keyed return type -- a looser annotation here doesn't round-trip through `.set('skills', ...)`.
export function hasOonigeSkill(skills: HorseState['skills']): boolean {
	return skills.get(OONIGE_SKILL_GROUP) === OONIGE_SKILL_ID;
}

export function withOonigeSkill(skills: HorseState['skills']) {
	return skills.set(OONIGE_SKILL_GROUP, OONIGE_SKILL_ID);
}

export function withoutOonigeSkill(skills: HorseState['skills']) {
	return skills.delete(OONIGE_SKILL_GROUP);
}

// Single shared entry point for every call site that changes `strategy` -- the strategy dropdown,
// and (should another one ever need it) anything else that sets strategy directly. Keeps the skill
// in lockstep atomically. Do not hand-roll `.set('strategy', ...)` + a separate skills update at a
// new call site; use this (or withSkillsSynced below) instead -- UI-25 code review caught a 4th
// call site (umalator/app.tsx's addSkillFromTable) that hand-rolled this and missed the pairing.
export function withStrategySynced(
	state: HorseState,
	newStrategy: string,
): HorseState {
	const newSkills =
		newStrategy === 'Oonige'
			? withOonigeSkill(state.skills)
			: withoutOonigeSkill(state.skills);
	return state.set('strategy', newStrategy).set('skills', newSkills);
}

// Single shared entry point for every call site that changes `skills` -- the skill picker, the
// Skill Chart's "add candidate" action, and skill dismissal. Keeps strategy in lockstep atomically:
// equipping 大逃げ switches to Oonige, un-equipping it (while Oonige) falls back to Nige. See
// withStrategySynced's comment on why this exists as a shared helper rather than being hand-rolled
// per call site.
export function withSkillsSynced(
	state: HorseState,
	newSkills: HorseState['skills'],
): HorseState {
	const hadSkill = hasOonigeSkill(state.skills);
	const hasSkill = hasOonigeSkill(newSkills);
	if (hasSkill === hadSkill) return state.set('skills', newSkills);
	return state
		.set('skills', newSkills)
		.set('strategy', hasSkill ? 'Oonige' : 'Nige');
}

// Reconciles a HorseState built outside the interactive editor (loaded/imported/shared) so the
// 大逃げ skill and the Oonige strategy always agree, matching the in-game constraint. Interactive
// edits in HorseDef.tsx keep the two in sync directly (atomically, in one setState) instead of
// relying on this -- see HorseDef.tsx's strategy/skill handlers and its reconcile effect, which
// calls this for the same reason: the two states it disambiguates here (skill-present-wins,
// strategy-Oonige-wins) are exactly the residual cases left after those handlers already resolved
// the ambiguous ones. Returns `state` unchanged (same reference) when already consistent.
export function reconcileOonige(state: HorseState): HorseState {
	const hasSkill = hasOonigeSkill(state.skills);
	const isOonige = state.strategy === 'Oonige';
	if (hasSkill === isOonige) return state;
	return hasSkill
		? state.set('strategy', 'Oonige')
		: state.set('skills', withOonigeSkill(state.skills));
}

export function SkillSet(
	ids,
): ImmMap<(typeof skill_meta)['groupId'], keyof typeof skills> {
	return ImmMap(
		ids.reduce(
			(acc, id) => {
				const { entries, ndebuff } = acc;
				const groupId = skillmeta[id].groupId;
				if (isDebuffSkill(id)) {
					entries.push([groupId + '-' + ndebuff, id]);
					return { entries, ndebuff: ndebuff + 1 };
				} else {
					entries.push([groupId, id]);
					return { entries, ndebuff };
				}
			},
			{ entries: [], ndebuff: 0 },
		).entries,
	);
}

export class HorseState extends Record({
	outfitId: '',
	speed: CC_GLOBAL ? 1200 : 1850,
	stamina: CC_GLOBAL ? 1200 : 1700,
	power: CC_GLOBAL ? 800 : 1700,
	guts: CC_GLOBAL ? 400 : 1200,
	wisdom: CC_GLOBAL ? 400 : 1300,
	strategy: 'Senkou',
	distanceAptitude: 'S',
	surfaceAptitude: 'A',
	strategyAptitude: 'A',
	mood: 2 as Mood,
	skills: SkillSet([]),
	// Map of skillId -> forced position (in meters). If a skill is in this map, it will be forced to activate at that position.
	forcedSkillPositions: ImmMap(),
}) {}
