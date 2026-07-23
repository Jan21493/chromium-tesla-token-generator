chrome.action.onClicked.addListener(async function(tab) {
	let newTab = await chrome.tabs.create({url: 'setup.html'});
	await chrome.storage.session.set({[`tab_${newTab.id}`]: true});
});

chrome.webNavigation.onBeforeNavigate.addListener(async function(details) {
	if (details.frameId !== 0) {
		return;
	}

	let tabInfoKey = `tab_${details.tabId}`;
	let tabInfo = (await chrome.storage.session.get(tabInfoKey))[tabInfoKey];
	if (!tabInfo || !tabInfo.codeVerifier || tabInfo.processingAuth) {
		return;
	}

	await chrome.storage.session.set({
		[tabInfoKey]: {
			...tabInfo,
			authUrl: details.url,
			processingAuth: true
		}
	});

	await chrome.tabs.update(details.tabId, {url: chrome.runtime.getURL('auth.html')});
}, {url: [{urlPrefix: 'https://auth.tesla.com/void/callback'}]});

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
