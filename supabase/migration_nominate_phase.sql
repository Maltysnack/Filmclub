-- Allow shortlist_rounds to have a 'nominate' phase before the main veto/vote flow.
-- This lets the host signal to all participants that a nomination round is starting
-- (via real-time INSERT) before any films are locked in.

ALTER TABLE shortlist_rounds
  DROP CONSTRAINT IF EXISTS shortlist_rounds_phase_check,
  ADD CONSTRAINT shortlist_rounds_phase_check
    CHECK (phase IN ('nominate', 'veto', 'vote', 'complete'));
