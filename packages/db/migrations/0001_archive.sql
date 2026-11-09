CREATE SCHEMA IF NOT EXISTS archive;

CREATE TABLE archive.sources (
  id text PRIMARY KEY,
  data jsonb NOT NULL CHECK (jsonb_typeof(data) = 'object'),
  CHECK ((data->>'id') IS NOT DISTINCT FROM id)
);
CREATE TABLE archive.persons (
  id text PRIMARY KEY,
  data jsonb NOT NULL CHECK (jsonb_typeof(data) = 'object'),
  CHECK ((data->>'id') IS NOT DISTINCT FROM id)
);
CREATE TABLE archive.places (
  id text PRIMARY KEY,
  data jsonb NOT NULL CHECK (jsonb_typeof(data) = 'object'),
  CHECK ((data->>'id') IS NOT DISTINCT FROM id)
);
CREATE TABLE archive.person_places (
  id text PRIMARY KEY,
  person_id text NOT NULL REFERENCES archive.persons(id),
  place_id text NOT NULL REFERENCES archive.places(id),
  data jsonb NOT NULL CHECK (jsonb_typeof(data) = 'object'),
  CHECK ((data->>'id') IS NOT DISTINCT FROM id),
  CHECK ((data->>'personId') IS NOT DISTINCT FROM person_id),
  CHECK ((data->>'placeId') IS NOT DISTINCT FROM place_id)
);
CREATE INDEX person_places_person_idx ON archive.person_places(person_id);
CREATE INDEX person_places_place_idx ON archive.person_places(place_id);
CREATE TABLE archive.materials (
  id text PRIMARY KEY,
  person_id text NOT NULL REFERENCES archive.persons(id),
  source_id text NOT NULL REFERENCES archive.sources(id),
  data jsonb NOT NULL CHECK (jsonb_typeof(data) = 'object'),
  CHECK ((data->>'id') IS NOT DISTINCT FROM id),
  CHECK ((data->>'personId') IS NOT DISTINCT FROM person_id),
  CHECK ((data->>'sourceId') IS NOT DISTINCT FROM source_id)
);
CREATE INDEX materials_person_idx ON archive.materials(person_id);
CREATE TABLE archive.issues (
  id text PRIMARY KEY,
  person_id text NOT NULL REFERENCES archive.persons(id),
  data jsonb NOT NULL CHECK (jsonb_typeof(data) = 'object'),
  CHECK ((data->>'personId') IS NOT DISTINCT FROM person_id)
);
CREATE TABLE archive.crosswalk (
  project text NOT NULL,
  external_id text NOT NULL,
  person_id text REFERENCES archive.persons(id),
  data jsonb NOT NULL CHECK (jsonb_typeof(data) = 'object'),
  PRIMARY KEY (project, external_id),
  CHECK ((data->>'project') IS NOT DISTINCT FROM project),
  CHECK ((data->>'externalId') IS NOT DISTINCT FROM external_id),
  CHECK ((data->>'personId') IS NOT DISTINCT FROM person_id)
);
