# Documentation and Help design

OpenLaw needs a manual people can browse and a Help destination that gets them back
to their work. The recommended design uses a prominent local search, clearly named
guide collections, and a stable article layout. It takes its colours, type, and
geometry from OpenLaw. It keeps the same content and links across the public site,
authenticated Help, and retained HTML edition.

## Evidence and limits

The visual study examined thirteen application screens and the available previews
of two four-screen journeys in Mobbin. The sample covers Help home pages, article
layouts, search results, and Help reached from an application. Current official
Linear, Notion, and GitHub documentation pages provide a second source for navigation
and information architecture. W3C guidance supplies the reflow requirement.

Mobbin captures are visual references, not proof of a product's current behaviour.
Capture dates were not supplied. The official pages were checked on 9 September 2026. A screenshot can establish visible hierarchy and controls, but cannot prove
keyboard support, loading speed, search quality, or task completion. No conversion,
usability, or performance claims are inferred from this sample.

## Comparative findings

| Reference                                                                                | Observed pattern                                                                                                                        | Application to OpenLaw                                                                                                       |
| ---------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| [Navan Help home](https://mobbin.com/screens/94d03315-33e4-40c2-8e4e-27d2d8852e32)       | Search leads the page. Category cards and an audience control provide other entry points.                                               | Put search before the catalogue. Give collections short descriptions. Use actual OpenLaw audiences.                          |
| [Mintlify quickstart](https://mobbin.com/screens/93535887-7be3-4091-a56d-2156e3a2d653)   | Section navigation sits left, instructions in the centre, and a page outline right. The current article has a distinct selection state. | Use a three-column article layout when there is room. Keep the article readable as the available width decreases.            |
| [Hashnode article](https://mobbin.com/screens/37af2131-4bd5-4cb2-a888-7abdb45791b8)      | Search remains in the header. Code has its own area. The article title and opening text dominate the centre column.                     | Give long instructions a clear title, narrow reading measure, and separate code/table treatment.                             |
| [Amazon Help library](https://mobbin.com/screens/29ee3038-b4ed-4679-b1b8-8effef391215)   | A topic list sits beside specific action links. Each action has explanatory text.                                                       | Keep a compact collection navigation beside the browse view. Use descriptive links instead of a flat wall of article titles. |
| [Bard Help home](https://mobbin.com/screens/c7135f10-40d1-42f1-80fd-e9dd6c080249)        | Topic groups expand to expose their article links.                                                                                      | Make the guide navigation collapsible on narrow screens, while retaining direct links.                                       |
| [Charma support search](https://mobbin.com/screens/ce8483bb-9718-4deb-8672-b60baae010e7) | Search is accompanied by suggested support articles before a query exists.                                                              | Offer useful browse paths before the reader knows the term to search for. Do not require a query to discover guides.         |
| [Slack Help](https://mobbin.com/screens/99739c29-51c8-4bfb-a4c9-a96b427fca2a)            | Help lives within the account shell, with a small topic list and search.                                                                | Preserve the staff and Business Portal shells. Filter their guide choices for the signed-in audience.                        |
| [Melio support](https://mobbin.com/screens/7fbaecc4-6b79-4f31-ae86-9d783549cd63)         | Support has a stable place in application navigation and links to a fuller Help centre.                                                 | Keep the existing Help entry points and make the route to the complete manual explicit.                                      |
| [Gemini search journey](https://mobbin.com/flows/ab6ad9f1-d6fe-49ab-aa48-911b5681a15e)   | The inspected previews move from a search-led home to results with titles, excerpts, and a retained query.                              | Keep the query in the address, show excerpts and a result count, and support Back.                                           |

Not all returned examples are equally useful. The [Zendesk template preview](https://mobbin.com/screens/e14e25b7-2506-4f93-9e63-af94f3635b3e)
mixes authoring controls with the reader view. The [Zendesk Guide journey](https://mobbin.com/flows/a830f51a-f807-4cae-9d30-1421f2de6264)
also exposes an activation notice. Those are not patterns for an OpenLaw end reader.
The [Vercel integration instructions](https://mobbin.com/screens/8f10d056-15b3-4469-a3d1-7bd371906584)
are useful as an example of instructions within an app, but are not a complete
manual. [Codecademy's article](https://mobbin.com/screens/13279c45-183e-40a7-9241-de57707b691c)
gives video substantial space. OpenLaw has no verified video library, so the design
does not reserve an empty video area.

The [Mintlify search overlay](https://mobbin.com/screens/22382df2-2420-4b63-b02f-5c309c95dc85)
and [Zendesk visual template chooser](https://mobbin.com/screens/9cfdc51f-b979-48c2-9257-2bf7cb7d8b87)
were inspected but do not establish search result behaviour. The design does not
infer interactions hidden by those overlays.

## Current documentation sites

[Linear Docs](https://linear.app/docs) separates product sections, a start guide,
selected articles, and a link back to the app. This supports a manual that is easy
to enter at several levels. OpenLaw can group its catalogue by the existing module
names while keeping a direct route for someone who is new to the product.

[Notion Help](https://www.notion.com/help) combines search, subject navigation,
selected topics, and routes for different teams. OpenLaw already knows the audience
of each article. Its existing audience metadata is a stronger basis for discovery
than introducing a second taxonomy or assuming all readers are Administrators.

[GitHub Docs](https://docs.github.com/en) presents search and grouped documentation
links. Its broad catalogue shows why the section names must remain specific and
scannable as content grows. OpenLaw has eleven existing sections, so a compact
section list can remain visible without introducing another navigation level.

These are design comparisons, not evidence that copying a pattern improves a
measured outcome. The proposed choices should be checked with OpenLaw's own guides
and roles, particularly Business Users and deployment operators.

## OpenLaw design direction

The application already has a strong visual system. DES-001 through DES-005 specify
Light, Warm, and Dark themes, semantic colour tokens, Inter, restrained borders,
and consistent geometry. Documentation should look like another part of OpenLaw.
The Warm palette gives it character without a separate documentation brand.

Use the existing scales mark and wordmark in the public header. Add a concise
Documentation label and an Open app link. Give the landing title more room than a
record heading, while keeping controls and navigation compact. Use the established
six-pixel card shape, one-pixel rules, and text colours. Colour should distinguish
the selected location, links, and notices. Decorative gradients, stock photographs,
oversized illustrations, and fabricated product screenshots are unnecessary.

The reading layout should have a different density from a record table. Navigation
can stay small. Article prose needs comfortable line spacing and a measure around
65 to 75 characters. Headings, numbered steps, callouts, code, and tables need clear
separation. A long deployment command should scroll within its own region rather
than widening the page.

## Navigation and page model

| Page                           | Main content                                                                                      | Navigation and recovery                                                       |
| ------------------------------ | ------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------- |
| Documentation home             | Clear introduction, local search, audience filter, guide collections with descriptions and counts | Section links, Open app, retained edition access                              |
| Help home                      | Short introduction for the current reader and available guide collections                         | Existing application shell, contextual topic filters, full documentation link |
| Collection                     | Collection title and the available article links                                                  | Selected collection, clear route back to all guides                           |
| Search                         | Query, result count, article titles, section labels, excerpts                                     | Query and filters in the URL, clear filters, Back support                     |
| Article                        | Breadcrumb, audience information, canonical instructions, adjacent guides                         | Selected article in section navigation, page outline, link back to collection |
| Unavailable article or section | Specific explanation and working recovery links                                                   | Full index and local search remain reachable                                  |
| Empty edition                  | Honest publication state and useful navigation                                                    | No invented guide counts, articles, or unsupported support channel            |

Article and section navigation must come from the compiled bundle. Nothing should
link to a draft that was excluded from that edition. Help uses the existing audience
and destination selection. A public article can explain Administrator work without
granting permission to perform it. The existing distinction between product Help
and organization-authored Knowledge Items remains intact.

Search stays an ordinary, labelled form with a submit button. It searches only the
bundled product instructions. It should show the current query, give a count, and
explain how to recover from no results. Search results should remain visually
distinct from the browse catalogue. Opening a result must not leave an article
reader under a large search landing banner.

The article sidebar is for moving between guides. The page outline is for moving
within the current guide. These have different labels and selection states. On a
wide display, keep the outline beside the prose. At narrower widths, place it above
the article and let it collapse. The main navigation also needs a compact disclosure
on small screens. The document should have one clear heading and retain native links.

## Accessibility and resilient delivery

W3C's [reflow guidance](https://www.w3.org/WAI/WCAG22/Understanding/reflow.html)
describes presenting ordinary vertical content at 320 CSS pixels without forcing
two-dimensional scrolling. Tables and code may need their own scrolling regions;
that exception does not extend to the surrounding prose. This is the reason for
collapsing navigation and constraining article width, not simply a mobile aesthetic.

Keep keyboard-visible focus, labelled navigation regions, a skip link, semantic
headings, and real buttons for disclosures. Article navigation should move focus
to the title. Fragment navigation should focus its heading. Colour must not be the
only indication of the selected guide. The same geometry should work in all three
themes, and print should prioritise the article over navigation.

DD-020 and TECH-026 require instructions to work on an isolated deployment. The
standalone edition must use local CSS, fonts, scripts, and article links. Its prose
and index must remain usable without JavaScript. Search may require JavaScript,
with a clear explanation when it is unavailable. No external search service,
analytics, chat widget, support inbox, or model endpoint is part of this design.

A separate site framework would duplicate the existing compiler, reader, stable
links, and edition handling. The recommended implementation improves the current
React reader and generated HTML edition, using shared styles and matching page
structure. It does not introduce a new deployment service or domain requirement.

## Publication and review

The merged source suite contains 56 guides, with verification and proofreading
still pending. The visual design must not turn those sources into a release claim.
Normal builds continue to select only accepted content. Explicit development
previews show the full draft catalogue with a visible unverified notice.

Keep edition identity, supported app identity, and retained export information in
a secondary details area. Readers need those facts for recovery and support, but
they should not dominate the home page or interrupt instructions. Preserve prior
evidence records and guide content hashes. The redesigned reader needs its own
verification evidence because its layout and navigation have changed.

## Verification plan

Test the complete browse-to-article journey in the public reader, staff Help, and
Business Portal Help. Check audience and topic filtering, section navigation,
search and clearing, redirects, missing fragments, and browser Back. Verify that
the public route makes no session or record API request. Confirm that unavailable
and empty states offer working recovery paths.

Inspect real draft content on desktop and at 320 CSS pixels in all three themes.
Include a long operator guide with tables and code, a shorter Business User guide,
search results, and the empty normal edition. Check focus order and deep-link focus.
Inspect the retained HTML edition over HTTP and from local files, with its article
navigation still usable when JavaScript is disabled. Run the existing compiler,
reader, route, security, translation, and build checks, then an independent review.

## Sources

The exact Mobbin screens and journeys are linked beside their observations in the
comparison above. Their publisher is Mobbin and their capture dates are unknown.
The current official sources are Linear, Notion, GitHub, and W3C at the URLs cited
in their respective sections, accessed on 9 September 2026. OpenLaw's local design
constraints are recorded in `DECISIONS-DESIGN.md`, DD-020 in `DECISIONS.md`, and
TECH-026 in `DECISIONS-TECH-STACK.md`.
