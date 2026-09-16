# Live-provider settings to enter (C42, C43)

These are the only steps that need you. You type the provider settings into the lab yourself. The agent never reads or copies them. Do not paste a secret into chat, a file, a comment or a Contract.

Lab: http://127.0.0.1:23314 (app commit `3fa407e3`). Sign in as Administrator `daniel.okafor@helix.example`. The password is the seeded lab password. Both connectors are unconfigured now.

## 1. DocuSign, Polling mode

Open **Settings → Organization → Integrations → E-signature**. Select **DocuSign** to expand the card.

| Field               | Enter                                                                  |
| ------------------- | ---------------------------------------------------------------------- |
| **Environment**     | Demo                                                                   |
| **Signing updates** | Polling (the default)                                                  |
| **Integration key** | The key of the DocuSign validation integration from DOC-022            |
| **User ID**         | The API User ID of the sending user who gave consent (not their email) |
| **RSA private key** | The private key that matches the public key now on that integration    |

Polling shows no **Public callback URL** or **Connect HMAC secret** field. No other field is needed.

1. Select **Save connector**. The chip changes to **Connected**.
2. Select **Test connection**. Wait for **Connected to …**. Tell the agent the account name only if it is not the intended developer account.
3. Stop there. The agent does the send, the checks and the negative cases.

The DOC-022 record says the original RSA key was retired. Use the replacement key.

## 2. OpenRouter

Open **Settings → Organization → AI analysis**. Select **Provider** to expand the card.

1. In **Provider**, choose **OpenRouter**.
2. Paste your OpenRouter key in **API key**. Use a disposable key with a small spend limit.
3. Select **Load models**. Do not keep the prefilled `~openai/gpt-latest`. That ID was not in OpenRouter's public model list on 2026-09-16.
4. Type in **Search models** and choose the model. I suggest `openai/gpt-5.6-luna`. It is low cost and lists JSON output (`response_format`) support, which OpenLaw requests on every call. Another text model with JSON output support is fine. Tell the agent the model ID you chose.
5. Select **Save connector**, then **Test connection**. Wait for **Connection successful.**
6. Stop there. Leave **Use AI analysis** on and the three **Request conversion** switches off.

## 3. Signer email for the round trip

The Envelope needs one Signer inbox that you control and can open during the test. DocuSign sends the signing email itself, so the lab's Mailpit and the seeded `@helix.example` addresses cannot receive it.

Tell the agent which address to use. It can be your own inbox or the test recipient you approved earlier. The agent uses a fictional Signer name and fictional paper.

When the email arrives, sign in DocuSign. The paper may have no placed signature field, so DocuSign can ask you to drag one onto the page. After you finish, Polling can take up to about 20 minutes to bring the result back. Tell the agent when you have signed.

## After the tests

The verification pass ends by removing both connectors from the lab. Removing them in OpenLaw does not revoke anything at DocuSign or OpenRouter. Revoke or rotate the OpenRouter key yourself if you want to. Keep the DocuSign integration unless you want it gone.
