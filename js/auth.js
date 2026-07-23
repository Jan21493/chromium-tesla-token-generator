const outputDiv = document.getElementById('output');

main();
async function main() {
	let response = await chrome.runtime.sendMessage({type: 'finalizeAuth'});
	if (!response) {
		fatalError('This login attempt has expired.');
		return;
	}

	let {codeVerifier, authError, authUrl, redirectUri, state} = response;
	if (authError) {
		fatalError(`Unable to login. ${authError}`);
		return;
	}

	if (!redirectUri) {
		fatalError('This login attempt is missing redirect information.');
		return;
	}

	let callbackUrl;
	try {
		callbackUrl = new URL(authUrl);
	} catch (ex) {
		fatalError('Unable to login. An invalid authorization response was returned.');
		return;
	}

	let queryString = callbackUrl.searchParams;
	if (queryString.get('state') !== state) {
		fatalError('Unable to login. The authorization response state did not match.');
		return;
	}

	if (queryString.get('error')) {
		let errorDescription = queryString.get('error_description') || queryString.get('error');
		fatalError(`Unable to login. ${errorDescription}`);
		return;
	}

	if (!queryString.get('code')) {
		fatalError('Unable to login. No authorization code was issued.');
		return;
	}

	try {
		let result = await exchangeCodeForToken({
			authBaseUrl: queryString.get('issuer') || 'https://auth.tesla.com/oauth2/v3',
			code: queryString.get('code'),
			codeVerifier,
			redirectUri
		});

		document.getElementById('access-token').textContent = result.access_token || '(none returned)';
		document.getElementById('refresh-token').textContent = result.refresh_token || '(none returned)';
		document.getElementById('id-token').textContent = result.id_token || '(none returned)';
		document.getElementById('access-token-validity').textContent = formatAccessTokenValidity(result.expires_in);
		document.getElementById('output-tokens').style.display = 'block';

		outputDiv.style.display = 'block';
	} catch (ex) {
		fatalError(ex && ex.message ? ex.message : 'There was an error logging in.');
	}
}

// Set up click listeners
document.getElementById('tokens-show-more').addEventListener('click', function(event) {
	this.style.display = 'none';
	document.getElementById('output-tokens-more').style.display = 'block';
});

let codeTags = document.getElementsByTagName('code');
let g_ConfirmMessageClearTimer;
for (let i = 0; i < codeTags.length; i++) {
	codeTags[i].addEventListener('click', function() {
		if (!this.dataset.type) {
			return;
		}

		clearTimeout(g_ConfirmMessageClearTimer);
		navigator.clipboard.writeText(this.textContent);
		let confirmDiv = document.getElementById('confirm-message');
		confirmDiv.textContent = this.dataset.type + ' token copied!';

		g_ConfirmMessageClearTimer = setTimeout(() => {
			confirmDiv.textContent = '';
		}, 5000);
	});
}

function fatalError(msg) {
	outputDiv.className = 'fatal-error-message';
	outputDiv.textContent = msg;
	outputDiv.style.display = 'block';
}

async function exchangeCodeForToken({authBaseUrl, code, codeVerifier, redirectUri}) {
	let response = await fetch(authBaseUrl + '/token', {
		method: 'POST',
		headers: {
			'Content-Type': 'application/json'
		},
		body: JSON.stringify({
			grant_type: 'authorization_code',
			client_id: 'ownerapi',
			code_verifier: codeVerifier,
			code,
			redirect_uri: redirectUri
		})
	});

	let result;
	try {
		result = await response.json();
	} catch (ex) {
		throw new Error('There was an error logging in. Invalid JSON was returned.');
	}

	if (!response.ok) {
		throw new Error(result.error_description || result.error || 'There was an error logging in.');
	}

	return result;
}

function formatAccessTokenValidity(expiresIn) {
	let expiresInSeconds = Number(expiresIn);
	if (!Number.isFinite(expiresInSeconds) || expiresInSeconds <= 0) {
		return '(none returned)';
	}

	return `${Math.floor(expiresInSeconds / 60)} minutes`;
}
