import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";
import { subscribeToChannel, unsubscribeFromChannel } from "@/lib/youtube-websub";

/**
 * Manage monitored YouTube channels.
 *
 * GET - List all monitored channels
 * POST - Add a channel to monitor (subscribes to WebSub)
 * DELETE - Remove a channel (unsubscribes from WebSub)
 */

export async function GET() {
  const { data, error } = await supabase
    .from("monitored_channels")
    .select("*")
    .order("created_at", { ascending: false });

  if (error) {
    return NextResponse.json({ error: "Failed to fetch channels" }, { status: 500 });
  }

  return NextResponse.json(data);
}

export async function POST(request: NextRequest) {
  const { channelId, channelName } = await request.json();

  if (!channelId || !channelName) {
    return NextResponse.json(
      { error: "Missing channelId or channelName" },
      { status: 400 }
    );
  }

  // Build the webhook callback URL
  const baseUrl = process.env.NEXT_PUBLIC_APP_URL || "https://your-app.vercel.app";
  const callbackUrl = `${baseUrl}/api/webhooks/youtube`;

  // Subscribe to YouTube WebSub
  const result = await subscribeToChannel(channelId, callbackUrl);

  if (!result.success) {
    return NextResponse.json(
      { error: `WebSub subscription failed: ${result.error}` },
      { status: 502 }
    );
  }

  // Save to database
  const { data, error } = await supabase
    .from("monitored_channels")
    .upsert(
      {
        youtube_channel_id: channelId,
        channel_name: channelName,
        webhook_active: true,
      },
      { onConflict: "youtube_channel_id" }
    )
    .select()
    .single();

  if (error) {
    return NextResponse.json({ error: "Database error" }, { status: 500 });
  }

  return NextResponse.json(data);
}

export async function DELETE(request: NextRequest) {
  const { channelId } = await request.json();

  if (!channelId) {
    return NextResponse.json({ error: "Missing channelId" }, { status: 400 });
  }

  const baseUrl = process.env.NEXT_PUBLIC_APP_URL || "https://your-app.vercel.app";
  const callbackUrl = `${baseUrl}/api/webhooks/youtube`;

  await unsubscribeFromChannel(channelId, callbackUrl);

  await supabase
    .from("monitored_channels")
    .delete()
    .eq("youtube_channel_id", channelId);

  return NextResponse.json({ status: "removed" });
}
