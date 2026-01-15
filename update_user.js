
import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = 'https://mhiormzpctfoyjbrmxfz.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im1oaW9ybXpwY3Rmb3lqYnJteGZ6Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjU4NTkwNjUsImV4cCI6MjA4MTQzNTA2NX0.y5rfFm0XHsieEZ2fCDH6tq5sZI7mqo8V_tYbbkKWroQ';

const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

async function updateToDemo() {
    const { data, error } = await supabase
        .from('clients')
        .update({ client_name: 'Demo', phone_number: '6789' }) // Ensuring identifier
        .eq('id', '4ffbef2c-8496-4238-9d0a-7b2537505799')
        .select();

    if (error) {
        console.error('Error:', error);
        return;
    }

    console.log('Update Successful:', JSON.stringify(data, null, 2));
}

updateToDemo();
