const DISCORD_BOT_TOKEN = process.env.DISCORD_BOT_TOKEN;

const TOPICS = [
  {
    slug: 'team-lists',
    channelId: '1500718194137239562',
    url: 'https://www.melbournestorm.com.au/news/topic/team-lists/',
    ariaPrefix: 'Team Lists Article - ',
    flair_id: '82219f50-3670-11f1-ac72-c22170d0e125',
    flair_text: 'Team List',
  },
  {
    slug: 'injuries',
    channelId: '1501075944973008948',
    url: 'https://www.melbournestorm.com.au/news/topic/injuries/',
    ariaPrefix: 'Injuries Article - ',
    flair_id: 'b44e515c-3671-11f1-a98e-de42d307c623',
    flair_text: 'Injuries',
  },
];

// --- Resilience settings ---
const MAX_ATTEMPTS = 3;          // fetch attempts per topic per run
const RETRY_DELAY_MS = 15000;    // wait between attempts
const FETCH_TIMEOUT_MS = 30000;  // give up on a hanging request (524s hang ~100s)
const FAIL_THRESHOLD = 3;        // consecutive failed runs before status=0 (alert)

const DISCORD_API = 'https://discord.com/api/v10';
const fs = await import('fs');
const path = await import('path');

const LOG_FILE = path.join(process.cwd(), 'logs', 'article-history.md');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function toDiscordContent(data) {
  return '`' + JSON.stringify(data) + '`';
}

function fromDiscordContent(content) {
  return JSON.parse(content.replace(/`/g, '').trim());
}

async function discordRequest(method, endpoint, body) {
  const response = await fetch(`${DISCORD_API}${endpoint}`, {
    method,
    headers: {
      'Authorization': `Bot ${DISCORD_BOT_TOKEN}`,
      'Content-Type': 'application/json',
    },
    body: body ? JSON.stringify(body) : undefined,
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`DISCORD_ERROR:${response.status}:${error}`);
  }

  const text = await response.text();
  return text ? JSON.parse(text) : null;
}

async function getPinnedMessage(channelId) {
  const pins = await discordRequest('GET', `/channels/${channelId}/pins`);
  if (!pins || pins.length === 0) return null;
  if (pins.length > 1) {
    console.warn(`WARNING: ${pins.length} pinned messages in channel ${channelId} — using the first. Unpin the extras.`);
  }
  return pins[0];
}

async function createAndPinMessage(channelId, content) {
  const message = await discordRequest('POST', `/channels/${channelId}/messages`, {
    content,
  });
  await discordRequest('PUT', `/channels/${channelId}/pins/${message.id}`);
  return message;
}

async function editMessage(channelId, messageId, content) {
  return await discordRequest('PATCH', `/channels/${channelId}/messages/${messageId}`, {
    content,
  });
}

// Is this error worth retrying? 5xx, 429, timeouts/network errors, and parse
// failures (usually an error page served with 200). Not 4xx like 404.
function isTransient(err) {
  const m = err.message;
  if (m.startsWith('PARSE_ERROR')) return true;
  if (m.startsWith('HTTP_ERROR')) {
    const code = parseInt(m.split(':')[1], 10);
    return code >= 500 || code === 429;
  }
  return true; // network error / timeout / abort
}

async function fetchLatestArticleOnce(topic) {
  const response = await fetch(topic.url, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (compatible; MelbourneStormBot/1.0)',
    },
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  });

  if (!response.ok) {
    throw new Error(`HTTP_ERROR:${response.status}`);
  }

  const html = await response.text();

  const ariaPattern = new RegExp(
    `aria-label="${topic.ariaPrefix}([^.]+)\\.[^"]*"[^>]*href="([^"]+)"`
  );

  const match = html.match(ariaPattern);

  if (!match) {
    // Diagnostics: tells a real redesign apart from an error/challenge page
    const pageTitle = (html.match(/<title[^>]*>([^<]*)<\/title>/i) || [])[1] || '(none)';
    const ariaCount = (html.match(/aria-label="/g) || []).length;
    console.error(`  Parse diag — status ${response.status}, length ${html.length}, title "${pageTitle.trim()}", aria-labels found: ${ariaCount}`);
    throw new Error(`PARSE_ERROR:Could not find article card with aria-label prefix "${topic.ariaPrefix}" — page structure may have changed`);
  }

  const title = match[1].trim()
    .replace(/&#39;/g, "'")
    .replace(/&#8217;/g, "'")
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>');
  const path2 = match[2].trim();
  const url = path2.startsWith('http')
    ? path2
    : `https://www.melbournestorm.com.au${path2}`;

  return { title, url };
}

async function fetchLatestArticle(topic) {
  let lastErr;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      return await fetchLatestArticleOnce(topic);
    } catch (err) {
      lastErr = err;
      console.warn(`  Attempt ${attempt}/${MAX_ATTEMPTS} failed: ${err.message}`);
      if (!isTransient(err) || attempt === MAX_ATTEMPTS) break;
      await sleep(RETRY_DELAY_MS);
    }
  }
  throw lastErr;
}

async function appendToLog(slug, title, url) {
  try {
    const dir = path.dirname(LOG_FILE);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    const timestamp = new Date().toISOString();
    const entry = `| ${timestamp} | ${slug} | ${title} | ${url} |\n`;

    if (!fs.existsSync(LOG_FILE)) {
      const header = `# Melbourne Storm Article History\n\nAutomatically updated by MelbourneStormBot when new articles are detected.\n\n| Detected At | Topic | Title | URL |\n|---|---|---|---|\n`;
      fs.writeFileSync(LOG_FILE, header);
    }

    fs.appendFileSync(LOG_FILE, entry);
    console.log(`Log file updated: ${title}`);

    const outputFile = process.env.GITHUB_OUTPUT;
    if (outputFile) {
      fs.appendFileSync(outputFile, `article_detected=true\n`);
    }
  } catch (err) {
    console.error(`Failed to update log file: ${err.message}`);
  }
}

async function processTopic(topic) {
  console.log(`\nChecking: ${topic.slug}`);

  let pinnedMessage = null;
  let pinnedData = null;
  let articleUpdated = false;

  try {
    pinnedMessage = await getPinnedMessage(topic.channelId);
    if (pinnedMessage) {
      pinnedData = fromDiscordContent(pinnedMessage.content);
      console.log(`Found pinned message, stored URL: ${pinnedData.url}`);
    } else {
      console.log(`No pinned message found — will create one`);
    }
  } catch (err) {
    // Stop here: carrying on with no pin would create a duplicate pinned message
    console.error(`Failed to read pinned message for ${topic.slug}: ${err.message} — skipping topic this run`);
    return { success: false, alerted: false, error: `[${topic.slug}]: ${err.message}` };
  }

  try {
    const latest = await fetchLatestArticle(topic);
    console.log(`Latest article: "${latest.title}" — ${latest.url}`);

    const storedUrl = pinnedData ? pinnedData.url : null;
    console.log(`Stored URL: ${storedUrl}`);

    if (latest.url === storedUrl) {
      console.log(`No change for ${topic.slug} — skipping Discord write`);
    } else {
      console.log(`New article detected — updating Discord`);

      const newData = {
        topic: topic.slug,
        title: latest.title,
        url: latest.url,
        flair_id: topic.flair_id,
        flair_text: topic.flair_text,
        detected_at: new Date().toISOString(),
        status: '1',
        last_error: '',
        fail_count: 0,
      };

      if (pinnedMessage) {
        await editMessage(topic.channelId, pinnedMessage.id, toDiscordContent(newData));
        pinnedMessage = { ...pinnedMessage, content: toDiscordContent(newData) };
      } else {
        pinnedMessage = await createAndPinMessage(topic.channelId, toDiscordContent(newData));
      }

      pinnedData = newData;
      articleUpdated = true;
      console.log(`Discord updated successfully for ${topic.slug}`);

      await appendToLog(topic.slug, latest.title, latest.url);
    }

    // Only create initial pinned message if none exists yet
    if (!articleUpdated && !pinnedMessage) {
      const healthData = {
        topic: topic.slug,
        title: 'health check',
        url: 'health',
        flair_id: topic.flair_id,
        flair_text: topic.flair_text,
        detected_at: new Date().toISOString(),
        status: '1',
        last_error: '',
        fail_count: 0,
      };
      await createAndPinMessage(topic.channelId, toDiscordContent(healthData));
      console.log(`Created initial pinned message for ${topic.slug}`);
    }

    // Reset after recovery from an alert (status 0) or from silent failures (fail_count > 0)
    if (
      !articleUpdated && pinnedMessage && pinnedData &&
      (pinnedData.status === '0' || (pinnedData.fail_count || 0) > 0)
    ) {
      const recoveredData = {
        ...pinnedData,
        detected_at: new Date().toISOString(),
        status: '1',
        last_error: '',
        fail_count: 0,
      };
      await editMessage(topic.channelId, pinnedMessage.id, toDiscordContent(recoveredData));
      console.log(`Recovery: status=1, fail_count reset for ${topic.slug}`);
    }

    return { success: true };

  } catch (err) {
    const errorMessage = `[${topic.slug}]: ${err.message}`;
    console.error(`ERROR ${errorMessage}`);

    if (err.message.startsWith('PARSE_ERROR')) {
      console.error(`The page loaded but no article card matched. If this persists, check ${topic.url}`);
    } else if (err.message.startsWith('HTTP_ERROR')) {
      console.error(`The Melbourne Storm website returned an error. May be temporary.`);
    } else if (err.message.startsWith('DISCORD_ERROR')) {
      console.error(`Discord API call failed. Check DISCORD_BOT_TOKEN secret.`);
    }

    let alerted = false;

    try {
      if (pinnedMessage && pinnedData) {
        if (pinnedData.status === '0') {
          console.log(`Status already 0 for ${topic.slug} — skipping Discord write`);
          alerted = true;
        } else {
          const failCount = (pinnedData.fail_count || 0) + 1;
          const reachedThreshold = failCount >= FAIL_THRESHOLD;
          const errorData = {
            ...pinnedData,
            status: reachedThreshold ? '0' : '1',
            last_error: errorMessage,
            fail_count: failCount,
          };
          if (reachedThreshold) errorData.detected_at = new Date().toISOString();

          await editMessage(topic.channelId, pinnedMessage.id, toDiscordContent(errorData));
          alerted = reachedThreshold;
          console.log(
            reachedThreshold
              ? `Health check updated for ${topic.slug}: status=0 after ${failCount} consecutive failures`
              : `Failure ${failCount}/${FAIL_THRESHOLD} for ${topic.slug} — not alerting yet`
          );
        }
      }
    } catch (healthErr) {
      console.error(`Failed to update health check for ${topic.slug}: ${healthErr.message}`);
    }

    return { success: false, alerted, error: errorMessage };
  }
}

async function run() {
  console.log(`Scraper started at ${new Date().toISOString()}`);

  const results = [];

  for (const topic of TOPICS) {
    const result = await processTopic(topic);
    results.push(result);
  }

  const alerted = results.some(r => !r.success && r.alerted);
  const transient = results.some(r => !r.success && !r.alerted);

  if (alerted) {
    console.error(`\nScraper finished WITH ERRORS`);
    process.exit(1);
  } else if (transient) {
    // Shows as a yellow annotation in Actions, but the run stays green
    console.log(`::warning::Transient scraper failure (below alert threshold)`);
    console.log(`\nScraper finished with transient failures`);
  } else {
    console.log(`\nScraper finished successfully`);
  }
}

run();
