// src/lib/supabaseClient.js
// Server-side Supabase client, used only for Storage (file uploads).
// Uses the SERVICE ROLE / secret key — keep it on the server, never expose it.
//
// The client is created LAZILY and defensively: a missing or malformed
// SUPABASE_URL must never crash the whole API at startup — it should only
// affect the file-upload endpoints.
const { createClient } = require('@supabase/supabase-js');
const path = require('path');
const { v4: uuidv4 } = require('uuid');

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const BUCKET = process.env.SUPABASE_STORAGE_BUCKET || 'oms-uploads';

let _client;
let _initialised = false;

function getClient() {
  if (!_initialised) {
    _initialised = true;
    if (SUPABASE_URL && SUPABASE_SERVICE_ROLE_KEY) {
      try {
        _client = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
          auth: { persistSession: false, autoRefreshToken: false },
        });
      } catch (err) {
        // e.g. invalid SUPABASE_URL — log and carry on without Storage.
        console.error('⚠️  Failed to initialise Supabase Storage client:', err.message);
        _client = null;
      }
    }
  }
  return _client;
}

function isStorageConfigured() {
  return Boolean(getClient());
}

// Upload an in-memory multer file to the Storage bucket.
// Returns { path, url } where `path` is what we persist in the DB.
async function uploadBuffer(file, prefix = '') {
  const supabase = getClient();
  if (!supabase) {
    throw new Error('Supabase Storage is not configured (set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY)');
  }
  const ext = path.extname(file.originalname || '');
  const objectPath = `${prefix}${uuidv4()}${ext}`;

  const { error } = await supabase.storage.from(BUCKET).upload(objectPath, file.buffer, {
    contentType: file.mimetype,
    upsert: false,
  });
  if (error) throw error;

  const { data } = supabase.storage.from(BUCKET).getPublicUrl(objectPath);
  return { path: objectPath, url: data.publicUrl };
}

// Public URL for a stored object (bucket must be public for this to resolve).
function publicUrl(objectPath) {
  if (!objectPath) return null;
  const client = getClient();
  if (client) { const { data } = client.storage.from(BUCKET).getPublicUrl(objectPath); return data && data.publicUrl; }
  if (SUPABASE_URL) return `${SUPABASE_URL}/storage/v1/object/public/${BUCKET}/${objectPath}`;
  return null;
}

// Delete an object from the bucket (frees storage). Best-effort.
async function removeObject(objectPath) {
  if (!objectPath) return;
  const client = getClient();
  if (!client) return;
  await client.storage.from(BUCKET).remove([objectPath]);
}

module.exports = { getClient, BUCKET, isStorageConfigured, uploadBuffer, publicUrl, removeObject };
