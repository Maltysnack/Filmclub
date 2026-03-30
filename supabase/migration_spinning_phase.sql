-- Allow shortlist_rounds to have a 'spinning' phase for the spin wheel animation.
-- Writing this to the DB (not just broadcasting) ensures non-hosts who miss the
-- broadcast still sync to the spin screen via their Postgres subscription.

ALTER TABLE shortlist_rounds
  DROP CONSTRAINT IF EXISTS shortlist_rounds_phase_check,
  ADD CONSTRAINT shortlist_rounds_phase_check
    CHECK (phase IN ('nominate', 'veto', 'vote', 'spinning', 'complete'));
