/**
 * Create (or reset the password of) an admin account:
 *
 *   ADMIN_EMAIL=owner@example.com ADMIN_PASSWORD='a long passphrase' npm run create-admin
 *
 * The password is read from the environment (never from argv, so it does not land in shell history
 * or the process list) and must satisfy the same password policy as customers.
 */
import { loadConfig } from '../server/config.js';
import { openDb, audit } from '../server/db.js';
import { loadPepper, makeHasher, checkPasswordPolicy } from '../server/security.js';
import { parse, email as emailRule } from '../server/validate.js';

const cfg = loadConfig();
const { email } = parse({ email: process.env.ADMIN_EMAIL }, { email: emailRule() });
const password = process.env.ADMIN_PASSWORD;
const name = process.env.ADMIN_NAME || 'Barbero Admin';
const bad = checkPasswordPolicy(password, { email, name });
if (bad) {
  console.error(`Password rejected: ${bad}`);
  process.exit(1);
}

const db = openDb(cfg);
const hasher = makeHasher({ iterations: cfg.pbkdf2Iterations, pepper: loadPepper(cfg) });
const hash = await hasher.hash(password);
const existing = db.prepare('SELECT id, role FROM users WHERE email = ?').get(email);
if (existing && existing.role !== 'admin') {
  console.error('That e-mail belongs to a customer account. Use a different e-mail for the admin.');
  process.exit(1);
}
if (existing) {
  db.prepare('UPDATE users SET pw_hash = ?, must_change = 0 WHERE id = ?').run(hash, existing.id);
  db.prepare('DELETE FROM sessions WHERE user_id = ?').run(existing.id);
  audit(db, existing.id, 'admin_password_reset', 'cli');
  console.log(`Password reset for admin ${email}.`);
} else {
  const id = db.prepare("INSERT INTO users (email, name, role, pw_hash, must_change, created_at) VALUES (?, ?, 'admin', ?, 0, ?)").run(email, name, hash, Date.now()).lastInsertRowid;
  audit(db, Number(id), 'admin_created', 'cli');
  console.log(`Admin ${email} created.`);
}
db.close();
