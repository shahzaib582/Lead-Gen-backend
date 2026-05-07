// services/campaignLeadService.js

const supabase = require('../config/supabase');
const AppError = require('../utils/AppError');

const {
  enqueueMailTemplateJob,
} = require('../jobs/mailTemplateJob');

const VALID_STATUSES = [
  'pending',
  'template_generated',
  'sent',
  'failed',
  'skipped',
];

// ─────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────

async function assertCampaignOwnership(
  userId,
  campaignId
) {
  const { data, error } =
    await supabase
      .from('campaigns')
      .select('*')
      .eq('id', campaignId)
      .eq('user_id', userId)
      .single();

  if (error || !data) {
    throw new AppError(
      'Campaign not found.',
      404
    );
  }

  return data;
}

// ─────────────────────────────────────────────────────────────
// Add Single Lead
// ─────────────────────────────────────────────────────────────

async function addLeadToCampaign(
  userId,
  campaignId,
  {
    lead_data_id,
    mail_template,
  }
) {
  const campaign =
    await assertCampaignOwnership(
      userId,
      campaignId
    );

  // ------------------------------------
  // Insert lead
  // ------------------------------------

  const { data, error } =
    await supabase
      .from('campaign_leads')
      .insert({
        user_id: userId,

        campaign_id: campaignId,

        lead_data_id:
          String(lead_data_id),

        mail_template:
          mail_template || null,

        status: 'pending',
      })
      .select()
      .single();

  if (error) {
    if (error.code === '23505') {
      throw new AppError(
        'This lead is already added to the campaign.',
        409
      );
    }

    throw new AppError(
      `Failed to add lead to campaign: ${error.message}`,
      500
    );
  }

  // ------------------------------------
  // Queue template generation
  // ------------------------------------

  if (campaign.status === 'active') {
    await enqueueMailTemplateJob({
      userId,
      campaignId,
      campaignLeadId: data.id,
    });
  }

  return data;
}

// ─────────────────────────────────────────────────────────────
// Bulk Add Leads
// ─────────────────────────────────────────────────────────────

async function bulkAddLeadsToCampaign(
  userId,
  campaignId,
  leads
) {
  const campaign =
    await assertCampaignOwnership(
      userId,
      campaignId
    );

  const rows = leads.map((l) => ({
    user_id: userId,

    campaign_id: campaignId,

    lead_data_id:
      String(l.lead_data_id),

    mail_template:
      l.mail_template || null,

    status: 'pending',
  }));

  const { data, error } =
    await supabase
      .from('campaign_leads')
      .upsert(rows, {
        onConflict:
          'campaign_id,lead_data_id',

        ignoreDuplicates: true,
      })
      .select();

  if (error) {
    throw new AppError(
      `Bulk insert failed: ${error.message}`,
      500
    );
  }

  // ------------------------------------
  // Queue template jobs
  // ------------------------------------

  if (campaign.status === 'active') {
    for (const lead of data || []) {
      await enqueueMailTemplateJob({
        userId,
        campaignId,
        campaignLeadId: lead.id,
      });
    }
  }

  const insertedIds = new Set(
    (data || []).map(
      (r) => r.lead_data_id
    )
  );

  const duplicates = leads
    .map((l) =>
      String(l.lead_data_id)
    )
    .filter(
      (id) => !insertedIds.has(id)
    );

  return {
    inserted: data || [],
    duplicates,

    totalInserted:
      (data || []).length,

    totalDuplicates:
      duplicates.length,
  };
}

// ─────────────────────────────────────────────────────────────
// Get Campaign Leads
// ─────────────────────────────────────────────────────────────

async function getCampaignLeads(
  userId,
  campaignId,
  {
    status,
    page = 1,
    limit = 20,
  } = {}
) {
  await assertCampaignOwnership(
    userId,
    campaignId
  );

  let query = supabase
    .from('campaign_leads')
    .select('*', {
      count: 'exact',
    })
    .eq('campaign_id', campaignId)
    .eq('user_id', userId)
    .order('created_at', {
      ascending: false,
    })
    .range(
      (page - 1) * limit,
      page * limit - 1
    );

  if (status) {
    query = query.eq(
      'status',
      status
    );
  }

  const {
    data,
    error,
    count,
  } = await query;

  if (error) {
    throw new AppError(
      'Failed to fetch campaign leads.',
      500
    );
  }

  return {
    leads: data,
    total: count,
    page,
    limit,
    totalPages: Math.ceil(
      count / limit
    ),
  };
}

// ─────────────────────────────────────────────────────────────
// Get Single Lead
// ─────────────────────────────────────────────────────────────

async function getCampaignLeadById(
  userId,
  campaignId,
  leadId
) {
  await assertCampaignOwnership(
    userId,
    campaignId
  );

  const { data, error } =
    await supabase
      .from('campaign_leads')
      .select('*')
      .eq('id', leadId)
      .eq(
        'campaign_id',
        campaignId
      )
      .eq('user_id', userId)
      .single();

  if (error || !data) {
    throw new AppError(
      'Campaign lead not found.',
      404
    );
  }

  return data;
}

// ─────────────────────────────────────────────────────────────
// Update Lead
// ─────────────────────────────────────────────────────────────

async function updateCampaignLead(
  userId,
  campaignId,
  leadId,
  updates
) {
  const existing =
    await getCampaignLeadById(
      userId,
      campaignId,
      leadId
    );

  const { data, error } =
    await supabase
      .from('campaign_leads')
      .update(updates)
      .eq('id', leadId)
      .eq(
        'campaign_id',
        campaignId
      )
      .eq('user_id', userId)
      .select()
      .single();

  if (error) {
    throw new AppError(
      'Failed to update campaign lead.',
      500
    );
  }

  // ------------------------------------
  // Mirror outreach status
  // ------------------------------------

  const MIRROR_STATUSES = {
    sent: 'contacted',
    failed: 'failed',
    skipped: 'skipped',
  };

  if (
    updates.status &&
    MIRROR_STATUSES[
      updates.status
    ]
  ) {
    const leadsDataUpdate = {
      outreachStatus:
        MIRROR_STATUSES[
          updates.status
        ],
    };

    if (
      updates.status === 'sent'
    ) {
      leadsDataUpdate.emailSent =
        'true';

      leadsDataUpdate.emailSentDate =
        updates.sent_at ||
        new Date().toISOString();
    }

    await supabase
      .from('leads_data')
      .update(leadsDataUpdate)
      .eq(
        'id',
        Number(
          existing.lead_data_id
        )
      );
  }

  return data;
}

// ─────────────────────────────────────────────────────────────
// Remove Lead
// ─────────────────────────────────────────────────────────────

async function removeCampaignLead(
  userId,
  campaignId,
  leadId
) {
  await getCampaignLeadById(
    userId,
    campaignId,
    leadId
  );

  const { error } =
    await supabase
      .from('campaign_leads')
      .delete()
      .eq('id', leadId)
      .eq(
        'campaign_id',
        campaignId
      )
      .eq('user_id', userId);

  if (error) {
    throw new AppError(
      'Failed to remove campaign lead.',
      500
    );
  }
}

// ─────────────────────────────────────────────────────────────
// Assign Random Leads
// ─────────────────────────────────────────────────────────────

async function assignRandomLeadsToCampaign(
  userId,
  campaignId
) {
  const campaign =
    await assertCampaignOwnership(
      userId,
      campaignId
    );

  const targetCount =
    campaign.target_leads;

  if (
    !targetCount ||
    targetCount <= 0
  ) {
    throw new AppError(
      'Campaign target_leads must be greater than 0.',
      400
    );
  }

  // Existing assigned leads
  const {
    data: existing,
  } = await supabase
    .from('campaign_leads')
    .select('lead_data_id')
    .eq(
      'campaign_id',
      campaignId
    );

  const excludedIds =
    (existing || [])
      .map((r) =>
        Number(r.lead_data_id)
      )
      .filter(
        (n) => !isNaN(n)
      );

  let idsQuery = supabase
    .from('leads_data')
    .select('id');

  const leadSource =
    campaign.lead_source ||
    'both';

  if (leadSource === 'new') {
    idsQuery = idsQuery.or(
      'outreachStatus.is.null,outreachStatus.eq.'
    );
  } else if (
    leadSource === 'old'
  ) {
    idsQuery = idsQuery
      .not(
        'outreachStatus',
        'is',
        null
      )
      .neq(
        'outreachStatus',
        ''
      );
  }

  if (
    excludedIds.length > 0
  ) {
    idsQuery = idsQuery.not(
      'id',
      'in',
      `(${excludedIds.join(',')})`
    );
  }

  const {
    data: allLeads,
    error: leadsError,
  } = await idsQuery;

  if (leadsError) {
    throw new AppError(
      leadsError.message,
      500
    );
  }

  if (
    !allLeads ||
    allLeads.length === 0
  ) {
    throw new AppError(
      'No available leads found.',
      404
    );
  }

  // Shuffle
  for (
    let i =
      allLeads.length - 1;
    i > 0;
    i--
  ) {
    const j = Math.floor(
      Math.random() *
        (i + 1)
    );

    [
      allLeads[i],
      allLeads[j],
    ] = [
      allLeads[j],
      allLeads[i],
    ];
  }

  const randomLeads =
    allLeads.slice(
      0,
      targetCount
    );

  const rows =
    randomLeads.map((l) => ({
      user_id: userId,

      campaign_id:
        campaignId,

      lead_data_id:
        String(l.id),

      status: 'pending',
    }));

  const {
    data: inserted,
    error: insertError,
  } = await supabase
    .from('campaign_leads')
    .upsert(rows, {
      onConflict:
        'campaign_id,lead_data_id',

      ignoreDuplicates: true,
    })
    .select();

  if (insertError) {
    throw new AppError(
      insertError.message,
      500
    );
  }

  // ------------------------------------
  // Queue template generation
  // ------------------------------------

  if (campaign.status === 'active') {
    for (const lead of inserted || []) {
      await enqueueMailTemplateJob({
        userId,
        campaignId,
        campaignLeadId: lead.id,
      });
    }
  }

  const insertedIds =
    new Set(
      (inserted || []).map(
        (r) => r.lead_data_id
      )
    );

  const duplicates =
    randomLeads
      .map((l) =>
        String(l.id)
      )
      .filter(
        (id) =>
          !insertedIds.has(id)
      );

  return {
    inserted:
      inserted || [],

    duplicates,

    totalRequested:
      targetCount,

    totalAvailable:
      randomLeads.length,

    totalInserted:
      (inserted || []).length,

    totalDuplicates:
      duplicates.length,

    leadSource,
  };
}

module.exports = {
  VALID_STATUSES,

  addLeadToCampaign,

  bulkAddLeadsToCampaign,

  getCampaignLeads,

  getCampaignLeadById,

  updateCampaignLead,

  removeCampaignLead,

  assignRandomLeadsToCampaign,
};