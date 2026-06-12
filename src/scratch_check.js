require('dotenv').config();
const supabase = require('./config/supabase');

async function test() {
  console.log('================= START DIAGNOSTIC =================');

  const campaignId = '56b03c38-57a9-4102-b959-d52d6f66718d';

  // 1. Get campaign
  const { data: campaign } = await supabase
    .from('campaigns')
    .select('*')
    .eq('id', campaignId)
    .single();

  console.log('Campaign:', campaign);

  // 2. Get campaign follow ups
  const { data: followUps } = await supabase
    .from('campaign_follow_ups')
    .select('*')
    .eq('campaign_id', campaignId);
  console.log('Follow Ups:', followUps);

  // 3. Get leads
  const { data: leads } = await supabase
    .from('campaign_leads')
    .select('*')
    .eq('campaign_id', campaignId);
  console.log('Leads in Campaign:', leads);

  if (leads && leads.length > 0) {
    for (const lead of leads) {
      const { data: leadData } = await supabase
        .from('leads_data')
        .select('*')
        .eq('id', lead.lead_data_id)
        .single();
      console.log(`Lead Data for lead ${lead.id}:`, leadData);
    }
  }

  console.log('================= END DIAGNOSTIC =================');
}

test().catch(console.error);
