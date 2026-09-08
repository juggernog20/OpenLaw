# Look up terms, permissions, and file behavior

Use this reference alongside the procedure for your role. Labels and limits can depend on your organization's configuration. Check [Edition details](versions-and-support.md) before applying instructions to a different app build.

## Work and people

| Term                   | Meaning                                                                                                |
| ---------------------- | ------------------------------------------------------------------------------------------------------ |
| Request                | Work a Business User submits through the Portal for Legal to triage.                                   |
| Contract               | A workspace for legal work whose deliverable is a signed document.                                     |
| Matter                 | A container for legal effort such as advice, disputes, or investigations.                              |
| Entity                 | One of your own corporate entities, such as a subsidiary or branch.                                    |
| Counterparty           | An external organization on the other side of a Contract or Matter.                                    |
| Holding                | A directional ownership percentage between two Entities; it does not grant access.                     |
| Registration           | An Entity's registration or qualification in a jurisdiction, separate from its formation jurisdiction. |
| Officer                | A named person with a role and appointment on an Entity; an OpenLaw account is optional.               |
| Knowledge Item         | Curated organizational guidance that can own Documents. Product Help explains OpenLaw itself.          |
| Owner / Matter Manager | The accountable person on a Contract / Matter respectively.                                            |
| Requester              | The Business User who submitted that Request.                                                          |
| Signer                 | A named person asked to sign an Envelope; they do not need an OpenLaw account.                         |

See [Entities and Counterparties](entities-and-counterparties.md), [Entity records](entity-records.md), and [Knowledge authoring](create-knowledge.md).

## Workflow and dates

| Term             | Fixed meaning or distinction                                                                                                     |
| ---------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| Stage            | A Contract's fixed lifecycle backbone: Draft, Review, Approval, Signature, Active, Ended. Its Status determines its Stage.       |
| Status           | A configurable label mapped to one Contract Stage or one Matter Category. Renaming the label does not change the mapping.        |
| Category         | A Matter Status maps to Open or Closed.                                                                                          |
| Task             | Checklist work with an optional assigned person and due date. Task due dates are separate from Key dates.                        |
| Key date         | A named Contract or Matter deadline, with an optional note; it has no assignee or individual reminder schedule.                  |
| Obligation       | An Entity filing or compliance requirement, with its own cycle and filing history.                                               |
| Approval Request | A named colleague's internal decision on a Contract. It is separate from signature.                                              |
| Envelope         | One electronic-signature round on one Version of a Contract's primary Document. A Contract has at most one live Envelope.        |
| Analysis run     | A recorded reading of a Contract's target Document Version using the configured AI target Fields.                                |
| Unverified value | A saved value written by Analysis with its evidence still attached. It is already usable; confirmation records a person's check. |

[Contract Status changes](contract-stages.md), [Matter Status](matter-status-and-archive.md), [Tasks and Key dates](contract-tasks-and-dates.md), and [Entity Obligations](entity-obligations.md) explain the actions and their effects. An archived record is a separate condition from a Contract being Ended or a Matter being Closed.

## Permissions at a glance

Both account role and record access apply. This table is a starting point; [roles and record access](roles-and-access.md) gives Confidential access and Document/conversation audience rules.

| Reader              | Reach and action limits                                                                                                                                                                                                              |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Administrator       | Legal work and organization settings, including all Confidential Contracts, Matters, and Entities. Individual actions can still require the named person, such as answering an Approval Request.                                     |
| Legal Team Member   | Legal work on reachable records. Confidential Contracts/Matters need the applicable Owner, Manager, or team access; Confidential Entities use Grants. Organization settings remain Administrator-only.                               |
| Contributor         | Shared Contracts and Matters through their teams. Can edit permitted business information, supply supporting Documents, and join permitted conversations. Cannot perform legal actions, complete Tasks, or manage primary Documents. |
| Business User       | Their own Portal Requests and published Knowledge shared with their audience. Conversion does not open the staff Contract or Matter workspace to them.                                                                               |
| Deployment operator | Maintains the installation and service configuration. This is an operational responsibility, not an additional app account role. Use an appropriate account for in-app work.                                                         |

A relationship, mention, Task assignment, or copied link does not itself share a record. A Contributor on one Contract does not acquire access to its related Matter. See [Contributor work](contributor-guide.md) and [Request updates](follow-request.md).

## Documents and derived files

| Term               | Meaning and consequence                                                                                                                        |
| ------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| Document           | Managed paper owned by exactly one Contract, Matter, Entity, or Knowledge Item.                                                                |
| Document Version   | A file snapshot in that Document's linear chain. Adding a Version preserves earlier file bytes.                                                |
| Version kind       | The classification of a Version, such as Draft · ours or Executed; it is separate from the Executed pin.                                       |
| Primary Document   | The designated principal Document on a Contract. Knowledge has its own primary selection. Matters and Entities have no equivalent designation. |
| Executed pin       | The selected executed Version on a Contract's primary Document. A newer upload does not automatically move it.                                 |
| Comparison         | A derived comparison of two Versions of one Document; it is not itself a Version.                                                              |
| Generated redline  | A Version appended by a supported Comparison export. Its generated kind cannot be assigned to an ordinary upload.                              |
| Preview            | A reading rendition of the selected file; conversion does not add a Version or replace the original.                                           |
| Comment attachment | Paper in a conversation's audience. It becomes managed paper only through an applicable filing action.                                         |

Follow [Document Versions](document-versions.md), [Comparison](compare-versions.md), and [archive/deletion](archive-and-delete-documents.md). There is no individual-Version delete action; permanent Document deletion has wider consequences and requires an Administrator.

## File behavior and limits

| Item                                                 | Behavior or limit                                                                                                                                                                          |
| ---------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Stored file types                                    | Any type can be uploaded, subject to the destination's rules and deployment limit. Storage acceptance does not promise a preview or extracted text.                                        |
| Upload size                                          | Default 100 MiB per file (104,857,600 bytes), displayed as MB in a refusal. The operator can configure a different limit with `MAX_UPLOAD_MB`; use the actual refusal or ask the operator. |
| Filename                                             | At most 255 characters under the API's filename check. Use a short, meaningful name if refused.                                                                                            |
| PDF                                                  | Read original pages. Background OCR can make a scan searchable without replacing its original pages.                                                                                       |
| Supported Word / PowerPoint                          | Read a converted PDF once preparation finishes; Download returns the original uploaded file.                                                                                               |
| Supported raster image                               | Read inline, including PNG and JPEG.                                                                                                                                                       |
| EML / MSG                                            | Read message headers, body, and attachments. Remote images and active body content are not loaded.                                                                                         |
| Spreadsheet, ZIP, SVG, and other download-only types | Store and download; no in-app preview is promised.                                                                                                                                         |
| Portal files                                         | Request attachments download within the permitted thread. Published Knowledge offers current-file downloads, without the staff Version-history picker.                                     |

The applicable [Document reading guide](document-previews.md) describes format-specific controls and recovery. Preview and text extraction can finish after storage; a failed preview is different from a failed original download.

## What your organization can configure

Administrators configure types, Status labels, Fields, Matter Templates, Approver groups, request forms, reminder lead times, and eligible organization settings. A Field's label can change while its stable identifier remains. A type's required answers and available Fields can differ from another type's. See [types, Statuses, and Fields](types-statuses-fields.md), [Matter Templates](matter-templates.md), and [Request forms](request-forms.md).

Account roles, Contract Stages, Matter Categories, and the distinction between Entity and Counterparty are fixed concepts. Configuration does not make a Contributor a Legal Team Member or turn an Approval into a signature.

Personal preferences belong to the signed-in person; organization settings belong to the Administrator; environment configuration, storage, backups, and service operation belong to the deployment operator. Follow [personal settings](personal-settings.md), [organization and users](organisation-and-users.md), and [deployment configuration](deployment-configuration.md) for the right controls.
