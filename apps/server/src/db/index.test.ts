import { describe, expect, it } from 'vitest';
import { assertNoDataLoss } from './index.js';

describe('assertNoDataLoss', () => {
  it('refuses a statement that deletes rows, naming it', () => {
    const statement = 'DELETE FROM `sounds`;';
    expect(() => assertNoDataLoss(['CREATE TABLE `a` (`id` text);', statement])).toThrow(
      statement,
    );
  });

  it('refuses a delete in any case and after leading spaces', () => {
    for (const statement of ['delete from sounds', 'Delete From mixes;', '  \n\tDELETE   FROM x']) {
      expect(() => assertNoDataLoss([statement]), statement).toThrow(statement);
    }
  });

  it('names every destructive statement', () => {
    expect(() => assertNoDataLoss(['delete from a', 'delete from b'])).toThrow(
      /delete from a.*delete from b/,
    );
  });

  it('accepts statements that keep the data', () => {
    expect(() =>
      assertNoDataLoss([
        'CREATE TABLE `images` (`key` text PRIMARY KEY NOT NULL);',
        'ALTER TABLE `mixes` ADD `crossfadeSec` real;',
        'INSERT INTO `__new_mixes` SELECT * FROM `mixes`;',
        'DROP TABLE `mixes`;',
        'PRAGMA foreign_keys=OFF;',
        'CREATE INDEX `deleted_idx` ON `sounds` (`deletedAt`);',
      ]),
    ).not.toThrow();
  });

  it('accepts an empty list', () => {
    expect(() => assertNoDataLoss([])).not.toThrow();
  });
});
