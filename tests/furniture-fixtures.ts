import { expect } from 'vitest';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';

export const FURNITURE_V32_HASHES = {
  furnished: '13d2f819a21f254132c1fb9fc311262312c2b5b30d857b3f1391b7d1be494e84',
  'during-meal': 'cb97b38ca75173c148627f1890266bf1effca352c71971ed627baa5de299f6eb',
  sleeping: 'ee0de7d0886835a1de2bbe7a739c2d65110842814d5a8f1d91c29ad6b1bbaf32',
};
export function furnitureV32(name: keyof typeof FURNITURE_V32_HASHES = 'furnished') {
  const bytes = readFileSync(new URL(`./fixtures/voxel-v32-furniture-${name}.json`, import.meta.url));
  const proof = JSON.parse(readFileSync(new URL(`./fixtures/voxel-v32-furniture-${name}.provenance.json`, import.meta.url), 'utf8'));
  expect(createHash('sha256').update(bytes).digest('hex')).toBe(FURNITURE_V32_HASHES[name]);
  expect(proof.sha256).toBe(FURNITURE_V32_HASHES[name]);
  expect(proof.sourceCommit).toBe('857a810b1ad73864c3c71d2d4c56a343e1981876');
  expect(proof.sourceArchiveSha256).toBe('4265f87ac9c31ea06bc786c733fef4395242483713ed4a1fd249c0df466c2dd4');
  const data = JSON.parse(bytes.toString('utf8')); expect(data.version).toBe(32); return data;
}
