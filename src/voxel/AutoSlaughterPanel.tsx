import { useEffect, useRef, useState } from 'react';
import { AUTO_SLAUGHTER_LIMITS, AUTO_SLAUGHTER_SPECIES, defaultAutoSlaughterPolicy,
  type AutoSlaughterLimit, type AutoSlaughterPolicy } from './autoSlaughter';
import { HUSBANDRY_RULES } from './husbandry';
import { ANIMAL_DEFS } from './wildlife';
import type { AnimalSpecies, VoxelSnapshot, WildAnimal } from './types';
import type { PenCommand } from './PenPanel';

const limitNames: Record<AutoSlaughterLimit, string> = {
  total: '总数', male: '成年雄性', female: '成年雌性', youngMale: '幼年雄性', youngFemale: '幼年雌性',
};
export type AutoSlaughterDraft = Record<AutoSlaughterLimit, string> & { allowPregnant: boolean };
const toDraft = (policy: AutoSlaughterPolicy): AutoSlaughterDraft => ({
  total: policy.total?.toString() ?? '', male: policy.male?.toString() ?? '', female: policy.female?.toString() ?? '',
  youngMale: policy.youngMale?.toString() ?? '', youngFemale: policy.youngFemale?.toString() ?? '', allowPregnant: policy.allowPregnant,
});
const validLimitText = (text: string) => text.trim() === '' || /^\d+$/.test(text.trim()) && Number(text) <= HUSBANDRY_RULES.maxAnimals;

/** Text inputs preserve invalid edits instead of coercing them into an unlimited quota. */
export function parseAutoSlaughterDraft(draft: AutoSlaughterDraft): AutoSlaughterPolicy | null {
  if (!AUTO_SLAUGHTER_LIMITS.every(key => validLimitText(draft[key]))) return null;
  return { ...Object.fromEntries(AUTO_SLAUGHTER_LIMITS.map(key => [key, draft[key].trim() === '' ? null : Number(draft[key])])) as
    Record<AutoSlaughterLimit, number | null>, allowPregnant: draft.allowPregnant };
}

function HerdPolicy({ species, snapshot: s, command, selectAnimal }: {
  species: AnimalSpecies; snapshot: VoxelSnapshot; command: PenCommand; selectAnimal: (animal: WildAnimal) => void;
}) {
  const policy = s.autoSlaughter[species], herd = s.autoSlaughterStatus.herds.find(item => item.species === species)!;
  const policyKey = JSON.stringify(policy), name = ANIMAL_DEFS[species].name;
  const [draft, setDraft] = useState(() => toDraft(policy)), [busy, setBusy] = useState(false), [message, setMessage] = useState('');
  const pending = useRef(false);
  useEffect(() => { setDraft(toDraft(policy)); setMessage(''); }, [policyKey]);
  const parsed = parseAutoSlaughterDraft(draft);
  const changed = parsed !== null && (AUTO_SLAUGHTER_LIMITS.some(key => parsed[key] !== policy[key]) || parsed.allowPregnant !== policy.allowPregnant);
  const apply = async () => {
    if (pending.current || !parsed || !changed) return;
    pending.current = true; setBusy(true); setMessage('');
    try {
      const result = await command({ type: 'autoSlaughter', species, policy: parsed });
      setMessage(result.ok ? '配额已应用。' : result.message);
    } catch { setMessage('未能应用配额，请重试。'); }
    finally { pending.current = false; setBusy(false); }
  };
  const selected = herd.selected.map(id => s.animals.find(animal => animal.id === id)).filter((animal): animal is WildAnimal => !!animal);
  return <form className="voxel-auto-slaughter-card" data-testid="auto-slaughter-policy" data-species={species}
    onSubmit={event => { event.preventDefault(); void apply(); }}>
    <fieldset disabled={busy}>
      <legend>{name}</legend>
      <p>殖民地存活 {herd.population} 只 · 自动待宰 {herd.selected.length} 只</p>
      <small>孕期保护 {herd.protectedPregnant} 只 · 放归中 {herd.releasing} 只；这两类不计入当前配额。</small>
      <div className="voxel-auto-slaughter-quotas">
        <span>分类</span><span>当前 / 生效上限</span><span>保留上限</span>
        {AUTO_SLAUGHTER_LIMITS.map(key => <div className="voxel-auto-slaughter-quota" key={key}>
          <label htmlFor={`auto-slaughter-${species}-${key}`}>{limitNames[key]}</label>
          <output aria-label={`${name} ${limitNames[key]} 当前与上限`}>{herd.counts[key]} / {policy[key] ?? '不限'}</output>
          <input id={`auto-slaughter-${species}-${key}`} aria-label={`${name} ${limitNames[key]} 保留上限`}
            type="text" inputMode="numeric" placeholder="不限" maxLength={3} value={draft[key]}
            aria-invalid={!validLimitText(draft[key])} onChange={event => { setDraft({ ...draft, [key]: event.target.value }); setMessage(''); }} />
        </div>)}
      </div>
      <label className="voxel-auto-slaughter-pregnancy"><input type="checkbox" checked={draft.allowPregnant}
        aria-label={`${name} 允许自动宰杀怀孕动物`} onChange={event => { setDraft({ ...draft, allowPregnant: event.target.checked }); setMessage(''); }} />允许自动宰杀怀孕动物</label>
      <small>{policy.allowPregnant ? '已生效：孕期动物计入配额；在当前处理的分类中，非孕期候选不足时才会选中。' : '已生效：保护怀孕动物，不计入配额。'}</small>
      {!parsed && <small role="alert" className="voxel-auto-slaughter-warning">上限须为 0–{HUSBANDRY_RULES.maxAnimals} 的整数，留空表示不限。</small>}
      {changed && <small className="voxel-auto-slaughter-warning">有未应用的修改；下方待宰名单仍按已生效配额计算。</small>}
      <div className="voxel-auto-slaughter-actions">
        <button type="submit" disabled={!parsed || !changed}>{busy ? '应用中…' : '应用配额'}</button>
        <button type="button" onClick={() => { setDraft(toDraft(defaultAutoSlaughterPolicy())); setMessage('已重置草稿；点击应用配额后生效。'); }}>重置为不限</button>
      </div>
    </fieldset>
    <small role="status" aria-live="polite">{message}</small>
    <details className="voxel-auto-slaughter-targets" open={herd.selected.length > 0}>
      <summary>当前自动待宰 · {herd.selected.length} 只</summary>
      {selected.length > 0 && <ul>{selected.map(animal => <li key={animal.id}>
        <button type="button" onClick={() => selectAnimal(animal)}>{animal.name}</button>
        <small>{animal.sex === 'male' ? '雄性' : '雌性'} · {animal.growth >= 1 ? '成年' : '幼年'}{animal.pregnancy ? ' · 怀孕' : ''}{animal.slaughter ? ' · 同时手动待宰' : ''}</small>
      </li>)}</ul>}
      {herd.selected.length > selected.length && <small>另有 {herd.selected.length - selected.length} 只当前不可定位的自动待宰动物。</small>}
      {herd.selected.length === 0 && <small>当前没有自动待宰目标。</small>}
    </details>
  </form>;
}

export function AutoSlaughterPanel({ snapshot, command, selectAnimal }: {
  snapshot: VoxelSnapshot; command: PenCommand; selectAnimal: (animal: WildAnimal) => void;
}) {
  return <div className="voxel-auto-slaughter-panel" data-testid="auto-slaughter-panel">
    <p>按物种设置数量上限，让饲养员宰杀超过配额的动物。默认全部不限，怀孕动物受保护。</p>
    <p>留空表示不限；0 表示该类一只不留。幼年包括幼崽。修改后点击“应用配额”才会生效。</p>
    <small>依次处理成年雌性、幼年雌性、成年雄性、幼年雄性上限，最后处理总数。每一类优先选择年长的非孕期动物；允许宰杀孕期动物时，在该类中最后才选孕期动物，并优先孕期较深的。分类顺序优先，因此雌性配额可能先于雄性配额选中孕期动物。</small>
    <small>所有配额都是数量上限，不保证最低留种数量；总数上限仍可使各类数量降到其分类上限以下。</small>
    {AUTO_SLAUGHTER_SPECIES.map(species => <HerdPolicy key={species} species={species} snapshot={snapshot} command={command} selectAnimal={selectAnimal} />)}
    <p>自动待宰会随出生、成长和种群变化重新计算。需要开启人物的「饲养」分工，饲养员实际走到动物身边执行；随后由「烹饪」分工将尸体搬到屠宰点加工。</p>
    <small>手动待宰独立保留。取消手动标记不会解除配额选中的自动待宰；调高配额也不会清除手动标记。</small>
  </div>;
}
