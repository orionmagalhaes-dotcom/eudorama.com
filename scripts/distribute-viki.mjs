import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = process.env.VITE_SUPABASE_URL || 'https://mhiormzpctfoyjbrmxfz.supabase.co';
const SUPABASE_ANON_KEY = process.env.VITE_SUPABASE_ANON_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im1oaW9ybXpwY3Rmb3lqYnJteGZ6Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjU4NTkwNjUsImV4cCI6MjA4MTQzNTA2NX0.y5rfFm0XHsieEZ2fCDH6tq5sZI7mqo8V_tYbbkKWroQ';

const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

async function main() {
    console.log('Iniciando distribuição igualitária de clientes Viki...');

    const [credsRes, clientsRes] = await Promise.all([
        supabase.from('credentials').select('id,email,service,is_visible').ilike('service', '%viki%'),
        supabase.from('clients').select('id,phone_number,client_name,subscriptions,deleted,manual_credentials')
    ]);

    if (credsRes.error) throw credsRes.error;
    if (clientsRes.error) throw clientsRes.error;

    const vikiCreds = credsRes.data.filter(c => c.is_visible && !(c.email || '').toLowerCase().includes('demo'));
    console.log(`Credenciais Viki disponíveis: ${vikiCreds.length}`);
    vikiCreds.forEach((c, idx) => console.log(`  [${idx + 1}] ${c.email} (${c.id})`));

    const vikiClients = clientsRes.data.filter(c => {
        if (c.deleted) return false;
        const subsStr = JSON.stringify(c.subscriptions || []).toLowerCase();
        return subsStr.includes('viki');
    });

    console.log(`Total de clientes com Viki ativo: ${vikiClients.length}`);

    // Map existing counts
    const countsMap = new Map();
    vikiCreds.forEach(c => countsMap.set(c.id, 0));

    const unassigned = [];
    vikiClients.forEach(c => {
        const mc = c.manual_credentials || {};
        const existingCredId = mc['viki'] || mc['Viki Pass'] || mc['viki pass'];
        const valid = existingCredId && vikiCreds.find(cr => cr.id === existingCredId);
        if (valid) {
            countsMap.set(existingCredId, (countsMap.get(existingCredId) || 0) + 1);
        } else {
            unassigned.push(c);
        }
    });

    console.log(`Clientes já vinculados: ${vikiClients.length - unassigned.length}`);
    console.log(`Clientes a vincular: ${unassigned.length}`);

    // Shuffle unassigned to avoid order bias
    const shuffled = [...unassigned].sort(() => Math.random() - 0.5);

    let updatedCount = 0;
    for (const client of shuffled) {
        // Find credentials with min count
        let minCount = Infinity;
        vikiCreds.forEach(c => {
            const count = countsMap.get(c.id) || 0;
            if (count < minCount) minCount = count;
        });

        const candidates = vikiCreds.filter(c => (countsMap.get(c.id) || 0) === minCount);
        // Random choice among tied minimums (Rule 1)
        const chosen = candidates[Math.floor(Math.random() * candidates.length)];
        countsMap.set(chosen.id, (countsMap.get(chosen.id) || 0) + 1);

        const currentManual = client.manual_credentials || {};
        const nextManual = {
            ...currentManual,
            'viki': chosen.id,
            'Viki Pass': chosen.id
        };

        const { error } = await supabase.from('clients').update({ manual_credentials: nextManual }).eq('id', client.id);
        if (error) {
            console.error(`Erro ao vincular cliente ${client.id} (${client.phone_number}):`, error.message);
        } else {
            updatedCount++;
        }
    }

    console.log(`\n✅ Distribuição concluída com sucesso! ${updatedCount} clientes vinculados.`);
    console.log('\nDistribuição final por credencial:');
    vikiCreds.forEach((c, idx) => {
        console.log(`  Conta [${idx + 1}] ${c.email}: ${countsMap.get(c.id)} clientes`);
    });
}

main().catch(console.error);
