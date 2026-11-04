import { expect } from 'vitest';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
export const RELOCATION_V33_HASHES = {
  furnished: 'e8eca3b51eb338b19f7c9f0749f1c3b94e31cb1fd72e47fd75833eadd2a302b2',
  sleeping: '21d2c4e473478093d216f2503f5269f241e8b38032e5de0eb275a7ae58bedefd',
  'during-meal': 'f7424fb738ecd0d9bfdc4b8ab64280694880350277a8844276d0a32416c68221',
};
export function relocationV33(name: keyof typeof RELOCATION_V33_HASHES = 'furnished') {
  const bytes = readFileSync(new URL(`./fixtures/voxel-v33-relocation-${name}.json`, import.meta.url));
  const proof = JSON.parse(readFileSync(new URL(`./fixtures/voxel-v33-relocation-${name}.provenance.json`, import.meta.url), 'utf8'));
  expect(createHash('sha256').update(bytes).digest('hex')).toBe(RELOCATION_V33_HASHES[name]);
  expect(proof.sha256).toBe(RELOCATION_V33_HASHES[name]);
  expect(proof.sourceCommit).toBe('3ffccf132fbeff1752704448923635862342147a');
  expect(proof.sourceManifestSha256).toBe('c3287ae4594737dabd9cfbd6eeb2b045a3cf5442e3d40f400ce49eddaa47ba7f');
  expect(proof.campaignScriptSha256).toBe('6e1bf10cbc9de177924b89b14822d7b6534795eafa66d79215486f31fb5db194');
  const data = JSON.parse(bytes.toString('utf8')); expect(data.version).toBe(33); return data;
}
