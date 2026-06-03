// src/lib/supabaseClient.js
// Server-side Supabase client, used only for Storage (file uploads).
// Uses the SERVICE ROLE key — keep it on the server, never expose to the browser.
const { createClient } = require('@supabase/supabase-js');
const path = require('path');
const { v4: uuidv4 } = require('uuid');

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const BUCKET = process.env.SUPABASE_STORAGE_BUCKET || 'oms-uploads';

const supabase =
  SUPABASE_URL && SUPABASE_SERVICE_ROLE_KEY
    ? createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
        auth: { persistSession: false, autoRefreshToken: false },
      })
    : null;

function isStorageConfigured() {
  return Boolean(supabase);
}

// Upload an in-memory multer file to the Storage bucket.
// Returns { path, url } where `path` is what we persist in the DB.
async function uploadBuffer(file, prefix = '') {
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

module.exports = { supabase, BUCKET, isStorageConfigured, uploadBuffer };
