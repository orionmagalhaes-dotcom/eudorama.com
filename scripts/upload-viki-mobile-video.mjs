import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL =
  process.env.SUPABASE_URL ||
  process.env.VITE_SUPABASE_URL ||
  'https://mhiormzpctfoyjbrmxfz.supabase.co';

const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const SOURCE_PATH_ARG = process.argv[2];
const OBJECT_PATH_ARG = process.argv[3];
const BUCKET_NAME_ARG = process.argv[4];
const BUCKET_NAME = BUCKET_NAME_ARG || process.env.SUPABASE_VIDEO_BUCKET || 'public-media';
const OBJECT_PATH = OBJECT_PATH_ARG || process.env.SUPABASE_VIDEO_OBJECT_PATH || 'viki/como-conectar-no-celular.mp4';
const SOURCE_PATH = resolve(process.cwd(), SOURCE_PATH_ARG || 'public/media/viki/como-conectar-no-celular.mp4');

if (!SUPABASE_SERVICE_ROLE_KEY) {
  console.error('Defina SUPABASE_SERVICE_ROLE_KEY antes de executar o upload.');
  process.exit(1);
}

if (!existsSync(SOURCE_PATH)) {
  console.error(`Arquivo nao encontrado: ${SOURCE_PATH}`);
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

const { data: buckets, error: listError } = await supabase.storage.listBuckets();
if (listError) {
  console.error('Falha ao listar buckets:', listError.message);
  process.exit(1);
}

if (!(buckets || []).some((bucket) => bucket.name === BUCKET_NAME)) {
  const { error: createError } = await supabase.storage.createBucket(BUCKET_NAME, {
    public: true
  });

  if (createError) {
    console.error('Falha ao criar bucket:', createError.message);
    process.exit(1);
  }
}

const fileBuffer = readFileSync(SOURCE_PATH);
const { error: uploadError } = await supabase.storage
  .from(BUCKET_NAME)
  .upload(OBJECT_PATH, fileBuffer, {
    cacheControl: '31536000',
    contentType: 'video/mp4',
    upsert: true
  });

if (uploadError) {
  console.error('Falha no upload:', uploadError.message);
  process.exit(1);
}

const { data: publicData } = supabase.storage.from(BUCKET_NAME).getPublicUrl(OBJECT_PATH);
console.log(publicData.publicUrl);
