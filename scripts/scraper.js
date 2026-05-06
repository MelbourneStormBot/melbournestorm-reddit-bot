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

const DISCORD_API = 'https://discord.com/api/v10';
const fs = await import('fs');
const path = await import('path');

const LOG_FILE = path.join(process.cwd(), 'logs', 'article-history.md');

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

async function fetchLatestArticle(topic) {
  const response = await fetch(topic.url, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (compatible; MelbourneStormBot/1.0)',
    },
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
    throw new Error(`PARSE_ERROR:Could not find article card with aria-label prefix "${topic.ariaPrefix}" — page structure may have changed`);
  }

  const title = match[1].trim();
  const path2 = match[2].trim();
  const url = path2.startsWith('http')
    ? path2
    : `https://www.melbournestorm.com.au${path2}`;

  return { title, url };
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
    console.error(`Failed to read pinned message for ${topic.slug}: ${err.message}`);
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
      };
      await createAndPinMessage(topic.channelId, toDiscordContent(healthData));
      console.log(`Created initial pinned message for ${topic.slug}`);
    }

    // If previous status was 0 (error), update it back to 1 now we succeeded
    if (!articleUpdated && pinnedMessage && pinnedData && pinnedData.status === '0') {
      const recoveredData = {
        ...pinnedData,
        detected_at: new Date().toISOString(),
        status: '1',
        last_error: '',
      };
      await editMessage(topic.channelId, pinnedMessage.id, toDiscordContent(recoveredData));
      console.log(`Recovery: status updated to 1 for ${topic.slug}`);
    }

    return { success: true };

  } catch (err) {
    const errorMessage = `[${topic.slug}]: ${err.message}`;
    console.error(`ERROR ${errorMessage}`);

    if (err.message.startsWith('PARSE_ERROR')) {
      console.error(`ACTION REQUIRED: The Melbourne Storm website structure may have changed.`);
      console.error(`Check ${topic.url} and update the scraper if needed.`);
    } else if (err.message.startsWith('HTTP_ERROR')) {
      console.error(`The Melbourne Storm website returned an error. May be temporary.`);
    } else if (err.message.startsWith('DISCORD_ERROR')) {
      console.error(`Discord API call failed. Check DISCORD_BOT_TOKEN secret.`);
    }

    // Only update Discord with error if status wasn't already 0
    try {
      if (pinnedMessage && pinnedData && pinnedData.status !== '0') {
        const errorData = {
          ...pinnedData,
          detected_at: new Date().toISOString(),
          status: '0',
          last_error: errorMessage,
        };
        await editMessage(topic.channelId, pinnedMessage.id, toDiscordContent(errorData));
        console.log(`Health check updated for ${topic.slug}: status=0`);
      } else if (pinnedMessage && pinnedData && pinnedData.status === '0') {
        console.log(`Status already 0 for ${topic.slug} — skipping Discord write`);
      }
    } catch (healthErr) {
      console.error(`Failed to update health check for ${topic.slug}: ${healthErr.message}`);
    }

    return { success: false, error: errorMessage };
  }
}

async function run() {
  console.log(`Scraper started at ${new Date().toISOString()}`);

  const results = [];

  for (const topic of TOPICS) {
    const result = await processTopic(topic);
    results.push(result);
  }

  const anyError = results.some(r => !r.success);

  if (anyError) {
    console.error(`\nScraper finished WITH ERRORS`);
    process.exit(1);
  } else {
    console.log(`\nScraper finished successfully`);
  }
}

run();
