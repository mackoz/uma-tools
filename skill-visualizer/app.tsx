import { h, render } from 'preact';
import { useEffect, useMemo, useState } from 'preact/hooks';
import { IntlProvider, Text } from 'preact-i18n';

import {
	Language,
	LanguageSelect,
	useLanguageSelect,
} from '../components/Language';
import {
	RaceTrack,
	RegionDisplayType,
	TrackSelect,
} from '../components/RaceTrack';
import { scalingContextForHorseParameters } from '../components/ScalingContext';
import { ExpandedSkillDetails, SkillList } from '../components/SkillList';
import { TRACKNAMES_en, TRACKNAMES_ja } from '../strings/common';
import {
	immediate,
	noopImmediate,
} from '../uma-skill-tools/ActivationConditions';
import { ImmediatePolicy } from '../uma-skill-tools/ActivationSamplePolicy';
import { getParser } from '../uma-skill-tools/ConditionParser';
import { type CourseData, CourseHelpers } from '../uma-skill-tools/CourseData';
import skills from '../uma-skill-tools/data/jp/skill_data.json';
import skillnames from '../uma-skill-tools/data/jp/skillnames.json';
import {
	Aptitude,
	type HorseParameters,
	Strategy,
} from '../uma-skill-tools/HorseTypes';
import {
	buildSkillData,
	conditionsWithActivateCountsAsRandom,
} from '../uma-skill-tools/RaceSolverBuilder';
import { Region, RegionList } from '../uma-skill-tools/Region';

import '../components/Tooltip.css';
import './app.css';

const DefaultCourseId = 10903;

const UI_ja = Object.freeze({
	title: 'ウマ娘スキル発動位置可視化ツール',
	addskill: '+ スキル追加',
	thresholds: '補正ステータス：',
	stats: Object.freeze([
		'なし',
		'スピード',
		'スタミナ',
		'パワー',
		'根性',
		'賢さ',
	]),
	joiner: '、',
	notice: Object.freeze({
		dna: 'このコースではこのスキルは発動しない',
		error: '発動条件を解析しながらエラーが出た',
	}),
});

const UI_en = Object.freeze({
	title: 'Umamusume Skill Activation Visualizer',
	addskill: '+ Add Skill',
	thresholds: 'Stat thresholds: ',
	stats: Object.freeze(['None', 'Speed', 'Stamina', 'Power', 'Guts', 'Wisdom']),
	joiner: ',',
	notice: Object.freeze({
		dna: 'This skill does not activate on this track',
		error: 'Error parsing activation conditions',
	}),
});

const horse = Object.freeze({
	speed: 2000,
	stamina: 2000,
	power: 2000,
	guts: 2000,
	wisdom: 2000,
	strategy: Strategy.Nige,
	distanceAptitude: Aptitude.S,
	surfaceAptitude: Aptitude.A,
	strategyAptitude: Aptitude.A,
	rawStamina: 2000,
	rawWisdom: 2000,
	// SKL-7: value usage 13 brackets on HorseParameters.maxRawStat -- the max of the five stats
	// before any course/ground/strategy modifier. This inspection horse applies no such modifiers
	// (it is used verbatim as the "adjusted" horse everywhere in this app), so its raw max is
	// simply 2000.
	maxRawStat: 2000,
});

function baseSpeed(distance: number) {
	return 20.0 - (distance - 2000) / 1000.0;
}

const conditions = Object.freeze(
	Object.assign({}, conditionsWithActivateCountsAsRandom, {
		accumulatetime: immediate({
			filterGte(
				regions: RegionList,
				t: number,
				course: CourseData,
				_: HorseParameters,
			) {
				// obviously we can't know this condition without actually running the race, and the actual distance traveled depends on the uma's strategy, power stat,
				// skills (opening leg accel skills), and other things that aren't available in a static environment like this. so instead guess approximately how far we
				// travel in t seconds by just using the course base speed.
				// this will typically be a bit high since umas need to accelerate and non-nige strategies have lower than 1.0 StrategyPhaseCoefficient for phase 0
				// except for oonige in which case it could be a bit low since their phase 0 speed is so high
				const estimate = new Region(
					baseSpeed(course.distance) * t,
					course.distance,
				);
				return regions.rmap((r) => r.intersect(estimate));
			},
		}),
		grade: noopImmediate,
		ground_condition: noopImmediate,
		is_used_skill_id: noopImmediate,
		motivation: noopImmediate,
		popularity: noopImmediate,
		running_style: noopImmediate,
		season: noopImmediate,
		time: noopImmediate,
		weather: noopImmediate,
	}),
);

const parser = getParser(conditions);

function regionsForSkill(
	course: CourseData,
	skillId: string,
	color: { stroke: string; fill: string },
) {
	const wholeCourse = new RegionList();
	wholeCourse.push(new Region(0, course.distance));
	try {
		const sd = buildSkillData(
			horse,
			{},
			course,
			wholeCourse,
			parser,
			skillId,
			true,
		);
		if (sd == null)
			return {
				err: false,
				type: RegionDisplayType.Immediate,
				regions: [],
				color,
			};
		return {
			err: false,
			type:
				sd.samplePolicy == ImmediatePolicy
					? RegionDisplayType.Immediate
					: RegionDisplayType.Regions,
			regions: sd.regions,
			color,
			height: 100,
		};
	} catch (e) {
		return { err: true, type: RegionDisplayType.Immediate, regions: [], color };
	}
}

function doesNotActivate(skillRegions) {
	return (
		skillRegions.regions.length == 0 || skillRegions.regions[0].start == 9999
	);
}

const colors = [
	{ stroke: 'rgb(205,11,11)', fill: 'rgba(247,115,115,0.3)' },
	{ stroke: 'rgb(28,61,106)', fill: 'rgba(47,103,177,0.3)' },
	{ stroke: 'rgb(114,76,132)', fill: 'rgba(182,153,196,0.3)' },
	{ stroke: 'rgb(36,106,99)', fill: 'rgba(61,177,166,0.3)' },
];

function App(props) {
	const [language, setLanguage] = useLanguageSelect();
	const [courseId, setCourseId] = useState(
		() =>
			+(/cid=(\d+)/.exec(window.location.hash) || [null, DefaultCourseId])[1],
	);
	const [selectedSkills, setSelectedSkills] = useState(
		() =>
			new Set(
				(/sid=(\d+(?:,\d+)*)/.exec(window.location.hash) || [null, ''])[1]
					.split(',')
					.filter(Boolean),
			),
	);
	const [skillsOpen, setSkillsOpen] = useState(false);

	useEffect(() => {
		document.title = language == 'ja' ? UI_ja.title : UI_en.title;
	}, [language]);

	useEffect(() => {
		window.location.replace(
			`#cid=${courseId}${selectedSkills.size == 0 ? '' : ',sid='}${Array.from(selectedSkills).join(',')}`,
		);
	}, [courseId, selectedSkills]);

	function setSelectedSkillsAndClose(ids) {
		setSelectedSkills(ids);
		setSkillsOpen(false);
	}

	function showSkillSelector(e) {
		setSkillsOpen(true);
	}

	function hideSkillSelector(e) {
		setSkillsOpen(false);
	}

	function removeSkill(e) {
		const se = e.target.closest('.expandedSkill');
		if (se == null) return;
		e.stopPropagation();
		const id = se.dataset.skillid;
		const newSelected = new Set(selectedSkills);
		newSelected.delete(id);
		setSelectedSkills(newSelected);
	}

	const strings = {
		skillnames: {},
		tracknames: language == 'ja' ? TRACKNAMES_ja : TRACKNAMES_en,
		ui: language == 'ja' ? UI_ja : UI_en,
	};
	const langid = +(language == 'en');
	Object.keys(skillnames).forEach((id) => {
		strings.skillnames[id] = skillnames[id][langid];
	});

	const course = CourseHelpers.getCourse(courseId);

	// SKL-7: this app inspects skills against one fixed horse (`horse` above -- all stats 2000,
	// Nige, no course/ground modifiers applied), so a ScalingContext for it is a direct read of
	// that object rather than a buildBaseStats()/buildAdjustedStats() derivation. Without one,
	// every value/duration below renders unscaled -- which stopped being harmless once SKL-7
	// removed the baked x1.2 from the affected skills' stored modifiers, since those would then
	// display strictly *smaller* than they used to (e.g. 210081 at +0.35 rather than +0.42).
	// Full HP, since nothing here simulates a race in which HP could have been spent.
	const scalingContext = useMemo(
		() => scalingContextForHorseParameters(horse, course, selectedSkills.size),
		[course, selectedSkills],
	);

	const statThresholds =
		course.courseSetStatus.length == 0
			? strings.ui.stats[0]
			: course.courseSetStatus
					.map((s) => strings.ui.stats[s])
					.join(strings.ui.joiner);

	const regions = useMemo(
		() =>
			Array.from(selectedSkills).map((id, i) =>
				regionsForSkill(course, id, colors[i % colors.length]),
			),
		[selectedSkills, course],
	);
	const skillDetails = useMemo(
		() =>
			Array.from(selectedSkills).map((id, i) => {
				const hasNotice = regions[i].err || doesNotActivate(regions[i]);
				return (
					<li class={`expandedSkillItem${hasNotice ? ' hasNotice' : ''}`}>
						{regions[i].err && (
							<div class="skillNotice hasTooltip">
								<span>×</span>
								<div class="tooltip">
									<Text id="ui.notice.error" />
									<span class="arrow" />
								</div>
							</div>
						)}
						{!regions[i].err && doesNotActivate(regions[i]) && (
							<div class="skillNotice hasTooltip">
								<span>!</span>
								<div class="tooltip">
									<Text id="ui.notice.dna" />
									<span class="arrow" />
								</div>
							</div>
						)}
						<div
							class="expandedSkillColorMarker"
							style={`background:${colors[i % colors.length].stroke}`}
						/>
						<ExpandedSkillDetails
							id={id}
							distanceFactor={course.distance}
							scalingContext={scalingContext}
						/>
					</li>
				);
			}),
		[selectedSkills, course, regions, scalingContext],
	);

	return (
		<Language.Provider value={language}>
			<IntlProvider definition={strings}>
				<div
					id="overlay"
					class={skillsOpen ? 'skillListWrapper-open' : ''}
					onClick={hideSkillSelector}
				/>
				<LanguageSelect language={language} setLanguage={setLanguage} />
				<RaceTrack
					courseid={courseId}
					width="960"
					height="220"
					regions={regions}
				/>
				<div id="buttonsRow">
					<TrackSelect courseid={courseId} setCourseid={setCourseId} />
					<div id="thresholds">
						<Text id="ui.thresholds" />
						{statThresholds}
					</div>
					<button id="addSkill" onClick={showSkillSelector}>
						<Text id="ui.addskill" />
					</button>
				</div>
				<div id="skillDetailsWrapper" onClick={removeSkill}>
					<ul class="skillDetailsList">{skillDetails}</ul>
				</div>
				<div
					id="skillListWrapper"
					class={skillsOpen ? 'skillListWrapper-open' : ''}
				>
					<SkillList
						ids={Object.keys(skills)}
						selected={selectedSkills}
						setSelected={setSelectedSkillsAndClose}
					/>
				</div>
			</IntlProvider>
		</Language.Provider>
	);
}

render(<App lang="ja" />, document.getElementById('app'));
