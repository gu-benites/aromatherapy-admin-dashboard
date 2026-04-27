import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';

const databaseUrl = process.env.DATABASE_URL;
const supabaseUrl = process.env.SUPABASE_URL?.replace(/\/+$/, '');
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const bucket = process.env.STORAGE_BUCKET || 'essential-oil-reports';

if (!databaseUrl || !supabaseUrl || !serviceRoleKey) {
  throw new Error('DATABASE_URL, SUPABASE_URL, and SUPABASE_SERVICE_ROLE_KEY are required');
}

function psql(sql) {
  return execFileSync('psql', [databaseUrl, '-At', '-v', 'ON_ERROR_STOP=1', '-c', sql], {
    encoding: 'utf8',
    maxBuffer: 1024 * 1024 * 20,
  }).trim();
}

function encodePath(path) {
  return path.split('/').map(encodeURIComponent).join('/');
}

function safeFilename(filename, id) {
  const clean = String(filename || `report-${id}.pdf`)
    .normalize('NFKD')
    .replace(/[^\w .()+-]/g, '_')
    .replace(/\s+/g, '-')
    .replace(/_+/g, '_')
    .replace(/^-+|-+$/g, '');

  return clean.toLowerCase().endsWith('.pdf') ? clean : `${clean}.pdf`;
}

async function fetchBuffer(url) {
  const response = await fetch(url, { redirect: 'follow' });
  if (!response.ok) {
    throw new Error(`download failed ${response.status} ${response.statusText}`);
  }

  const arrayBuffer = await response.arrayBuffer();
  return Buffer.from(arrayBuffer);
}

async function uploadPdf(path, buffer) {
  const uploadUrl = `${supabaseUrl}/storage/v1/object/${bucket}/${encodePath(path)}`;
  let lastError;

  for (let attempt = 1; attempt <= 5; attempt += 1) {
    const response = await fetch(uploadUrl, {
      method: 'POST',
      headers: {
        apikey: serviceRoleKey,
        Authorization: `Bearer ${serviceRoleKey}`,
        'Content-Type': 'application/pdf',
        'Cache-Control': '3600',
        'x-upsert': 'true',
      },
      body: buffer,
    });

    if (response.ok) {
      return;
    }

    const body = await response.text();
    lastError = new Error(`upload failed ${response.status} ${response.statusText}: ${body.slice(0, 500)}`);

    if (attempt < 5) {
      await new Promise((resolve) => setTimeout(resolve, attempt * 3000));
    }
  }

  throw lastError;
}

async function assertPublicUrl(url) {
  const response = await fetch(url, { method: 'HEAD', redirect: 'follow' });
  if (!response.ok) {
    throw new Error(`public URL check failed ${response.status} ${response.statusText}`);
  }
}

const records = JSON.parse(psql(`
  select coalesce(json_agg(row_to_json(t)), '[]'::json)::text
  from (
    select id, filename, file_url
    from public.essential_oil_reports
    where file_url is not null
    order by id
  ) t;
`));

const uploaded = [];

for (const record of records) {
  const filename = safeFilename(record.filename, record.id);
  const path = `reports/${record.id}/${filename}`;
  const sourceUrl = record.file_url;

  process.stdout.write(`report ${record.id}: download... `);
  const buffer = await fetchBuffer(sourceUrl);
  const sha256 = createHash('sha256').update(buffer).digest('hex');
  process.stdout.write(`${buffer.length} bytes, upload... `);

  await uploadPdf(path, buffer);

  const storageUrl = `${supabaseUrl}/storage/v1/object/public/${bucket}/${encodePath(path)}`;
  await assertPublicUrl(storageUrl);

  uploaded.push({
    id: record.id,
    storage_bucket: bucket,
    storage_path: path,
    storage_url: storageUrl,
    source_file_url: sourceUrl,
    file_sha256: sha256,
    file_size_bytes: buffer.length,
  });

  process.stdout.write('ok\n');
}

const manifestPath = '/tmp/essential-oil-report-storage-upload-manifest.json';
writeFileSync(manifestPath, JSON.stringify(uploaded, null, 2));

const payload = JSON.stringify(uploaded).replaceAll('$json$', '$ json $');
psql(`
  with uploaded as (
    select *
    from jsonb_to_recordset($json$${payload}$json$::jsonb) as x(
      id bigint,
      storage_bucket text,
      storage_path text,
      storage_url text,
      source_file_url text,
      file_sha256 text,
      file_size_bytes bigint
    )
  )
  update public.essential_oil_reports r
  set
    storage_bucket = uploaded.storage_bucket,
    storage_path = uploaded.storage_path,
    storage_url = uploaded.storage_url,
    source_file_url = uploaded.source_file_url,
    file_sha256 = uploaded.file_sha256,
    file_size_bytes = uploaded.file_size_bytes
  from uploaded
  where r.id = uploaded.id;
`);

console.log(`uploaded=${uploaded.length}`);
console.log(`manifest=${manifestPath}`);
