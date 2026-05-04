# Melbourne Storm Reddit Bot

Automatically detects new articles on the Melbourne Storm website and posts them to [r/melbournestorm](https://www.reddit.com/r/melbournestorm/) with the correct flair.

<!-- keep alive -->

---

## What It Does

A GitHub Actions workflow scrapes the Melbourne Storm news website on a schedule. When a new article is detected, it writes the article details to a pinned message in a private Discord channel. A Devvit app installed on r/melbournestorm polls that Discord channel and automatically creates a link post with the correct flair.

---

## Architecture Overview

```
Melbourne Storm website
        ↓
GitHub Actions (scraper runs on schedule)
        ↓
Discord (pinned message stores latest article data)
        ↓
Devvit app (polls Discord, posts to Reddit)
        ↓
r/melbournestorm (link post with flair)
```

There is no direct connection between GitHub and Reddit. Discord acts as the neutral middle layer because:
- Devvit cannot fetch the Melbourne Storm website directly (not on Reddit's allow-list)
- Discord (discord.com) is on Devvit's global fetch allow-list
- Supabase is NOT on Devvit's global fetch allow-list and was therefore not used

---

## Accounts and Credentials

All accounts use **MelbourneStormBot@proton.me** as the email address. Credentials are stored in the Proton Mail account for handover purposes.

| Service | Account | Purpose |
|---|---|---|
| GitHub | MelbourneStormBot | Hosts the scraper code and runs it on schedule |
| Discord | MelbourneStormBot@proton.me | Stores latest article data as a pinned message |
| Reddit | u/MelbourneStormBot | Mod account that installs and runs the Devvit app |
| Proton Mail | MelbourneStormBot@proton.me | Receives error alert emails from GitHub |

**Note:** A Supabase account also exists at MelbourneStormBot@proton.me but is no longer used by the bot. It was set up during development but abandoned when Supabase was found to be incompatible with Devvit's fetch allow-list.

---

## Repository Structure

```
melbournestorm-reddit-bot/
├── .github/
│   └── workflows/
│       ├── scraper-general.yml     # Runs every 15 min, all week
│       └── scraper-tuesday.yml     # Runs every 5 min on Tuesdays 3-8pm AEST/AEDT
├── scripts/
│   └── scraper.js                  # The scraper script
└── README.md
```

---

## GitHub Actions Workflows

Two workflows run the scraper on different schedules.

**scraper-general.yml** — runs every 15 minutes, all day, every day. Catches general news updates, injuries, and other topics when expanded.

**scraper-tuesday.yml** — runs every 5 minutes on Tuesdays only, during UTC hours 4–9. This covers 3pm–8pm in both AEST (UTC+10) and AEDT (UTC+11), ensuring the Tuesday 4pm team list announcement is caught quickly regardless of daylight saving.

Both workflows use the same scraper script. The script itself handles the logic — the workflows just trigger it on schedule.

**Note on scheduling:** GitHub does not guarantee exact cron timing on free accounts. Scheduled runs may be delayed by 15–30 minutes during busy periods. This is expected behaviour and not a bug.

---

## GitHub Secrets

The following secrets are stored in the repository under Settings → Secrets and variables → Actions. They are never visible in the code.

| Secret name | What it is |
|---|---|
| `DISCORD_BOT_TOKEN` | The bot token allowing the scraper to read and write to Discord |
| `DISCORD_CHANNEL_ID` | The ID of the #article-feed channel in the MelbourneStormBot Discord server |
| `SUPABASE_URL` | No longer used — kept for reference only |
| `SUPABASE_SERVICE_ROLE_KEY` | No longer used — kept for reference only |
| `SUPABASE_ANON_KEY` | No longer used — kept for reference only |

---

## Discord Setup

**Server:** MelbourneStormBot's server (private, no public invite link)
**Channel:** #article-feed
**Channel ID:** 1500718194137239562
**Bot:** MelbourneStormBot (APP)

The bot stores all article data as a single pinned message in the #article-feed channel. There is always exactly one pinned message. The bot edits this message on every run — it never creates additional pinned messages.

**Bot permissions:**
- View Channels
- Send Messages
- Read Message History
- Manage Messages
- Pin Messages

**To view the pinned message:** Open the #article-feed channel in Discord and click the pin icon in the top right, or scroll up to find the pinned message notification.

---

## Pinned Message Format

The pinned message contains a single line of JSON with the following fields:

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

## How the Scraper Works

1. GitHub Actions triggers `scripts/scraper.js` on schedule
2. The script reads the current pinned message from the Discord #article-feed channel
3. For each topic in the `TOPICS` config, the script fetches the Melbourne Storm topic page
4. It finds the first article card using the `aria-label` attribute (e.g. `"Team Lists Article - Late Mail: Round 9 v Dolphins..."`)
5. It extracts the article title and URL from that card
6. It compares the latest URL to the URL stored in the pinned message
7. If the URLs match — no change, script updates the health fields only
8. If the URLs differ — new article detected, script edits the pinned message with new article data
9. At the end of every run, the health fields (`status` and `last_error`) are updated in the pinned message

---

## How Devvit Uses the Data

Devvit polls the Discord channel on a schedule and follows this logic:

1. Read the pinned message from #article-feed
2. Parse the JSON
3. Check `status` first — if `0`, send a modmail alert to r/melbournestorm mods and stop
4. If `status` is `1`, compare the article URL to the last URL Devvit posted (stored in Devvit's KV store)
5. If the URL is new — create a Reddit link post with the article title and URL, apply the flair
6. If the URL is the same — do nothing

---

## Adding a New Topic

Open `scripts/scraper.js` and add a new entry to the `TOPICS` array:

```javascript
{
  slug: 'injuries',
  url: 'https://www.melbournestorm.com.au/news/topic/injuries/',
  ariaPrefix: 'Injuries Article - ',
  flair_id: 'b44e515c-3671-11f1-a98e-de42d307c623',
  flair_text: 'Injuries',
},
```

You will need to verify the correct `ariaPrefix` by viewing the page source of the topic page and finding the `aria-label` on the first article card. The prefix is everything before the article title in that label.

You will also need to update the Devvit app to handle the new topic and flair. See the Devvit section of this README when that is documented.

**Note on multiple topics:** The current pinned message format stores only one topic at a time. When multiple topics are added, the architecture will need to be reviewed — either one pinned message per topic (one channel per topic) or a different data structure. This will be addressed when the second topic is added.

**Flair IDs for future topics:**

| Topic | Flair ID |
|---|---|
| Team List | `82219f50-3670-11f1-ac72-c22170d0e125` |
| Injuries | `b44e515c-3671-11f1-a98e-de42d307c623` |
| Official News | `bfedceda-3670-11f1-98fa-42b0121679c6` |

---

## Monitoring and Alerts

**Email alerts:** GitHub automatically sends an email to MelbourneStormBot@proton.me when a workflow run fails. Check Proton Mail if you suspect something is wrong.

**Discord health check:** Open the #article-feed channel in the MelbourneStormBot Discord server and check the pinned message:
- `detected_at` should be recent (within the last 20 minutes during the day)
- `status` should be `1`
- `last_error` should be empty

If `status` is `0`, the `last_error` field will say what went wrong.

**Devvit modmail alerts:** If the scraper is reporting errors, Devvit will automatically send a modmail to r/melbournestorm so all mods are notified.

**GitHub Actions log:** Go to the repository on GitHub, click the Actions tab, and click on any workflow run to see the full log output.

---

## Common Errors and Fixes

**`HTTP_ERROR:404`**
The Melbourne Storm website returned a page not found error. Usually temporary. Wait for the next scheduled run. If it persists, check that the topic URL in `scraper.js` is correct.

**`PARSE_ERROR`**
The scraper could not find an article card with the expected `aria-label` format. This means the Melbourne Storm website has changed its HTML structure. The scraper needs to be updated. See the "If the scraper breaks" section below.

**`DISCORD_ERROR`**
The scraper could not read from or write to Discord. Check that the `DISCORD_BOT_TOKEN` and `DISCORD_CHANNEL_ID` secrets in GitHub are correct. The bot token may need to be regenerated in the Discord Developer Portal at https://discord.com/developers/applications.

---

## If the Scraper Breaks

If the Melbourne Storm website changes its structure and the scraper stops working:

1. Go to the Melbourne Storm topic page in your browser (e.g. `https://www.melbournestorm.com.au/news/topic/team-lists/`)
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
3. Click **Scraper - General (every 15 min)** in the left sidebar
4. Click **Run workflow** → **Run workflow**
5. Wait about 30 seconds and refresh the page
6. A green tick means success, a red cross means failure
7. Click into the run to see the full log
8. Check the Discord #article-feed pinned message to verify data is correct

---

## Discord API Limits

Discord allows 50 requests per second globally. The scraper makes 1-2 API calls per run (one GET to read the pinned message, one PATCH to update it). At 15-minute intervals this is approximately 3,000 calls per month — well within any reasonable limit.
