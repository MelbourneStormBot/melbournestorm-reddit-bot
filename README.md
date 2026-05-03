# Melbourne Storm Reddit Bot

Automatically detects new articles on the Melbourne Storm website and posts them to [r/melbournestorm](https://www.reddit.com/r/melbournestorm/) with the correct flair.

---

## What It Does

A GitHub Actions workflow scrapes the Melbourne Storm news website on a schedule. When a new article is detected, it writes the article details to a Supabase database. A Devvit app installed on r/melbournestorm polls that database and automatically creates a link post with the correct flair.

---

## Architecture Overview

```
Melbourne Storm website
        ↓
GitHub Actions (scraper runs on schedule)
        ↓
Supabase database (stores latest article per topic)
        ↓
Devvit app (polls Supabase, posts to Reddit)
        ↓
r/melbournestorm (link post with flair)
```

There is no direct connection between GitHub and Reddit. Supabase acts as the neutral middle layer because Devvit cannot fetch the Melbourne Storm website directly (not on Reddit's allow-list).

---

## Accounts and Credentials

All accounts use **MelbourneStormBot@proton.me** as the email address. Credentials are stored in the Proton Mail account for handover purposes.

| Service | Account | Purpose |
|---|---|---|
| GitHub | MelbourneStormBot | Hosts the scraper code and runs it on schedule |
| Supabase | MelbourneStormBot@proton.me | Database storing latest article per topic |
| Reddit | u/MelbourneStormBot | Mod account that installs and runs the Devvit app |
| Proton Mail | MelbourneStormBot@proton.me | Receives error alert emails from GitHub |

---

## Repository Structure

```
melbournestorm-reddit-bot/
├── .github/
│   └── workflows/
│       ├── scraper-general.yml     # Runs every 15 min, all week
│       └── scraper-tuesday.yml     # Runs every 5 min on Tuesdays 3-8pm AEST
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

---

## GitHub Secrets

The following secrets are stored in the repository under Settings → Secrets and variables → Actions. They are never visible in the code.

| Secret name | What it is |
|---|---|
| `SUPABASE_URL` | `https://ohfhothimzcaevwolrms.supabase.co` |
| `SUPABASE_SERVICE_ROLE_KEY` | The secret key allowing the scraper to write to Supabase |
| `SUPABASE_ANON_KEY` | The publishable key used by Devvit to read from Supabase |

---

## Supabase Database

**Project:** melbournestorm-reddit-bot
**Region:** Oceania (Sydney)
**URL:** https://ohfhothimzcaevwolrms.supabase.co

**Table:** `public.latest_articles`

| Column | Type | Purpose |
|---|---|---|
| `id` | int8 | Auto-generated row ID |
| `topic` | text (unique) | Topic slug e.g. `team-lists` |
| `title` | text | Article title |
| `url` | text | Full article URL |
| `detected_at` | timestamptz | When the article was detected |
| `flair_id` | text | Reddit flair UUID for this topic |
| `flair_text` | text | Human-readable flair label |
| `status` | text | `1` = last scraper run succeeded, `0` = failed |
| `last_error` | text | Error message from last failed run, empty if OK |

There will always be one row per topic plus one `_health` row. The table never grows beyond that.

---

## How the Scraper Works

1. GitHub Actions triggers `scripts/scraper.js` on schedule
2. For each topic in the `TOPICS` config, the script fetches the Melbourne Storm topic page
3. It finds the first article card using the `aria-label` attribute (e.g. `"Team Lists Article - Late Mail: Round 9 v Dolphins..."`)
4. It extracts the article title and URL from that card
5. It reads the currently stored URL from Supabase for that topic
6. If the URLs match — no change, script moves on
7. If the URLs differ — new article detected, script writes the new article to Supabase
8. At the end of every run, the script updates the `_health` row with a fresh timestamp and status

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

**Flair IDs for future topics:**

| Topic | Flair ID |
|---|---|
| Team List | `82219f50-3670-11f1-ac72-c22170d0e125` |
| Injuries | `b44e515c-3671-11f1-a98e-de42d307c623` |
| Official News | `bfedceda-3670-11f1-98fa-42b0121679c6` |

---

## Monitoring and Alerts

**Email alerts:** GitHub automatically sends an email to MelbourneStormBot@proton.me when a workflow run fails. Check Proton Mail if you suspect something is wrong.

**Supabase health check:** Go to the Supabase table editor and look at the `_health` row.
- `detected_at` should be recent (within the last 15–20 minutes during the day)
- `status` should be `1`
- `last_error` should be empty

If `status` is `0`, the `last_error` column will tell you what went wrong.

**GitHub Actions log:** Go to the repository on GitHub, click the Actions tab, and click on any workflow run to see the full log output.

---

## Common Errors and Fixes

**`HTTP_ERROR:404`**
The Melbourne Storm website returned a page not found error. This is usually temporary. Wait for the next scheduled run. If it persists, check that the topic URL in `scraper.js` is correct.

**`PARSE_ERROR`**
The scraper could not find an article card with the expected `aria-label` format. This means the Melbourne Storm website has changed its HTML structure. The scraper needs to be updated. See the "If the scraper breaks" section below.

**`SUPABASE_ERROR`**
The scraper could not write to Supabase. Check that the `SUPABASE_SERVICE_ROLE_KEY` secret in GitHub is still valid. You may need to regenerate the key in Supabase and update the secret.

---

## If the Scraper Breaks

If the Melbourne Storm website changes its structure and the scraper stops working and you can not update code yourself:

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

---

## Supabase Free Tier Limits

The free tier allows 50,000 database operations per month. Current estimated usage with one topic is approximately 14,000 per month (28% of limit). Each additional topic adds approximately 3,200 operations per month. The free tier should comfortably support up to 4 topics total.

The free tier remains active as long as the project receives traffic. Since the scraper runs every 15 minutes, the project will never go idle.
