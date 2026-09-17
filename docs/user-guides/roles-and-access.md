# Understand roles and record access

Your account type controls what you can do. Team membership controls which records a Business User can open in the Portal.

## What each account can reach

| Account           | Access and actions                                                                                                                                                                                                                                          |
| ----------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Administrator     | Full legal work and organization settings. Confidential Contracts and Matters still require named access.                                                                                                                                                   |
| Legal Team Member | Full legal work on open records and Confidential records they can reach. Organization settings remain Administrator-only.                                                                                                                                   |
| Business User     | Their own Requests and non-archived Contracts and Matters whose teams include them, through the Portal. They read business Fields, upload Documents and Versions, join Full Thread conversations, and add existing people to non-Confidential record teams. |

Contributor is no longer an account type. Existing Contributor accounts become Business Users and keep their team memberships. An Administrator can change an account to Legal Team Member when the person needs full legal work access.

## How Confidential access works

On a Confidential Contract, an Administrator or Legal Team Member needs a team row or must be Legal Owner. On a Confidential Matter, they need a team row or must be Matter Manager. Administrator status does not bypass this rule. Business Users always need a team row.

Only an Administrator, Creator, Legal Owner or Matter Manager who is a Legal Team Member or Administrator and can already reach the record may change its Confidential audience. Being able to read the record does not give that right.

Confidential Entities use a separate rule. Every person needs a **Grant** for that Entity, and Administrators need one too. The person who creates an Entity gets a Grant. A Legal Team Member or Administrator who has a Grant uses **Manage access** to give or remove Grants. An Administrator can also manage access on an Entity that is not Confidential. A Grant applies to that Entity only. A Confidential Entity must keep at least one active person with a Grant. Business Users cannot open the Entities module.

## Manage Portal Contract access

Open **Contract team** or **Matter team** in the record's activity bar. Select **Add team member**, choose a person in **Person**, and select **Add**. Each person appears once, with their responsibilities together and no role picker. Adding a Business User gives them access to the record in the Portal. Business Users may add existing people from the Portal on non-Confidential records. Confidential team changes remain Legal actions under the rules above.

In the full app, use the person's remove control to remove membership. That ends a Business User's record access on the next read, including old links, replies, Documents and notifications. Removing a Legal Team Member from an open record does not end their ordinary account access.

Legal Owner, Matter Manager, Business Owner and Creator are statements on the person's row in both the main app and Portal. Use the owner controls on Overview to change responsibility. Assigning a Business Owner automatically adds that person to the team and gives them record access through their usual app or Portal. Change or clear the Business Owner before removing that person from the team. Reassignment leaves the former owner on the team until explicitly removed. Creator is historical and does not itself grant Portal access.

At conversion, the Requester becomes Business Owner and a team member on the new Contract or Matter. Their old Request address leads to that record. A Business User added later needs no Request.

The former Stakeholder list is removed. Existing eligible affiliations become team memberships. The upgrade preserves Confidential audiences. Legal can add a person later if an older affiliation did not give them access inside the wall.

## A shared record does not share everything

Every related record has its own audience. A link, mention or owner statement does not grant a Business User record access. Documents also require access to their owning record. A Document's Confidential flag can further narrow its audience.

Business Users read and post Full Thread comments on their records. In the Comments applet, a Full Thread comment shows **Contract Team** on a Contract and **Matter Team** on a Matter. Business Users do not see **Legal Only** comments or older **Internal team** comments. A later-added team member can read the earlier Contract Team or Matter Team comments. Removing membership ends that access. For a message to the business, Legal chooses **Contract Team** or **Matter Team** above **New comment**, not **Legal Only**.

The Portal History applet shows Contract Team and Matter Team comment activity. It excludes Legal Only and Internal team activity. Record changes do not appear in Portal History. The record details and **Fields** show the current values. The Portal excludes legal Fields, Tasks, Key dates, Approvals and signing controls. Legal retains responsibility for those actions.

## When a record is unavailable

Check your signed-in identity. Ask the Legal Owner, Matter Manager or Administrator to check the record's team. A copied link or a reload cannot restore access. An archived record leaves the Portal. An old Request link then shows its Requester the original ask and an archived notice, without Documents or a conversation.

See [Work on a shared Contract or Matter](contributor-guide.md) for Portal work. Legal Team Members and Administrators can use [Search, filter, and save views](search-and-views.md).
