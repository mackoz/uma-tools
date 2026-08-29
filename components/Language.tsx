import { createContext, h } from 'preact';
import { useCallback, useContext, useEffect, useState } from 'preact/hooks';

import './Language.css';

// ANCHOR: language-storage-key-read
const defaultLanguage =
	localStorage.getItem('language') ||
	(navigator.language.startsWith('ja') ? 'ja' : 'en-ja');

export function useLanguageSelect() {
	const p = useState(defaultLanguage);
	// ANCHOR: language-storage-key-write
	useEffect(() => localStorage.setItem('language', p[0]), [p[0]]);
	return p;
}

export const Language = createContext(defaultLanguage);

export function useLanguage() {
	return useContext(Language);
}

export function LanguageSelect(props) {
	const change = useCallback(
		(e) => props.setLanguage(e.target.value),
		[props.setLanguage],
	);

	return (
		<select class="langSelect" value={props.language} onChange={change}>
			<option value="en">English</option>
			<option value="ja">日本語</option>
			<option value="en-ja">English with Japanese skill names</option>
		</select>
	);
}
