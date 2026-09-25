# Connect a headless Client

Connect Claude Code, Claude Cowork, Claude Desktop, or a script to OpenLaw with an API key issued to your account. The Client can read or change only what you can access, within its approved Toolsets and scope.

For browser sign-in and consent, use [Connect Claude](connect-claude.md), [Connect ChatGPT](connect-chatgpt.md) or [Connect Microsoft 365 Copilot](connect-microsoft-365-copilot.md). ChatGPT has no API key path. This guide remains the API key path for headless Clients.

## Before you start

You need an OpenLaw account, your Client installed and signed in, and the Server address from your Administrator. Claude Cowork and Claude Desktop also need Node.js 22 or later on the device, because they connect through a small bridge program. Ask the Administrator to [enable MCP and API keys for your account group](configure-mcp.md#enable-api-keys). An Administrator must approve your key request before you can connect.

For a [LAN only deployment](deployment-configuration.md#lan-only), run the Client on a device connected to the office network or VPN. The device must resolve the private hostname and trust its HTTPS certificate. No public address is needed.

## Request and collect your key

1. Open **Settings → Personal → API keys**.
2. Select **Request a key**. The **Request an API key** dialog opens. Enter the name of the app you will connect, such as `Claude Code` or `Claude Cowork`, as the **Client name**. This name appears on activity caused by the key.
3. Under **Toolsets**, select the Toolsets you need, such as **Contracts**. The list shows only the Toolsets the organization permits. Under **Scope**, choose **Read** to find and read records, or **Write** to allow changes as well. **Write** is absent while the organization is read-only. Nothing is selected for you. Guide Tools remain available with every key.
4. Add a **Note (Optional)** to explain your task. Check the expiry, then select **Send request**.
5. Ask an Administrator to approve the request from **Your approvals** in the bell or from the MCP settings. Your row says **Pending approval** until it is handled. An approved row says **Active**. A denied row says **Denied** and shows any note from the Administrator.
6. Return to **API keys** and reload. The **Your key is ready** dialog shows the key once. Select **Copy** and retain it in your approved secret store before selecting **Done**. A click outside the dialog does not close it, but Esc does. OpenLaw cannot show the key again.

An Administrator's own request approves itself. A Business User follows the same request flow in the Portal. Select the **Notification settings** gear in the Portal header, then **API keys**. The **Request a key** button appears only if the Administrator turned on API keys for Business Users. Their available Tools and record access follow their account.

## Connect Claude Code

Replace the example address with the **Server address** your Administrator copied, including `/mcp`. Run these commands in Bash. At the hidden prompt, paste the key you just copied:

```bash
read -r -s -p 'OpenLaw API key: ' OPENLAW_API_KEY
printf '\n'
export OPENLAW_API_KEY
claude mcp add --transport http --scope user openlaw https://openlaw.company.example/mcp \
  --header 'x-api-key: ${OPENLAW_API_KEY}'
claude mcp list
claude
```

The single quotes keep the variable reference in the Client configuration. Supply `OPENLAW_API_KEY` in the environment each time you start Claude Code. The key itself is not in the command history or the saved header. User scope makes this connection available to you across projects. See [Claude Code's MCP instructions](https://code.claude.com/docs/en/mcp) for its command and configuration options.

In Claude Code, open `/mcp` and check that `openlaw` is connected. Ask: "Use OpenLaw to tell me who I am, then find the guide Connect a headless Client." The Client can call `openlaw_whoami`, `openlaw_docs_search`, and `openlaw_docs_read`. The Guide Tools read the same articles as Help. With Contracts selected, you can then ask it to list the Contracts you can access.

Other SDK Clients use Streamable HTTP at the same `/mcp` address and send `x-api-key: <your key>` on requests. `Authorization: Bearer <your key>` is also accepted. A browser session cookie does not authenticate a Client.

## Connect Claude Cowork or Claude Desktop

For this API key path, Claude Cowork and Claude Desktop read a configuration file and start the bridge as a local program. The `mcp-remote` bridge is that program. It connects to the Server address and sends your key in the `x-api-key` header.

1. Open **Settings → Developer** in the app and select **Edit Config**. The app shows the folder that holds `claude_desktop_config.json`. Open that file in a text editor.
2. Add an `openlaw` entry under `mcpServers`. Replace the example address with your **Server address**, including `/mcp`. Replace the placeholder with the key you copied:

```json
{
  "mcpServers": {
    "openlaw": {
      "command": "npx",
      "args": [
        "-y",
        "mcp-remote@0.14.3",
        "https://openlaw.company.example/mcp",
        "--header",
        "x-api-key:${OPENLAW_API_KEY}",
        "--transport",
        "http-only"
      ],
      "env": {
        "OPENLAW_API_KEY": "paste your key here"
      }
    }
  }
}
```

3. Save the file. Quit the app fully and start it again. The app reads the file only when it starts.
4. Open a new chat and open the tools menu. `openlaw` is listed with its Tools. Ask the same question as for Claude Code: "Use OpenLaw to tell me who I am."

Three details keep this entry working. Write the header as `x-api-key:${OPENLAW_API_KEY}` with no space after the colon. Some versions of the app split arguments on spaces and break the header. Keep `--transport http-only`, because OpenLaw serves Streamable HTTP only. Put the key in the entry's `env` block. The app does not pass your shell environment to the bridge, so a variable exported in a terminal is not seen.

The file holds your key in clear text. Keep it readable by your account only. If your secret policy does not permit this, replace the two `--header` arguments with `--header-file` and the path to a file that holds one line, `x-api-key: <your key>`. Remove the `env` block from the entry, and set the permissions of the header file the same way.

The claude.ai website and mobile apps reach a custom connector only at a public HTTPS address, and they cannot send an API key header. Use the OAuth steps in [Connect Claude](connect-claude.md).

## Fix a connection or stop access

| What you see                                          | What to check or do                                                                                                                                                                                                                           |
| ----------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| No Request a key button                               | Ask the Administrator to turn on MCP and API keys for your account group.                                                                                                                                                                     |
| Pending approval                                      | Ask an Administrator to handle the request in Your approvals or the MCP section. To withdraw it, select **Cancel request** on its row and confirm.                                                                                            |
| Denied                                                | Read the Administrator's note on the row. A denial is final. Send a new request if you still need a key.                                                                                                                                      |
| Key dialog closed before you saved it                 | Revoke that key and request another. Reloading cannot recover it.                                                                                                                                                                             |
| Connection refused, timeout, or certificate error     | Check the address, office network or VPN, private DNS, and certificate trust on the Client device with your deployer.                                                                                                                         |
| Unauthorized                                          | Check that the environment variable is set in the shell launching Claude Code, or in the `env` block of the Claude Cowork or Claude Desktop entry. Check expiry and revocation, and ask whether MCP or your group's API keys were turned off. |
| A Tool is absent or a call is refused                 | Compare your approved Toolsets and scope with the organization's ceiling and Read-only switch. Record access still applies.                                                                                                                   |
| Rate limit reached                                    | Wait until the reset time in the refusal before retrying.                                                                                                                                                                                     |
| An openlaw configuration already exists               | Run `claude mcp remove --scope user openlaw`, then repeat the add command.                                                                                                                                                                    |
| Claude Cowork or Claude Desktop does not list openlaw | Check that the JSON is valid and that the app was quit and started again. Open the log for `openlaw` from **Settings → Developer**. An `npx` error means Node.js is absent.                                                                   |

To stop this Client, open **API keys** and select **Revoke** on its row. In **Revoke API key**, select **Revoke**. Its next request is refused, and the row says **Revoked**. Removing a Client configuration alone does not revoke its OpenLaw key.
