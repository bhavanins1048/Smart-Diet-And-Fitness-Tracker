USE smart_fitness_tracker;

ALTER TABLE users
  ADD COLUMN email VARCHAR(191) NULL AFTER name,
  ADD COLUMN password_hash VARCHAR(255) NULL AFTER email;

UPDATE users
SET
  email = CONCAT('demo', id, '@example.com'),
  password_hash = 'replace-this-by-registering-a-new-user'
WHERE email IS NULL;

ALTER TABLE users
  MODIFY email VARCHAR(191) NOT NULL,
  MODIFY password_hash VARCHAR(255) NOT NULL,
  ADD UNIQUE KEY uq_users_email (email);
