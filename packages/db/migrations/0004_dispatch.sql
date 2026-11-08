-- Durable handoff from committed submissions to the grading queue.
CREATE TABLE submission_dispatch (
  submission_id uuid PRIMARY KEY REFERENCES submissions(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now()
);
INSERT INTO submission_dispatch(submission_id) SELECT id FROM submissions WHERE status='queued' ON CONFLICT DO NOTHING;
