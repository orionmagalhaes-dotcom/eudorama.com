
import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = 'https://mhiormzpctfoyjbrmxfz.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im1oaW9ybXpwY3Rmb3lqYnJteGZ6Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjU4NTkwNjUsImV4cCI6MjA4MTQzNTA2NX0.y5rfFm0XHsieEZ2fCDH6tq5sZI7mqo8V_tYbbkKWroQ';

const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

async function findUser() {
    const { data, error } = await supabase
        .from('clients')
        .select('*')
        .like('phone_number', '%6789');

    if (error) {
        console.error('Error:', error);
        return;
    }

    console.log('Results:', JSON.stringify(data, null, 2));
}

findUser();
