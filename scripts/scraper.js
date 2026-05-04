const DISCORD_BOT_TOKEN = process.env.DISCORD_BOT_TOKEN;
const DISCORD_CHANNEL_ID = process.env.DISCORD_CHANNEL_ID;

const TOPICS = [
  {
    slug: 'team-lists',
    url: 'https://www.melbournestorm.com.au/news/topic/team-lists/',
    ariaPrefix: 'Team Lists Article - ',
    flair_id: '82219f50-3670-11f1-ac72-c22170d0e125',
    flair_text: 'Team List',
  },
];

const DISCORD_API = 'https://discord.com/api/v10';
const fs = await import('fs');
const path = await import('path');

const LOG_FILE = path.join(process.cwd(), 'logs', 'article-history.md');

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

async function getPinnedMessage() {
  const pins = await discordRequest('GET', `/channels/${DISCORD_CHANNEL_ID}/pins`);
  if (!pins || pins.length === 0) return null;
  return pins[0];
}

async function createAndPinMessage(content) {
  const message = await discordRequest('POST', `/channels/${DISCORD_CHANNEL_ID}/messages`, {
    content,
  });
  await discordRequest('PUT', `/channels/${DISCORD_CHANNEL_ID}/pins/${message.id}`);
  return message;
}

async function editMessage(messageId, content) {
  return await discordRequest('PATCH', `/channels/${DISCORD_CHANNEL_ID}/messages/${messageId}`, {
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

async function appendToLog(topic, title, url) {
  try {
    const dir = path.dirname(LOG_FILE);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    const timestamp = new Date().toISOString();
    const entry = `| ${timestamp} | ${topic} | ${title} | ${url} |\n`;

    if (!fs.existsSync(LOG_FILE)) {
      const header = `# Melbourne Storm Article History\n\nAutomatically updated by MelbourneStormBot when new articles are detected.\n\n| Detected At | Topic | Title | URL |\n|---|---|---|---|\n`;
      fs.writeFileSync(LOG_FILE, header);
    }

    fs.appendFileSync(LOG_FILE, entry);
    console.log(`Log file updated: ${title}`);

    // Signal to the workflow that a commit is needed
    const outputFile = process.env.GITHUB_OUTPUT;
    if (outputFile) {
      fs.appendFileSync(outputFile, `article_detected=true\n`);
    }
  } catch (err) {
    console.error(`Failed to update log file: ${err.message}`);
  }
}

async function run() {
  console.log(`Scraper started at ${new Date().toISOString()}`);

  let anyError = false;
  let lastErrorMessage = '';
  let articleUpdated = false;

  let pinnedMessage = null;
  let pinnedData = null;

  try {
    pinnedMessage = await getPinnedMessage();
    if (pinnedMessage) {
      pinnedData = JSON.parse(pinnedMessage.content);
      console.log(`Found pinned message, stored URL: ${pinnedData.url}`);
    } else {
      console.log(`No pinned message found — will create one`);
    }
  } catch (err) {
    console.error(`Failed to read pinned message: ${err.message}`);
  }

  for (const topic of TOPICS) {
    console.log(`\nChecking: ${topic.slug}`);

    try {
      const latest = await fetchLatestArticle(topic);
      console.log(`Latest article: "${latest.title}" — ${latest.url}`);

      const storedUrl = pinnedData ? pinnedData.url : null;
      console.log(`Stored URL: ${storedUrl}`);

      if (latest.url === storedUrl) {
        console.log(`No change for ${topic.slug}`);
        continue;
      }

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
        await editMessage(pinnedMessage.id, JSON.stringify(newData));
        pinnedMessage = { ...pinnedMessage, content: JSON.stringify(newData) };
      } else {
        pinnedMessage = await createAndPinMessage(JSON.stringify(newData));
      }

      pinnedData = newData;
      articleUpdated = true;
      console.log(`Discord updated successfully`);

      await appendToLog(topic.slug, latest.title, latest.url);

    } catch (err) {
      anyError = true;
      lastErrorMessage = `[${topic.slug}]: ${err.message}`;
      console.error(`ERROR ${lastErrorMessage}`);

      if (err.message.startsWith('PARSE_ERROR')) {
        console.error(`ACTION REQUIRED: The Melbourne Storm website structure may have changed.`);
        console.error(`Check ${topic.url} and update the scraper if needed.`);
      } else if (err.message.startsWith('HTTP_ERROR')) {
        console.error(`The Melbourne Storm website returned an error. May be temporary.`);
      } else if (err.message.startsWith('DISCORD_ERROR')) {
        console.error(`Discord API call failed. Check DISCORD_BOT_TOKEN and DISCORD_CHANNEL_ID secrets.`);
      }
    }
  }

  if (!articleUpdated) {
    try {
      if (pinnedMessage && pinnedData) {
        const updatedData = {
          ...pinnedData,
          detected_at: new Date().toISOString(),
          status: anyError ? '0' : '1',
          last_error: anyError ? lastErrorMessage : '',
        };
        await editMessage(pinnedMessage.id, JSON.stringify(updatedData));
        console.log(`\nHealth check updated: status=${updatedData.status}`);
      } else {
        const healthData = {
          topic: '_health',
          title: 'health check',
          url: 'health',
          flair_id: '',
          flair_text: '',
          detected_at: new Date().toISOString(),
          status: anyError ? '0' : '1',
          last_error: anyError ? lastErrorMessage : '',
        };
        pinnedMessage = await createAndPinMessage(JSON.stringify(healthData));
        console.log(`\nCreated initial pinned message with health status`);
      }
    } catch (err) {
      console.error(`Health check update failed: ${err.message}`);
    }
  }

  if (anyError) {
    console.error(`\nScraper finished WITH ERRORS`);
    process.exit(1);
  } else {
    console.log(`\nScraper finished successfully`);
  }
}

run();
