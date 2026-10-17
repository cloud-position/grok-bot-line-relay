# grok-bot-line-relay

English | [日本語](README.md)

A Cloudflare Workers template that delivers webhooks from a LINE Official Account to a Grok Bot webhook.
LINE webhooks cannot carry a custom key header, so this Worker sits in between and moves the key into one.
It runs on your own Cloudflare account (the free plan is enough). Nothing passes through the author's servers.

- It stores nothing. It passes the request body to Grok Bot as received.
- It cannot send messages to LINE and holds no channel access token.
- The only value to set is `RELAY_KEY`, a passphrase just for this Worker.

## What you need

- A LINE Official Account with the Messaging API enabled ([LINE Developers Console](https://developers.line.biz/console/))
- Your Grok Bot webhook URL and token
- A long random string for the passphrase (for example the output of `openssl rand -hex 32`)
- A Cloudflare account (the free plan is enough)
- A GitHub account (you fork or copy this repository into your GitHub)

## Setting up

There are two ways. A makes it easier to pick up updates later. If unsure, choose A.

| | A. Fork (recommended) | B. Deploy button |
| --- | --- | --- |
| Setup | Four steps | One button |
| Updates | Press "Sync fork" | By hand ([Updating](#updating)) |

### A. Fork (recommended)

1. [Fork this repository](https://github.com/keesmark/grok-bot-line-relay/fork). On the page that opens, press "Create fork".
2. In the Cloudflare dashboard, open "Workers & Pages", choose "Create" and then "Import a repository". Connect GitHub and pick the fork from step 1. If the fork is not listed, give the Cloudflare app access to it in your GitHub settings.
3. Keep the Worker name `grok-bot-line-relay` and deploy. If it differs from `name` in `wrangler.jsonc`, the build fails. If you already have a Worker with that name from B, do not set up A again; use [B's "Switch to a fork"](#if-you-used-b-deploy-button) instead.
4. Once deployed, open the Worker's Settings → Variables and Secrets, add `RELAY_KEY` as a secret, and enter the passphrase. Until then the Worker returns 500 and forwards nothing.

Screen labels may change. If you cannot find one, look for the closest match.

- Do not edit files in your fork. Edits can conflict when you pick up updates.
- A fork of a public repository stays public and cannot be made private. The passphrase and token never go into the repository; they live only in your Cloudflare and LINE settings, so a public fork is fine.

### B. Deploy button

[![Deploy to Cloudflare](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/keesmark/grok-bot-line-relay)

The button copies this repository into your GitHub (it is not a fork). Enter the passphrase as `RELAY_KEY` on the deploy screen and deploy. This is quicker, but the copy is not linked to this repository, so picking up updates takes manual work.

## Connecting LINE

Once the Worker is up, paste the following into the Webhook URL field in the LINE Developers Console, press "Verify" and check that it succeeds.

```
https://<your Worker URL>/webhook?url=<Grok Bot webhook URL>&token=<Grok Bot token>&key=<passphrase>
```

URL-encode `url`. The Worker sends `token` as `Authorization: Bearer <Grok Bot token>` and posts the body to `url` exactly as LINE sent it.

- A Grok Bot webhook URL looks like `https://api2.cursor.sh/automations/webhook/…`.
- Only https URLs on `cursor.sh` and its subdomains are allowed as destinations (`GROK_BOT_DOMAINS` in `src/env.ts`). The path is not checked, so the Worker keeps working if the shape of Grok Bot URLs changes. Any other destination gets a 403 and nothing is forwarded.
- The token and passphrase are part of the URL, so request logs are turned off. Do not paste this URL into chats or other places.
- Requests with no events, such as the "Verify" button, are not forwarded.
- The Worker returns 200 to LINE even when the destination returns an error. LINE does not retry, so check that message in the LINE chat.

### About the LINE signature

This Worker does not verify the LINE signature. Sending a fake message to Grok Bot through the Worker requires the key (`token`), and anyone with the key can call Grok Bot directly without the Worker, so verifying here adds no protection. The `X-Line-Signature` header is passed through to Grok Bot unchanged, so Grok Bot can verify it if needed.

### About the passphrase (RELAY_KEY)

Without a passphrase, anyone who learns your Worker URL could attach their own `token` and body and make your Worker POST to `cursor.sh`, using it as a relay. To prevent this, requests whose `key` does not match `RELAY_KEY` get a 401 and nothing is forwarded. If `RELAY_KEY` is not set, the Worker returns 500 and forwards nothing.

To change the passphrase later, run the command below or change it in the Cloudflare dashboard under the Worker's Settings → Variables and Secrets, then update `key=` in the URL registered in LINE.

```sh
npx wrangler secret put RELAY_KEY
```

## Updating

Changes to the template are listed in the [commit history](https://github.com/keesmark/grok-bot-line-relay/commits/main). Every method keeps your Worker URL and `RELAY_KEY`, so the LINE settings stay as they are.

After updating, check in Cloudflare that the new deployment succeeded, and send one message from LINE to check that it reaches Grok Bot. If something breaks, you can roll the Worker back to the previous version in the Cloudflare dashboard. The repository still holds the new version, so it is deployed again the next time you update. Wait for a fixed update before updating again.

### If you used A (fork)

On your fork's page, press "Sync fork" → "Update branch". Read through the listed commits before pressing it. Cloudflare deploys the update automatically.

If GitHub reports a conflict, it is because files in your fork were edited. [Replacing with git](#replacing-with-git) brings it back.

### If you used B (Deploy button)

There are two ways.

**1. Switch to a fork (recommended)**

After switching once, you can use "Sync fork" just like A. This only works if your Worker is named `grok-bot-line-relay`.

1. [Fork this repository](https://github.com/keesmark/grok-bot-line-relay/fork). Your copy already uses the same name, so give the fork a different one.
2. In Cloudflare, open the Worker's Settings → Builds, disconnect the current repository and connect the fork from step 1. If the fork is not listed, give the Cloudflare app access to it in your GitHub settings.
3. Check that the new deployment succeeded.

**2. Replace with git**

Follow [Replacing with git](#replacing-with-git) below.

### Replacing with git

This replaces main in your repository with the latest template commit. It works for both A and B. Anything you changed in your repository is lost.

Without git on your machine, open your repository's page, create a Codespace from "Code" → "Codespaces", and run the commands from the third line in its terminal.

```sh
git clone https://github.com/<your GitHub name>/<your repository>.git
cd <your repository>
git fetch https://github.com/keesmark/grok-bot-line-relay.git main
git reset --hard FETCH_HEAD
git push --force origin main
```

If your Worker is not named `grok-bot-line-relay`, change `name` in `wrangler.jsonc` to your Worker's name and commit before `git push`. Otherwise the build fails.

## Design

### Overall flow

```mermaid
sequenceDiagram
    participant U as LINE user
    participant L as LINE Platform
    participant W as Worker (your Cloudflare)
    participant G as Grok Bot

    U->>L: Sends a message
    L->>W: POST /webhook?url=…&token=…&key=…<br/>with X-Line-Signature
    W->>W: Check the passphrase, destination and body
    W-->>L: 200 (right away)
    W->>G: POST url<br/>Authorization: Bearer token<br/>X-Line-Signature unchanged<br/>body as received
    G-->>W: Response (logs keep only the count and status)
```

The Worker returns 200 to LINE first and forwards to Grok Bot in the background (`ctx.waitUntil`). It stores nothing.

### Request handling

```mermaid
flowchart TD
    A[Request] --> B{Path}
    B -- / --> OK[200 ok]
    B -- other --> N404[404]
    B -- /webhook --> C{POST?}
    C -- no --> N405[405]
    C -- yes --> S{RELAY_KEY set?}
    S -- no --> N500[500]
    S -- yes --> K{key matches RELAY_KEY?}
    K -- no --> N401[401]
    K -- yes --> D{url and token present<br/>and url parses?}
    D -- no --> N400a[400]
    D -- yes --> E{Destination on cursor.sh?<br/>https, no port, no user info<br/>cursor.sh or a subdomain}
    E -- no --> N403[403]
    E -- yes --> F{Body 1 MiB or less?}
    F -- no --> N413[413]
    F -- yes --> G{Valid JSON?}
    G -- no --> N400b[400]
    G -- yes --> H{Any events?}
    H -- none --> R200a[200, not forwarded]
    H -- some --> R200b[200, forwarded to Grok Bot]
```

### Files

| File | Role |
| --- | --- |
| `src/index.ts` | Routes requests by path |
| `src/webhook.ts` | Handles `/webhook` and forwards to Grok Bot |
| `src/env.ts` | Allowed destinations, and building the destination from `url` and `token` |
| `src/key.ts` | Checks `key` against `RELAY_KEY` |
| `src/body.ts` | Reads the body with a size cap |

## Security

- No runtime dependencies. Development tools are pinned to exact versions with a lockfile.
- Versions published less than 7 days ago are not installed (`min-release-age=7` in `.npmrc`, honored by npm 11.10 and later), since hijacked releases are usually found and pulled within days. Every version in the lockfile is at least 7 days old.
- The request body is capped at 1 MiB, and reading stops once the cap is exceeded.
- Redirects from the destination are never followed. The destination check only covers the first URL, so following one could deliver the body and token outside `cursor.sh`.
- Forwarding gives up after 10 seconds.
- Logs never include the body, the URL, or the key.
- If you find a vulnerability, please report it privately as described in [SECURITY.md](SECURITY.md).

## Development

```sh
npm ci
cp .dev.vars.example .dev.vars  # set RELAY_KEY= to any value
npm test
npm run coverage
npm run dev
```

## License

[MIT](LICENSE)

---

LINE is a trademark of LY Corporation. This repository is not an official product of LY Corporation.
