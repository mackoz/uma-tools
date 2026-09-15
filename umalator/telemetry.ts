import posthog from 'posthog-js';

export function initTelemetry() {
	if (CC_GLOBAL && !CC_DEBUG) {
		posthog.init('phc_sbf9k9rt6YxQg23nHWUSv2Y7NFkS32F86JmA83fC9wTL', {
			api_host: 'https://t.mackoz.net',
			ui_host: 'https://us.posthog.com',
			// 'always' rather than the 'identified_only' default: this app has no
			// login, so identify() is never called and 'identified_only' produced
			// no person profiles at all -- no unique-user counts, retention, or
			// cohorts. The cost is that every event is billed as identified, which
			// PostHog prices at up to 4x an anonymous one above the 1M/month free
			// tier. Revisit if volume ever approaches that.
			person_profiles: 'always',
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
