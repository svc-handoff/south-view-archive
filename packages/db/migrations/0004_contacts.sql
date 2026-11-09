-- Private contact data is a separate entity and never part of publication JSON.
CREATE TABLE community.contacts (
  submission_id text PRIMARY KEY REFERENCES community.submissions(id),
  private_name text NOT NULL,
  email text NOT NULL
);
INSERT INTO community.contacts (submission_id, private_name, email)
SELECT id, input->>'privateName', input->>'email'
FROM community.submissions
WHERE input ? 'privateName' AND input ? 'email';
UPDATE community.submissions SET input = input - 'privateName' - 'email';
