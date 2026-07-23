chrome.action.onClicked.addListener(async function(tab) {
	let newTab = await chrome.tabs.create({url: 'setup.html'});
	await chrome.storage.session.set({[`tab_${newTab.id}`]: true});
});

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

			case 'completeAuth':
				// Auth succeeded
				await chrome.storage.session.set({
					[tabInfoKey]: {
						...tabInfo,
						authError: msg.authError || null,
						authUrl: msg.authUrl || null
					}
				});

				// Edge doesn't like it if we try to redirect to an extension page with declarativeNetRequest.
				// So instead, update its location here
				// The current launchWebAuthFlow-based flow still uses this tab update as the final handoff into auth.html.
				await chrome.tabs.update(sender.tab.id, {url: chrome.runtime.getURL('auth.html')});
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
