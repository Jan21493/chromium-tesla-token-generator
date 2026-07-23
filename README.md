# Access Token Generator for Tesla

There are a number of useful third-party services and apps that integrate with Tesla vehicle and energy products,
but as of yet Tesla doesn't have an OAuth API that's open to the public. The only way to get access to Tesla product
data, therefore, is using an authentication token.

This extension for Chrome and Chromium based browsers enables you to get those tokens easily and safely. The Tesla
sign-in flow uses Chromium's extension identity redirect handling, and auth.tesla.com is the only remote origin
declared in the extension's manifest for the OAuth/token exchange.

**Why is the extension requesting identity access?** Chromium's `chrome.identity.launchWebAuthFlow` API is used to open
Tesla's sign-in page and capture the OAuth redirect back into the extension without inspecting arbitrary browsing
traffic.

Once you have the extension installed, click the Access Token Generator for Tesla button on your toolbar to get started.

- [Get it from the Chrome Web Store](https://chrome.google.com/webstore/detail/access-token-generator-fo/djpjpanpjaimfjalnpkppkjiedmgpjpe)
- [Get it from Edge Add-ons](https://microsoftedge.microsoft.com/addons/detail/tesla-access-token-genera/mjpplpkadjdmedpklcioagjgaflfphbo)

*This extension is not endorsed by or affiliated with Tesla, Inc.*
