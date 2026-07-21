chrome.action.onClicked.addListener(async function(tab) {
	let newTab = await chrome.tabs.create({url: 'setup.html'});
	await chrome.storage.session.set({[`tab_${newTab.id}`]: true});
});

const NEW_CALLBACK_URL_PREFIX = 'tesla://auth/callback';
// Maximum number of characters to include from a URL in a log message
const MAX_LOG_URL_LENGTH = 80;

// Tracks tabs whose auth callback is currently being processed to prevent
// double-processing when both onBeforeRedirect and onBeforeNavigate fire for
// the same callback in the same service-worker lifecycle.
const g_processingTabs = new Set();

chrome.runtime.onMessage.addListener(function(msg, sender, sendResponse) {
	async function handle() {
		if (!sender || !sender.tab || sender.tab.id == null || !msg || !msg.type) {
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
				g_processingTabs.delete(sender.tab.id);
				return tabInfo;
		}
	}

	// returning true indicates that we're going to asyncronously use sendResponse()
	handle().then(result => sendResponse(result));
	return true;
});

async function getTrackedTabInfo(tabId, shouldLogIfMissing) {
	let tabInfoKey = `tab_${tabId}`;
	let tabInfo = (await chrome.storage.session.get(tabInfoKey))[tabInfoKey];
	if (typeof tabInfo != 'object') {
		if (shouldLogIfMissing) {
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

function isNewCallbackUrl(url) {
	return typeof url == 'string' && url.startsWith(NEW_CALLBACK_URL_PREFIX);
}

function getRedirectLocationHeaderValue(responseHeaders) {
	if (!Array.isArray(responseHeaders)) {
		return null;
	}

	for (let i = 0; i < responseHeaders.length; i++) {
		let header = responseHeaders[i];
		if (!header || typeof header.name != 'string') {
			continue;
		}
		if (header.name.toLowerCase() == 'location' && typeof header.value == 'string') {
			return header.value;
		}
	}
	return null;
}

// Legacy callback handler for the old https://auth.tesla.com/void/callback redirect URI
chrome.webRequest.onBeforeRequest.addListener(async function(info) {
	let trackedTabInfo = await getTrackedTabInfo(info.tabId, true);
	if (!trackedTabInfo) {
		return;
	}
	await processAuthCallback(info.tabId, info.url, trackedTabInfo.tabInfoKey, trackedTabInfo.tabInfo);
}, {urls: ['https://auth.tesla.com/void/callback*']});

// Primary interceptor for the tesla://auth/callback redirect URI.
// The URL filter covers all of auth.tesla.com because Tesla's OAuth redirect chain
// can issue the final 302 → tesla:// from various sub-paths (not only /oauth2/).
// isNewCallbackUrl() ensures only actual tesla://auth/callback redirects are acted on.
chrome.webRequest.onBeforeRedirect.addListener(async function(info) {
	console.log('[Tesla Auth] onBeforeRedirect fired', info.tabId, info.redirectUrl ? info.redirectUrl.substring(0, MAX_LOG_URL_LENGTH) : '');

	if (info.tabId < 0 || !isNewCallbackUrl(info.redirectUrl)) {
		return;
	}

	// Guard against double-processing if onBeforeNavigate fires in the same SW lifecycle
	if (g_processingTabs.has(info.tabId)) {
		console.log('[Tesla Auth] onBeforeRedirect: tab already processing, skipping', info.tabId);
		return;
	}
	g_processingTabs.add(info.tabId);

	let trackedTabInfo = await getTrackedTabInfo(info.tabId, true);
	if (!trackedTabInfo) {
		g_processingTabs.delete(info.tabId);
		return;
	}

	console.log('[Tesla Auth] onBeforeRedirect: processing auth callback for tab', info.tabId);
	await processAuthCallback(info.tabId, info.redirectUrl, trackedTabInfo.tabInfoKey, trackedTabInfo.tabInfo);
}, {urls: ['https://auth.tesla.com/*']});

// Backup interceptor using the webNavigation API.
// Fires when Chrome begins navigating the tab to the tesla:// URL — later than
// onBeforeRedirect but catches cases where the service worker was sleeping during
// the HTTP redirect event and missed onBeforeRedirect.
chrome.webNavigation.onBeforeNavigate.addListener(async function(details) {
	console.log('[Tesla Auth] onBeforeNavigate fired', details.tabId, details.url ? details.url.substring(0, MAX_LOG_URL_LENGTH) : '');

	if (!isNewCallbackUrl(details.url)) {
		return;
	}

	// Skip if onBeforeRedirect already handled this tab in the same SW lifecycle
	if (g_processingTabs.has(details.tabId)) {
		console.log('[Tesla Auth] onBeforeNavigate: tab already processing, skipping', details.tabId);
		return;
	}
	g_processingTabs.add(details.tabId);

	let trackedTabInfo = await getTrackedTabInfo(details.tabId, true);
	if (!trackedTabInfo) {
		g_processingTabs.delete(details.tabId);
		return;
	}

	console.log('[Tesla Auth] onBeforeNavigate: processing auth callback for tab', details.tabId);
	await processAuthCallback(details.tabId, details.url, trackedTabInfo.tabInfoKey, trackedTabInfo.tabInfo);
}, {url: [{schemes: ['tesla']}]});

// Header-based fallback for Chrome: inspect 3xx redirects from auth.tesla.com and
// extract the Location header before navigation to tesla:// is attempted.
chrome.webRequest.onHeadersReceived.addListener(async function(info) {
	if (info.tabId < 0 || g_processingTabs.has(info.tabId)) {
		return;
	}

	if (typeof info.statusCode != 'number' || info.statusCode < 300 || info.statusCode >= 400) {
		return;
	}

	let locationHeader = getRedirectLocationHeaderValue(info.responseHeaders);
	if (!isNewCallbackUrl(locationHeader)) {
		return;
	}

	g_processingTabs.add(info.tabId);
	let trackedTabInfo = await getTrackedTabInfo(info.tabId, true);
	if (!trackedTabInfo) {
		g_processingTabs.delete(info.tabId);
		return;
	}

	console.log('[Tesla Auth] onHeadersReceived: processing auth callback for tab', info.tabId);
	await processAuthCallback(info.tabId, locationHeader, trackedTabInfo.tabInfoKey, trackedTabInfo.tabInfo);
}, {urls: ['https://auth.tesla.com/*']}, ['responseHeaders']);
