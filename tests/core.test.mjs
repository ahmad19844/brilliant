import test from 'node:test';
import assert from 'node:assert/strict';
import { openDatabase, migrateAndSeed } from '../server/db.mjs';
import { registerStudent, publishSubject } from '../server/exams.mjs';

function db() { const value = openDatabase(':memory:'); migrateAndSeed(value); return value; }

test('seeds the required five SS3 subjects and blocks incomplete publication', () => {
  const value = db();
  const subjects = value.prepare('SELECT name FROM subjects ORDER BY id').all().map(x => x.name);
  assert.deepEqual(subjects, ['Mathematics', 'English', 'Chemistry', 'Physics', 'Biology']);
  assert.throws(() => publishSubject(value, 1), /exactly 50/);
});

test('one BFIA number covers selected published subjects', () => {
  const value = db();
  value.prepare('UPDATE subjects SET published=1 WHERE id IN (1,2)').run();
  const student = registerStudent(value, { fullName: 'Amina Musa', gender: 'Female', subjectIds: [1, 2] });
  assert.equal(student.examNumber, 'BFIA001');
  assert.match(student.accessCode, /^\d{6}$/);
  assert.equal(value.prepare('SELECT COUNT(*) AS count FROM registration_subjects').get().count, 2);
});
