# Redeploying data.gs

The site talks to one Apps Script web app (`WS_ENDPOINTS.data` in `system/js/endpoints.js`):

`https://script.google.com/macros/s/AKfycbynx8CkmFWlABjxirOD6-WqQ1wQj5R8H0rglFYJR95AIrONEMnM9QCB2gLXxJy63PGV/exec`

`data.gs` build **WS-DATA-07** contains WannaChat and ProfileNet (see [`profile-api.md`](profile-api.md)). Until it is redeployed, the live URL still serves the old build and the chat page will show an error.

1. Open the Apps Script project behind that URL and replace the whole of `Code.gs` with `data.gs`. Save.
2. **Deploy → Manage deployments → ✏️ edit the existing deployment → Version: New version → Deploy.**
   Editing the existing deployment (not "New deployment") keeps the same `/exec` URL.
3. In the editor run **`installChatCleanupTrigger`** once and approve the permissions. It adds a daily trigger for `chatCleanup`. Safe to run again.
4. Check `<exec url>?type=build` answers `WS-DATA-07`.
5. The sheets `ChatFriendsWS` and `ChatMessagesWS` are created on first use. For profiles, paste `ProfileNetWS.tsv` into row 1 of a tab named `ProfileNetWS` (or skip it and the script creates the tab).

`chatCleanup()` is the merge/clean-up pass: it re-trims every chat to the newest 60 messages, drops chats whose friendship is gone, drops friend requests unanswered for 30 days, and drops anything belonging to a ticket that is no longer approved. You can run it by hand any time.

Optional, only for the websocket worker: set a Script Property `SECRET_TOKEN` if you want to use the `userexists` POST (the worker in this folder does **not** need it).
