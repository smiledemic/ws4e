# ProfileNet (data.gs, build WS-DATA-07)

Sheet **`ProfileNetWS`**, one row per approved ticket. Header row: [`ProfileNetWS.tsv`](ProfileNetWS.tsv) (paste it into row 1 of a tab with that exact name, or let the script create the tab). Headers are matched by name, so column order doesn't matter and any missing column is added on the right.

| Column | Meaning |
|---|---|
| Name, ClientID, Key, TicketID | Copied from `TicketApprovalWS` as a record. Requests are always checked against the ticket sheet, and Key/ClientID are never returned by the API. |
| DisplayName (32), Bio (300) | Free text |
| Visibility | `private` (default) / `public`. Public shows Bio, avatars and ConnectionsPublic to other users |
| FavVisibility | `public` (default) / `private` |
| ConnectionsPublic | `TheTruth\|TRIPPY\|Elmo`, max **12** |
| ConnectionsPrivate | same format, no limit (cell-safe cap 2000) |
| FavConnections | same format, max **6**, each must be in one of the two lists above |
| Avatar50 / Avatar128 / Avatar256 | data URLs, max **45,000** chars each (Sheets cell limit is 50,000) |
| Updated | ISO time |

A person is in the public **or** the private list, never both. Names are 3–20 characters of letters, digits, `_` `.` `-`; capitalisation follows the real username when that user exists.

## API
`GET ?type=profile&ticket&key[&user=<name>][&variant=50|128|256]` returns your own full record, or what `user` lets others see (private profile: name, display name and, unless FavVisibility is private, favorites). It never creates a row.

`POST` with `{ "type":"profile", "ticket", "key", "action", … }`:
- `save`: any of `displayName, bio, visibility, favVisibility, connectionsPublic, connectionsPrivate, favConnections` (lists as `"a|b|c"` or arrays)
- `avatar`: `{ variant, dataUrl }`. The server checks the prefix, size, base64, file signature and the real pixel size (exactly 50, 128 or 256). WebP at every size, GIF at 50 and 256 (animation kept as sent), animated WebP refused.
- `avatar_remove`: `{ variant }`

Errors use the same shape as chat: `{ ok:false, code, error }`.

## Link with chat
Accepting a friend request adds each person to the other's **ConnectionsPrivate**; removing a friend takes them out of all of that person's lists. `chatCleanup()` also drops profile rows whose ticket is gone or not approved, and repeated names.

## Not enforced by the server
"Only from the profile modal, from the user's own computer" can't be checked server-side. The profile modal will be the only place in the site that calls `avatar`, but anyone holding their own ticket + key could post to it directly. The size, type and ownership checks above still apply.
