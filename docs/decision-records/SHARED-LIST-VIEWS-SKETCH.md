# Shared list views — a priced sketch

**This is not a decision.** DD-019 stands: a saved view is private to one person. This document takes no
`DD-` number, changes no behaviour, and ratifies nothing. It prices the graduation DD-019 names in its
alternatives — "shared views with an Administrator default" — so that the day the papercut bleeds, the
decision is a ratification rather than an argument.

Origin: the 2026-08-20 high-level review of the API and domain core, close call CC-4, worked in issue #389.

## Why price it now

DD-019 kept views private, and the review upheld that. But the defence leaned on reversibility — nothing is
built that a later record could not undo — more than on the record's own reasoning. The reasoning is that at
DD-002's team size, "send me your columns" is a sentence and not a feature.

That sentence holds at two people. At the top of the persona it starts to strain. Ten people rebuilding the
same renewals view by hand is a real papercut, and DD-019 does not say what fixing it costs. This document
says.

## What exists today

The thing being extended is small, and the price is mostly in how tightly it is built.

| Piece                                                | Size       | What it holds                                                   |
| ---------------------------------------------------- | ---------- | --------------------------------------------------------------- |
| `packages/db/src/schema/list-views.ts`               | ~110 lines | One table. Two unique indexes. Two check constraints.           |
| `packages/db/migrations/0051_list_views.sql`         | 16 lines   | The table as it shipped.                                        |
| `apps/api/src/modules/list-views/routes.ts`          | 355 lines  | Four routes, all scoped to `request.user.id` in one predicate.  |
| `apps/api/src/modules/list-views/list-views.test.ts` | 394 lines  | Asserts the 404-not-403 convention throughout.                  |
| `apps/web/src/lib/list-views.ts`                     | 320 lines  | Catalogue, layout, view. `resolveLayout` reads a stored layout. |
| `apps/web/src/components/table/views-menu.tsx`       | 321 lines  | The DES-046 clause 6 control.                                   |
| `apps/web/src/routes/contracts.tsx`                  | 610 lines  | The only surface that adopts it.                                |

**One surface adopts saved views today.** `LIST_VIEW_SURFACES` is `["contracts"]`, and `ManagedTable` is
rendered by `contracts.tsx` alone. The Entities list is a bespoke table. Matters (M22), Documents (M26), and
Entities (M27) each adopt the same machinery later, so **any per-surface price is paid up to four times**.

**Every surface reads views the same way, in three lines.** The contracts loader reads this person's views,
takes the row that carries `isDefault`, and resolves it against the column catalogue — or draws the built-in
layout when no row does:

```ts
const views = await readViews(CATALOGUE.surface);
const opensOn = views.find((view) => view.isDefault) ?? null;
const layout = opensOn ? resolveLayout(CATALOGUE, opensOn.layout) : builtInLayout(CATALOGUE);
```

One read, one pick, two outcomes. Everything below that adds an outcome adds it here, four times.

## The schema delta — the "a column and a read-scope" reading does not hold

DD-019 never states the delta in one sentence. The reading under test comes from putting clause 1 ("no
`is_shared` column waiting to be turned on") beside the Consequences ("one API module scoped so hard to
`request.user.id` that another person's view id is a 404"). Read together they suggest the graduation is one
column plus one widened predicate.

**Against the schema as built, that reading is too small.** It is right about the column. It is wrong about
everything the column collides with. The true delta is six things.

**1. The column — real, and it should not be a boolean.** `scope text not null default 'private'` with a
check beats `is_shared boolean`, because a boolean cannot later hold a third state without a second boolean.

**2. Both unique indexes have to be rewritten.** `list_views_name_idx` is `(user_id, surface, lower(name))`.
It gives the menu its rule that no two rows sort as one. A shared view has no useful `user_id` leading
column, so two Administrators could both publish "Renewals". The existing index becomes partial
(`where scope = 'private'`), and a second partial unique index `(surface, lower(name)) where scope = 'shared'`
joins it. Even then the index cannot stop a shared "Renewals" from sitting in a person's menu beside their own
private "Renewals" — so the menu gains a disambiguation rule that no constraint can give it. That is a design
question wearing a schema question's clothes.

**3. `is_default` cannot carry a workspace default.** `list_views_default_idx` is
`(user_id, surface) where is_default`, which is "one default per person per surface". A workspace default is
per surface and belongs to nobody. A shared row with `is_default` true is ambiguous: the index cannot tell one
Administrator's personal pick from the workspace's. So this needs a second column
(`is_workspace_default`, with a partial unique index on `(surface)`) or a separate table, plus a check
constraint that allows `is_default` only on a row that still has a `user_id` — otherwise a shared row can hold
a personal flag that belongs to nobody. Either way the loader's one pick becomes a three-level merge: my
default, else the workspace default, else the built-in layout.

**4. `user_id` stops being one thing.** Today it is author, owner, and scope key at once. That is exactly why
one predicate does all four routes' work. Sharing splits it into author (who made it), owner (who may edit
it), and reader (who may see it). Two of those three are answered by a DD-013 role rather than by an id, so
the column stays and quietly gains meanings it does not carry.

**5. The cascade is wrong for a shared row.** The FK is `on delete cascade`, justified in the schema comment
as "a deleted user's saved columns are nobody's". A shared view's saved columns are ten people's. Today
nothing fires this against a view: the Users module archives (`archived_at`) rather than deletes, and the one
hard user delete anywhere — revoking a never-activated invite (SET-005) — removes somebody who could never have
signed in to save one. So the author-left story is "an archived author's private views become unreachable, and
that harms nobody". Under sharing the
story has to change — an archived author's shared view must stay alive and must become editable by somebody.
The clean shape is that a shared row is owned by the role and not by the person: `user_id` goes null on shared
rows, and a nullable `created_by` records who made it. That is a nullable-column migration plus the index
rewrite in point 2, not a column.

**6. The ceiling needs a second one.** `MAX_LIST_VIEWS_PER_SURFACE` is 25, counted per `(user_id, surface)`
inside the create transaction. Shared views need their own ceiling, or an Administrator's published views eat
their own personal allowance.

**The true schema delta, stated plainly:** one new column, two rewritten unique indexes, one new partial unique
index, one new check constraint, one changed foreign-key rule, one new nullable author column, and one new
ceiling. That is one migration, but it is the six decisions above inside it — and it is the cheap end of the
price.

## The read-scope delta — one predicate becomes four rules

Today the module has one authorization idea, and it is a `WHERE` clause: `and(eq(id), eq(userId))`. Sharing
replaces the idea, not the clause.

**The read widens, and the menu's order stops working.** `GET` becomes `user_id = me OR scope = 'shared'`.
`order by lower(name)` then interleaves my views with everyone's, so the menu needs a grouping the query does
not currently produce.

**The 404-not-403 convention gets a carve-out.** The module answers 404 for another person's view id, so
access is never advertised — CTR-021's convention applied to a preference. It cannot survive sharing. You
cannot answer 404 for a view the reader is looking at in their own menu but may not edit. So the module gains
its first 403, and DD-019's Consequences gain a marked exception. Sharing is advertising.

**The guard gains a role.** `routes.ts` says in terms: "The guard is authentication and nothing more … Adding
a role check here would be a second, weaker copy of the destination's own gate." That reasoning holds only
while a view is a claim about nobody. Publishing a view is a claim about everybody, so the writes that publish
and that edit a published view need a real role gate — the module's first.

**Narration becomes warranted, and is cheap.** `routes.ts` declines DD-017 narration because "how one person
likes their columns is not an event anybody audits". A view ten people open is. The cost here is genuinely
small: `activity_log` already accepts the `system` entity type with a null entity id and `admin_only`
visibility, so publish, edit, and unpublish are three call sites and no schema change.

## The DD-013 role question, per role

| Role              | Read a shared view              | Publish / edit one                                   |
| ----------------- | ------------------------------- | ---------------------------------------------------- |
| Administrator     | Yes                             | Yes — publishes, edits any shared view, unpublishes. |
| Legal Team Member | Yes                             | **The question that has to be answered.** See below. |
| Contributor       | Yes, on lists they reach        | No.                                                  |
| Business User     | Never reaches a list with views | No.                                                  |

**Legal Team Member is the live question.** This role is the persona's centre of gravity. The counsel who
built the renewals view is the reason the papercut exists, and routing every publish through the General
Counsel turns a papercut into a ticket. The recommendation, if this graduates: Legal Team Members publish and
edit what they published; Administrators edit anything. That leaves SET-002 intact — Organization settings
stay Administrator-only — but a shared view sits close enough to org configuration that the decision has to
say so out loud rather than assume it.

**Contributor is the one place sharing costs nothing.** A view carries filters, not reach. CTR-021 makes the
contracts list enforce its own scope, so a Contributor opening a shared "Renewals" sees the renewals they are
on. A shared view can never widen what anybody can see.

## The minimal version — an Administrator-pinned workspace default per surface

The smallest thing that answers the papercut. No general sharing, no shared-view library, no ownership
question, and **no change to `list_views` at all**.

- **Schema.** One small table, keyed by surface: `list_view_defaults (surface pk, config jsonb, updated_by,
updated_at)`. None of the six deltas above apply, because nothing on `list_views` learns to be shared.
- **What it still costs in the record.** Clause 1 names four things it refuses, and one of them is "no
  Administrator-pinned workspace default". So even the minimal version **amends DD-019 clause 1** — it does not
  slip under it. What survives untouched is the clause's last sentence and the sentence the schema comment
  builds on it: no `is_shared` column, and no column on `list_views` that could ever share a view. The
  amendment to write is therefore narrow — clause 1 drops the workspace-default refusal and keeps the rest —
  and DD-019 stays Accepted with that one refusal marked amended rather than superseded whole.
- **Read.** The loader's `views.find(isDefault) ?? null` becomes `mine ?? workspace ?? built-in`. One extra
  read, resolved by the same `resolveLayout` against the same catalogue, so DD-019 clause 7's read-past rule
  covers a stale workspace config for free.
- **Surface.** No settings pane. The Administrator pins it from the views menu they already have: one extra
  row, "Set as the workspace default", role-gated and absent for everyone else. That is DES-046 clause 6's
  menu growing one item.
- **Roles.** One gate, on one write, for one role. No per-role grid.
- **Author-left.** Does not arise. The row belongs to the surface, and `updated_by` is a record of who touched
  it last, not an owner.

**What it buys.** Nobody rebuilds the opening state. Every person who has not saved a view of their own lands
on the columns the General Counsel chose — which is most of the ten, most of the time.

**What it forecloses.** Nothing structural, and that is the point: it adds no column to `list_views`, so the
full graduation is still reachable at the price above and no higher. What it does **not** buy is a library:
one shared layout per surface, not several named ones; no peer-to-peer sharing without an Administrator; and
no answer to "who owns this view", because with one row per surface the answer is "whoever is Administrator
today".

**Its one real surprise.** A person whose workspace default changed under them sees their list move on the
next load, with nothing on screen that says why. The cheapest answer is the merge order already written above:
the workspace default applies only to a person who has saved no default of their own. Anyone who curated a
view is never moved.

## The trigger

**Build it the first time a second person asks for the same view.** Concretely: a second request for the same
layout on the same surface, from somebody who is not its author.

Not before. DD-019's rationale is sound while "send me your columns" is a sentence. The sentence stops working
when it is being said twice about one list.

**Build the minimal version first.** The full graduation has its own trigger, one step further out: somebody
asking to share a _second_ view on the same surface. One shared layout per surface is a default. Two is a
library, and a library is what costs the six schema deltas and the 403.

## What the full graduation would touch

For estimating, when the trigger fires:

- `packages/db/src/schema/list-views.ts` — rewritten, not amended. Its whole doc comment is an argument for
  privacy, and that argument does not survive.
- One migration, carrying the six deltas above.
- `apps/api/src/modules/list-views/routes.ts` and its 394-line test file, which asserts the 404 convention on
  every route.
- `apps/web/src/lib/list-views.ts` — `SavedView` gains a scope; `readViews` answers two groups.
- `apps/web/src/components/table/views-menu.tsx` — grouped menu, role-gated acts, and Save falling back to
  Save as on a view the reader may not edit.
- `apps/web/src/routes/contracts.tsx` — the three-level merge, repeated as M22, M26, and M27 land.
- A DES-046 amendment for the menu, and a new `DD-` record appended to `DECISIONS.md` — the file DD-019 lives
  in — that carries the sharing decision. DD-019 is kept and marked superseded, with a pointer to the new
  record's number. Never deleted, and never a file of its own.
