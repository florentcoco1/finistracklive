import "https://deno.land/std@0.224.0/dotenv/load.ts";
import { assertEquals, assert } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.4";

const SUPABASE_URL = Deno.env.get("VITE_SUPABASE_URL")!;
const SUPABASE_ANON_KEY = Deno.env.get("VITE_SUPABASE_PUBLISHABLE_KEY")!;

assert(SUPABASE_URL, "VITE_SUPABASE_URL missing");
assert(SUPABASE_ANON_KEY, "VITE_SUPABASE_PUBLISHABLE_KEY missing");

// Anonymous client — simulates an attacker with only the public anon key.
const anon = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

/**
 * RLS expectation for these tables (see public schema policies):
 *   - race_registrations:        SELECT public; INSERT/UPDATE/DELETE require auth.uid() = runner_id
 *   - runner_positions:          SELECT public; INSERT requires owning registration
 *   - runner_checkpoint_times:   SELECT public; INSERT/UPDATE/DELETE only for race organizer/admin
 *
 * Anonymous (unauthenticated) users must therefore be:
 *   - allowed to SELECT (public live data)
 *   - rejected on every mutation
 */

const FAKE_UUID_A = "00000000-0000-0000-0000-000000000001";
const FAKE_UUID_B = "00000000-0000-0000-0000-000000000002";
const FAKE_UUID_C = "00000000-0000-0000-0000-000000000003";

function assertBlocked(error: { code?: string; message?: string } | null, label: string) {
  assert(error, `${label}: expected RLS to block this mutation, but it succeeded`);
  // Postgres returns 42501 (insufficient_privilege) or RLS code; PostgREST exposes as code "42501"
  // or the message contains "row-level security" / "permission denied".
  const msg = (error.message ?? "").toLowerCase();
  const blocked =
    error.code === "42501" ||
    msg.includes("row-level security") ||
    msg.includes("permission denied") ||
    msg.includes("violates row-level security");
  assert(
    blocked,
    `${label}: error did not look like an RLS block — code=${error.code}, message=${error.message}`,
  );
}

Deno.test("anon can SELECT race_registrations (public live data)", async () => {
  const { error } = await anon.from("race_registrations").select("id").limit(1);
  assertEquals(error, null);
});

Deno.test("anon CANNOT INSERT into race_registrations", async () => {
  const { error } = await anon.from("race_registrations").insert({
    race_id: FAKE_UUID_A,
    runner_id: FAKE_UUID_B,
    bib_number: "RLS-TEST",
  });
  assertBlocked(error, "race_registrations INSERT");
});

Deno.test("anon CANNOT UPDATE race_registrations", async () => {
  const { error, data } = await anon
    .from("race_registrations")
    .update({ bib_number: "HACKED" })
    .neq("id", FAKE_UUID_A)
    .select();
  // RLS may surface as an error OR silently return 0 rows. Both are acceptable —
  // we just need to be sure no rows were actually mutated.
  if (error) {
    assertBlocked(error, "race_registrations UPDATE");
  } else {
    assertEquals(data ?? [], [], "race_registrations UPDATE silently affected rows");
  }
});

Deno.test("anon CANNOT DELETE from race_registrations", async () => {
  const { error, data } = await anon
    .from("race_registrations")
    .delete()
    .neq("id", FAKE_UUID_A)
    .select();
  if (error) {
    assertBlocked(error, "race_registrations DELETE");
  } else {
    assertEquals(data ?? [], [], "race_registrations DELETE silently affected rows");
  }
});

Deno.test("anon can SELECT runner_positions (public live data)", async () => {
  const { error } = await anon.from("runner_positions").select("id").limit(1);
  assertEquals(error, null);
});

Deno.test("anon CANNOT INSERT into runner_positions", async () => {
  const { error } = await anon.from("runner_positions").insert({
    registration_id: FAKE_UUID_A,
    latitude: 48.39,
    longitude: -4.49,
  });
  assertBlocked(error, "runner_positions INSERT");
});

Deno.test("anon can SELECT runner_checkpoint_times (public live data)", async () => {
  const { error } = await anon.from("runner_checkpoint_times").select("id").limit(1);
  assertEquals(error, null);
});

Deno.test("anon CANNOT INSERT into runner_checkpoint_times", async () => {
  const { error } = await anon.from("runner_checkpoint_times").insert({
    registration_id: FAKE_UUID_A,
    checkpoint_id: FAKE_UUID_B,
    time_seconds: 1234,
  });
  assertBlocked(error, "runner_checkpoint_times INSERT");
});

Deno.test("anon CANNOT UPDATE runner_checkpoint_times", async () => {
  const { error, data } = await anon
    .from("runner_checkpoint_times")
    .update({ time_seconds: 9999 })
    .neq("id", FAKE_UUID_C)
    .select();
  if (error) {
    assertBlocked(error, "runner_checkpoint_times UPDATE");
  } else {
    assertEquals(data ?? [], [], "runner_checkpoint_times UPDATE silently affected rows");
  }
});

Deno.test("anon CANNOT DELETE runner_checkpoint_times", async () => {
  const { error, data } = await anon
    .from("runner_checkpoint_times")
    .delete()
    .neq("id", FAKE_UUID_C)
    .select();
  if (error) {
    assertBlocked(error, "runner_checkpoint_times DELETE");
  } else {
    assertEquals(data ?? [], [], "runner_checkpoint_times DELETE silently affected rows");
  }
});
