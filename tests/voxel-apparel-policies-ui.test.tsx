import type { ReactElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { ApparelPanel, WearApparel } from '../src/voxel/ApparelPanel';
import { ApparelPolicyPanel } from '../src/voxel/ApparelPolicyPanel';
import { APPAREL_KINDS, APPAREL_NAMES, makeApparel, QUALITY_NAMES } from '../src/voxel/apparel';
import { createDefaultApparelPolicies, initialApparelControl, type ApparelPoliciesState } from '../src/voxel/apparelPolicies';
import type { Pawn, VoxelCommand } from '../src/voxel/types';
import { VoxelSimulation } from '../src/voxel/world';

let initialPawn: Pawn;
beforeAll(() => { initialPawn = new VoxelSimulation(73129, { hilliness: 'flat' }, false, 2).pawns[0]; });
const command = vi.fn<(c: VoxelCommand) => void>();
const remove = vi.fn<(id: number) => void>();
function pawn(extra: Partial<Pawn> = {}): Pawn {
  return { ...structuredClone(initialPawn), name: '林禾', faction: 'colony', dead: false, downed: false,
    carriedBy: null, apparelTask: null, worn: [], apparelControl: initialApparelControl(0, 1), ...extra };
}
function panel(p: Pawn, policies = createDefaultApparelPolicies(), pawns = [p]) {
  return renderToStaticMarkup(<ApparelPanel pawn={p} remove={remove} policies={policies} pawns={pawns} command={command} />);
}
function elements(node: unknown): ReactElement<any>[] {
  if (!node || typeof node !== 'object') return [];
  if (Array.isArray(node)) return node.flatMap(elements);
  if (!('props' in node)) return [];
  const element = node as ReactElement<any>;
  return [element, ...elements(element.props.children)];
}
function button(html: string, label: string) {
  return html.match(new RegExp(`<button[^>]*>${label}</button>`))?.[0];
}

describe('apparel policy and forced wear UI without a browser', () => {
  it('exposes shared policy selection and a complete draft editor without changing the snapshot on render', () => {
    const p = pawn(), policies = createDefaultApparelPolicies(), before = structuredClone({ p, policies });
    const html = panel(p, policies);
    expect(html).toContain('aria-label="林禾 的穿衣政策"');
    expect(html).toContain('<option value="1" selected="">自由穿戴</option>');
    expect(html).toContain('手动管理'); expect(html).toContain('克隆为新政策');
    expect(html).toContain('保存政策'); expect(html).toContain('共享政策，保存后影响使用者：林禾');
    expect(html).toContain('aria-label="服装政策名称"'); expect(html).toContain('maxLength="40"');
    for (const kind of APPAREL_KINDS) expect(html).toContain(APPAREL_NAMES[kind]);
    expect((html.match(/type="checkbox"/g) ?? []).length).toBe(7);
    for (const quality of QUALITY_NAMES) expect(html).toContain(quality);
    for (const label of ['最低服装品质', '最高服装品质', '最低服装耐久百分比', '最高服装耐久百分比']) expect(html).toContain(`aria-label="${label}"`);
    expect({ p, policies }).toEqual(before);
  });

  it('keeps manual management explicit and explains stored candidates and seasonal warmth', () => {
    const p = pawn({ apparelControl: initialApparelControl(0) }), html = panel(p);
    expect(html).toContain('<option value="" selected="">手动管理</option>');
    expect(html).toContain('手动管理：由你安排穿脱衣物');
    expect(html).toContain('季节冷暖与防护'); expect(html).toContain('须已入库');
    expect(html).toContain('允许取用且能够到达'); expect(html).not.toContain('当前房温');
    expect(html).not.toContain('自动换装：先脱下');
  });

  it('marks forced worn garments and sends distinct single/all release commands', () => {
    const hat = makeApparel(100, 'tuque', 2), shirt = makeApparel(101, 'shirt', 2);
    const p = pawn({ worn: [hat, shirt], apparelControl: { ...initialApparelControl(0, 1), forcedIds: [hat.id] } });
    const html = panel(p);
    expect((html.match(/data-testid="forced-apparel"/g) ?? []).length).toBe(1);
    expect(html).toContain('aria-label="林禾 解除强制穿戴 无边帽"');
    expect(html).not.toContain('aria-label="林禾 解除强制穿戴 T恤"');
    const tree = elements(ApparelPanel({ pawn: p, remove, command }));
    tree.find(e => e.props['aria-label'] === '林禾 解除强制穿戴 无边帽')!.props.onClick();
    expect(command).toHaveBeenLastCalledWith({ type: 'apparelUnforce', pawnId: p.id, apparelId: hat.id });
    tree.find(e => e.props.children === '解除全部强制穿戴')!.props.onClick();
    expect(command).toHaveBeenLastCalledWith({ type: 'apparelUnforce', pawnId: p.id });
    expect(p.worn).toEqual([hat, shirt]);
  });

  it('separates automatic pending work from completed worn equipment and ordinary manual work', () => {
    const p = pawn({ apparelTask: { automatic: true, action: 'wear', apparelId: 300, stage: 'fetch', progress: 0 } });
    const html = panel(p);
    expect(html).toContain('data-automatic="true"'); expect(html).toContain('自动换装：正在取用或穿上衣物');
    expect(html).toContain('完成后更新装备'); expect(html).toContain('衣着 · 0 件');
    delete p.apparelTask!.automatic;
    expect(panel(p)).toContain('data-automatic="false"');
    expect(panel(p)).not.toContain('自动换装：正在');
  });

  it('blocks deleting the last or in-use policy while permitting an unused one', () => {
    const p = pawn(), policies = createDefaultApparelPolicies();
    expect(button(panel(p, policies), '删除政策')).toContain('disabled=""');
    policies.policies.push({ ...structuredClone(policies.policies[0]), id: 2, name: '外出' }); policies.nextId = 3;
    expect(button(panel(p, policies), '删除政策')).toContain('disabled=""');
    p.apparelControl.policyId = null;
    expect(button(panel(p, policies), '删除政策')).not.toContain('disabled');
    const another = pawn({ id: p.id + 1, name: '陈序' });
    expect(button(panel(p, policies, [p, another]), '删除政策')).toContain('disabled=""');
    expect(panel(p, policies, [p, another])).toContain('保存后影响使用者：陈序');
  });

  it('retains display but disables physical apparel orders for non-colonists and incapacitated pawns', () => {
    const hat = makeApparel(100, 'tuque', 2);
    for (const faction of ['raider', 'trader', 'prisoner'] as const) {
      const p = pawn({ faction, worn: [hat] }), html = panel(p);
      expect(html).toContain('无边帽'); expect(html).not.toContain('apparel-policy-controls');
      expect(elements(ApparelPanel({ pawn: p, remove })).find(e => e.props['aria-label'] === '林禾 脱下 无边帽')!.props.disabled).toBe(true);
    }
    for (const extra of [{ dead: true }, { downed: true }, { drafted: true }, { carriedBy: 20 }]) {
      const p = pawn({ ...extra, worn: [hat] });
      expect(elements(ApparelPanel({ pawn: p, remove })).find(e => e.props['aria-label'] === '林禾 脱下 无边帽')!.props.disabled).toBe(true);
    }
    const dead = panel(pawn({ dead: true }));
    expect(dead).toContain('aria-label="林禾 的穿衣政策" disabled=""');
    expect(button(dead, '保存政策')).toContain('disabled=""');
  });

  it('keeps policies with a dead pawn reference undeletable', () => {
    const p = pawn({ apparelControl: initialApparelControl(0) }), policies = createDefaultApparelPolicies();
    policies.policies.push({ ...structuredClone(policies.policies[0]), id: 2, name: '备用' }); policies.nextId = 3;
    const deceased = pawn({ id: p.id + 1, name: '陈序', dead: true });
    const html = panel(p, policies, [p, deceased]);
    expect(html).toContain('陈序（已死亡，保留引用）');
    expect(button(html, '删除政策')).toContain('disabled=""');
    expect(button(panel(p, policies, [p]), '删除政策')).not.toContain('disabled');
  });

  it('preserves the old ApparelPanel calling interface without policy props', () => {
    const p = pawn({ worn: [makeApparel(100, 'tuque', 2)] });
    const html = renderToStaticMarkup(<ApparelPanel pawn={p} remove={remove} />);
    expect(html).toContain('无边帽'); expect(html).toContain('脱下');
    expect(html).not.toContain('apparel-policy-controls');
  });

  it('disables drafted physical wear orders while retaining policy and forced-flag management', () => {
    const hat = makeApparel(100, 'tuque', 2);
    const p = pawn({ drafted: true, worn: [hat], apparelControl: { ...initialApparelControl(0, 1), forcedIds: [hat.id] } });
    const html = panel(p);
    const selector = html.match(/<select aria-label="林禾 的穿衣政策"[^>]*>/)?.[0];
    expect(selector).toBeDefined(); expect(selector).not.toContain('disabled');
    expect(button(html, '保存政策')).not.toContain('disabled');
    expect(button(html, '解除强制')).not.toContain('disabled');
    expect(button(html, '脱下')).toContain('disabled=""');
    const wear = renderToStaticMarkup(<WearApparel piece={hat} pawns={[p]} preferredPawnId={p.id} wear={() => {}} />);
    expect(wear).toContain('暂无可行动同伴'); expect(button(wear, '前往穿上')).toContain('disabled=""');
  });

  it('explains forced manual wear and only offers actionable colonists', () => {
    const p = pawn(), hat = makeApparel(100, 'tuque', 2);
    const others = (['raider', 'trader', 'prisoner'] as const).map((faction, i) => pawn({ id: 10 + i, name: faction, faction }));
    const html = renderToStaticMarkup(<WearApparel piece={hat} pawns={[p, ...others]} wear={() => {}} />);
    expect(html).toContain('强制穿戴，自动换装保留'); expect(html).toContain('可在衣着中解除');
    expect(html).toContain('林禾');
    for (const other of others) expect(html).not.toContain(`>${other.name}</option>`);
    const disabled = renderToStaticMarkup(<WearApparel piece={hat} pawns={[...others, pawn({ carriedBy: 19 }), pawn({ downed: true })]} wear={() => {}} />);
    expect(disabled).toContain('暂无可行动同伴'); expect(button(disabled, '前往穿上')).toContain('disabled=""');
  });

  it('supports forbidding all ordinary garments and validates reversed editor ranges', () => {
    const p = pawn(), policies = createDefaultApparelPolicies();
    policies.policies[0].allowedKinds = [];
    expect(panel(p, policies)).toContain('自动换装会脱下未强制保留的衣物');
    expect(button(panel(p, policies), '保存政策')).not.toContain('disabled');
    // Deliberate invalid editor data: SSR must not offer a save for a reversed range.
    policies.policies[0].minCondition = .9; policies.policies[0].maxCondition = .3;
    expect(panel(p, policies)).toContain('下限不能高于上限');
    expect(button(panel(p, policies), '保存政策')).toContain('disabled=""');
  });

  it('limits cloning at the shared policy capacity', () => {
    const p = pawn(), initial = createDefaultApparelPolicies().policies[0];
    const policies: ApparelPoliciesState = { nextId: 17, policies: Array.from({ length: 16 }, (_, i) => ({ ...structuredClone(initial), id: i + 1, name: `政策 ${i + 1}` })) };
    const html = renderToStaticMarkup(<ApparelPolicyPanel pawn={p} policies={policies} pawns={[p]} command={command} />);
    expect(button(html, '克隆为新政策')).toContain('disabled=""');
    expect(html).toContain('最多保留 16 份政策');
  });
});
