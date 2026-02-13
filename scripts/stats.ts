#!/usr/bin/env npx tsx
/**
 * pairux.com Stats Dashboard
 * Usage: npx tsx scripts/stats.ts
 */

import { createClient } from "@supabase/supabase-js";
import dotenv from "dotenv";
import path from "path";
dotenv.config({ path: path.resolve(process.cwd(), ".env.local") });
dotenv.config();

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

async function count(table: string, filter?: Record<string, unknown>) {
  let q = supabase.from(table).select("*", { count: "exact", head: true });
  if (filter) {
    for (const [col, val] of Object.entries(filter)) {
      if (val === null) q = q.is(col, null);
      else if (typeof val === "string" && val.startsWith("not."))
        q = q.not(col, "is", null);
      else q = q.eq(col, val as string);
    }
  }
  const { count: c, error } = await q;
  if (error) console.error(`  ⚠ ${table}:`, error.message);
  return c ?? 0;
}

async function countSince(table: string, col: string, days: number) {
  const since = new Date(Date.now() - days * 86400000).toISOString();
  const { count: c } = await supabase
    .from(table)
    .select("*", { count: "exact", head: true })
    .gte(col, since);
  return c ?? 0;
}

function header(title: string) {
  console.log(`\n${"═".repeat(50)}`);
  console.log(`  ${title}`);
  console.log("═".repeat(50));
}

function line(label: string, value: number | string) {
  console.log(`  ${label.padEnd(35)} ${value}`);
}

async function main() {
  console.log("📊 pairux.com Stats Dashboard");
  console.log(`   ${new Date().toISOString()}\n`);

  // ── Users ──
  header("👤 Profiles");
  const totalProfiles = await count("profiles");
  const newProfiles7d = await countSince("profiles", "created_at", 7);
  const newProfiles30d = await countSince("profiles", "created_at", 30);

  line("Total profiles", totalProfiles);
  line("  New (7 days)", newProfiles7d);
  line("  New (30 days)", newProfiles30d);

  // ── Sessions ──
  header("💻 Pair Programming Sessions");
  const totalSessions = await count("sessions");
  const newSessions7d = await countSince("sessions", "created_at", 7);
  const newSessions30d = await countSince("sessions", "created_at", 30);

  line("Total sessions", totalSessions);
  line("  New (7 days)", newSessions7d);
  line("  New (30 days)", newSessions30d);

  // ── Session Participants ──
  header("👥 Session Participants");
  const totalParticipants = await count("session_participants");

  line("Total participant entries", totalParticipants);

  // ── Chat ──
  header("💬 Chat Messages");
  const totalMessages = await count("chat_messages");
  const newMessages7d = await countSince("chat_messages", "created_at", 7);

  line("Total messages", totalMessages);
  line("  New (7 days)", newMessages7d);

  // ── Media Sessions ──
  header("🎥 Media Sessions");
  const totalMedia = await count("media_sessions");

  line("Total media sessions", totalMedia);

  // ── Usage ──
  header("📈 Session Usage");
  const totalUsage = await count("session_usage");

  line("Usage records", totalUsage);

  // ── Push Notifications ──
  header("🔔 Push Subscriptions");
  const totalPush = await count("push_subscriptions");

  line("Push subscriptions", totalPush);

  console.log(`\n${"═".repeat(50)}\n`);
}

main().catch(console.error);
