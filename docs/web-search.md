# Web search

Ordinary research uses a free, limited research service. It does not need a browser, an account, or an API key.

## What a new install does

Settings → Web search starts on **Automatic — free, limited**.

- A search query is sent to Tavily (`https://api.tavily.com/search`) with no `Authorization` header.
- If that attempt times out, is unavailable, or reaches Tavily’s limit, Riot tries Firecrawl once (`https://api.firecrawl.dev/v2/search`). It does not try both at the same time.
- An empty result is kept. Riot does not keep searching for a different answer.
- Snippets are leads. They are not a claim that the page was read, and they are not a Google rank.
- Readable public pages are fetched directly by Riot, up to the direct reading size limit. If a public page is blocked, larger than that limit, or comes back as a verification screen, its address can be sent once to Tavily Extract and, only if that attempt fails, once to Firecrawl scrape. The tool result names the service that produced the text. A verification screen is not used as the article and is not solved automatically.
- Saved keys are ignored until **Use my own connection** is selected. A saved key is never sent together with the keyless header, and it does not raise the per-bot limit.

Free use is also capped by those services per network address. Riot does not invent a provider quota and does not ask the user to sign up from Chat. Separately, each bot can make 40 research requests per day. That ceiling includes Tavily, Firecrawl, a fallback, native `riot_web_search` and `riot_fetch_url`, and the Check button. A request refused by the bot limit does not spend the account limit, and the reverse is also true.

## Other choices

**Use my own connection** sends `Authorization` only to the selected service, and only after that service is checked on. Those calls still count toward the bot’s 40-request day, and they also count toward a local account cap, default 20. Both counters are reserved together. Provider credits are not part of Riot’s model budget. **Check Tavily** or **Check Firecrawl** sends one search for the word “example” to that selected service only. It counts as one bot request and one account-capped request. The settings screen does not send it on its own, and it does not check the other service.

**Use the browser** keeps the existing browser search, including Google, Brave, DuckDuckGo, a custom search address, and the verification handoff. An explicit engine request uses the browser even while Automatic is selected. An unrelated open browser window does not switch Automatic or a saved connection over to the browser. If a search is waiting on verification, that same search can read the cleared results without opening the search page again. Tavily and Firecrawl results are never described as a Google position.

Switching modes does not delete keys, bot data, or a custom search address.

## Permissions

Each bot’s tool switch and remembered websites still apply. After private sources have been read, Tavily and Firecrawl each need their own approval. A generated address needs approval before it is opened, and a separate approval before it is sent to a reading service. A link that appeared only on a page in the bot’s browser, which can be signed in, can be opened there without another prompt, but it also needs that reading-service approval. Links you typed, public search results, and links from pages Riot read directly do not. Signed query parameters, including AWS (`X-Amz-Signature`, `X-Amz-Credential`) and Google (`X-Goog-Signature`, `X-Goog-Credential`, `GoogleAccessId`) forms, are not submitted to either extractor and are not shown as ordinary result links. Private addresses, cookies, saved passwords, and mailbox content are not submitted. Provider text is untrusted data. A reported source address is kept only when it is a usable public URL; a private, malformed, or signed reported address is dropped instead of being relabeled as the page that was requested. Only a validated public result link becomes a link Riot may read later. Riot does not control a provider’s own redirect path.

Stop cancels the current attempt and any fallback. A provider deadline is not Stop: Riot may try the one enabled fallback, and it does not keep a late response from the attempt that timed out. The same failed search or page waits out the provider’s cooldown instead of firing again.

Native Codex can still use its own built-in search. That path is not controlled by this setting and does not use the 40-request counter. `riot_web_search` and `riot_fetch_url` do.
