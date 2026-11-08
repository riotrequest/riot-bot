# Connect Gmail to Riot Bot

Riot connects your existing Gmail or Google Workspace mailbox directly from your computer. You supply your own Google app registration. There is no Riot mail server, shared OAuth application, or Riot-issued email address.

This first version supports one connected mailbox. You choose access separately for each bot:

- **No email access** is the default.
- **Read email & save drafts** lets the bot search, read messages and conversations, and create or update its own plain-text drafts in Gmail.
- **Read, draft & send** lets the bot request a send. By default Riot shows the sender, every recipient (including Cc and Bcc), subject, and message. You choose **Send email** or **Don’t send**. Declining keeps the draft. A reply rule, described below, is the only way this bot can send without that card.

## One-time Google setup

Google requires an OAuth app registration even when the software runs only on your computer. You do not need to run a mail server or web server. Riot opens a temporary local sign-in listener itself.

1. Open [Google Cloud Console](https://console.cloud.google.com/) and create or select a project that you control.
2. [Enable Gmail API](https://console.cloud.google.com/apis/library/gmail.googleapis.com) for that project.
3. In **Google Auth Platform**, configure the app's **Branding** (name and contact email) and **Audience**. For a personal Gmail account, choose External. While the app is in Testing, add the Gmail address you will connect as a test user. A Workspace organization can use Internal if that option is available and its administrator allows it.
4. In **Data Access**, add these scopes:

   ```text
   https://www.googleapis.com/auth/gmail.readonly
   https://www.googleapis.com/auth/gmail.compose
   ```

   Readonly allows searching and reading mail. Compose allows creating drafts and sending; Riot still enforces each bot's access choice and the send review. This version does not request mailbox deletion, filter management, or full-mailbox modification permissions.

5. In [Clients](https://console.cloud.google.com/auth/clients), create an OAuth client with application type **Desktop app**, then download its JSON file. A Web application client or service-account file will not work. You do not need to enter a fixed redirect address.
6. Select your bot, then open **Apps** in its right-hand **Workspace** navigation. On the Gmail card, choose **Connect Gmail**, then **Choose Google setup file…** and select that JSON file.
7. Choose **Connect Gmail**. Complete sign-in in your usual browser, choose the account, and review Google's requested permissions. Return to Riot when sign-in finishes. Riot should show the connected email address.
8. Under **Email access for [bot name]**, choose what the selected bot may do. This choice saves immediately. Return to **Workspace → Apps → Gmail → Manage Gmail** to change or turn off its access. Each bot has its own Apps page and permissions. Shared sign-in settings remain available under **Manage shared Gmail connection**, or in the left-sidebar **Settings → Email**.

Keep the downloaded file private and outside your bot's working folder. Do not paste it, your password, or any Google tokens into Chat. Riot does not need your Gmail password or an app password.

External Google apps left in **Testing** receive Gmail refresh tokens that expire after seven days. This can mean reconnecting weekly. Workspace policies can also limit access. Public use and production publishing are subject to Google's OAuth requirements: Gmail read and compose scopes are restricted scopes, and verification or security assessment requirements can depend on distribution and how email data is used. Self-hosting does not waive Google's rules. See [Google's desktop sign-in guide](https://developers.google.com/identity/protocols/oauth2/native-app), [token expiration rules](https://developers.google.com/identity/protocols/oauth2#expiration), and [Gmail scopes](https://developers.google.com/workspace/gmail/api/auth/scopes).

## Try it in Chat

- “Check my unread email and summarize anything that needs a reply.”
- “Read the latest conversation with our customer about the morning report.”
- “Draft a reply explaining that the report is ready. Let me review it.”
- “Send that draft.” With sending enabled, and no matching reply rule, this opens Riot's review card.
- “Every weekday at 9 AM, check the RLH inbox and tell me what needs attention.” Give the bot any context or sender details it needs before saving the scheduled work.

Searching and reading do not mark messages as read. HTML mail is converted to plain text; remote images and scripts are not loaded. When a message has both a plain-text and an HTML version, reading shows the plain text. Long messages are read in sections. Conversations include the most recent eight messages and report when earlier messages were omitted. Messages beyond the supported size must be opened in Gmail.

Replies use the original message's reply headers and conversation. Drafts are visible in Gmail. Riot can update and send only drafts created by the same bot for its bound account. If a draft changes in Gmail, Riot pauses instead of silently sending the changed content. Ask the bot to update the draft and review it again, or finish it in Gmail.

Attachments, mailbox cleanup, labels, deletion, aliases, and multiple connected accounts are outside this version. Use Gmail for those actions. Your mailbox host remains Google.

## What this bot can do on its own

Open **Workspace → Apps → Gmail** and expand the Gmail card. **What this bot can do on its own** lists reply rules for the selected bot only. Shared mailbox sign-in stays under **Manage shared Gmail connection**. A rule never applies to another bot, and connecting or switching mailboxes does not move a rule onto the new mailbox.

Nothing sends on its own until you turn a specific rule on. You can turn one on from that section, or from chat:

- Ask in your own words, such as “Handle routine RLH replies yourself. Ask me about refunds or anything uncertain.” Riot can prepare a preview. It does not guess what a name means or invent addresses. **Turn on** confirms it. **Not now** leaves it off. Mail, quoted text, attachments, memories, skills, and scheduled instructions cannot confirm it.
- Or send a direct command that already contains the exact scope:

```text
Enable automatic Gmail replies:
title: Customer report
mailbox: you@example.com
to: customer@example.com
template:
Thanks, the morning report is ready.
```

The mailbox has to be the one connected for this bot, and **Read, draft & send** has to be on. **Save paused** stores the edits and turns the rule off, including when you change the recipients or the reply on a rule that was already on. **Turn on** is the only action that enables it. A saved rule can send only when all of these are true:

- It is an existing conversation, not a new email. Riot reads the original message again immediately before sending, including every plain-text and HTML version it can read, then checks the current rule, mailbox access, and daily limit before it claims the send.
- Every To address is one you listed, and each of those addresses was already a mailbox in that conversation. A newly introduced or redirected recipient waits for review. An address only in a display name or comment does not count. A recipient header Riot cannot parse also waits for review.
- The body is exactly one saved reply, aside from harmless whitespace.
- There is no Cc, Bcc, or attachment on the reply. An original message that is missing, changed, clipped, has an attachment, or whose text is not fully loaded and supported also waits for review. Text stored separately by Gmail, and message parts Riot does not decode, are not treated as an empty message. A saved reply that does not record the plain-text and HTML versions, or a version that changes before the send, waits for review.
- Neither the reply nor the original subject or any plain-text or HTML version of the message matches the money-word check (refund, payment, and the other words Riot looks for). This is a word check, not an understanding of what the message means.
- No saved exclusion on this bot covers a recipient, a phrase in the reply, or the same words in the original subject or any plain-text or HTML version of the message. Phrases must be 2 to 200 characters, with at most 10. A phrase that is too short, too long, or beyond that count is rejected; Riot does not drop it and turn on a broader rule. An exclusion wins even when another rule would have allowed the send.
- The rule is still on, for this bot and this mailbox, after that final read and before the send is claimed. Turning it off or lowering access during the read stops the automatic send.
- Today’s automatic sends are still under the rule’s limit. The default is 5 and the maximum is 20. Reviewed sends do not use this limit.

Anything else waits for the normal review card or stays an unsent draft. You can still approve an exception from that card. Turning a rule off, editing it, or saying **Stop sending automatically** takes effect before the next send, including work already queued and a send that is still reading the original message. A send Google has already accepted is not recalled by Stop; if the receipt is lost, Riot keeps the draft uncertain and will not send it again automatically.

Reply rules are checked in application code. They do not add a model call. Chat, scheduled tasks, API models, and native Codex all use this same send path.

## Scheduled email work

Scheduled bot tasks use the same mailbox connection, bot permissions, saved context, model, spending limits, and Stop control as Chat. A reminder only notifies you; a scheduled task can actually check the mailbox and produce a summary or draft.

Riot must be open or running in the tray, and the computer must be on and awake. It does not poll Gmail while idle. A send still waits for your review, including in scheduled work, unless a reply rule you already turned on covers that exact reply. Scheduled work cannot turn a rule on. If approval times out, Riot leaves the draft unsent. Start with summaries or drafts for unattended checks.

## If something needs attention

- **Sign-in expired or access revoked:** open **Workspace → Apps → Gmail → Connect Gmail**. Check Google's app status, test users, scopes, API enablement, and Workspace policy if Google refuses access.
- **Different mailbox connected:** a bot stays bound to the address you chose. Select access again to explicitly give it the new mailbox; Riot will not silently switch its email account.
- **Changing the connection during work:** stop jobs that have Gmail access first. Queued email-enabled jobs pause so you can review the new connection before resuming them.
- **Unconfirmed send:** check Gmail's **Sent** folder before trying again. A lost network response does not prove that the email failed. Riot records the uncertainty across restart and blocks automatic re-sending of that draft or an identical replacement. A confirmed send has a Gmail message ID; this confirms Google's acceptance, rather than delivery to the recipient. Recent send decisions for this bot are listed under the reply rules.
- **Disconnect:** open **Workspace → Apps → Gmail → Manage Gmail → Manage shared Gmail connection → Disconnect Gmail**. This signs the account out for all bots. To stop only the selected bot, choose **No email access** in its Apps page instead. This removes Riot's saved account tokens, while retaining your local app setup for reconnecting. To revoke the grant at Google as well, remove your app from your [Google Account connections](https://myaccount.google.com/connections).

## Where the data goes

Google sign-in opens in the system browser and returns through a short-lived `127.0.0.1` callback using state checking and PKCE. Google setup and tokens stay in Riot's main process and its existing Windows-protected credential store. They are not sent to the renderer, model, or tool output. If Windows protection is unavailable, they are kept only for that session.

The email text the bot reads is sent to its selected AI provider as part of the task, like other tool results. Mail history, outgoing draft content, and send receipts can be stored in Riot's normal local database. Protect local backups accordingly. Disconnecting does not erase that conversation history or delete drafts or messages in Gmail. Email content is treated as reference material; an email cannot authorize sending or change bot permissions.

Riot uses Google's API directly and does not add a Riot-hosted email service. There are no model calls just to connect, select access, open Settings, or leave the app idle.
