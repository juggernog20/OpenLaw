# Review Contract analysis and verify values

Analysis can write Contract values before anyone confirms them. Review each **Unverified** value against the Document it came from, then confirm it or correct it.

## Before you start

Use a Legal Team Member or Administrator account that can reach the Contract. To run Analysis, the Contract must be neither Ended nor archived, an Administrator must have [configured and enabled the AI connector](configure-analysis.md), and its primary Document must have ready, non-empty extracted text. Your configured provider receives that text for Analysis.

The target is the primary Document's executed pin, or its current Document Version when no pin exists. A newer upload does not displace an older executed pin. Ordinary manual and automatic primary-Document runs use this one target. Request-context Analysis after conversion also reads eligible Request answers, conversation and supporting sources. Check the primary Document and its Version under **Documents** before running; [Document Versions](document-versions.md) and [manual hand-off](manual-signing.md) explain those controls.

## Run Analysis and read its outcome

Analysis can start automatically when the target's text becomes ready or a ready Document Version is marked as the executed copy. To request a run yourself, open **Fields** and select **Run analysis** in the section header. The Contract actions menu also offers **Run analysis** from any section. The control says **Running…** and stays disabled while the run is under way. The record updates when the run finishes, while preserving typed drafts. A finished run shows no summary sentence. Its results are the values it wrote.

User and Entity Fields stay outside Analysis, even if they have an old saved prompt. Set those Fields yourself on the Contract.

A text or long text Field's answer takes that Field's **Answer style**: **Few word summary**, **1-2 sentence summary**, or **Full clause text**. The Field uses the organization default unless an Administrator set its own style. A style change applies to the next run. Values already written keep their form. [Configure Analysis](configure-analysis.md) explains the setting.

A finished run writes its answers onto the Contract itself. Read them where the values live: a built-in Row on **Overview**, a Field on **Fields**, a milestone in **Key dates**. Each value the run wrote carries an **Unverified** marker beside it. A value the run could not support, could not use, or chose to keep writes nothing, so a Row with no marker is a Row the run left alone. A Counterparty the run could not link stays unlinked. Analysis needs one matching live Counterparty and no existing Counterparty link, and it never creates one. The record does not say that a Counterparty name went unmatched.

Analysis also looks for named Contract milestones with explicit calendar dates in Document text, such as a price review or an option deadline. A written milestone is added to the **Key dates** section with an **Unverified** marker. A milestone that matches an existing Key date or a term date is kept, and adds nothing.

Each newly AI-written value has a subtle purple border, the neutral **Unverified** indicator and an evidence sparkle. Select the sparkle to open the cited original Document Version in the same-page doc panel and locate its quoted passage. For Request-context Analysis, multiple citations let you choose a source; Request answers and messages show their actual text and context. These are saved citations, so opening one makes no new AI call. Compare the evidence with the surrounding text. An evidence quote supports the extraction; it does not establish that the interpretation is correct or complete. The evidence is available while the value is **Unverified**; confirming the value clears the marker and the sparkle with it.

## Confirm or correct one value

Select **Confirm** beside the value you have checked. Confirmation keeps the value and clears that value's **Unverified** marker. Other markers remain. To correct a value, edit its normal control on **Overview** or **Fields** and wait for the save result; that edit clears the corresponding marker. For an extracted Key date, use **Edit date** or **Remove date** in **Key dates**. A change to its date or event, or its removal, clears the marker, and later runs do not add that milestone again. A change to only its note or reminders does not clear the marker.

**Confirm all** appears in the **Fields** section header when more than one value on the Contract is marked, in any section. Use it only after checking every marked value on **Overview**, **Fields** and **Key dates**. It clears the remaining markers together. **History** records Analysis and confirmation activity. Business Users cannot run Analysis or confirm its values. An archived Contract must be restored before confirmation; an Ended Contract can still have its existing values reviewed and corrected.

Unverified values are already usable. An extracted expiry or notice period affects the Contract's derived deadlines before confirmation, an extracted Key date is already in the Key dates list, and the recorded Value is already saved. Check [terms and renewals](terms-and-renewals.md) and the displayed dates promptly. Confirmation does not roll a term or change the Contract's Status.

## Rerun after a change

Check the current primary Document and executed pin, then select **Run analysis** again when no run is pending. The run uses the configured target Fields and prompts. An unverified value can be replaced by a later supported answer; existing values you have set or confirmed are kept. A later run does not change or remove a Key date that an earlier run added. Explicit clears remain human choices and are preserved by later runs. The Value's amount, currency, and cadence are treated together.

A run's evidence describes its own input. The evidence sparkle opens the Document Version that run read. Uploading a newer Version does not make an earlier run's evidence refer to it. If the Document or a saved value changed while you were reviewing, read the updated Contract and the cited Version again before confirming. A rerun can preserve a saved value even when its returned answer differs.

## Analysis after Request conversion

An Administrator can enable **Fill Contract Fields after conversion** independently of both Convert dialog preparation switches. Successful conversion commits first. Then one durable Analysis run reads eligible original Request context and supporting sources. It fills the confirmed Type's Record Rows: the Rows that are neither **On intake form** nor **Required for creation**. A Field Row needs no saved prompt for this pass. The Conversion draft already covered the Intake and Creation Rows. The run can also add a **Needed by** Key date when the Contract has none. A Document Version promoted from the Request does not queue a separate automatic run. Conversion draft values can already await confirmation even when no Analysis run has run.

Most values this run fills show their **Unverified** marker, evidence and **Confirm** where they live. At this build, no page shows a marker, evidence or **Confirm** for **Risk**, **Region** or **Department** when this run filled them. Those values do not count towards showing **Confirm all**, so the **Fields** header can show only **Run analysis**. Check those three Rows on **Overview** yourself after conversion. When **Confirm all** appears for other values, it also clears these hidden markers.

If this run fails, a note under the **Fields** section header says: "Request-context Analysis failed. The Contract was created successfully. Check the Type, sources and AI settings, then retry."

The Contract remains created. Check the current Type, sources and settings, then select **Retry Request-context Analysis** in the header. Retry reads current sources and Type. Human values, confirmations and explicit clears still win. Disabling the switch or connector prevents new application, while saved evidence and individual confirm/edit remain usable.

## If Analysis cannot finish

If **Run analysis** is unavailable, check your role, the Contract's Ended/archived state, whether a run is pending, and the AI connector. With no connector, no run and no marked value, the **Fields** header shows no Analysis controls. If the connector is disabled, no new run can start. Existing **Unverified** values keep their row controls, and **History** keeps the runs. Disabling the connector does not erase existing unverified values.

A refusal can also mean there is no primary Document, you cannot read the primary Document, or its target text is not ready or is empty. A refused run from the Contract actions menu shows its reason under the **Fields** section header. Check [Document reading and processing](document-previews.md). A failed run shows **Analysis failed:** and its reason in the same place. Resolve the processing or provider problem, then request another run; an Analysis failure does not justify confirming unchecked values. Ask an Administrator to check [the connector and Field prompts](configure-analysis.md) when the failure concerns configuration.

A removed, edited or inaccessible source can make a citation unavailable. If you still have access but a quote cannot be located, use the displayed source text or original download. If the source was removed or your access changed, ask the record owner for help; a download cannot bypass that restriction. Do not treat an unavailable citation as verification. Restricted sources are excluded from the Request-context pass; it does not copy Legal Only observations into broader Fields.
