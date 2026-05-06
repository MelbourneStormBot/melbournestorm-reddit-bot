import { Hono } from 'hono';
import { redis } from '@devvit/redis';
import { reddit } from '@devvit/web/server';
import { settings } from '@devvit/web/server';
import type { TaskRequest, TaskResponse } from '@devvit/web/server';

export const poll = new Hono();

const SUBREDDIT = 'melbournestorm';

const CHANNELS = [
  {
    id: '1500718194137239562',
    topic: 'team-lists',
    flairId: '82219f50-3670-11f1-ac72-c22170d0e125',
  },
  {
    id: '1501075944973008948',
    topic: 'injuries',
    flairId: 'b44e515c-3671-11f1-a98e-de42d307c623',
  },
];

poll.post('/poll', async (c) => {
  const token = await settings.get('DISCORD_BOT_TOKEN');
  if (!token) {
    console.error('DISCORD_BOT_TOKEN is not set');
    return c.json<TaskResponse>({ status: 'ok' }, 200);
  }

  for (const channel of CHANNELS) {
    try {
      // Fetch pinned messages from Discord
      const response = await fetch(
        `https://discord.com/api/v10/channels/${channel.id}/pins`,
        {
          headers: {
            Authorization: `Bot ${token}`,
          },
        }
      );

      if (!response.ok) {
        console.error(
          `Discord fetch failed for ${channel.topic}: ${response.status}`
        );
        continue;
      }

      const pins = (await response.json()) as Array<{ content: string }>;

      if (!pins || pins.length === 0) {
        console.log(`No pinned messages found for ${channel.topic}`);
        continue;
      }

      const firstPin = pins[0];
      if (!firstPin) {
        console.log(`No pinned messages found for ${channel.topic}`);
        continue;
      }

      // Strip backticks and parse JSON
      const raw = firstPin.content.replace(/`/g, '').trim();
      const data = JSON.parse(raw) as {
        topic: string;
        title: string;
        url: string;
        flair_id: string;
        flair_text: string;
        detected_at: string;
        status: string;
        last_error: string;
      };

      const statusKey = `lastStatus:${channel.topic}`;
      const lastStatus = await redis.get(statusKey);

      // If status is 0, only send modmail if this is a new error
      if (data.status === '0') {
        if (lastStatus !== '0') {
          console.error(
            `Scraper error for ${channel.topic}: ${data.last_error}`
          );
          await reddit.sendPrivateMessage({
            to: `/r/${SUBREDDIT}`,
            subject: `Storm News Bot Error: ${channel.topic}`,
            text: `The scraper reported an error for **${channel.topic}**:\n\n${data.last_error}`,
          });
          await redis.set(statusKey, '0');
        } else {
          console.log(
            `Status still 0 for ${channel.topic}, modmail already sent`
          );
        }
        continue;
      }

      // Status is 1 — update status key if it was previously 0
      if (lastStatus !== '1') {
        await redis.set(statusKey, '1');
      }

      // Check Redis for last posted URL
      const kvKey = `lastPostedUrl:${channel.topic}`;
      const lastPostedUrl = await redis.get(kvKey);

      if (lastPostedUrl === data.url) {
        console.log(`No new article for ${channel.topic}, skipping`);
        continue;
      }

      // Submit the link post with flair
      const post = await reddit.submitPost({
        subredditName: SUBREDDIT,
        title: data.title,
        url: data.url,
        flairId: data.flair_id,
      });

      console.log(`Posted new article for ${channel.topic}: ${post.id}`);

      // Update Redis with new URL
      await redis.set(kvKey, data.url);
    } catch (err) {
      console.error(`Unexpected error for ${channel.topic}:`, err);
    }
  }

  return c.json<TaskResponse>({ status: 'ok' }, 200);
});
