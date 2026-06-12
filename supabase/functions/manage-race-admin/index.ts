import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import postgres from "npm:postgres@3.4.5";
import { z } from "https://esm.sh/zod@3.25.76";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const uuid = z.string().uuid();
const BodySchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("load"), race_id: uuid }),
  z.object({
    action: z.literal("save_gmcap"),
    race_id: uuid,
    source_url: z.preprocess(
      (v) => {
        if (typeof v !== "string") return v;
        const t = v.trim();
        if (!t) return t;
        return /^https?:\/\//i.test(t) ? t : `https://${t}`;
      },
      z.string().url().max(1000),
    ),
    enabled: z.boolean(),
  }),
  z.object({ action: z.literal("sync_gmcap"), race_id: uuid }),
  z.object({
    action: z.literal("update_registration"),
    race_id: uuid,
    registration_id: uuid,
    bib_number: z.string().trim().min(1).max(40),
    category: z.string().trim().max(80).nullable(),
    emergency_phone: z.string().trim().max(40).nullable(),
    address: z.string().trim().max(500).nullable().optional(),
  }),
  z.object({ action: z.literal("delete_registration"), race_id: uuid, registration_id: uuid }),
  z.object({ action: z.literal("delete_all_registrations"), race_id: uuid }),
  z.object({
    action: z.literal("add_registration"),
    race_id: uuid,
    email: z.string().trim().email().max(255),
    bib_number: z.string().trim().min(1).max(40),
    category: z.string().trim().max(80).nullable(),
    gender: z.enum(["M", "F"]).nullable().optional(),
    emergency_phone: z.string().trim().max(40).nullable(),
    address: z.string().trim().max(500).nullable().optional(),
  }),
  z.object({
    action: z.literal("bulk_import_registrations"),
    race_id: uuid,
    file_name: z.string().trim().max(180).optional(),
    content: z.string().min(1).max(8 * 1024 * 1024),
  }),
  z.object({ action: z.literal("add_organizer"), race_id: uuid, email: z.string().trim().email().max(255) }),
  z.object({ action: z.literal("remove_organizer"), race_id: uuid, organizer_id: uuid }),
]);

type ProfileRow = { user_id: string; email: string | null; first_name: string | null; last_name: string | null; phone: string | null };
type RegistrationRow = { id: string; runner_id: string; bib_number: string; category: string | null; emergency_phone: string | null; address: string | null; runner_status: string; created_at: string };
type OrganizerRow = { id: string; user_id: string; role: string; created_at: string | null };
type RegistrationContactRow = { registration_id: string; emergency_phone: string | null; address: string | null };

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
}

function normalizeHeader(value: string) {
  return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9#]+/g, "");
}

function splitDelimitedLine(line: string, delimiter: string) {
  const cells: string[] = [];
  let current = "";
  let quoted = false;
  for (let i = 0; i < line.length; i += 1) {
    const char = line[i];
    if (char === '"') {
      if (quoted && line[i + 1] === '"') {
        current += '"';
        i += 1;
      } else {
        quoted = !quoted;
      }
    } else if (char === delimiter && !quoted) {
      cells.push(current.trim());
      current = "";
    } else {
      current += char;
    }
  }
  cells.push(current.trim());
  return cells;
}

function getCell(row: Record<string, string>, names: string[]) {
  for (const name of names) {
    const value = row[normalizeHeader(name)];
    if (value?.trim()) return value.trim();
  }
  return "";
}

function getEmailCell(row: Record<string, string>) {
  const exact = getCell(row, ["EMail", "Email", "E-mail", "E mail", "Mail", "Adresse mail", "Adresse e-mail", "Adresse email", "Courriel"]);
  if (exact) return exact;
  for (const [header, value] of Object.entries(row)) {
    if (value?.trim() && (header.includes("email") || header.includes("mail") || header.includes("courriel"))) return value.trim();
  }
  return "";
}

function getPhoneCell(row: Record<string, string>) {
  const exact = getCell(row, [
    "Tel", "Tél", "Tél.", "Telephone", "Téléphone", "Tel.", "Phone",
    "Portable", "Mobile", "GSM", "Tel mobile", "Téléphone mobile", "Telephone mobile",
    "N° Tel", "N° Tél", "No Tel", "Numéro Tel", "Numero Tel",
  ]);
  if (exact) return exact;
  for (const [header, value] of Object.entries(row)) {
    if (value?.trim() && (header.includes("telephone") || header.includes("tel") || header.includes("portable") || header.includes("mobile") || header.includes("gsm") || header.includes("phone"))) return value.trim();
  }
  return "";
}

function getAddressCell(row: Record<string, string>) {
  const street = getCell(row, ["Adresse", "Adresse 1", "Adresse postale", "Address", "Rue", "Voie"]);
  const extra = getCell(row, ["Adresse 2", "Complément", "Complement", "Complément adresse", "Complement adresse"]);
  const zip = getCell(row, ["CP", "Code postal", "CodePostal", "Zip", "Postal code"]);
  const city = getCell(row, ["Ville", "Commune", "City", "Localité", "Localite"]);
  const composed = [street, extra, zip, city].filter(Boolean).join(" ").trim();
  if (composed) return composed;
  for (const [header, value] of Object.entries(row)) {
    if (!value?.trim()) continue;
    const isAddress = header.includes("adresse") || header.includes("address") || header.includes("rue");
    const isEmail = header.includes("email") || header.includes("mail") || header.includes("courriel");
    if (isAddress && !isEmail) return value.trim();
  }
  return "";
}

function detectDelimiter(line: string) {
  const delimiters = ["\t", ";", ",", "|"];
  return delimiters
    .map((delimiter) => ({ delimiter, count: splitDelimitedLine(line, delimiter).length }))
    .sort((a, b) => b.count - a.count)[0]?.delimiter ?? "\t";
}

function parseBirthDate(value: string) {
  const clean = value.trim();
  if (!clean) return null;
  const fr = clean.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/);
  if (fr) return `${fr[3]}-${fr[2].padStart(2, "0")}-${fr[1].padStart(2, "0")}`;
  const iso = clean.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (iso) return `${iso[1]}-${iso[2].padStart(2, "0")}-${iso[3].padStart(2, "0")}`;
  return null;
}

function randomPassword() {
  const bytes = new Uint8Array(24);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(36).padStart(2, "0")).join("") + "Aa1!";
}

function parseRunnerImport(content: string) {
  const lines = content.replace(/^\uFEFF/, "").split(/\r?\n/).filter((line) => line.trim());
  if (lines.length < 2) throw new Error("Le fichier doit contenir une ligne d’en-tête et au moins un coureur");
  const delimiter = detectDelimiter(lines[0]);
  const headers = splitDelimitedLine(lines[0], delimiter).map(normalizeHeader);
  return lines.slice(1).map((line) => {
    const cells = splitDelimitedLine(line, delimiter);
    const row = Object.fromEntries(headers.map((header, index) => [header, cells[index] ?? ""]));
    return {
      email: getEmailCell(row).toLowerCase(),
      bib_number: getCell(row, ["Numéro", "Numero", "Dossard", "N°", "No"]),
      first_name: getCell(row, ["Prénom", "Prenom", "First name"]),
      last_name: getCell(row, ["Nom", "Last name"]),
      phone: getPhoneCell(row),
      address: getAddressCell(row),
      category: getCell(row, ["Abbrev. Catégorie", "Abbrev Categorie", "Nom Catégorie", "Nom Categorie", "Catégorie", "Categorie"]),
      birth_date: parseBirthDate(getCell(row, ["DateNaissance", "Date naissance", "Naissance"])),
      gender: normalizeGender(getCell(row, ["Sexe", "Genre", "Gender", "Sex", "S"])),
    };
  });
}

function normalizeGender(value: string): string | null {
  const v = value.trim().toUpperCase();
  if (!v) return null;
  if (v === "M" || v === "H" || v.startsWith("HOM") || v === "MALE") return "M";
  if (v === "F" || v === "W" || v.startsWith("FEM") || v === "FEMALE") return "F";
  return null;
}

async function findUserByEmail(admin: any, email: string): Promise<string | null> {
  const normalized = email.trim().toLowerCase();
  const { data: profile } = await admin.from("profiles").select("user_id").ilike("email", normalized).maybeSingle();
  if (profile?.user_id) return profile.user_id as string;
  for (let page = 1; page <= 20; page += 1) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 200 });
    if (error || !data?.users?.length) return null;
    const match = data.users.find((u: { email?: string | null; id: string; user_metadata?: Record<string, unknown> }) => (u.email ?? "").toLowerCase() === normalized);
    if (match) {
      const meta = (match.user_metadata ?? {}) as { first_name?: string; last_name?: string };
      await admin.from("profiles").upsert({
        user_id: match.id,
        email: match.email,
        first_name: meta.first_name ?? null,
        last_name: meta.last_name ?? null,
      }, { onConflict: "user_id" });
      return match.id;
    }
    if (data.users.length < 200) return null;
  }
  return null;
}

async function requireRaceAdmin(admin: any, userId: string, raceId: string) {
  const { data, error } = await admin.rpc("is_race_admin", { _race_id: raceId, _user_id: userId });
  if (!error && data) return;

  const { data: race, error: raceError } = await admin
    .from("races")
    .select("organizer_id")
    .eq("id", raceId)
    .single();
  if (raceError || race?.organizer_id !== userId) throw new Error("Administration réservée aux organisateurs de cette course");
}

async function loadRace(admin: any, raceId: string) {
  const [{ data: source }, { data: registrations }, { data: raceOrganizers }, { data: race }, { data: gmcapResults }] = await Promise.all([
    admin.from("gmcap_import_sources").select("id, source_url, source_type, file_name, enabled, last_import_at, last_import_status, last_import_message").eq("race_id", raceId).maybeSingle(),
    admin.from("race_registrations").select("id, runner_id, bib_number, category, runner_status, created_at").eq("race_id", raceId).order("bib_number"),
    admin.from("race_organizers").select("id, user_id, role, created_at").eq("race_id", raceId).order("created_at"),
    admin.from("races").select("id, name, organizer_id, event_id").eq("id", raceId).single(),
    admin.from("gmcap_results").select("bib_number, first_name, last_name, gender, birth_date, phone").eq("race_id", raceId),
  ]);

  const eventId = (race as { event_id?: string | null } | null)?.event_id ?? null;
  let event: { id: string; organizer_id: string | null } | null = null;
  let eventOrganizers: OrganizerRow[] = [];
  if (eventId) {
    const [{ data: ev }, { data: evOrgs }] = await Promise.all([
      admin.from("events").select("id, organizer_id").eq("id", eventId).maybeSingle(),
      admin.from("event_organizers").select("id, user_id, role, created_at").eq("event_id", eventId).order("created_at"),
    ]);
    event = ev as { id: string; organizer_id: string | null } | null;
    eventOrganizers = (evOrgs ?? []) as OrganizerRow[];
  }

  const registrationRows = (registrations ?? []) as Omit<RegistrationRow, "emergency_phone" | "address">[];
  const raceOrganizerRows = (raceOrganizers ?? []) as OrganizerRow[];
  const regIds = registrationRows.map((r) => r.id);
  const contacts = await getRegistrationContacts(regIds);
  const contactByReg = new Map(contacts.map((c) => [c.registration_id, c]));

  const profileIds = [
    ...new Set([
      race?.organizer_id,
      event?.organizer_id,
      ...registrationRows.map((r) => r.runner_id),
      ...raceOrganizerRows.map((o) => o.user_id),
      ...eventOrganizers.map((o) => o.user_id),
    ].filter(Boolean)),
  ];
  const { data: profiles } = profileIds.length
    ? await admin.from("profiles").select("user_id, email, first_name, last_name, phone").in("user_id", profileIds)
    : { data: [] as ProfileRow[] };
  const profileById = new Map(((profiles ?? []) as ProfileRow[]).map((p) => [p.user_id, p]));

  const gmcapByBib = new Map(
    ((gmcapResults ?? []) as Array<{ bib_number: string; first_name: string | null; last_name: string | null; gender: string | null; birth_date: string | null; phone: string | null }>)
      .map((g) => [String(g.bib_number).trim(), g]),
  );

  const seen = new Set<string>();
  const allOrganizers: Array<Record<string, unknown>> = [];
  if (race?.organizer_id) {
    seen.add(race.organizer_id as string);
    allOrganizers.push({ id: "owner", user_id: race.organizer_id, role: "propriétaire", scope: "course", created_at: null, profile: profileById.get(race.organizer_id as string) ?? null });
  }
  if (event?.organizer_id && !seen.has(event.organizer_id as string)) {
    seen.add(event.organizer_id as string);
    allOrganizers.push({ id: "event-owner", user_id: event.organizer_id, role: "propriétaire épreuve", scope: "épreuve", created_at: null, profile: profileById.get(event.organizer_id as string) ?? null });
  }
  for (const o of eventOrganizers) {
    if (seen.has(o.user_id)) continue;
    seen.add(o.user_id);
    allOrganizers.push({ ...o, scope: "épreuve", profile: profileById.get(o.user_id) ?? null });
  }
  for (const o of raceOrganizerRows) {
    if (seen.has(o.user_id)) continue;
    seen.add(o.user_id);
    allOrganizers.push({ ...o, scope: "course", profile: profileById.get(o.user_id) ?? null });
  }

  return {
    source,
    imported_count: (gmcapResults ?? []).length,
    event_id: eventId,
    registrations: registrationRows.map((r) => {
      const profile = profileById.get(r.runner_id) ?? null;
      const gmcap = gmcapByBib.get(String(r.bib_number).trim()) ?? null;
      const merged = profile
        ? { ...profile, first_name: profile.first_name ?? gmcap?.first_name ?? null, last_name: profile.last_name ?? gmcap?.last_name ?? null }
        : gmcap
          ? { email: null, phone: gmcap.phone ?? null, first_name: gmcap.first_name, last_name: gmcap.last_name }
          : null;
      const contact = contactByReg.get(r.id) ?? null;
      return { ...r, emergency_phone: contact?.emergency_phone ?? profile?.phone ?? gmcap?.phone ?? null, address: contact?.address ?? null, profile: merged, gender: gmcap?.gender ?? null, birth_date: gmcap?.birth_date ?? null };
    }),
    organizers: allOrganizers,
  };
}

function databaseUrl() {
  const dbUrl = Deno.env.get("SUPABASE_DB_URL");
  if (!dbUrl) throw new Error("Configuration base de données manquante");
  return dbUrl;
}

async function withSql<T>(handler: (sql: postgres.Sql) => Promise<T>) {
  const sql = postgres(databaseUrl(), { max: 1, prepare: false });
  try {
    return await handler(sql);
  } finally {
    await sql.end({ timeout: 5 });
  }
}

async function getRegistrationContacts(registrationIds: string[]): Promise<RegistrationContactRow[]> {
  if (!registrationIds.length) return [];
  return await withSql(async (sql) => {
    const rows = await sql<RegistrationContactRow[]>`
      SELECT registration_id::text, emergency_phone, address
      FROM public.race_registration_contacts
      WHERE registration_id = ANY(${registrationIds}::uuid[])
    `;
    return rows;
  });
}

async function upsertRegistrationContact(registrationId: string, emergencyPhone: string | null, address: string | null) {
  await withSql(async (sql) => {
    await sql`
      INSERT INTO public.race_registration_contacts (registration_id, emergency_phone, address)
      VALUES (${registrationId}::uuid, ${emergencyPhone}, ${address})
      ON CONFLICT (registration_id) DO UPDATE SET
        emergency_phone = EXCLUDED.emergency_phone,
        address = EXCLUDED.address,
        updated_at = now()
    `;
  });
}

async function deleteRegistrationContact(registrationId: string) {
  await withSql(async (sql) => {
    await sql`DELETE FROM public.race_registration_contacts WHERE registration_id = ${registrationId}::uuid`;
  });
}

async function deleteRegistrationContacts(registrationIds: string[]) {
  if (!registrationIds.length) return;
  await withSql(async (sql) => {
    await sql`DELETE FROM public.race_registration_contacts WHERE registration_id = ANY(${registrationIds}::uuid[])`;
  });
}

async function ensureRegistrationContactsSchema() {
  await withSql(async (sql) => {
    // Fast path: if table + required columns already exist, skip the heavy DDL transaction.
    const rows = await sql`
      SELECT column_name FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'race_registration_contacts'
    `;
    const cols = new Set(rows.map((r: any) => r.column_name));
    if (cols.has("registration_id") && cols.has("emergency_phone") && cols.has("address")) {
      return;
    }
    await sql.begin(async (tx) => {
      await tx.unsafe(`CREATE TABLE IF NOT EXISTS public.race_registration_contacts (
        registration_id uuid PRIMARY KEY,
        emergency_phone text,
        address text,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now()
      )`);
      await tx.unsafe(`ALTER TABLE public.race_registration_contacts ADD COLUMN IF NOT EXISTS emergency_phone text`);
      await tx.unsafe(`ALTER TABLE public.race_registration_contacts ADD COLUMN IF NOT EXISTS address text`);
      await tx.unsafe(`ALTER TABLE public.race_registration_contacts ADD COLUMN IF NOT EXISTS created_at timestamptz NOT NULL DEFAULT now()`);
      await tx.unsafe(`ALTER TABLE public.race_registration_contacts ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now()`);
      await tx.unsafe(`DO $$ BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM pg_constraint WHERE conname = 'race_registration_contacts_registration_id_fkey'
        ) THEN
          ALTER TABLE public.race_registration_contacts
            ADD CONSTRAINT race_registration_contacts_registration_id_fkey
            FOREIGN KEY (registration_id) REFERENCES public.race_registrations(id) ON DELETE CASCADE;
        END IF;
      END $$`);
      await tx.unsafe(`GRANT SELECT, INSERT, UPDATE, DELETE ON public.race_registration_contacts TO authenticated`);
      await tx.unsafe(`GRANT ALL ON public.race_registration_contacts TO service_role`);
      await tx.unsafe(`ALTER TABLE public.race_registration_contacts ENABLE ROW LEVEL SECURITY`);
      await tx.unsafe(`DROP POLICY IF EXISTS "Registration contacts readable by runner or staff" ON public.race_registration_contacts`);
      await tx.unsafe(`CREATE POLICY "Registration contacts readable by runner or staff" ON public.race_registration_contacts FOR SELECT TO authenticated USING (
        public.has_role(auth.uid(), 'admin'::public.app_role)
        OR EXISTS (
          SELECT 1 FROM public.race_registrations rr
          JOIN public.races r ON r.id = rr.race_id
          WHERE rr.id = race_registration_contacts.registration_id
          AND (rr.runner_id = auth.uid() OR r.organizer_id = auth.uid())
        )
      )`);
      await tx.unsafe(`DROP POLICY IF EXISTS "Registration contacts writable by runner or staff" ON public.race_registration_contacts`);
      await tx.unsafe(`CREATE POLICY "Registration contacts writable by runner or staff" ON public.race_registration_contacts FOR ALL TO authenticated USING (
        public.has_role(auth.uid(), 'admin'::public.app_role)
        OR EXISTS (
          SELECT 1 FROM public.race_registrations rr
          JOIN public.races r ON r.id = rr.race_id
          WHERE rr.id = race_registration_contacts.registration_id
          AND (rr.runner_id = auth.uid() OR r.organizer_id = auth.uid())
        )
      ) WITH CHECK (
        public.has_role(auth.uid(), 'admin'::public.app_role)
        OR EXISTS (
          SELECT 1 FROM public.race_registrations rr
          JOIN public.races r ON r.id = rr.race_id
          WHERE rr.id = race_registration_contacts.registration_id
          AND (rr.runner_id = auth.uid() OR r.organizer_id = auth.uid())
        )
      )`);
      await tx.unsafe(`DROP TRIGGER IF EXISTS update_race_registration_contacts_updated_at ON public.race_registration_contacts`);
      await tx.unsafe(`CREATE TRIGGER update_race_registration_contacts_updated_at BEFORE UPDATE ON public.race_registration_contacts FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column()`);
      await tx.unsafe(`NOTIFY pgrst, 'reload schema'`);
    });
  });
}


async function ensureRaceOrganizersSchema() {
  await withSql(async (sql) => {
    const rows = await sql`
      SELECT to_regclass('public.race_organizers') AS race_t, to_regclass('public.event_organizers') AS event_t
    `;
    if (rows[0]?.race_t && rows[0]?.event_t) return;
    await sql.begin(async (tx) => {
      await tx.unsafe(`CREATE TABLE IF NOT EXISTS public.race_organizers (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        race_id uuid NOT NULL REFERENCES public.races(id) ON DELETE CASCADE,
        user_id uuid NOT NULL,
        role text NOT NULL DEFAULT 'organisateur',
        created_by uuid,
        created_at timestamptz NOT NULL DEFAULT now()
      )`);
      await tx.unsafe(`ALTER TABLE public.race_organizers ADD COLUMN IF NOT EXISTS role text NOT NULL DEFAULT 'organisateur'`);
      await tx.unsafe(`ALTER TABLE public.race_organizers ADD COLUMN IF NOT EXISTS created_by uuid`);
      await tx.unsafe(`ALTER TABLE public.race_organizers ADD COLUMN IF NOT EXISTS created_at timestamptz NOT NULL DEFAULT now()`);
      await tx.unsafe(`CREATE UNIQUE INDEX IF NOT EXISTS race_organizers_race_user_key ON public.race_organizers(race_id, user_id)`);
      await tx.unsafe(`GRANT SELECT, INSERT, UPDATE, DELETE ON public.race_organizers TO authenticated`);
      await tx.unsafe(`GRANT ALL ON public.race_organizers TO service_role`);
      await tx.unsafe(`ALTER TABLE public.race_organizers ENABLE ROW LEVEL SECURITY`);
      await tx.unsafe(`DROP POLICY IF EXISTS "Race organizers readable by staff" ON public.race_organizers`);
      await tx.unsafe(`CREATE POLICY "Race organizers readable by staff" ON public.race_organizers FOR SELECT TO authenticated USING (
        public.has_role(auth.uid(), 'admin'::public.app_role)
        OR user_id = auth.uid()
        OR EXISTS (SELECT 1 FROM public.races r WHERE r.id = race_organizers.race_id AND r.organizer_id = auth.uid())
      )`);
      await tx.unsafe(`DROP POLICY IF EXISTS "Race organizers writable by owner or admin" ON public.race_organizers`);
      await tx.unsafe(`CREATE POLICY "Race organizers writable by owner or admin" ON public.race_organizers FOR ALL TO authenticated USING (
        public.has_role(auth.uid(), 'admin'::public.app_role)
        OR EXISTS (SELECT 1 FROM public.races r WHERE r.id = race_organizers.race_id AND r.organizer_id = auth.uid())
      ) WITH CHECK (
        public.has_role(auth.uid(), 'admin'::public.app_role)
        OR EXISTS (SELECT 1 FROM public.races r WHERE r.id = race_organizers.race_id AND r.organizer_id = auth.uid())
      )`);
      await tx.unsafe(`CREATE TABLE IF NOT EXISTS public.event_organizers (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        event_id uuid NOT NULL REFERENCES public.events(id) ON DELETE CASCADE,
        user_id uuid NOT NULL,
        role text NOT NULL DEFAULT 'organisateur',
        created_by uuid,
        created_at timestamptz NOT NULL DEFAULT now()
      )`);
      await tx.unsafe(`CREATE UNIQUE INDEX IF NOT EXISTS event_organizers_event_user_key ON public.event_organizers(event_id, user_id)`);
      await tx.unsafe(`GRANT SELECT, INSERT, UPDATE, DELETE ON public.event_organizers TO authenticated`);
      await tx.unsafe(`GRANT ALL ON public.event_organizers TO service_role`);
      await tx.unsafe(`ALTER TABLE public.event_organizers ENABLE ROW LEVEL SECURITY`);
      await tx.unsafe(`DROP POLICY IF EXISTS "Event organizers readable by staff" ON public.event_organizers`);
      await tx.unsafe(`CREATE POLICY "Event organizers readable by staff" ON public.event_organizers FOR SELECT TO authenticated USING (
        public.has_role(auth.uid(), 'admin'::public.app_role)
        OR user_id = auth.uid()
        OR EXISTS (SELECT 1 FROM public.events e WHERE e.id = event_organizers.event_id AND e.organizer_id = auth.uid())
      )`);
      await tx.unsafe(`DROP POLICY IF EXISTS "Event organizers writable by owner or admin" ON public.event_organizers`);
      await tx.unsafe(`CREATE POLICY "Event organizers writable by owner or admin" ON public.event_organizers FOR ALL TO authenticated USING (
        public.has_role(auth.uid(), 'admin'::public.app_role)
        OR EXISTS (SELECT 1 FROM public.events e WHERE e.id = event_organizers.event_id AND e.organizer_id = auth.uid())
      ) WITH CHECK (
        public.has_role(auth.uid(), 'admin'::public.app_role)
        OR EXISTS (SELECT 1 FROM public.events e WHERE e.id = event_organizers.event_id AND e.organizer_id = auth.uid())
      )`);
      await tx.unsafe(`CREATE OR REPLACE FUNCTION public.is_race_admin(_race_id uuid, _user_id uuid)
        RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
        SELECT EXISTS (
          SELECT 1 FROM public.races r WHERE r.id = _race_id AND r.organizer_id = _user_id
        ) OR EXISTS (
          SELECT 1 FROM public.race_organizers o WHERE o.race_id = _race_id AND o.user_id = _user_id
        ) OR EXISTS (
          SELECT 1 FROM public.races r
          JOIN public.events e ON e.id = r.event_id
          WHERE r.id = _race_id AND e.organizer_id = _user_id
        ) OR EXISTS (
          SELECT 1 FROM public.races r
          JOIN public.event_organizers eo ON eo.event_id = r.event_id
          WHERE r.id = _race_id AND eo.user_id = _user_id
        ) OR public.has_role(_user_id, 'admin'::public.app_role)
      $$`);
      await tx.unsafe(`NOTIFY pgrst, 'reload schema'`);
    });
  });
}

async function ensureEventOrganizersTableExists() {
  await withSql(async (sql) => {
    const rows = await sql`SELECT to_regclass('public.event_organizers') AS r`;
    if (rows[0]?.r) return;
    raceOrganizersSchemaReady = null;
  });
  await ensureRaceOrganizersSchemaOnce();
}

let registrationContactsSchemaReady: Promise<void> | null = null;
let raceOrganizersSchemaReady: Promise<void> | null = null;

async function ensureRegistrationContactsSchemaOnce() {
  if (!registrationContactsSchemaReady) {
    registrationContactsSchemaReady = ensureRegistrationContactsSchema().catch((error) => {
      registrationContactsSchemaReady = null;
      throw error;
    });
  }
  await registrationContactsSchemaReady;
}

async function ensureRaceOrganizersSchemaOnce() {
  if (!raceOrganizersSchemaReady) {
    raceOrganizersSchemaReady = ensureRaceOrganizersSchema().catch((error) => {
      raceOrganizersSchemaReady = null;
      throw error;
    });
  }
  await raceOrganizersSchemaReady;
}


Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const authHeader = req.headers.get("Authorization") ?? "";
    const userClient = createClient(supabaseUrl, anonKey, { global: { headers: { Authorization: authHeader } } });
    const admin = createClient(supabaseUrl, serviceKey);

    const { data: { user } } = await userClient.auth.getUser();
    if (!user) return json({ error: "Connexion requise" }, 401);

    const parsed = BodySchema.safeParse(await req.json().catch(() => ({})));
    if (!parsed.success) return json({ error: "Données invalides", details: parsed.error.flatten().fieldErrors }, 400);
    const body = parsed.data;
    await ensureRaceOrganizersSchemaOnce();
    await requireRaceAdmin(admin, user.id, body.race_id);
    await ensureRegistrationContactsSchemaOnce();

    if (body.action === "load") return json(await loadRace(admin, body.race_id));

    if (body.action === "save_gmcap") {
      const { data: existing } = await admin.from("gmcap_import_sources").select("id").eq("race_id", body.race_id).maybeSingle();
      const payload = { race_id: body.race_id, source_url: body.source_url, source_type: "url", enabled: body.enabled, pending_content: null, pending_import_at: null, updated_at: new Date().toISOString() };
      const result = existing
        ? await admin.from("gmcap_import_sources").update(payload).eq("id", existing.id)
        : await admin.from("gmcap_import_sources").insert(payload);
      if (result.error) throw new Error(result.error.message);
      return json({ ok: true, ...(await loadRace(admin, body.race_id)) });
    }

    if (body.action === "sync_gmcap") {
      return json({ ok: true, message: "La synchronisation se lance depuis l’interface course avec le moteur GMCAP existant." });
    }

    if (body.action === "update_registration") {
      const { error } = await admin.from("race_registrations").update({
        bib_number: body.bib_number,
        category: body.category || null,
        updated_at: new Date().toISOString(),
      }).eq("id", body.registration_id).eq("race_id", body.race_id);
      if (error) throw new Error(error.message);
      const phone = body.emergency_phone || null;
      const address = body.address || null;
      if (phone || address) {
        await upsertRegistrationContact(body.registration_id, phone, address);
      } else {
        await deleteRegistrationContact(body.registration_id);
      }
      return json({ ok: true, ...(await loadRace(admin, body.race_id)) });
    }

    if (body.action === "delete_registration") {
      const { error } = await admin.from("race_registrations").delete().eq("id", body.registration_id).eq("race_id", body.race_id);
      if (error) throw new Error(error.message);
      return json({ ok: true, ...(await loadRace(admin, body.race_id)) });
    }

    if (body.action === "delete_all_registrations") {
      const { data: regs, error: regsError } = await admin.from("race_registrations").select("id").eq("race_id", body.race_id);
      if (regsError) throw new Error(regsError.message);
      const ids = (regs ?? []).map((r: { id: string }) => r.id);
      if (ids.length) {
        await deleteRegistrationContacts(ids);
      }
      const { error: delError, count } = await admin.from("race_registrations").delete({ count: "exact" }).eq("race_id", body.race_id);
      if (delError) throw new Error(delError.message);
      return json({ ok: true, deleted: count ?? ids.length, ...(await loadRace(admin, body.race_id)) });
    }

    if (body.action === "add_registration") {
      const userId = await findUserByEmail(admin, body.email);
      if (!userId) return json({ error: `Aucun compte trouvé pour ${body.email}. Demandez à la personne de créer un compte ou utilisez l'import en masse pour le créer automatiquement.` }, 404);
      const { data: inserted, error } = await admin.from("race_registrations").upsert({
        race_id: body.race_id,
        runner_id: userId,
        bib_number: body.bib_number,
        category: body.category || null,
      }, { onConflict: "race_id,runner_id" }).select("id").single();
      if (error) throw new Error(error.message);
      if ((body.emergency_phone || body.address) && inserted?.id) {
        await upsertRegistrationContact(inserted.id, body.emergency_phone || null, body.address || null);
      }
      if (body.gender) {
        await admin.from("gmcap_results").upsert({
          race_id: body.race_id,
          bib_number: body.bib_number,
          gender: body.gender,
        }, { onConflict: "race_id,bib_number" });
      }
      return json({ ok: true, ...(await loadRace(admin, body.race_id)) });
    }


    if (body.action === "bulk_import_registrations") {
      const parsedRunners = parseRunnerImport(body.content);
      const runners = parsedRunners.filter((runner) => runner.email && runner.bib_number && runner.first_name && runner.last_name);
      if (!runners.length) return json({ error: "Aucun coureur valide trouvé : email, nom, prénom et dossard sont requis." }, 400);
      if (runners.length > 1000) return json({ error: "Import limité à 1000 coureurs par fichier." }, 400);

      // Détection des doublons de dossards dans le fichier
      const bibCounts = new Map<string, { count: number; emails: string[] }>();
      for (const runner of runners) {
        const bib = String(runner.bib_number).trim();
        const entry = bibCounts.get(bib) ?? { count: 0, emails: [] };
        entry.count += 1;
        entry.emails.push(runner.email);
        bibCounts.set(bib, entry);
      }
      const duplicateBibs: string[] = [];
      const duplicateBibSet = new Set<string>();
      for (const [bib, info] of bibCounts.entries()) {
        if (info.count > 1) {
          duplicateBibs.push(`Dossard #${bib} en doublon dans le fichier (${info.count} fois : ${info.emails.join(", ")})`);
          duplicateBibSet.add(bib);
        }
      }

      // Détection des dossards déjà utilisés dans la course par un autre coureur
      const { data: existingRegs } = await admin
        .from("race_registrations")
        .select("bib_number, runner_id, profiles:runner_id(email)")
        .eq("race_id", body.race_id);
      const existingBibToRunner = new Map<string, { runner_id: string; email?: string }>();
      for (const row of existingRegs ?? []) {
        const bib = String((row as { bib_number: string }).bib_number).trim();
        const email = (row as { profiles?: { email?: string } | { email?: string }[] }).profiles;
        const emailValue = Array.isArray(email) ? email[0]?.email : email?.email;
        existingBibToRunner.set(bib, { runner_id: (row as { runner_id: string }).runner_id, email: emailValue });
      }

      let created = 0;
      let updated = 0;
      let registered = 0;
      const errors: string[] = [...duplicateBibs];
      // Suivi des dossards à importer pour vérifier les conflits avec coureurs déjà inscrits
      for (const runner of runners) {
        const bib = String(runner.bib_number).trim();
        if (duplicateBibSet.has(bib)) {
          // On n'importe pas les doublons internes au fichier
          continue;
        }
        const existing = existingBibToRunner.get(bib);
        if (existing && existing.email && existing.email.toLowerCase() !== runner.email.toLowerCase()) {
          errors.push(`Dossard #${bib} déjà attribué à ${existing.email} dans cette course (conflit avec ${runner.email})`);
          continue;
        }
        try {
          let { data: profile } = await admin.from("profiles").select("user_id").ilike("email", runner.email).maybeSingle();
          if (!profile?.user_id) {
            const { data: createdUser, error: userError } = await admin.auth.admin.createUser({
              email: runner.email,
              password: randomPassword(),
              email_confirm: true,
              user_metadata: { first_name: runner.first_name, last_name: runner.last_name, birth_date: runner.birth_date, phone: runner.phone },
            });
            if (userError || !createdUser.user) throw new Error(userError?.message ?? "Création utilisateur impossible");
            profile = { user_id: createdUser.user.id };
            created += 1;
          } else {
            updated += 1;
          }

          const { error: profileError } = await admin.from("profiles").upsert({
            user_id: profile.user_id,
            email: runner.email,
            first_name: runner.first_name,
            last_name: runner.last_name,
            birth_date: runner.birth_date,
            phone: runner.phone || null,
            updated_at: new Date().toISOString(),
          }, { onConflict: "user_id" });
          if (profileError) throw new Error(profileError.message);

          await admin.from("user_roles").upsert({ user_id: profile.user_id, role: "runner" }, { onConflict: "user_id,role" });
          const { data: regRow, error: registrationError } = await admin.from("race_registrations").upsert({
            race_id: body.race_id,
            runner_id: profile.user_id,
            bib_number: runner.bib_number,
            category: runner.category || null,
            updated_at: new Date().toISOString(),
          }, { onConflict: "race_id,runner_id" }).select("id").single();
          if (registrationError) throw new Error(registrationError.message);
          if ((runner.phone || runner.address) && regRow?.id) {
            await upsertRegistrationContact(regRow.id, runner.phone || null, runner.address || null);
          }


          // Persist sexe + identité dans gmcap_results pour qu'ils s'affichent même sans import GMCAP
          if (runner.gender || runner.first_name || runner.last_name || runner.birth_date || runner.phone) {
            await admin.from("gmcap_results").upsert({
              race_id: body.race_id,
              bib_number: runner.bib_number,
              first_name: runner.first_name || null,
              last_name: runner.last_name || null,
              gender: runner.gender || null,
              birth_date: runner.birth_date || null,
              phone: runner.phone || null,
            }, { onConflict: "race_id,bib_number" });
          }
          registered += 1;
        } catch (error) {
          errors.push(`${runner.bib_number || "?"} ${runner.email || runner.last_name}: ${(error as Error).message}`);
        }
      }
      return json({ ok: true, created, updated, registered, skipped: parsedRunners.length - runners.length, duplicate_bibs: Array.from(duplicateBibSet), errors: errors.slice(0, 50), ...(await loadRace(admin, body.race_id)) });
    }

    if (body.action === "add_organizer") {
      const userId = await findUserByEmail(admin, body.email);
      if (!userId) return json({ error: `Aucun compte trouvé pour ${body.email}. La personne doit d'abord créer un compte sur l'application.` }, 404);
      const [{ error: organizerError }, { error: roleError }] = await Promise.all([
        admin.from("race_organizers").upsert({ race_id: body.race_id, user_id: userId, created_by: user.id }, { onConflict: "race_id,user_id" }),
        admin.from("user_roles").upsert({ user_id: userId, role: "organizer" }, { onConflict: "user_id,role" }),
      ]);
      if (organizerError || roleError) throw new Error(organizerError?.message ?? roleError?.message);
      return json({ ok: true, ...(await loadRace(admin, body.race_id)) });
    }

    if (body.action === "remove_organizer") {
      const { data: race } = await admin.from("races").select("organizer_id").eq("id", body.race_id).single();
      if (race?.organizer_id === body.organizer_id) return json({ error: "Le propriétaire de la course ne peut pas être retiré" }, 400);
      const { error } = await admin.from("race_organizers").delete().eq("race_id", body.race_id).eq("user_id", body.organizer_id);
      if (error) throw new Error(error.message);
      return json({ ok: true, ...(await loadRace(admin, body.race_id)) });
    }

    return json({ error: "Action inconnue" }, 400);
  } catch (error) {
    const message = (error as Error).message || "Erreur administration";
    const status = message.includes("réservée aux organisateurs") || message.includes("Connexion requise") ? 403 : 500;
    return json({ error: message }, status);
  }
});
