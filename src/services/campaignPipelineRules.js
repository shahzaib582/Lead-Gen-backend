/**
 * When true, bulk add / activation enqueue BullMQ template jobs and mail kickoff may run.
 */
function shouldAutoEnqueuePipeline(campaign) {
  return campaign?.status === 'active' && campaign?.run_mode === 'auto';
}

module.exports = { shouldAutoEnqueuePipeline };
