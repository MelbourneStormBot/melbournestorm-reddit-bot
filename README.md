# Melbourne Storm Reddit Bot

Automatically detects new articles on the Melbourne Storm website and posts them to [r/melbournestorm](https://www.reddit.com/r/melbournestorm/) with the correct flair.

---

## What It Does

A GitHub Actions workflow scrapes the Melbourne Storm news website on a schedule. When a new article is detected, it writes the article details to a pinned message in a public Discord channel. A Devvit app installed on r/melbournestorm polls that Discord channel and automatically creates a Reddit link post with the correct flair.

---

## Architecture Overview

```
Melbourne Storm website
        ↓
GitHub Actions (scraper runs on schedule)
        ↓
Discord (one pinned message per topic channel)
        ↓
Devvit app (polls Discord, posts to Reddit)
        ↓
r/melbournestorm (link post with flair)
```

There is no direct connection between GitHub and Reddit. Discord acts as the neutral middle layer because:
- Devvit cannot fetch the Melbourne Storm website directly (not on Reddit's allow-list)
- Discord (discord.com) is on Devvit's global fetch allow-list

---

## Accounts and Credentials

All accounts use **MelbourneStormBot@proton.me** as the email address. Credentials are stored in the Proton Mail account for handover purposes.

| Service | Account | Purpose |
|---|---|---|
| GitHub | MelbourneStormBot | Hosts the scraper code and runs it on schedule |
| Discord | MelbourneStormBot@proton.me | Stores latest article data as pinned messages |
| Reddit | u/MelbourneStormBot | Mod account that installs and runs the Devvit app |
| Proton Mail | MelbourneStormBot@proton.me | Shared credential store for account handover |
| cron-job.org | MelbourneStormBot@proton.me | Reliable external trigger for Tuesday 4pm precision window |

---

## Repository Structure

```
melbournestorm-reddit-bot/
├── .github/
│   └── workflows/
│       ├── scraper-general.yml     # Triggered by cron-job.org every 30 min
│       └── scraper-tuesday.yml     # Triggered by cron-job.org at 4:00-4:10pm Tuesdays
├── logs/
│   └── article-history.md          # Historical record of all detected articles
├── scripts/
│   └── scraper.js                  # The scraper script
├── storm-news-bot/                 # Devvit app (posts articles to Reddit)
│   ├── src/
│   │   ├── routes/
│   │   │   └── poll.ts             # Core polling logic
│   │   └── index.ts                # Server entry point
│   └── devvit.json                 # App config, scheduler, permissions, secrets
├── PRIVACY.md
├── TERMS.md
└── README.md
```

---

## GitHub Actions Workflows

Two workflows run the scraper on different schedules — both triggered externally by cron-job.org rather than GitHub's own unreliable scheduler.

**scraper-general.yml** — triggered every 30 minutes, all day, every day. Catches general news updates and injuries.

**scraper-tuesday.yml** — triggered every minute from 4:00pm to 4:10pm Tuesdays only (Australia/Sydney timezone). Ensures the Tuesday 4pm team list announcement is posted within minutes of publication.

Both workflows also have `workflow_dispatch` enabled, allowing manual triggering from the Actions tab for testing.

---

## GitHub Secrets

The following secrets are stored in the repository under Settings → Secrets and variables → Actions. They are never visible in the code.

| Secret name | What it is |
|---|---|
| `DISCORD_BOT_TOKEN` | The bot token allowing the scraper to read and write to Discord |

Note: Channel IDs are stored directly in the `TOPICS` config inside `scripts/scraper.js`, not in secrets, since they are not sensitive.

---

## cron-job.org Setup

GitHub's own scheduled workflows are unreliable on free accounts and can be delayed by hours. cron-job.org is used as the primary trigger for both workflows.

**Account:** MelbourneStormBot@proton.me at https://cron-job.org

**Jobs configured:**

| Job name | Schedule | Triggers |
|---|---|---|
| Melbourne Storm Bot - General Trigger | Every 30 min at :07 and :37 | scraper-general.yml |
| Melbourne Storm Bot - Tuesday Trigger | 4:00pm–4:10pm Tuesdays | scraper-tuesday.yml |

**What each job does:** Sends a POST request to the GitHub API to trigger the relevant workflow via workflow_dispatch. GitHub then runs the scraper immediately on demand.

**GitHub Personal Access Token:** A token named `cron-job-trigger` is stored in the cron-job.org job headers as the Authorization Bearer token. This token has only the `workflow` scope. If it needs to be regenerated:
1. Go to https://github.com/settings/tokens
2. Delete the old `cron-job-trigger` token
3. Create a new classic token with only the `workflow` scope selected
4. Update the `Authorization` header value in both cron-job.org jobs

**cron-job.org request headers (same for both jobs):**

| Header | Value |
|---|---|
| `Accept` | `application/vnd.github+json` |
| `Authorization` | `Bearer YOUR_GITHUB_TOKEN` |
| `Content-Type` | `application/json` |
| `X-GitHub-Api-Version` | `2026-03-10` |

**Request body:** `{"ref":"main"}`

---

## Discord Setup

**Server:** MelbourneStormBot's server (private, invite only)
**Bot:** MelbourneStormBot (APP)

**Channels:**

| Channel | Channel ID | Topic |
|---|---|---|
| #feed-team-lists | 1500718194137239562 | Team list announcements |
| #feed-injuries | 1501075944973008948 | Injury updates |

Each channel has exactly one pinned message at all times. The scraper edits this message on every run — it never creates additional pinned messages.

**Bot permissions required:**
- View Channels
- Send Messages
- Read Message History
- Manage Messages
- Pin Messages

**Discord Developer Portal:** https://discord.com/developers/applications — log in as MelbourneStormBot to manage the bot token if needed.

---

## Pinned Message Format

Each channel's pinned message contains a single line of JSON:

```json
{
  "topic": "team-lists",
  "title": "Late Mail: Round 9 v Dolphins",
  "url": "https://www.melbournestorm.com.au/news/2026/05/01/late-mail-round-9-v-dolphins/",
  "flair_id": "82219f50-3670-11f1-ac72-c22170d0e125",
  "flair_text": "Team List",
  "detected_at": "2026-05-04T05:21:23.229Z",
  "status": "1",
  "last_error": ""
}
```

| Field | Purpose |
|---|---|
| `topic` | Topic slug identifying which news category this is |
| `title` | Article title extracted from the Melbourne Storm website |
| `url` | Full article URL |
| `flair_id` | Reddit flair UUID to apply when posting |
| `flair_text` | Human-readable flair label |
| `detected_at` | Timestamp of when this run completed |
| `status` | `1` = last scraper run succeeded, `0` = failed |
| `last_error` | Error message from last failed run, empty if OK |

**Note:** Discord renders URLs as clickable links which can make the JSON appear broken in the Discord interface. The underlying data is correct. Devvit reads the raw JSON string, not the rendered version.

---

## Article History Log

Every time a new article is detected, the scraper appends a record to `logs/article-history.md`. This file is a permanent archive of every article the bot has ever detected, useful for debugging and auditing. Each entry includes the detection timestamp, topic, article title, and URL.

---

## How the Scraper Works

1. cron-job.org triggers GitHub Actions on schedule
2. For each topic in the `TOPICS` config, the script fetches the Melbourne Storm topic page
3. It reads the current pinned message from that topic's Discord channel
4. It finds the latest article using the `aria-label` attribute on article cards
5. It compares the latest URL to the URL stored in the pinned message
6. If the URLs match — no change, script does nothing.
7. If the URLs differ — new article detected, script edits the pinned message and appends to the article history log
8. The workflow commits the updated log file back to the repository

---

## How Devvit Uses the Data

Devvit polls each Discord channel on a schedule and follows this logic for each:

1. Read the pinned message from the channel
2. Parse the JSON
3. Check `status` first — if `0`, send a modmail alert to r/melbournestorm mods and stop
4. If `status` is `1`, compare the article URL to the last URL Devvit posted (stored in Devvit's Redis store)
5. If the URL is new — create a Reddit link post with the article title and URL, apply the flair
6. If the URL is the same — do nothing

---

## Devvit App Setup

The Devvit app lives in the `storm-news-bot/` folder. It is published on Reddit's developer platform as `storm-news-bot` under the `u/MelbourneStormBot` account.

**App page:** https://developers.reddit.com/apps/storm-news-bot

**To install or reinstall the app on r/melbournestorm:**
1. Log into Reddit as u/MelbourneStormBot
2. Go to https://developers.reddit.com/apps/storm-news-bot
3. Click **Add to community** and select r/melbournestorm

**To set the Discord bot token secret:**
```bash
cd storm-news-bot
npx devvit settings set DISCORD_BOT_TOKEN
```

**To publish a new version after making code changes:**
```bash
cd storm-news-bot
nvm use 22
npx devvit publish
npx devvit install melbournestorm
```

**Scheduler:** The app runs on two schedules defined in `devvit.json`:
- Every minute all day Tuesday (UTC) — covers Tuesday 4pm AEST/AEDT team list window
- Every 30 minutes all other days

**Devvit Redis keys used:**

| Key | Purpose |
|---|---|
| `lastPostedUrl:team-lists` | Last article URL posted for team lists |
| `lastPostedUrl:injuries` | Last article URL posted for injuries |

---

## Adding a New Topic

Adding a new topic requires three steps:

**Step 1: Create a new Discord channel**
- In the MelbourneStormBot Discord server, create a new text channel named `feed-[topic-name]`
- Right-click the channel → Copy Channel ID
- Save the channel ID

**Step 2: Update scripts/scraper.js**

Open `scripts/scraper.js` and add a new entry to the `TOPICS` array at the top of the file:

```javascript
{
  slug: 'club-news',
  channelId: 'YOUR_NEW_CHANNEL_ID',
  url: 'https://www.melbournestorm.com.au/news/topic/club-news/',
  ariaPrefix: 'Club News Article - ',
  flair_id: 'bfedceda-3670-11f1-98fa-42b0121679c6',
  flair_text: 'Official News',
},
```

To find the correct `ariaPrefix`:
1. Go to the Melbourne Storm topic page in your browser
2. Right-click → View Page Source
3. Search for `aria-label="` and find the first article card
4. The prefix is everything before the article title — e.g. `"Club News Article - "` or `"Club News Video - "`
5. Always use `Article - ` not `Video - ` to avoid linking to video pages

**Step 3: Update the Devvit app**

Open `storm-news-bot/src/routes/poll.ts` and add a new entry to the `CHANNELS` array:

```typescript
{
  id: 'YOUR_NEW_CHANNEL_ID',
  topic: 'club-news',
  flairId: 'bfedceda-3670-11f1-98fa-42b0121679c6',
},
```

Then publish the updated app:

```bash
cd storm-news-bot
nvm use 22
npx devvit publish
npx devvit install melbournestorm
```

**Known flair IDs:**

| Topic | Flair ID |
|---|---|
| Team List | `82219f50-3670-11f1-ac72-c22170d0e125` |
| Injuries | `b44e515c-3671-11f1-a98e-de42d307c623` |
| Official News | `bfedceda-3670-11f1-98fa-42b0121679c6` |

---

## Monitoring and Alerts

**Discord health check:** Open each feed channel in the MelbourneStormBot Discord server and check the pinned message:
- `detected_at` should be recent (within the last 35 minutes)
- `status` should be `1`
- `last_error` should be empty

If `status` is `0`, the `last_error` field will say what went wrong.

**Devvit modmail alerts:** When the scraper reports an error, Devvit automatically sends a modmail to r/melbournestorm so all mods are notified.

**GitHub Actions log:** Go to the repository on GitHub, click the Actions tab, and click on any workflow run to see the full log output.

---

## Common Errors and Fixes

**`HTTP_ERROR:404`**
The Melbourne Storm website returned a page not found error. Usually temporary — wait for the next scheduled run. If it persists, check that the topic URL in the `TOPICS` config in `scraper.js` is correct.

**`PARSE_ERROR`**
The scraper could not find an article card with the expected `aria-label` format. This means the Melbourne Storm website has changed its HTML structure and the scraper needs updating. See the section below.

**`DISCORD_ERROR`**
The scraper could not read from or write to Discord. Check that the `DISCORD_BOT_TOKEN` secret in GitHub is correct. The bot token may need to be regenerated in the Discord Developer Portal.

**Devvit app not posting**
1. Check the Devvit app is installed on r/melbournestorm at https://developers.reddit.com/apps/storm-news-bot
2. Confirm the `DISCORD_BOT_TOKEN` secret is set by running `npx devvit settings set DISCORD_BOT_TOKEN` from the `storm-news-bot` folder
3. Check that u/MelbourneStormBot is still a moderator on r/melbournestorm

**cron-job.org job disabled**
If cron-job.org disables a job after repeated failures, log in at https://cron-job.org and re-enable it. Check the job execution history to find out why it failed — usually an expired GitHub token.

---

## If the Scraper Breaks and You Don't Know What to Do

If the Melbourne Storm website changes its structure and the scraper stops working:

1. Go to the broken topic page in your browser (e.g. `https://www.melbournestorm.com.au/news/topic/team-lists/`)
2. Right-click anywhere on the page and select "View Page Source"
3. Copy all of that source code
4. Open a new Claude chat at claude.ai
5. Paste the source code and the current contents of `scripts/scraper.js`
6. Tell Claude: "The scraper is broken with a PARSE_ERROR. Here is the current page source and the current scraper code. Please update the scraper to find the latest article correctly."
7. Replace the scraper code in GitHub with whatever Claude gives you
8. Test by triggering a manual run in GitHub Actions

---

## Manual Test Run

To trigger the scraper manually without waiting for the schedule:

1. Go to the repository on GitHub
2. Click the **Actions** tab
3. Click **Scraper - General** in the left sidebar
4. Click **Run workflow** → **Run workflow**
5. Wait about 30 seconds and refresh the page
6. A green tick means success, a red cross means failure
7. Click into the run to see the full log
8. Check each Discord feed channel's pinned message to verify data is correct

---

## Discord API Limits

Discord allows 50 requests per second globally. With two topics the scraper makes 2-4 API calls per run. At 30-minute intervals this is approximately 6,000 calls per month — well within any reasonable limit.
