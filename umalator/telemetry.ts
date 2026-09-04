import posthog from 'posthog-js';

export function initTelemetry() {
	if (CC_GLOBAL && !CC_DEBUG) {
		posthog.init('phc_sbf9k9rt6YxQg23nHWUSv2Y7NFkS32F86JmA83fC9wTL', {
			api_host: 'https://us.i.posthog.com',
			person_profiles: 'identified_only', // or 'always' to create profiles for anonymous users as well
			loaded: (posthog) => {
				window.posthog = posthog;
			},
			autocapture: {
				dom_event_allowlist: ['click'],
				element_allowlist: ['a', 'button', 'select'],
			},
		});
	}
}

export function postEvent(event, obj) {
	if (CC_GLOBAL && !CC_DEBUG) {
		posthog.capture(event, obj);
	}
}
