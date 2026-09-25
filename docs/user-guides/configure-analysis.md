# Configure the AI connector and Field prompts

Connect your chosen AI provider and describe the Contract values it should extract. Analysis can write values into Contracts; people then [verify those values against the source](contract-analysis.md).

## Before you start

Use an Administrator account and open **Settings → Organization → AI analysis**. It has its own entry in the Organization group. Prepare a provider API key unless a Saved key is already on file for that destination, an available model, and any endpoint your provider requires. The operator must allow both the app and its worker to reach the provider. A subscription to a provider's chat application is not itself an API key.

Use a disposable provider account and a small fictional Contract for your initial test. Confirm your organization's rules for sending Contract text to that provider before enabling it on a populated install. A new connector is enabled when saved. An Analysis run can start automatically when a primary Document's target text becomes ready or a ready Version becomes its executed copy; it is not limited to someone selecting **Run analysis**.

## Choose the provider configuration

Select the **Provider** card title to open the card. It starts closed on every visit. Its header shows **Connected**, **Turned off**, or **Not connected**. Choose **Provider**; a provider with a Saved key shows **(key saved)** in the list. Then supply the controls it exposes. Enter any required endpoint. If **Key saved** or **Key in use** appears beside **API key**, leave the field blank to use that destination's Saved key. Otherwise, enter the API key. Then select **Load models**. Select **Model** and type to narrow the list by name or ID, then choose a model from the list. The selection stores the exact provider ID. A prefilled value is a starting value from this OpenLaw build, not proof that your account can use it.

The suffix means that provider has a Saved key. For Azure or a custom endpoint, enter the matching endpoint before reusing it. A custom endpoint must also use the matching protocol. The **Key saved** pill confirms a Saved key for the destination currently in the form; **Key in use** means the saved connector references it, even while **Use AI analysis** is off. Neither pill means a connection test has passed.

Typing in **Model** only narrows the list. If you leave the box without choosing a listed model, it goes back to the model you chose before. **Refresh models** updates the list without changing your selection. If the selected model is missing from a later list, OpenLaw keeps it until you choose another. Use **Enter model ID manually** for a private model or when the provider cannot return a list. **Choose from list** turns the list back on. A partial or empty list has an explanation beside the control. Azure keeps manual entry for the deployment name because its full deployment endpoint does not list deployments.

Loading models does not save settings, run inference, send Contract text or download weights. OpenLaw leaves some models out of the list. Gemini lists only models that support Generate Content. OpenRouter lists only models with text input and text output. Groq drops inactive models and its speech and safety models. The list can still include models that do not support Contract analysis. Save and test your choice before using it on a Contract.

| Provider            | What to prepare                                                                                                                                                                                                                                                                                                                      |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Anthropic**       | A [single-workspace-scoped API key](https://platform.claude.com/docs/en/manage-claude/authentication) and a model that supports Messages. OpenLaw has no workspace-header control, so a key that requires you to select among multiple workspaces is unsuitable for this form.                                                       |
| **OpenAI**          | A standard application API key from the [API dashboard setup](https://developers.openai.com/api/docs/quickstart) and a model that supports Chat Completions. Use an application key rather than an organization Admin key.                                                                                                           |
| **Azure OpenAI**    | An API key, the full **Deployment endpoint** for [chat completions](https://learn.microsoft.com/en-us/rest/api/microsoft-foundry/azureopenai/chat), and the deployment name. Include the complete chat-completions path and any required API-version query; a resource host alone is insufficient.                                   |
| **Gemini**          | An API key and a model supporting the [Generate Content API](https://ai.google.dev/gemini-api/docs/generate-content/get-started?hl=en) used by this connector.                                                                                                                                                                       |
| **OpenRouter**      | An API key and model identifier from the [OpenRouter setup instructions](https://openrouter.ai/docs/quickstart).                                                                                                                                                                                                                     |
| **Groq**            | Create an API key at [Groq's console keys page](https://console.groq.com/keys). Use a Developer plan. The free plan's 8K tokens-per-minute budget cannot fit one Contract extraction with the default output allowance. Prefer `openai/gpt-oss-120b`, `openai/gpt-oss-20b`, or `qwen/qwen3.8-27b`, which support strict JSON Schema. |
| **Ollama**          | A running local service and an already available model following [Ollama's OpenAI compatibility instructions](https://docs.ollama.com/api/openai-compatibility). The preset uses `http://localhost:11434/v1` and does not require an API key.                                                                                        |
| **Custom endpoint** | The endpoint's **Protocol**, **Base URL**, **API key**, and **Model**. Protocol choices are **Anthropic Messages**, **OpenAI-compatible chat completions**, and **Gemini**. Use an HTTP or HTTPS URL without embedded credentials; put the key in its own field.                                                                     |

For Groq's `qwen/qwen3.8-27b`, set **Output token limit per API call** to 16,384 or lower before saving. [Groq's model reference](https://console.groq.com/docs/models) gives this model a 16,384-token completion limit, below OpenLaw's default of 32,768.

For Ollama, `localhost` means the machine or container running each calling process. In the standard Compose deployment, the app and worker have separate loopback addresses; an Ollama service on the operator's host is not automatically reachable there. This preset has no Base URL control. The operator must arrange a reachable service for both processes, or configure a suitable **Custom endpoint**. The custom form requires an API key even when the chosen endpoint does not authenticate it. [Local Ollama itself does not require authentication](https://docs.ollama.com/api/authentication).

## Save and test

1. Choose the provider and enter its required endpoint. Paste **API key**, or leave it blank when the destination shows **Key saved** or **Key in use**. Ollama does not require a key. Select **Load models**, search if needed, and choose **Model**. Use manual entry when needed.
2. Select **Save connector**. The key is encrypted and write-only; the saved value is never displayed.
3. Select **Test connection** and wait for **Connection successful.** The test sends a small fixed prompt to the configured model, without Contract text. It verifies a response from this configuration, not the quality of Contract extraction.
4. Configure the prompts below, then follow [Contract analysis](contract-analysis.md) on your fictional test Contract. Check the run's Version, model, evidence, and saved values. An automatic run may already have started when the Document's text became ready; wait for it before requesting another.

The **Connected** badge means the connector is saved and enabled, even before a successful test. If testing fails, correct the saved configuration and test again. Turning off **Use AI analysis** also disables **Test connection**; turn it on when ready to test. Saving changes to an existing disabled connector leaves it disabled.

## Choose the answer style and edit prompts

Three closed cards sit at the bottom of this page, below **Provider** and, after saving a connector, **Request conversion**. Select a card's title to open it. Each card opens on its own, and all three start closed on every visit.

- **Answer style.** This is the Organization default form of AI answers for Contract Fields of type Text or Long text. It does not change the seven built-in Contract values, because none of them is a text value. The choices are unavailable until you save a connector. Until then the card says "Connect an AI provider to choose an answer style." Choose **Few word summary** for a few words up to 80 characters, **1-2 sentence summary** for one or two short sentences up to 200 characters, or **Full clause text** for the provision quoted verbatim. Each choice saves immediately and shows its save result. The default is **1-2 sentence summary**. A Text Field uses 1-2 sentence summary when the Organization default is **Full clause text**, because a Text value stops at 500 characters. A Field can override the default, as described in [Add a catalog Field to Analysis](#add-a-catalog-field-to-analysis). Conversion drafts use the same style for their text Fields. The Conversion draft's built-in Title and Description keep their own wording. A new style applies to the next Analysis run. Values already written keep their form until a rerun.
- **Matter and Contract conversion prompts.** Edit the prompts for Title, Description, Priority, Needed by, and Counterparty, proposed alongside the target Type's Fields. Use `{module}` where the prompt should say Matter or Contract when the draft runs.
- **Contract analysis prompts.** Edit prompts for the seven built-in Contract values. For example, ask the notice-period prompt for the number of days stated in the fictional paper.

Press Enter or leave the input to save that prompt, and wait for its save result. Shift+Enter inserts a line break. Press Escape to restore the saved text. Each prompt is required and can contain up to 2,000 characters. If you clear a prompt and leave the input, the saved text comes back. For an overridden prompt, **Reset to default** restores that one built-in prompt.

The shared rules for corrections, conflicts, justification, missing values, and source scope are fixed in code. They cannot be edited in Settings. Citations carry the wording unless the answer style asks for the full clause. The output-format instructions are also fixed. They tell the model how to shape its JSON reply and which source ids to cite, and OpenLaw depends on them to read the answer. Field prompts only need to describe what to extract and any field-specific interpretation; they do not need to repeat the shared rules.

Prompt changes affect subsequent Analysis runs and Conversion drafts. They do not rewrite earlier results or confirm an existing **Unverified** value. Rerun deliberately after editing a prompt and review the resulting evidence.

## Add a catalog Field to Analysis

1. Follow **Contracts → Fields** from the **Contract analysis prompts** card, or open that Settings destination directly.
2. Create or edit a Contract Field with a type other than User or Entity. Enter its **AI prompt** to describe the value to extract. For a Text or Long text Field, **Answer style** appears below the prompt. Keep **Organisation default**, which shows the current default in parentheses, or choose a style for this Field only. **Full clause text** cannot be chosen for a Text Field, because it needs a Long text Field. Save the Field. Use [Fields and Type configuration](types-statuses-fields.md) for the catalog controls.
3. Open the **Form** tab of the Contract Type your test Contract uses. Select **Attach Field** and choose the active Field, so the Form has a Row for it.
4. Run Analysis on that Contract and check the Field's result and its saved value.

Only active Contract-scoped Fields with a Row on that Contract Type's Form and an AI prompt are included. User and Entity Fields are excluded, even if they have an old saved prompt. Their editor has no AI prompt box because Analysis cannot select an internal user or Entity. Removing a Field's prompt stops including it in future runs; it does not erase an existing value.

## Understand the data sent

An Analysis run uses the Document Version marked as the primary Document's executed copy (the executed pin), or its current Document Version when none is marked. It sends extracted text from that target, plus the requested Field identifiers and their prompts. It also asks for Key dates. That request carries the Contract's existing Key dates, its effective and expiry dates, its notice deadline, and the dates saved in its Fields, so the model does not repeat them. It does not send the PDF or Word file itself, supporting Documents, or the full Entity catalog. This build limits the supplied text to the first 200,000 characters, so a long document may not be fully represented.

The provider's response can write supported values and mark them **Unverified**. These values are already usable, including in derived deadlines. Existing values a person has set or confirmed are preserved under the rules in [Contract analysis](contract-analysis.md); changing a prompt does not override that protection.

OpenLaw's encrypted key storage does not establish the provider's retention, training, or hosting terms. Check those under your organization's provider agreement. The model and evidence shown by a run identify what it returned, not a guarantee of accuracy or completeness.

## Disable, rotate, or remove

Turn off **Use AI analysis** to stop new provider use while keeping the connector. A request already sent to the provider can still finish and apply its results. Disabling does not recall text already sent, cancel an in-flight provider call, erase saved values, or remove their **Unverified** markers.

OpenLaw keeps one **Saved key** for each destination, defined by provider preset, protocol, and normalized base URL. It ignores URL fragments, one trailing path slash, and query parameter order when matching destinations. When you switch providers, the previous destination's key stays saved, including when you move to keyless Ollama. Returning to that destination reuses its key; a different destination needs its own Saved key or a pasted key if it requires one.

To rotate a destination's key, choose that destination, paste a new **API key**, select **Save connector**, and test while the connector is enabled. Saving replaces only that destination's key. Loading models with a pasted key does not save the replacement.

Only **Forget key** deletes a Saved key. Choose its destination, select **Forget key** beside **Key saved**, and confirm. The action is absent beside **Key in use** because the connector still uses that key. Remove the connector or save it with another destination first, then return to the old destination to forget its key. Disabling the connector does not release its key. Forgetting does not revoke a key at the provider.

To remove the connector, select **Remove connector** and confirm. Removal also turns off the three Request conversion switches and sets **Answer style** back to **1-2 sentence summary**. Saved keys stay on file and can be used when you reconnect, or you can delete them with **Forget key**. Removal does not revoke a key at the provider. Keep the install's encryption key in the operator's recovery materials as described in [deployment configuration](deployment-configuration.md).

## If testing or Analysis fails

| Symptom                                         | Check and recovery                                                                                                                                                                                                                  |
| ----------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Settings is unavailable                         | Use an Administrator account. A Legal Team Member can run Analysis on an eligible reached Contract but cannot change this configuration.                                                                                            |
| Model list cannot be loaded                     | Check the key and endpoint, then retry **Load models**. Use **Enter model ID manually** if this endpoint has no listing API. Loading requires outbound access from the app.                                                         |
| Test is unavailable                             | Save a connector and turn on **Use AI analysis**.                                                                                                                                                                                   |
| Provider rejects the key or model               | Check that the key belongs to the intended API account and can use that exact model or deployment. Correct the saved key or Model, then retest. For Anthropic, also check the key's workspace scope.                                |
| Endpoint or connection failure                  | Check Protocol and the full endpoint, especially Azure's chat-completions path. Ask the operator to check outbound access from both the app and worker. For Ollama, check each process's localhost and that the model is available. |
| Provider refuses or times out                   | Read the reported reason. Resolve provider availability, account limits, or unsupported model/protocol settings before retrying. A successful earlier probe does not ensure a later Contract run will succeed.                      |
| Connection test passes but a Contract run fails | Check the run's failure and the primary Document's text readiness. Follow [Document processing](document-previews.md) and [Analysis recovery](contract-analysis.md). A short probe does not exercise the full Contract input.       |
| A Field is missing from the result              | Check that it is active, Contract-scoped, attached to this Type, and has an AI prompt. Check whether the run started before you saved the change.                                                                                   |

When escalating, provide the time, provider, model, displayed error, C- reference, and run's Document Version. Do not include the API key or copy Contract text into a general support report.

## Output token limit

The Provider card includes an **Output token limit per API call** slider and an exact number input. Save the connector to apply it to future analysis calls, including Request preparation. The default is 32,768 tokens; you can choose between 1,024 and 262,144. The setting persists across restarts and applies to every provider protocol. The short connection test keeps its smaller 1,024-token allowance.

Below 32,768, a warning explains that analyses are more likely to fail with incomplete responses, especially when reasoning uses the same output allowance. This threshold is guidance, not a guarantee. Choose a limit supported by the selected model. Higher limits allow longer responses and can increase latency and cost, but do not force the model to use the entire allowance. Each batch and corrective retry respects the saved ceiling; it is not a combined budget for the whole analysis.

## Structured replies and recovery

OpenLaw sends the requested field types and allowed choices to the provider. OpenAI, Azure OpenAI, and Groq use a JSON response schema, Claude uses its structured output format, and Gemini uses its response schema. OpenRouter, Ollama, and custom compatible endpoints use the adapter for their selected protocol. If a model explicitly rejects an output-format feature, OpenLaw falls back to a supported format while keeping the same local validation.

Large field sets are split into smaller batches, with at most two calls running at once. OpenLaw checks the returned field names, value types, and citation structure, then applies the existing source-evidence checks before saving suggestions. Unsupported answers stay empty. If a value still has the wrong type after the corrective attempt, the run writes nothing for that value and still saves the other values. A malformed or truncated response gets one corrective attempt per batch within a five-minute batch budget; all attempts respect the saved output token limit. The full set of fields has a time limit based on the number of batches, up to fifteen minutes per source section. Groq's JSON generation validation failure also gets this correction attempt. Credential errors and other configuration refusals do not.

Request preparation also uses each attached custom field's AI prompt, along with its description, type, and allowed choices. Editing those instructions makes an earlier conversion draft stale. Preparation failures distinguish unusable replies, output limits, timeouts, availability problems, and rejected configuration. They do not display the provider's raw response or credentials. You can retry or continue manually.

## Request conversion switches

Under **AI analysis**, find the **Request conversion** card. It appears only after a connector is saved. Its three independent switches start off:

- **Prepare Matter conversions with AI** prepares an editable Conversion draft before Matter creation.
- **Prepare Contract conversions with AI** prepares an editable Conversion draft before Contract creation.
- **Fill Contract Fields after conversion** starts a background Analysis run on the created Contract using its confirmed Type, current core/custom prompts and eligible Request answers, conversation and supporting sources. This also works when Contract preparation is off.

Only an Administrator can save these settings. Each switch requires the connector to be enabled. While **Use AI analysis** is off, the switches are unavailable. **Remove connector** also deletes these settings, so a new connector starts with all three off. Turning one off stops new application for that workflow. Existing evidence, Unverified values and individual confirm/edit remain available. Ordinary manual Contract analysis keeps its existing control. Follow [Request conversion](convert-request.md) and [Contract analysis](contract-analysis.md) to review proposals, progress, omissions and safe retries.
