const TESLA_REDIRECT_URI = 'tesla://auth/callback';
const AUTH_PAGE_URL = chrome.runtime.getURL('auth.html');
const AUTH_REDIRECT_RULE_ID = 1;

chrome.runtime.onInstalled.addListener(() => {
	setupAuthRedirectRule();
});

chrome.runtime.onStartup.addListener(() => {
	setupAuthRedirectRule();
});

setupAuthRedirectRule();

chrome.action.onClicked.addListener(async function(tab) {
	let newTab = await chrome.tabs.create({url: 'setup.html'});
	await chrome.storage.session.set({[`tab_${newTab.id}`]: true});
});

chrome.webNavigation.onBeforeNavigate.addListener(function(details) {
	handleNavigationCallback(details).catch(ex => {
		console.warn('Unable to process Tesla OAuth callback.', ex);
	});
});

chrome.webNavigation.onErrorOccurred.addListener(function(details) {
	handleNavigationCallback(details).catch(ex => {
		console.warn('Unable to process Tesla OAuth callback.', ex);
	});
});

async function handleNavigationCallback(details) {
	if (details.frameId !== 0) {
		return;
	}

	if (!details.url || !details.url.startsWith(TESLA_REDIRECT_URI)) {
		return;
	}

	let tabInfoKey = `tab_${details.tabId}`;
	let tabInfo = (await chrome.storage.session.get(tabInfoKey))[tabInfoKey];
	if (!tabInfo || !tabInfo.codeVerifier || tabInfo.processingAuth) {
		return;
	}

	let authPageUrl = AUTH_PAGE_URL;
	try {
		let callbackUrl = new URL(details.url);
		authPageUrl += callbackUrl.search + callbackUrl.hash;
	} catch (ex) {
		// fall back to the auth page without query parameters
	}

	await chrome.storage.session.set({
		[tabInfoKey]: {
			...tabInfo,
			authUrl: details.url,
			processingAuth: true
		}
	});

	await chrome.tabs.update(details.tabId, {url: authPageUrl});
}

async function setupAuthRedirectRule() {
	if (!chrome.declarativeNetRequest) {
		return;
	}

	try {
		await chrome.declarativeNetRequest.updateDynamicRules({
			removeRuleIds: [AUTH_REDIRECT_RULE_ID],
			addRules: [{
				id: AUTH_REDIRECT_RULE_ID,
				priority: 1,
				action: {
					type: 'redirect',
					redirect: {
						regexSubstitution: AUTH_PAGE_URL + '\\1'
					}
				},
				condition: {
					regexFilter: '^tesla://auth/callback(.*)$',
					resourceTypes: ['main_frame']
				}
			}]
		});
	} catch (ex) {
		console.warn('Unable to register Tesla OAuth redirect rule.', ex);
	}
}

chrome.runtime.onMessage.addListener(function(msg, sender, sendResponse) {
	async function handle() {
		if (!sender || !sender.tab || !sender.tab.id || !msg || !msg.type) {
			return;
		}

		let tabInfoKey = `tab_${sender.tab.id}`;
		let tabInfo = (await chrome.storage.session.get(tabInfoKey))[tabInfoKey];
		if (!tabInfo) {
			return;
		}

		switch (msg.type) {
			case 'init':
				await chrome.storage.session.set({
					[tabInfoKey]: {
						codeVerifier: msg.codeVerifier,
						codeChallenge: msg.codeChallenge,
						redirectUri: msg.redirectUri,
						state: msg.state
					}
				});
				return;

			case 'finalizeAuth':
				await chrome.storage.session.remove(tabInfoKey);
				return tabInfo;
		}
	}

	// returning true indicates that we're going to asyncronously use sendResponse()
	handle().then(result => sendResponse(result));
	return true;
});
