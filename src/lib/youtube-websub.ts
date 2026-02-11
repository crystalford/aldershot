const YOUTUBE_WEBSUB_HUB = "https://pubsubhubbub.appspot.com/subscribe";

/**
 * Subscribe to YouTube channel notifications via WebSub (PubSubHubbub).
 * This is the official, free, supported way to get notified about new uploads.
 *
 * YouTube will POST to your webhook URL whenever the channel uploads a video.
 * Subscriptions expire after ~10 days and need to be renewed.
 */
export async function subscribeToChannel(
  channelId: string,
  callbackUrl: string
): Promise<{ success: boolean; error?: string }> {
  const topic = `https://www.youtube.com/xml/feeds/videos.xml?channel_id=${channelId}`;

  const formData = new URLSearchParams({
    "hub.callback": callbackUrl,
    "hub.topic": topic,
    "hub.verify": "async",
    "hub.mode": "subscribe",
    "hub.lease_seconds": "864000", // 10 days
  });

  const response = await fetch(YOUTUBE_WEBSUB_HUB, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: formData.toString(),
  });

  if (response.status === 202 || response.status === 204) {
    return { success: true };
  }

  const body = await response.text();
  return {
    success: false,
    error: `WebSub subscription failed (${response.status}): ${body}`,
  };
}

/**
 * Unsubscribe from a YouTube channel's notifications.
 */
export async function unsubscribeFromChannel(
  channelId: string,
  callbackUrl: string
): Promise<{ success: boolean; error?: string }> {
  const topic = `https://www.youtube.com/xml/feeds/videos.xml?channel_id=${channelId}`;

  const formData = new URLSearchParams({
    "hub.callback": callbackUrl,
    "hub.topic": topic,
    "hub.verify": "async",
    "hub.mode": "unsubscribe",
  });

  const response = await fetch(YOUTUBE_WEBSUB_HUB, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: formData.toString(),
  });

  if (response.status === 202 || response.status === 204) {
    return { success: true };
  }

  const body = await response.text();
  return {
    success: false,
    error: `WebSub unsubscribe failed (${response.status}): ${body}`,
  };
}
