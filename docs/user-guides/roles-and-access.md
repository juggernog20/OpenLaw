# Understand roles and record access

Your role controls the actions available to you. Access to a record controls which work you can open. Both rules apply when you follow a link, search, read Documents, or join a conversation.

## What each role can reach

| Role              | Record access                                                                                                         | Actions                                                                                                                                     |
| ----------------- | --------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| Administrator     | All Contracts, Matters, and Entities, including Confidential records.                                                 | Legal work and organization settings, subject to each action's rules.                                                                       |
| Legal Team Member | Contracts, Matters, and Entities without the Confidential flag, plus Confidential records granted by the rules below. | Legal work on records they can reach. Organization settings remain Administrator-only.                                                      |
| Contributor       | The Contracts and Matters whose teams include them.                                                                   | Permitted business Fields, supporting Documents, and conversations. Legal actions remain unavailable.                                       |
| Business User     | Their own Requests through the Portal.                                                                                | Submit and follow Requests and reply to Legal. A Request does not grant access to the resulting Contract or Matter page outside the Portal. |

Adding a Contributor to one team does not change their account role or grant access to another record. An Administrator manages account roles. A Legal Team Member can add an existing Contributor to a permitted record team.

## How Confidential access works

On a Confidential Contract, a Legal Team Member needs a team entry or must be the Owner. On a Confidential Matter, they need a team entry or must be the Matter Manager. Contributors always need a team entry, whether the record is Confidential or not.

Administrators retain access to every Confidential record. The Confidential flag cannot exclude an Administrator. Ask an Administrator about account roles if your organization needs a different access arrangement.

An Administrator, or the permitted creator, Owner, or Matter Manager, maintains a Confidential Contract or Matter's audience. Being able to read it does not by itself let someone change its team or Confidential flag.

Confidential Entities use a different rule. An Administrator gives a named Legal Team Member a **Grant** through the Entity's **Manage access** control. A Grant applies to that Entity only. Contributors and Business Users cannot open the Entities module, and a Contract or Matter team entry does not give Entity access.

Removing a person's last qualifying team entry or Grant stops that source of access on the next read. A Legal Team Member who remains the Owner or Matter Manager can still reach that Confidential record. Removing a Legal Team Member from a record without the Confidential flag does not remove their ordinary role access.

## A shared record does not share everything

Suppose Daniel owns a Confidential Contract and adds Ravi as a Contributor. Ravi can open that Contract and do the work permitted to Contributors. Nadia, a Legal Team Member outside its team, cannot open it until she has a qualifying team entry or becomes its Owner. Daniel can still open it as an Administrator.

A parent, child, or related record has its own audience. Linking a Contract to a Matter does not copy either team's access. A relationship may show **Restricted contract** or **Restricted Matter** without a title or usable link. That label grants no access.

Documents also require access to their owning record. A Confidential Document on a Contract or Matter can narrow access to the named team and Owner or Matter Manager. It cannot give someone access to a record they otherwise cannot open. Entity Documents follow the Entity's access.

Conversations have visibility tiers within that record access. Contributors can read and write **Working team** and **Full thread**, but cannot read or write **Legal only**. A Business User follows their own Request conversation through the Portal. A Full thread message can reach its originating requester; choose the tier before posting.

## When a record is unavailable

A record outside your access is absent from lists and search. A direct record link may show **Something went wrong.** with **Reload**, just as a missing record does. Reload does not grant access. A Business User following a Contract, Matter, or Entity link outside the Portal is returned to the Portal.

Check that you are signed in with the intended account. Ask the record's Owner, Matter Manager, or an Administrator to check your role and access. Give them the link through your organization's usual support channel. An absent result does not prove that a record was deleted.

Product Help and formal documentation explain controls for several roles. Reading a guide does not grant the role or record access it describes.

## Related tasks

Contributors can follow [Work on a shared Contract or Matter](contributor-guide.md). If you are an Administrator, Legal Team Member, or Contributor, use [Search, filter, and save views](search-and-views.md) to find work you can reach.
