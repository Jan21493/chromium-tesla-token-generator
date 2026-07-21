const outputDiv = document.getElementById('output');
const MAX_ERROR_RESPONSE_LENGTH = 300;

main();
async function main() {
	let response = await chrome.runtime.sendMessage({type: 'finalizeAuth'});
	if (!response) {
		fatalError('This login attempt has expired.');
		return;
	}

	let {codeVerifier, codeChallenge, authUrl} = response;

	let qsPos = authUrl.indexOf('?');
	let rawQueryString = authUrl.substring(qsPos + 1).split('&');
	let queryString = {};
	rawQueryString.forEach((rawQueryStringPart) => {
		let parts = rawQueryStringPart.split('=');
		queryString[parts[0]] = decodeURIComponent(parts.slice(1).join('='));
	});

	if (queryString.error) {
		fatalError(formatOAuthErrorMessage(queryString, 'Authorization failed before token exchange.'));
		return;
	}

	if (!queryString.code) {
		fatalError('Unable to login. No authorization code was issued.');
		return;
	}

	let xhr = new XMLHttpRequest();
	xhr.open('POST', (queryString.issuer || 'https://auth.tesla.com/oauth2/v3') + '/token');
	xhr.timeout = 30000;
	xhr.setRequestHeader('Content-Type', 'application/json');
	xhr.send(JSON.stringify({
		grant_type: 'authorization_code',
		client_id: 'ownerapi',
		code_verifier: codeVerifier,
		code: queryString.code,
		redirect_uri: authUrl.substring(0, qsPos)
	}));

	xhr.onreadystatechange = function() {
		if (xhr.readyState != XMLHttpRequest.DONE) {
			return;
		}

		try {
			let result = xhr.responseText ? JSON.parse(xhr.responseText) : {};
			if (xhr.status < 200 || xhr.status >= 300) {
				fatalError(formatTokenRequestFailureMessage(xhr, result));
				return;
			}

			if (result.error) {
				fatalError(formatOAuthErrorMessage(result, 'Tesla returned an OAuth error while issuing tokens.'));
				return;
			}

			document.getElementById('access-token').textContent = result.access_token || '(none returned)';
			document.getElementById('refresh-token').textContent = result.refresh_token || '(none returned)';
			document.getElementById('id-token').textContent = result.id_token || '(none returned)';
			let accessTokenValidity = '(not returned)';
			if (typeof result.expires_in === 'number' && Number.isFinite(result.expires_in) && result.expires_in > 0) {
				if (result.expires_in < 60) {
					let totalSeconds = Math.floor(result.expires_in);
					accessTokenValidity = `${totalSeconds} ${totalSeconds === 1 ? 'second' : 'seconds'}`;
				} else {
					let totalMinutes = Math.floor(result.expires_in / 60);
					accessTokenValidity = `${totalMinutes} ${totalMinutes === 1 ? 'minute' : 'minutes'}`;
				}
			}
			document.getElementById('access-token-validity').textContent = accessTokenValidity;
			document.getElementById('output-tokens').style.display = 'block';

			outputDiv.style.display = 'block';
		} catch (ex) {
			fatalError(formatTokenRequestFailureMessage(xhr));
		}
	};

	xhr.onerror = function() {
		fatalError('The request for Tesla tokens failed due to a network error.');
	};

	xhr.ontimeout = function() {
		fatalError('Timed out while waiting for Tesla token response.');
	};
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

function formatOAuthErrorMessage(errorResponse, prefix) {
	let outputParts = [];
	if (prefix) {
		outputParts.push(prefix);
	}
	if (errorResponse.error) {
		outputParts.push(`OAuth error: ${errorResponse.error}.`);
	}
	if (errorResponse.error_description) {
		outputParts.push(errorResponse.error_description);
	}
	return outputParts.join(' ');
}

function formatTokenRequestFailureMessage(xhr, parsedResult) {
	let statusText = xhr.statusText ? ` ${xhr.statusText}` : '';
	let output = `Token exchange failed (HTTP ${xhr.status}${statusText}).`;

	if (parsedResult && parsedResult.error) {
		output += ` ${formatOAuthErrorMessage(parsedResult)}`;
	} else if (xhr.responseText) {
		let responsePreview = xhr.responseText.substring(0, MAX_ERROR_RESPONSE_LENGTH);
		if (xhr.responseText.length > MAX_ERROR_RESPONSE_LENGTH) {
			responsePreview += '...';
		}
		output += ` Response: ${responsePreview}`;
	}

	return output;
}
