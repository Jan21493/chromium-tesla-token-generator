chrome.action.onClicked.addListener(async function(tab) {
	let newTab = await chrome.tabs.create({url: 'setup.html'});
	await chrome.storage.session.set({[`tab_${newTab.id}`]: true});
});

const NEW_CALLBACK_URL_PREFIX = 'tesla://auth/callback';

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
						codeChallenge: msg.codeChallenge
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

async function getTrackedTabInfo(tabId, logWhenMissing) {
	let tabInfoKey = `tab_${tabId}`;
	let tabInfo = (await chrome.storage.session.get(tabInfoKey))[tabInfoKey];
	if (typeof tabInfo != 'object') {
		if (logWhenMissing) {
			console.log('Ignoring callback because it was not in a tab opened by us');
		}
		return null;
	}

	return {tabInfoKey, tabInfo};
}

async function processAuthCallback(tabId, authUrl, tabInfoKey, tabInfo) {
	// Auth succeeded
	tabInfo.authUrl = authUrl;
	await chrome.storage.session.set({[tabInfoKey]: tabInfo});

	// Edge doesn't like it if we try to redirect to an extension page with declarativeNetRequest.
	// So instead, update its location here
	await chrome.tabs.update(tabId, {url: chrome.runtime.getURL('auth.html')});
}

chrome.webRequest.onBeforeRequest.addListener(async function(info) {
	let trackedTabInfo = await getTrackedTabInfo(info.tabId, true);
	if (!trackedTabInfo) {
		return;
	}
	await processAuthCallback(info.tabId, info.url, trackedTabInfo.tabInfoKey, trackedTabInfo.tabInfo);
}, {urls: ['https://auth.tesla.com/void/callback*']});

chrome.webRequest.onBeforeRedirect.addListener(async function(info) {
	if (info.tabId < 0 || !info.redirectUrl.startsWith(NEW_CALLBACK_URL_PREFIX)) {
		return;
	}

	let trackedTabInfo = await getTrackedTabInfo(info.tabId, true);
	if (!trackedTabInfo) {
		return;
	}

	await processAuthCallback(info.tabId, info.redirectUrl, trackedTabInfo.tabInfoKey, trackedTabInfo.tabInfo);
}, {urls: ['https://auth.tesla.com/oauth2/v3/authorize*']});
