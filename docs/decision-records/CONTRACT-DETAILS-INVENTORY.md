# Contract details inventory — V12 + V13

Source: `designs/initial-contract-details.pen`, frames `GJVDs` (V12, 1440×1500) and `WdR49` (V13, 1440×1501).

This document enumerates every visible field, control, label, badge, link, marker, and chrome element on the two screens. It is the intake document for the grill-me sessions tracked in `CONTRACT-DETAILS-GRILL-PLAN.md` — one decision per row in that document, one element per row here.

Conventions:

- **ID** is the Pencil node ID (use to look up in `.pen` via `batch_get`).
- **Where** lists V12, V13, or both, with structural notes when the two diverge.
- **What** is the as-drawn content / behavior; this is data-on-mock and may not be the intended final shape.

---

## A. Top header (chrome)

| #   | Element                    | V12 ID            | V13 ID            | What                                                                                                              |
| --- | -------------------------- | ----------------- | ----------------- | ----------------------------------------------------------------------------------------------------------------- |
| A.1 | App logo                   | `YXxoT`           | `pDffd`           | Wordmark "OpenLaw"                                                                                                |
| A.2 | Global search              | `agNQg`           | `HPVgV`           | Search icon + placeholder ("Search contracts, matters, entities…" V12 / "…documents…" V13) + slash-key affordance |
| A.3 | Create button              | `qoRst`           | `JP8OE`           | Green CTA, plus-icon + "Create" label                                                                             |
| A.4 | Notifications bell + badge | `JkGrA` / `k8Kcr` | `yCUpH` / `Nu5ap` | Bell icon with red `9+` overflow badge                                                                            |
| A.5 | User avatar                | `r0IDZ`           | `U0jp5`           | Circle with initials ("BW")                                                                                       |

## B. Primary nav (sub-header)

| #   | Element                 | V12 ID                       | V13 ID                       | What                                                  |
| --- | ----------------------- | ---------------------------- | ---------------------------- | ----------------------------------------------------- |
| B.1 | Nav: first slot         | `SCia7` ("Inbox")            | `e86VE` ("Dashboard")        | **Diverges** — V12 says "Inbox", V13 says "Dashboard" |
| B.2 | Nav: Matters            | `aUhqm`                      | `l8qjs`                      | "Matters"                                             |
| B.3 | Nav: Contracts (active) | `n7x4r` + `V2t9wI` underline | `MLmt9` + `R9Grp9` underline | "Contracts" with 2px active indicator                 |
| B.4 | Nav: Documents          | `re19N`                      | `gvN4c`                      | "Documents"                                           |
| B.5 | Nav: Entities           | `pY1r2`                      | `JLGue`                      | "Entities"                                            |
| B.6 | Nav: Reports            | `hQPbs`                      | `R93Uz`                      | "Reports"                                             |

## C. Module sub-bar (breadcrumb / actions strip)

Same structure on both frames; container `ChrnV` (V12) / `fweao` (V13).

| #    | Element                | V12 ID                                                    | V13 ID                                             | What                                                    |
| ---- | ---------------------- | --------------------------------------------------------- | -------------------------------------------------- | ------------------------------------------------------- |
| C.1  | Back/up arrow          | `dBYn8`                                                   | `TWNeZ`                                            | Returns to list view (presumed)                         |
| C.2a | Module switcher icon 1 | `AeNdW`                                                   | `HyH66`                                            | Three small icons in a row of three; purpose unclear    |
| C.2b | Module switcher icon 2 | `Tgklu`                                                   | `bBITH`                                            | (see above)                                             |
| C.2c | Module switcher icon 3 | `MZNPK`                                                   | `eYN5E`                                            | (see above)                                             |
| C.3  | Title pill             | `vyvPX` → `rx8Rg`                                         | `basTU` → `WBZiY`                                  | "Acme Corp — Master Services Agreement"                 |
| C.4  | Inline action icon     | `JnA6D`                                                   | `F5mAJW`                                           | Single 20×20 icon next to title (purpose unclear)       |
| C.5  | Status pill            | `M7IDMD` (dot `NPkL5` + label `J73JXL` + chevron `ag88S`) | `n3qWgO` (dot `QosDW` + `OEurM` + chevron `CThWq`) | "In review" with status dot + chevron (status switcher) |
| C.6  | Cancel button          | `kFR1S` → `HO6Qw`                                         | `c1xXm` → `g0JIXg`                                 | Secondary "Cancel" button                               |
| C.7  | Save button            | `pss94` → `B0o8z`                                         | `CaHzW` → `WlkTS`                                  | Green primary "Save"                                    |
| C.8  | Overflow / more        | `tgsgn`                                                   | `f870X`                                            | More-actions icon (right edge)                          |

## D. Hero meta grid

V12 uses 4 columns × 2 rows = 8 fields; V13 reflows to fit 1000px column width.

| #   | Field          | V12 ID (label / value)                   | V13 ID (label / value)               | Value (mock)                                                              |
| --- | -------------- | ---------------------------------------- | ------------------------------------ | ------------------------------------------------------------------------- |
| D.1 | Reference      | `Tzt51` / `M5dH3j`                       | `hSDmD` / `X3IbL`                    | C-2026-0142                                                               |
| D.2 | Contract type  | `Dmch8` / `WQqrp`                        | `wHI23` / `TyyNu`                    | Master Services Agreement                                                 |
| D.3 | Effective date | `Z466F` / `M3Jhm`                        | `meODw` / `s0XEC`                    | 12 Jan 2026                                                               |
| D.4 | Subject matter | `AM2ff` / `rFiOf`                        | `v6nK5` / `DY0qo`                    | Cloud platform engagement                                                 |
| D.5 | Counterparty   | `werT0` / `A8V5wl` (+ link icon `gnhcE`) | `DQT9T` / `b7DCQI`                   | Acme Corp Ltd.                                                            |
| D.6 | Contract value | `Q7QOQ3` / `M27jEw`                      | `J3lP0` / `LrSK6`                    | "USD 480,000 / year" V12 — "USD 480,000/year" V13 (slash spacing differs) |
| D.7 | Owner          | `dvWXj` / `O3gI1l` (avatar) + `zTdkf`    | `GNlfJ` / `Xt8jk` (avatar) + `e3dBk` | V12: "Sarah Chen — General Counsel"; V13: "Sarah Chen" (no role)          |
| D.8 | Stage          | `ABKKK` / `GYogr` (+ icon `rRcV2`)       | `TKER1` / `GzAOy`                    | Negotiation — round 3                                                     |

## E. Module chip row (quick links to subordinate views)

V12 has 6 chips; V13 has 5 chips because the layout collapses the rest into "+ 2 more".

| #   | Chip                | V12 ID                                       | V13 ID                                       | Notes                                                                         |
| --- | ------------------- | -------------------------------------------- | -------------------------------------------- | ----------------------------------------------------------------------------- |
| E.1 | Notifications       | `obO9N` (label `d3SKE`, badge "3" `IT1fg`)   | `cpra3` (label `f7vEtz`, badge "3" `pYZbz`)  | Both have a count badge                                                       |
| E.2 | Workflows           | `nixqK` (label `KlwZZ`)                      | `WRNej` (label `Aun2d`)                      | No badge                                                                      |
| E.3 | Linked files        | `fN48i` (label `PcyPG`)                      | `CZKt5` (label `Hd9bR`)                      | No badge                                                                      |
| E.4 | Documents           | `X41WTp` (label `z8233`, count "12" `v8VnM`) | `U2Z399` (label `XQxnt`, badge "12" `qcwEH`) | V13: this chip is **active** (cta-primary fill), V12 is not visually selected |
| E.5 | Signature elements  | `g4xKK3` (label `sF5ys`)                     | —                                            | V12 only                                                                      |
| E.6 | Conversation        | `rNZCf` (label `XXxvJ`)                      | —                                            | V12 only                                                                      |
| E.7 | "+ 2 more" overflow | —                                            | `XlwJ1` (label `x9B5wS`)                     | V13 only — collapses E.5 + E.6                                                |

## F. Section tab strip

Both frames render the same 10 tabs. V12 includes a trailing chevron for overflow; V13 drops it to fit the narrower 1000px column.

| #    | Tab                                                                  | V12 ID (frame / text) | V13 ID (text)     | Active                                                  |
| ---- | -------------------------------------------------------------------- | --------------------- | ----------------- | ------------------------------------------------------- |
| F.1  | Description                                                          | `U0RV2` / `dvNsL`     | `aac4D` / `tgdqO` | Yes (cta-primary fill)                                  |
| F.2  | Key dates                                                            | `MhQPP` / `cUDNd`     | `DASqa`           | —                                                       |
| F.3  | Key clauses                                                          | `qw8km` / `mKctO`     | `R0VDFm`          | —                                                       |
| F.4  | Signatories (V13: just "Signatories"; V12: "Signatories & contacts") | `M7SJE` / `M9Lndi`    | `o2zAij`          | Label diverges                                          |
| F.5  | Considerations                                                       | `F82sf3` / `ar89E`    | `VbuBM`           | —                                                       |
| F.6  | Memo                                                                 | `x91MY` / `p0LQjo`    | `fXpZZ`           | —                                                       |
| F.7  | Communications                                                       | `kF1x7` / `zWRLr`     | `TZDbM`           | —                                                       |
| F.8  | Risks & issues                                                       | `q9TeC` / `BdqfK`     | `g1jV2m`          | —                                                       |
| F.9  | Deliverables                                                         | `phU0N` / `skKZF`     | `g21sJ`           | —                                                       |
| F.10 | History                                                              | `DlvfK` / `fdZo2`     | `E3nfVb`          | Newest tab; placeholder for V14 lifecycle visualization |
| F.11 | Overflow chevron                                                     | `eqHLo`               | (removed)         | V12 only                                                |

## G. Description card body

V12 is a 1344-wide two-column card (`IAkZ5`); V13 is a 952-wide two-column card (`GFrTB`) and renders **before** the section tab strip.

### G.left column

| #    | Field         | V12 ID            | V13 ID             | Value                            |
| ---- | ------------- | ----------------- | ------------------ | -------------------------------- |
| G.L1 | Country       | `kSVa4` / `mA1QP` | `LbHG0` / `pumBz`  | United States                    |
| G.L2 | Region        | `rVTRb` / `umom9` | `tqJwS` / `d9pyb7` | California                       |
| G.L3 | City          | `RuZCX` / `n5uw1` | —                  | San Francisco — **V12 only**     |
| G.L4 | Governing law | `WwQOb` / `fL4JG` | `Horze` / `xJ1Yh`  | California, USA                  |
| G.L5 | Jurisdiction  | `XY8yl` / `pdv5S` | `ELgey` / `q6tT0E` | Federal courts — N.D. California |
| G.L6 | Practice area | `KCuUc` / `UBcdw` | `qthKq` / `nWUDS`  | Commercial — SaaS                |
| G.L7 | Created       | `EGAde` / `a2o6H` | `CiAcz` / `qsbJQ`  | 23 Mar 2026 by Sarah Chen        |

### G.right column

| #    | Field          | V12 ID                            | V13 ID                            | Value                                        |
| ---- | -------------- | --------------------------------- | --------------------------------- | -------------------------------------------- |
| G.R1 | Our position   | `IQ67Y` / `MDkHW`                 | `HPZlW` / `Z3mq2`                 | Customer                                     |
| G.R2 | Risk level     | `lwCTd` / `nAW8P` (+ dot `regaA`) | `YSMku` / `zPyPa` (+ dot `n9BA8`) | Medium (with status dot)                     |
| G.R3 | Auto-renew     | `k1iwTl` / `R2smvT`               | `vvZv7` / `B0pDd`                 | Yes — 12-month rolling (V12: "rolling term") |
| G.R4 | Notice period  | `vATtv` / `JRyri`                 | `I5XxL` / `uQKlS`                 | 60 days                                      |
| G.R5 | Last renewal   | `YPyhU` / `gnLsB`                 | —                                 | "—" placeholder — **V12 only**               |
| G.R6 | Renewal cap    | `GQa1B` / `p79Qs`                 | `xrYYU` / `X5dcJ`                 | 36 months from initial                       |
| G.R7 | Days remaining | `bcI4A` / `SCSiJ`                 | `L5jbo` / `LLyMC`                 | 248 days until expiry                        |

### G.header

| #    | Element       | V12 ID  | V13 ID                  | What                       |
| ---- | ------------- | ------- | ----------------------- | -------------------------- |
| G.H1 | Section icon  | `TXqqm` | (no separate icon node) | Card-leading icon          |
| G.H2 | Title         | `OlPcw` | `H3kM3`                 | "Description"              |
| G.H3 | Overflow icon | `DIz4L` | `wuuxp`                 | Per-card more-actions menu |

## H. Events card

V12 (`VTkvC`, 1344×332) and V13 (`utWhh`, 952×288). Same conceptual table, **mock data differs row-for-row** between V12 and V13.

### H.header

| #    | Element              | V12 ID                                 | V13 ID                                  | What              |
| ---- | -------------------- | -------------------------------------- | --------------------------------------- | ----------------- |
| H.H1 | Section icon         | `VrCHA`                                | (in `JhhUG` strip)                      | Card-leading icon |
| H.H2 | Title                | `Q9fC7C`                               | `F1N1wa`                                | "Events"          |
| H.H3 | Count chip           | `kIPvL` ("7")                          | `LrYyC` ("7")                           | Total event count |
| H.H4 | "+ Add event" button | `dy9RI` (icon `xWsya` + label `Dqley`) | `RrWxC` (icon `E89vw7` + label `q5QDH`) | Adds new row      |

### H.column headers

| #    | Column              | V12 ID                  | V13 ID             | Notes          |
| ---- | ------------------- | ----------------------- | ------------------ | -------------- |
| H.C1 | Date                | `zzve4`                 | `avqbl`            | —              |
| H.C2 | Event name          | `myhS8`                 | `D5mZ4e`           | —              |
| H.C3 | Event type / Type   | `y20EmA` ("Event type") | `uQ293` ("Type")   | Label diverges |
| H.C4 | Decision            | `f277nl`                | `i5lyK`            | —              |
| H.C5 | Comment             | `ruNOc`                 | `U9Wwl`            | —              |
| H.C6 | Attachments / Files | `EI23V` ("Attachments") | `h03Ovq` ("Files") | Label diverges |

### H.rows

| #    | V12 row IDs | V13 row IDs | Date (V12 / V13)             | Event name                   |
| ---- | ----------- | ----------- | ---------------------------- | ---------------------------- |
| H.R1 | `cDSAz`     | `RXqhN`     | 23 Mar 2026 / 23 Mar 2026    | Drafted                      |
| H.R2 | `DPfQD`     | `PrFdK`     | 14 Apr 2026 / 02 Apr 2026    | Sent for counterparty review |
| H.R3 | `ltRYE`     | `u2J5C`     | 19 Apr 2026 / 15 Apr 2026    | Counter-redline received     |
| H.R4 | `ZO390`     | `yb018`     | 02 May 2026 / 24 Apr 2026    | Cap concession proposed      |
| H.R5 | `lbnN1`     | `YRzPV`     | 06 May 2026 / 30 Apr 2026    | Counter accepted by Acme     |
| H.R6 | `k0tiMr`    | `Pkau8`     | 09 May 2026 / 05 May 2026    | Approved by general counsel  |
| H.R7 | `EDHOq`     | `MU3Ho`     | Planned 18 May / 18 May 2026 | Sent for signature           |

Per-row inline elements not enumerated above: the Decision column shows colored status text (Accepted/Approved green, Pending amber) on rows 5–7; V13 wraps these in pill chips (`ivDIg`, `G916C`, `doh2P`), V12 uses inline colored text only.

## I. Timeframe / timeline card

V12 (`SikL2`, 1344×300) and V13 (`Mq0Lt`, 952×288).

### I.header

| #    | Element       | V12 ID                                   | V13 ID                                  | What                                       |
| ---- | ------------- | ---------------------------------------- | --------------------------------------- | ------------------------------------------ |
| I.H1 | Section icon  | `jmqtH`                                  | (in `FQjoM`)                            | Card-leading icon                          |
| I.H2 | Title         | `WCr5C`                                  | `QgY4A`                                 | "Timeframe"                                |
| I.H3 | Zoom switcher | `H04W9N` (Year / Quarter active / Month) | `FmJ4Q` (Year / Quarter active / Month) | 3-segment toggle; Quarter selected on both |

### I.x-axis labels

`k4NOF9..VRMr0` (V12) / `Qs4LF..k8zt0C` (V13): Q1 2026, Q2 2026, Q3 2026, Q4 2026, Q1 2027.

### I.row labels (left gutter, V13 only — V12 puts labels inline on bars)

| #    | V13 ID   | Label           |
| ---- | -------- | --------------- |
| I.L1 | `rJ4jR`  | Effective date  |
| I.L2 | `G18TR9` | Term 1          |
| I.L3 | `cvaDN`  | Term 2          |
| I.L4 | `j6B8gx` | Term 3          |
| I.L5 | `y8Hks`  | End of contract |
| I.L6 | `g4Alf`  | Renewal cap     |

### I.bars / markers

V12 places labels inside the bars; V13 uses the gutter. V12-only inline labels:

| #    | V12 ID             | V12 inline text                    |
| ---- | ------------------ | ---------------------------------- |
| I.B1 | `l0XLu` / `o5aAIC` | "Effective date"                   |
| I.B2 | `CYdPO` / `p6jOJ`  | "Term 1 — initial period"          |
| I.B3 | `s9xO8` / `EzG2w`  | "Term 2 — auto-renewal"            |
| I.B4 | `ZW3KD` / `c75Gnd` | "Term 3 — auto-renewal"            |
| I.B5 | `jpbVO` / `ESmsR`  | "Last renewal date" — **V12 only** |
| I.B6 | `JWUxO` / `sHDtF`  | "End of contract"                  |
| I.B7 | `S1SC4` / `mOnzu`  | "Renewal cap"                      |
| I.B8 | `EgdSg` (icon)     | Risk threshold marker              |

V13 bars are unlabeled; bar IDs are `EPY5x`, `W2R8wL`, `D3AsI`, `eGoOr`, `OlkDc`, `yxlFM`.

### I.today line

V12: vertical line `iZByn` + pill `y2W2Js` ("Today" `eah4H`). V13: line `BmL06` + pill `vEfkC` ("Today").

### I.legend (bottom)

V12 `pMMbr` and V13 `DsgRA`: three swatch + label pairs — Date marker (`fNrNC`/`xRSHF`), Term period (`cmxiH`/`hn5VS`), Risk threshold (`gdoJC`/`xfwzp`).

## J. Activity bar (right edge, closed state — V12 + V13)

48px-wide vertical strip on the right edge. V12 `HGWot @ 1392,166`. V13 `cFsVz` is the activity-bar half of the right column `i4DfDF` (the doc panel sits to its right).

| #   | Slot                       | V12 ID   | V13 ID                               | Glyph                                                                                                                 | Badge                        |
| --- | -------------------------- | -------- | ------------------------------------ | --------------------------------------------------------------------------------------------------------------------- | ---------------------------- |
| J.0 | Active indicator strip     | —        | `xTe2Z`                              | (3×48 accent bar, `#F78166`, square ends — corrected 2026-08-10 from "3px green pill", which the frame does not show) | V13 only — flags active item |
| J.1 | description                | `fF2Xr`  | `I8U5hg`                             | description                                                                                                           | —                            |
| J.2 | chat                       | `EgLMW`  | `Wm84X`                              | chat                                                                                                                  | "3" (`uPwNS`/`APHvS`)        |
| J.3 | history                    | `gUCf3`  | `s0onk8`                             | history                                                                                                               | "v7" (`vfGGn`/`Huk0J`)       |
| J.4 | draw / redline             | `U3fHF6` | `uP3Nm`                              | draw                                                                                                                  | —                            |
| J.5 | bolt / automation          | `Qveno`  | `cQcRz`                              | bolt                                                                                                                  | —                            |
| J.6 | track_changes              | `pRCgl`  | `b2Dh6g`                             | track_changes                                                                                                         | "42" (`jybsM`/`vKhfn`)       |
| J.7 | attach_file                | `UHDvJ`  | (V13 has no attach in current strip) | attach_file                                                                                                           | —                            |
| J.8 | divider                    | `dLEvZ`  | `RdfHw`                              | hairline                                                                                                              | —                            |
| J.9 | settings (bottom-anchored) | `tFokx`  | `bu8dm`                              | settings                                                                                                              | —                            |

## K. Document panel (V13 only)

Container: `nKd02 @ 48,0,392×1334` inside `i4DfDF`. Renders the live document next to the activity bar.

### K.header `un018`

| #    | Element       | ID                 | What                                                                                                                                                                                             |
| ---- | ------------- | ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| K.H1 | File icon     | `XTDT0`            | Document glyph                                                                                                                                                                                   |
| K.H2 | Filename      | `zH1CE`            | "MSA-Acme-v7.pdf"                                                                                                                                                                                |
| K.H3 | Version pill  | `MKtcn` → `Vqj7F`  | "v7"                                                                                                                                                                                             |
| K.H4 | Redlines pill | `W1rI1` → `A20fup` | **Built in M32:** reads "Compare" until the predecessor Comparison is ready, then reads its change count; opens that pair's compare screen and is absent on v1 and a Generated redline (DES-071) |
| K.H5 | Action icon 1 | `Z8e3M`            | (open-in-full presumed)                                                                                                                                                                          |
| K.H6 | Action icon 2 | `Pq0xP`            | (close presumed)                                                                                                                                                                                 |

### K.toolbar `vLiAa`

| #    | Element       | ID                 | What                |
| ---- | ------------- | ------------------ | ------------------- |
| K.T1 | Prev page     | `jae6j`            | chevron_left        |
| K.T2 | Page number   | `S4iVgj` → `J6GxC` | "3"                 |
| K.T3 | Page divider  | `Q87M3j`           | "of 14"             |
| K.T4 | Next page     | `YCk2M`            | chevron_right       |
| K.T5 | Zoom value    | `sb2yK`            | "100%"              |
| K.T6 | Zoom dropdown | `TIjXx`            | keyboard_arrow_down |
| K.T7 | Search        | `fPToU`            | search              |
| K.T8 | Download      | `goU3X`            | download            |
| K.T9 | More          | `A3PWB`            | more_vert           |

### K.body — page `jForm`

A simulated PDF page: title block + parties block + 4 numbered sections + signatories + page footer. Does double-duty as a comment/redline preview (clause `2.4 LIABILITY CAP` is highlighted with amber and carries comment marker `3`).

| #     | Region                   | IDs                                                                                                          | What                                                        |
| ----- | ------------------------ | ------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------- |
| K.B1  | Title                    | `XYfwJ`                                                                                                      | "MASTER SERVICES AGREEMENT"                                 |
| K.B2  | Subtitle                 | `gIx5g`                                                                                                      | "Effective as of January 12, 2026"                          |
| K.B3  | Title rule               | `Z1pKWY`                                                                                                     | hairline under title block                                  |
| K.B4  | Parties block            | `YLFFc`, `CXk40`, `K3xqt`, `Z5sQ8g`, `j6MZL`, `HJLRH`                                                        | "BETWEEN: / Acme Corp Ltd. … AND: / Northwind Cloud Inc. …" |
| K.B5  | §1 heading               | `F4cvo`                                                                                                      | "1. DEFINITIONS"                                            |
| K.B6  | §1 body                  | `f7yhAg`, `mRM4n`, `K4Fop`, `E4Xv2`                                                                          | placeholder text bars                                       |
| K.B7  | §2 heading               | `r9AqjM`                                                                                                     | "2. SERVICES"                                               |
| K.B8  | §2 body                  | `E1YTUG`, `LtycG`, `qzP0u`, `Fo3OG`                                                                          | placeholder text bars                                       |
| K.B9  | §2.4 highlight + comment | `gtAFi` (clause group, contains `VEwQi` "2.4 LIABILITY CAP"), `Nt7b5` (comment marker, contains `O7ZWO` "3") | Amber highlight on a clause + numbered comment marker       |
| K.B10 | §3 heading               | `HAFvD`                                                                                                      | "3. FEES AND PAYMENT"                                       |
| K.B11 | §3 body                  | `JCios`, `MbK5y`, `v2cJ5W`, `V3xXNT`, `h6zNc`                                                                | placeholder text bars                                       |
| K.B12 | §4 heading               | `OYytw`                                                                                                      | "4. TERM AND TERMINATION"                                   |
| K.B13 | §4 body                  | `GE2TZ`, `X5mp0`, `mGpgk`, `pZAya`                                                                           | placeholder text bars                                       |
| K.B14 | Signatories header       | `xpL5L`                                                                                                      | "SIGNATORIES"                                               |
| K.B15 | Customer block           | `CBGL7`, `hucSh`, `v5bk76`                                                                                   | "Customer / Mark Reid, CEO" + signature line                |
| K.B16 | Provider block           | `b1KGOs`, `gmB5Z`, `s6cLG`                                                                                   | "Provider / Sarah Chen, COO" + signature line               |
| K.B17 | Page footer              | `kIi1K`                                                                                                      | "Page 3 of 14 — Master Services Agreement"                  |

---

## Cross-cutting observations (for the grill plan)

These are not elements per se but recurring questions surfaced by the inventory pass:

1. **Inbox vs. Dashboard** (B.1) — V12 and V13 disagree on the first nav item.
2. **Owner field shape** (D.7) — V12 packs "name + role", V13 just name. Pick one.
3. **Module switcher icons** (C.2a–c) — three small icons whose purpose is undefined.
4. **Risk dot vs. pill** (G.R2) — currently a tiny dot; the rest of the system uses pills for status.
5. **City row** (G.L3, V12 only) — duplicates Region/Governing law information.
6. **Last renewal row** (G.R5, V12 only) — value is "—" for a fresh contract; do we still surface it?
7. **Signature elements / Conversation chips** (E.5, E.6) — collapse to "+ 2 more" (V13 approach) or always show (V12 approach)?
8. **Section tab labels** (F.4, H.C3, H.C6) — "Signatories" vs. "Signatories & contacts", "Type" vs. "Event type", "Files" vs. "Attachments" all diverge between V12/V13.
9. **Comment column for Events** — V12 leaves it blank for early rows; V13 fills every row with a sentence. Decide the editorial pattern.
10. **Decision column visualization** (Events) — colored text (V12) vs. pills (V13).
11. **Timeline label placement** (I) — labels-on-bars (V12) vs. labels-in-gutter (V13).
12. **Risk threshold marker on timeline** (I.B8) — present but underexplained; needs a definition.
13. **Activity bar slot order + glyphs** (J.1–J.9) — eight slots is a lot; needs a justification per slot.
14. **Activity bar badges** (J.2, J.3, J.6) — "3 / v7 / 42" is ad-hoc; need rules for when a badge appears and what the count means.
15. **Document panel toolbar density** (K.T1–T9) — nine controls for a preview; can collapse some behind more-vert.
16. **Inline comment markers in the doc body** (K.B9) — assumes a comment system; decided since: CMT-001 anchors document comments, CMT-003 defines tier rendering (DECISIONS-COMMENTS.md).
