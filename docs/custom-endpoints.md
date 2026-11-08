# Local and custom model endpoints

Riot Bot can use any server that speaks the OpenAI Chat Completions API. That includes a model running on this computer, such as Ollama, LM Studio, or vLLM, and a hosted OpenAI-compatible service at a public `https://` address. The connection is called **Local or custom model** in Settings and **Custom endpoint** elsewhere in the app.

It uses Riot's own agent loop and tools, like the OpenAI and OpenRouter connections. Native Codex is separate; see [Codex](codex.md).

## Set it up

1. Start your model server and note the address it serves. Common local addresses are:
   - Ollama: `http://localhost:11434/v1`
   - LM Studio (local server turned on): `http://localhost:1234/v1`
   - vLLM: `http://localhost:8000/v1` by default, or the host and port you started it with
2. Open **Settings → Connections & default model** and choose **Local or custom model**.
3. Enter the **Endpoint address**. The Ollama and LM Studio buttons fill in their usual addresses. Include the `/v1` part. Riot adds `/chat/completions` itself, and removes it if you paste the full chat address.
4. Enter the **Context length** your server runs the model with. Servers often load a model with a smaller context than its maximum. Riot fits every request to this number.
5. Leave **API key** blank for a local server that needs no key. For a hosted service, paste its key.
6. Enter the **model name** exactly as your server knows it, for example an Ollama tag such as `llama3.2`, the model identifier LM Studio shows, or vLLM's served model name.
7. Choose **Save app settings**. New bots start with this connection. For an existing bot, open **Bot settings → Model → Use app default**, then save that bot's settings.

To check the connection, open **Bot settings → Advanced → Test your saved connection**. The preview explains the calls before any are made.

## Which addresses are allowed

- Plain `http://` works only for this computer: exactly `localhost`, `127.0.0.1`, or `[::1]`. Riot connects `localhost` to 127.0.0.1 or ::1 directly and does not consult DNS or the hosts file for it.
- Every other endpoint must use `https://` and a public host name or public IP address. Before every request, Riot resolves the host and refuses to connect if any answer is a private, loopback, link-local, or other non-public address. It then connects only to the address it checked, and TLS still verifies the certificate for the host name you entered, using Windows' trusted certificates as well as Node's.
- Refused: plain `http://` to any other computer; private and local-network addresses even over `https://` (for example 192.168.x.x, 10.x.x.x, 172.16.x.x–172.31.x.x, 100.64.x.x–100.127.x.x, fc00::/7, fe80::/10); names ending in `.local`, `.lan`, `.internal`, or `.home.arpa`; and addresses containing a username, password, `?` query, or `#` fragment.
- **A model server elsewhere on your home or office network is not supported yet.** Whether and how such a connection should be granted is an open decision for the project owner. Until then Riot refuses those addresses rather than guessing.

The address is validated in the main process when you save it and again immediately before each request. The window cannot change these rules.

## What is sent where

- Each model request goes only to `<endpoint address>/chat/completions` at the origin you saved. It contains what any model connection receives: instructions, the fitted conversation, tool definitions, tool results, and attachments you send.
- An API key is saved in the Windows-protected credential store (`credentials.bin.json`), never in settings or SQLite. It is sent only as an `Authorization: Bearer` header to the saved endpoint, after the address and DNS checks pass. With no key saved, no `Authorization` header is sent at all.
- Riot refuses a request addressed to any other host, port, scheme, or path, and it never follows a redirect. A redirect response stops the request with an error; nothing is sent to the redirect target.
- A saved key is redacted from replies, streamed text, activity, errors, and logs, the same way the OpenAI and OpenRouter keys are. The window only learns whether a key is saved.
- A server on this computer still receives your conversation. Most local servers have no authentication, so other software on this computer that can reach that port can use it too.

Removing the key in Settings stops sending it; the address stays saved. Clearing the address disconnects every bot that uses the custom endpoint.

## Limits, spending, and failures

- **No silent switching.** If the endpoint is unreachable, refuses a request, or has no saved address, the task stops or pauses with that error. Riot never moves the work to OpenAI, OpenRouter, Codex, or another model.
- Call, time, and output limits, cancellation, and Stop work as for other API connections. Transient connection failures are retried at most twice, within the same limits.
- **Pricing is unknown.** Riot does not assume a local model is free. If any dollar limit applies to the bot, including the app-wide daily ceiling in Settings, a call without prices is refused. Leave the dollar limits blank to rely on call, time, and output limits. To use dollar limits, enter both prices per million tokens in **Bot settings → Limits**, including 0 and 0 if the endpoint really costs nothing. A cost figure the endpoint reports itself is ignored; estimates come from the prices you enter.
- **Context length.** A bot's own **Model context capacity** in Bot settings → Advanced overrides the connection's value. With neither set, Riot uses its conservative 32,768-token fallback, which can be larger than a local model's actual window. Automatic replies reserve up to half of the context length.
- Models without tool calling pause the task with “This model does not support tools.” Turn off **Allow tools** for that bot or choose another model. Riot also falls back once from streaming and from the `max_completion_tokens` parameter when a server reports that it does not support them.
- Changing the endpoint address pauses queued jobs that were meant for the old address and is refused while a job is using it.

## Known limitations

- Requests to a custom endpoint use Node's networking stack so the connection can be pinned to checked addresses. Windows proxy settings are not applied to it, unlike the OpenAI and OpenRouter connections, so a hosted endpoint behind a required corporate proxy may be unreachable.
- Riot does not list the models on your server. Enter the name yourself.
- Images reach the model only if it is vision-capable.
- Verification used mocked transports and local fake servers on 127.0.0.1. It did not include a run against a real Ollama, LM Studio, or vLLM server, or a hosted endpoint.
