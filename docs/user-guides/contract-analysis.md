# Review Contract analysis and verify values

Analysis can write Contract values before anyone confirms them. Review each **Unverified** value against the Document it came from, then confirm it or correct it.

## Before you start

Use a Legal Team Member or Administrator account that can reach the Contract. To run Analysis, the Contract must be neither Ended nor archived, an Administrator must have [configured and enabled the AI connector](configure-analysis.md), and its primary Document must have ready, non-empty extracted text. Your configured provider receives that text for Analysis.

The target is the primary Document's executed pin, or its current Document Version when no pin exists. A newer upload does not displace an older executed pin. Ordinary manual and automatic primary-Document runs use this one target. Request-context Analysis after conversion also reads eligible Request answers, conversation and supporting sources. Check the primary Document and its Version under **Documents** before running; [Document Versions](document-versions.md) and [manual hand-off](manual-signing.md) explain those controls.

## Run Analysis and read its outcome

Analysis can start automatically when the target's text becomes ready or a ready Document Version is marked as the executed copy. To request a run yourself, open **Fields**, find **AI analysis** below the Fields card, and select **Run analysis**. The Contract actions menu also offers **Run analysis** from any section. Wait while it says **Running…**. The card updates when the run finishes, while preserving typed drafts.

Read the completion sentence's Version, model, and time. The results show the returned values, their evidence, and what happened to each value:

| Outcome         | What to check                                                                                                                           |
| --------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| **Written**     | The value was saved on the Contract and marked **Unverified**.                                                                          |
| **Kept**        | The existing value was preserved. The returned value in this result is not necessarily the value saved on the Contract.                 |
| **Unsupported** | No usable evidence supported this answer in the text supplied to the run.                                                               |
| **Invalid**     | The answer could not be used for that Field or the recorded term.                                                                       |
| **Unmatched**   | A Counterparty was not linked. Analysis needs one matching live Counterparty and no existing Counterparty link; it does not create one. |

Each newly AI-written value has a subtle purple border, the neutral **Unverified** indicator and an evidence sparkle. Select the sparkle to open the cited original Document Version in the same-page doc panel and locate its quoted passage. For Request-context Analysis, multiple citations let you choose a source; Request answers and messages show their actual text and context. These are saved citations, so opening one makes no new AI call. Compare the evidence with the surrounding text. Check the actual saved value on **Overview** or **Fields** as well as the Analysis result. An evidence quote supports the extraction; it does not establish that the interpretation is correct or complete.

## Confirm or correct one value

Select **Confirm** beside the value you have checked. Confirmation keeps the value and clears that value's **Unverified** marker. Other markers remain. To correct a value, edit its normal control on **Overview** or **Fields** and wait for the save result; that edit clears the corresponding marker.

Use **Confirm all** only after checking every marked value. It clears the remaining markers together. **History** records Analysis and confirmation activity. Business Users cannot run Analysis or confirm its values. An archived Contract must be restored before confirmation; an Ended Contract can still have its existing values reviewed and corrected.

Unverified values are already usable. An extracted expiry or notice period affects the Contract's derived deadlines before confirmation, and the recorded Value is already saved. Check [terms and renewals](terms-and-renewals.md) and the displayed dates promptly. Confirmation does not roll a term or change the Contract's Status.

## Rerun after a change

Check the current primary Document and executed pin, then select **Run analysis** again when no run is pending. The run uses the configured target Fields and prompts. An unverified value can be replaced by a later supported answer; existing values you have set or confirmed are kept. Explicit clears remain human choices and are preserved by later runs. The Value's amount, currency, and cadence are treated together.

A run's Version and evidence describe its own input. Uploading a newer Version does not make an earlier run's evidence refer to it. If the Document or a saved value changed while you were reviewing, read the updated Contract and the run's named Version again before confirming. A rerun can preserve a saved value even when its returned answer differs.

## Analysis after Request conversion

An Administrator can enable **Fill Contract Fields after conversion** independently of both Convert dialog preparation switches. Successful conversion commits first, then one durable Analysis run reads the confirmed Type's current core and prompted catalog Fields with eligible original Request context and supporting sources. The first promoted primary Document does not queue a competing run. The **AI analysis** card reports filling, completion, partial-source warnings or failure. Conversion draft values can already await confirmation even when no Analysis run has run.

If this run fails, the Contract remains created. Check the current Type, sources and settings, then select **Retry Request-context Analysis**. Retry reads current sources and Type. Human values, confirmations and explicit clears still win. Disabling the switch or connector prevents new application, while saved evidence and individual confirm/edit remain usable.

## If Analysis cannot finish

If **Run analysis** is unavailable, check your role, the Contract's Ended/archived state, whether a run is pending, and the AI connector. If the card is absent, the connector may be disabled and there may be no marked values to show. Disabling the connector does not erase existing unverified values.

A refusal can also mean there is no primary Document or its target text is not ready or is empty. Check [Document reading and processing](document-previews.md). A failed run reports its reason, Version, and model. Resolve the processing or provider problem, then request another run; an Analysis failure does not justify confirming unchecked values. Ask an Administrator to check [the connector and Field prompts](configure-analysis.md) when the failure concerns configuration.

A removed, edited or inaccessible source can make a citation unavailable. If you still have access but a quote cannot be located, use the displayed source text or original download. If the source was removed or your access changed, ask the record owner for help; a download cannot bypass that restriction. Do not treat an unavailable citation as verification. Restricted sources are excluded from the Request-context pass; it does not copy Legal Only observations into broader Fields.
