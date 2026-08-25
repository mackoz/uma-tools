import { Map as ImmMap, Record } from 'immutable';
import skillmeta from '../skill_meta.json';
import type skills from '../uma-skill-tools/data/skill_data.json';

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
