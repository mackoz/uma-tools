// Shared skill-rarity classification, used by SkillPicker's rarity filter chips and the Skill
// Chart's rarity filter row (umalator/app.tsx). Semantics lifted verbatim from SkillPicker.tsx's
// former module-private matchRarity -- see uma-skill-tools/RaceSolver.ts:169 for the canonical
// SkillRarity enum (White=1, Gold=2, Unique=3, Evolution=6) and RaceSolverBuilder.ts:301-302 for
// why 1*/2* uniques, 1*/2* upgraded to 3*, and naturally-3* uniques all carry different raw rarity
// values (3, 4, 5) that collapse to one "real unique" bucket here.
//
// Inherited uniques (id[0] === '9') carry rarity 1 (White) despite being uniques -- RaceSolver.ts
// notes this explicitly -- so `inherit` is checked before `white` and `white` excludes them.
import skilldata from '../uma-skill-tools/data/skill_data.json';

export function matchRarity(id: string, testRarity: string): boolean {
	const r = skilldata[id]?.rarity;
	if (r == null) return false;
	switch (testRarity) {
		case 'white':
			return r === 1 && id[0] !== '9';
		case 'gold':
			return r === 2;
		case 'pink':
			return r === 6;
		case 'unique':
			return r > 2 && r < 6;
		case 'inherit':
			return id[0] === '9';
		default:
			return true;
	}
}

// Global has zero rarity-6 (evolved/scenario) skills today -- gates the Skill Chart's Evolved
// filter chip so it doesn't render as a permanently-empty no-op there.
export const hasEvolvedSkills = Object.keys(skilldata).some(
	(id) => skilldata[id].rarity === 6,
);
