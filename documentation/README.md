# WannaSmile documentation

Notes that ship with the site (this folder is **not** git-ignored, unlike `.documentation/`).

| File | What it is |
|---|---|
| [`chat-api.md`](chat-api.md) | The WannaChat API served by `data.gs` (what `chat.js` calls today) |
| [`profile-api.md`](profile-api.md) | ProfileNet: profile, connections and avatar API + the `ProfileNetWS` sheet ([`ProfileNetWS.tsv`](ProfileNetWS.tsv)) |
| [`ChatMessagesWS.tsv`](ChatMessagesWS.tsv), [`ChatFriendsWS.tsv`](ChatFriendsWS.tsv) | Header rows for the two chat sheets (optional: the script creates them on first use) |
| [`data-gs-deploy.md`](data-gs-deploy.md) | Redeploying `data.gs` and installing the clean-up trigger |
| [`websocket/README.md`](websocket/README.md) | Why a Cloudflare Worker alone isn't enough, and how to wire a websocket later |
| [`websocket/worker/`](websocket/worker) | Ready-to-deploy websocket relay (**not wired into the site**) |
| [`../version.json`](../version.json) | Release info. `date` is empty or `MMDDYY` / `MM/DD/YY`; parsed by `system/js/version.js` (`WS_Version.parseDate`) |
