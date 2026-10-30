const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { scoreLead } = require('../src/services/leadPipeline/scoring');
const { isPersonalEmail, runPipeline } = require('../src/services/leadPipeline/pipeline');
const { ENTITY_CONFIG } = require('../src/services/leadPipeline/clientCategories');
const { toLeadsDataPayload } = require('../src/services/leadPipeline/leadsDataRepo');
const { PIPELINE_TO_LEADS_DATA } = require('../src/services/leadPipeline/leadsDataColumns');

describe('lead pipeline', () => {
  it('treats gmail as personal', () => {
    assert.equal(isPersonalEmail('ada@gmail.com'), true);
    assert.equal(isPersonalEmail('ada@eqaiesports.com'), false);
  });

  it('scores a matching venue title', () => {
    const config = ENTITY_CONFIG.EQAIESPORTS.categories.VENUE;
    const result = scoreLead(
      {
        job_title: 'General Manager',
        seniority: 'director',
        industry: 'Entertainment',
        location: 'Texas, United States',
        employee_count: 80,
      },
      config,
      ENTITY_CONFIG.EQAIESPORTS.default_locations
    );
    assert.ok(result.score >= 40);
    assert.match(result.fit_reason, /General Manager|Entertainment|Texas/);
  });

  it('saves only verified leads into the repo', async () => {
    const rows = [];
    const repo = {
      async findExisting() {
        return null;
      },
      async save(lead) {
        const row = { id: rows.length + 1, ...lead };
        rows.push(row);
        return { kind: 'inserted', row };
      },
    };

    const result = await runPipeline({
      people: [
        {
          id: '1',
          first_name: 'Ada',
          last_name: 'Lovelace',
          email: 'ada@example.com',
          email_status: 'verified',
          title: 'General Manager',
          organization: { name: 'Arena Co', primary_domain: 'arena.co', industry: 'Entertainment' },
        },
        {
          id: '2',
          first_name: 'Skip',
          last_name: 'Me',
          email: 'skip@gmail.com',
          email_status: 'verified',
          title: 'Owner',
        },
      ],
      campaignId: '11111111-1111-4111-8111-111111111111',
      leadType: 'CO_EVENT_COLLABORATOR',
      leadClass: 'LEAD-03',
      targetSegment: 'EQAIESPORTS | VENUE',
      categoryConfig: ENTITY_CONFIG.EQAIESPORTS.categories.VENUE,
      targetLocations: ENTITY_CONFIG.EQAIESPORTS.default_locations,
      repo,
      hunter: null,
    });

    assert.equal(result.stats.inserted, 1);
    assert.equal(result.stats.rejected_personal_email, 1);
    assert.equal(rows[0].email, 'ada@example.com');
    assert.equal(rows[0].email_verification_status, 'verified');
  });

  it('maps important Apollo fields onto leads_data columns', () => {
    const payload = toLeadsDataPayload({
      first_name: 'Ada',
      last_name: 'Lovelace',
      full_name: 'Ada Lovelace',
      job_title: 'General Manager',
      email: 'ada@arena.co',
      phone: '+15125550123',
      timezone: 'America/Chicago',
      linkedin_url: 'https://linkedin.com/in/ada',
      city: 'Austin',
      state: 'Texas',
      country: 'United States',
      company_name: 'Arena Co',
      company_domain: 'arena.co',
      company_city: 'Dallas',
      company_state: 'Texas',
      company_phone: '+12145550199',
      company_linkedin_url: 'https://linkedin.com/company/arena',
      industry: 'Entertainment',
      sub_industry: 'Venues',
      employee_count: 80,
      revenue_range: '$10M-$50M',
      company_headquarters: 'Dallas, Texas, United States',
      company_description: 'Live events',
      company_type: 'Privately Held',
      technologies: ['Salesforce'],
      apollo_person_id: 'p1',
      apollo_company_id: 'c1',
      source: 'apollo',
      lead_type: 'CO_EVENT_COLLABORATOR',
      lead_class: 'LEAD-03',
      target_segment: 'EQAIESPORTS | VENUE',
      fit_score: 72,
      fit_reason: 'Title match',
      metadata: { verification: { verified_by: 'hunter' } },
    });

    assert.equal(payload.phone, '+15125550123');
    assert.equal(payload.companyPhone, '+12145550199');
    assert.equal(payload.companyCity, 'Dallas');
    assert.equal(payload.compantyState, 'Texas');
    assert.equal(payload.companyLinkedin, 'https://linkedin.com/company/arena');
    assert.equal(payload.subIndustry, 'Venues');
    assert.equal(payload.companyDescription, 'Live events');
    assert.equal(payload.employees, '80');
    assert.equal(payload.fitScore, '72');
    assert.equal(payload.apolloPersonId, 'p1');
    assert.equal(payload.leadType, 'CO_EVENT_COLLABORATOR');
    assert.equal(payload.source, 'apollo');
    assert.deepEqual(payload.technologies, ['Salesforce']);
    assert.equal(payload.metadata.verification.verified_by, 'hunter');
    assert.equal(payload.notes, 'EQAIESPORTS | VENUE');
    assert.equal(PIPELINE_TO_LEADS_DATA.first_name, 'firstName');
    assert.equal(PIPELINE_TO_LEADS_DATA.linkedin_url, 'linkedin');
    assert.equal(PIPELINE_TO_LEADS_DATA.lead_class, 'fitTag');
    assert.equal(PIPELINE_TO_LEADS_DATA.target_segment, 'notes');
    assert.equal(PIPELINE_TO_LEADS_DATA.campaign_id, undefined);
  });
});
