const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

const TOPICS = [
  {
    slug: 'team-lists',
    url: 'https://www.melbournestorm.com.au/news/topic/team-lists/',
    ariaPrefix: 'Team Lists Article - ',
    flair_id: '82219f50-3670-11f1-ac72-c22170d0e125',
    flair_text: 'Team List',
  },
];

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
  const path = match[2].trim();
  const url = path.startsWith('http')
    ? path
    : `https://www.melbournestorm.com.au${path}`;

  return { title, url };
}

async function getStoredData(slug) {
  const response = await fetch(
    `${SUPABASE_URL}/rest/v1/latest_articles?topic=eq.${slug}&select=url`,
    {
      headers: {
        'apikey': SUPABASE_SERVICE_ROLE_KEY,
        'Authorization': `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
      },
    }
  );

  if (!response.ok) return null;
  const data = await response.json();
  return data.length > 0 ? data[0].url : null;
}

async function upsertArticle(slug, title, url, flair_id, flair_text) {
  const response = await fetch(
    `${SUPABASE_URL}/rest/v1/latest_articles`,
    {
      method: 'POST',
      headers: {
        'apikey': SUPABASE_SERVICE_ROLE_KEY,
        'Authorization': `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
        'Content-Type': 'application/json',
        'Prefer': 'resolution=merge-duplicates',
      },
      body: JSON.stringify({
        topic: slug,
        title,
        url,
        flair_id,
        flair_text,
        detected_at: new Date().toISOString(),
      }),
    }
  );

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`SUPABASE_ERROR:${error}`);
  }
}

async function updateHealthCheck() {
  await fetch(
    `${SUPABASE_URL}/rest/v1/latest_articles`,
    {
      method: 'POST',
      headers: {
        'apikey': SUPABASE_SERVICE_ROLE_KEY,
        'Authorization': `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
        'Content-Type': 'application/json',
        'Prefer': 'resolution=merge-duplicates',
      },
      body: JSON.stringify({
        topic: '_health',
        title: 'health check',
        url: 'health',
        flair_id: '',
        flair_text: '',
        detected_at: new Date().toISOString(),
      }),
    }
  );
}

async function run() {
  console.log(`Scraper started at ${new Date().toISOString()}`);

  let anyError = false;

  for (const topic of TOPICS) {
    console.log(`\nChecking: ${topic.slug}`);

    try {
      const latest = await fetchLatestArticle(topic);
      console.log(`Latest article: "${latest.title}" — ${latest.url}`);

      const storedUrl = await getStoredData(topic.slug);
      console.log(`Stored URL: ${storedUrl}`);

      if (latest.url === storedUrl) {
        console.log(`No change for ${topic.slug}`);
        continue;
      }

      console.log(`New article detected — updating Supabase`);
      await upsertArticle(
        topic.slug,
        latest.title,
        latest.url,
        topic.flair_id,
        topic.flair_text
      );
      console.log(`Supabase updated successfully`);

    } catch (err) {
      anyError = true;
      console.error(`ERROR [${topic.slug}]: ${err.message}`);

      if (err.message.startsWith('PARSE_ERROR')) {
        console.error(`ACTION REQUIRED: The Melbourne Storm website structure may have changed.`);
        console.error(`Check ${topic.url} and update the scraper if needed.`);
      } else if (err.message.startsWith('HTTP_ERROR')) {
        console.error(`The Melbourne Storm website returned an error. May be temporary.`);
      } else if (err.message.startsWith('SUPABASE_ERROR')) {
        console.error(`Supabase write failed. Check your secrets are correct.`);
      }
    }
  }

  try {
    await updateHealthCheck();
    console.log(`\nHealth check timestamp updated`);
  } catch (err) {
    console.error(`Health check update failed: ${err.message}`);
  }

  if (anyError) {
    console.error(`\nScraper finished WITH ERRORS`);
    process.exit(1);
  } else {
    console.log(`\nScraper finished successfully`);
  }
}

run();
