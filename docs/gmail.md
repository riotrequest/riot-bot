# Connect Gmail to Riot Bot

Riot connects your existing Gmail or Google Workspace mailbox directly from your computer. You supply your own Google app registration. There is no Riot mail server, shared OAuth application, or Riot-issued email address.

This first version supports one connected mailbox. You choose access separately for each bot:

- **No email access** is the default.
- **Read email & save drafts** lets the bot search, read messages and conversations, and create or update its own plain-text drafts in Gmail.
- **Read, draft & ask before sending** also lets the bot request a send. Riot shows the sender, every recipient (including Cc and Bcc), subject, and message. You choose **Send email** or **Don’t send**. Declining keeps the draft.

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
6. Open Riot's left-sidebar **Settings → Email**. Choose **Choose Google setup file…** and select that JSON file.
7. Choose **Connect Gmail**. Complete sign-in in your usual browser, choose the account, and review Google's requested permissions. Return to Riot when sign-in finishes. Riot should show the connected email address.
8. Under **Email access for [bot name]**, choose what the selected bot may do. This choice saves immediately. You can also change it in **Bot settings → Files & tools**, then choose **Save bot settings**.

Keep the downloaded file private and outside your bot's working folder. Do not paste it, your password, or any Google tokens into Chat. Riot does not need your Gmail password or an app password.

External Google apps left in **Testing** receive Gmail refresh tokens that expire after seven days. This can mean reconnecting weekly. Workspace policies can also limit access. Public use and production publishing are subject to Google's OAuth requirements: Gmail read and compose scopes are restricted scopes, and verification or security assessment requirements can depend on distribution and how email data is used. Self-hosting does not waive Google's rules. See [Google's desktop sign-in guide](https://developers.google.com/identity/protocols/oauth2/native-app), [token expiration rules](https://developers.google.com/identity/protocols/oauth2#expiration), and [Gmail scopes](https://developers.google.com/workspace/gmail/api/auth/scopes).

## Try it in Chat

- “Check my unread email and summarize anything that needs a reply.”
- “Read the latest conversation with our customer about the morning report.”
- “Draft a reply explaining that the report is ready. Let me review it.”
- “Send that draft.” With sending enabled, this opens Riot's review card.
- “Every weekday at 9 AM, check the RLH inbox and tell me what needs attention.” Give the bot any context or sender details it needs before saving the scheduled work.

Searching and reading do not mark messages as read. HTML mail is converted to plain text; remote images and scripts are not loaded. Long messages are read in sections. Conversations include the most recent eight messages and report when earlier messages were omitted. Messages beyond the supported size must be opened in Gmail.

Replies use the original message's reply headers and conversation. Drafts are visible in Gmail. Riot can update and send only drafts created by the same bot for its bound account. If a draft changes in Gmail, Riot pauses instead of silently sending the changed content. Ask the bot to update the draft and review it again, or finish it in Gmail.

Attachments, mailbox cleanup, labels, deletion, aliases, multiple connected accounts, and unattended sending are outside this first version. Use Gmail for those actions. Your mailbox host remains Google.

## Scheduled email work

Scheduled bot tasks use the same mailbox connection, bot permissions, saved context, model, spending limits, and Stop control as Chat. A reminder only notifies you; a scheduled task can actually check the mailbox and produce a summary or draft.

Riot must be open or running in the tray, and the computer must be on and awake. It does not poll Gmail while idle. A send still waits for your review, including in scheduled work. If approval times out, Riot leaves the draft unsent. Start with summaries or drafts for unattended checks.

## If something needs attention

- **Sign-in expired or access revoked:** open **Settings → Email → Connect Gmail**. Check Google's app status, test users, scopes, API enablement, and Workspace policy if Google refuses access.
- **Different mailbox connected:** a bot stays bound to the address you chose. Select access again to explicitly give it the new mailbox; Riot will not silently switch its email account.
- **Changing the connection during work:** stop jobs that have Gmail access first. Queued email-enabled jobs pause so you can review the new connection before resuming them.
- **Unconfirmed send:** check Gmail's **Sent** folder before trying again. A lost network response does not prove that the email failed. Riot records the uncertainty across restart and blocks automatic re-sending of that draft or an identical replacement. A confirmed send has a Gmail message ID; this confirms Google's acceptance, rather than delivery to the recipient.
- **Disconnect:** use **Settings → Email → Disconnect Gmail**. This removes Riot's saved account tokens, while retaining your local app setup for reconnecting. To revoke the grant at Google as well, remove your app from your [Google Account connections](https://myaccount.google.com/connections).

## Where the data goes

Google sign-in opens in the system browser and returns through a short-lived `127.0.0.1` callback using state checking and PKCE. Google setup and tokens stay in Riot's main process and its existing Windows-protected credential store. They are not sent to the renderer, model, or tool output. If Windows protection is unavailable, they are kept only for that session.

The email text the bot reads is sent to its selected AI provider as part of the task, like other tool results. Mail history, outgoing draft content, and send receipts can be stored in Riot's normal local database. Protect local backups accordingly. Disconnecting does not erase that conversation history or delete drafts or messages in Gmail. Email content is treated as reference material; an email cannot authorize sending or change bot permissions.

Riot uses Google's API directly and does not add a Riot-hosted email service. There are no model calls just to connect, select access, open Settings, or leave the app idle.
