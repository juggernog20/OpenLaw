# Connect a headless Client

Connect Claude Code or a script to OpenLaw with an API key issued to your account. The Client can read or change only what you can access, within its approved Toolsets and scope.

## Before you start

You need a Legal Team Member account, Claude Code installed and signed in, and the Server address from your Administrator. Ask the Administrator to [enable MCP and Legal Users API keys](configure-mcp.md#enable-api-keys). Allow time for approval before the five-minute connection steps below.

For a [LAN only deployment](deployment-configuration.md#lan-only), run the Client on a device connected to the office network or VPN. The device must resolve the private hostname and trust its HTTPS certificate. No public address is needed.

## Request and collect your key

1. Open **Settings → Personal → API keys**.
2. Select **Request a key**. Enter `Claude Code` as the **Client name**. This name appears on activity caused by the key.
3. Select the Toolsets you need, such as **Contracts**. Choose **Read** to find and read records, or **Write** to allow changes as well. Nothing is selected for you. Guide Tools remain available with every key.
4. Add a **Note (Optional)** to explain your task. Check the expiry, then select **Send request**.
5. Ask an Administrator to open the bell, find your request under **Your approvals**, and select **Approve**. Your row says **Pending approval** until it is handled.
6. Return to **API keys** and reload. The **Your key is ready** dialog shows the key once. Select **Copy** and retain it in your approved secret store before selecting **Done**. OpenLaw cannot show it again.

An Administrator's own request approves itself. A Business User follows the same request flow from **API keys** in Portal Settings, if Business Users API keys is on. Their available Tools and record access follow their account.

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

## Fix a connection or stop access

| What you see                                      | What to check or do                                                                                                                                                       |
| ------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| No Request a key button                           | Ask the Administrator to turn on MCP and API keys for your account group.                                                                                                 |
| Pending approval                                  | Ask an Administrator to handle the request in Your approvals or the MCP section. You can cancel a pending request from your API keys pane.                                |
| Key dialog closed before you saved it             | Revoke that key and request another. Reloading cannot recover it.                                                                                                         |
| Connection refused, timeout, or certificate error | Check the address, office network or VPN, private DNS, and certificate trust on the Client device with your deployer.                                                     |
| Unauthorized                                      | Check that the environment variable is set in the shell launching Claude Code. Check expiry and revocation, and ask whether MCP or your group's API keys were turned off. |
| A Tool is absent or a call is refused             | Compare your approved Toolsets and scope with the organization's ceiling and Read-only switch. Record access still applies.                                               |
| Rate limit reached                                | Wait until the reset time in the refusal before retrying.                                                                                                                 |
| An openlaw configuration already exists           | Run `claude mcp remove --scope user openlaw`, then repeat the add command.                                                                                                |

To stop this Client, open **API keys**, select **Revoke** on its row, and confirm. Its next request is refused. Removing a Client configuration alone does not revoke its OpenLaw key.
