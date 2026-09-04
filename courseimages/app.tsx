import { h, render } from 'preact';
import { useEffect, useRef, useState } from 'preact/hooks';
import { RaceTrack, TrackSelect } from '../components/RaceTrack';

import { CourseHelpers } from '../uma-skill-tools/CourseData';
import tracknames from '../uma-skill-tools/data/jp/tracknames.json';

const inoutKey = Object.freeze(['', '', '-in', '-out', '-outin']);

function App(props) {
	const rc = useRef(null);
	const dl = useRef(null);
	const [courseId, setCourseId] = useState(10101);
	const course = CourseHelpers.getCourse(courseId);

	useEffect(() => {
		if (rc.current == null) return;
		const track = document.querySelector('.racetrackView');
		Array.from(track.querySelectorAll('text')).forEach((el) => {
			const cs = window.getComputedStyle(el);
			const st = [];
			for (let i = 0; i < cs.length; ++i) {
				const p = cs.item(i);
				st.push(`${p}:${cs.getPropertyValue(p)}`);
			}
			el.style.cssText = st.join(';');
		});
		window.requestAnimationFrame(() => {
			const ctx = rc.current.getContext('2d');
			ctx.reset();
			const img = new Image();
			const xml = new XMLSerializer().serializeToString(track);
			const svg = new Blob([xml], { type: 'image/svg+xml;charset=utf-8' });
			const url = URL.createObjectURL(svg);
			img.src = url;
			img.onload = () => {
				ctx.drawImage(img, 0, 0);
				URL.revokeObjectURL(url);
				dl.current.download =
					tracknames[course.raceTrackId][1].toLowerCase() +
					'-' +
					course.distance +
					inoutKey[course.course] +
					(course.surface == 2 ? '-dirt' : '') +
					'.png';
				dl.current.href = rc.current.toDataURL('image/png');
			};
		});
	}, [courseId]);

	return (
		<div id="wrapper">
			<RaceTrack courseid={courseId} width={960} height={240} regions={[]} />
			<div id="buttonsRow">
				<TrackSelect
					key={courseId}
					courseid={courseId}
					setCourseid={setCourseId}
					tabindex={2}
				/>
			</div>
			<canvas id="rc" width="960" height="240" ref={rc} />
			<a href="#" download="" ref={dl} style="display:block">
				Download
			</a>
		</div>
	);
}

render(<App />, document.getElementById('app'));
