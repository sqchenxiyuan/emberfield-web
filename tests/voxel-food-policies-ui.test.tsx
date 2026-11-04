import type { ReactElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { FoodPolicyPanel, type FoodPolicyPanelProps } from '../src/voxel/FoodPolicyPanel';
import { FoodOrder } from '../src/voxel/FoodOrder';
import { createDefaultFoodPolicies, FOOD_POLICY_RESOURCES, type FoodPoliciesState } from '../src/voxel/foodPolicies';
import { RESOURCE_NAMES, type Pawn, type Stack, type VoxelCommand } from '../src/voxel/types';
import { VoxelSimulation } from '../src/voxel/world';

let initialPawn: Pawn;
beforeAll(() => { initialPawn = new VoxelSimulation(73129, { hilliness: 'flat' }, false, 2).pawns[0]; });
const command = vi.fn<(c: VoxelCommand) => void>();
beforeEach(() => command.mockClear());
function pawn(extra: Partial<Pawn> = {}): Pawn {
  return { ...structuredClone(initialPawn), name: '林禾', faction: 'colony', dead: false, downed: false,
    foodPolicyId: 1, ...extra };
}
function props(p = pawn(), policies = createDefaultFoodPolicies(), pawns = [p]): FoodPolicyPanelProps {
  return { pawn: p, policies, pawns, command };
}
function panel(p = pawn(), policies = createDefaultFoodPolicies(), pawns = [p]) {
  return renderToStaticMarkup(<FoodPolicyPanel {...props(p, policies, pawns)} />);
}
function elements(node: unknown): ReactElement<any>[] {
  if (Array.isArray(node)) return node.flatMap(elements);
  if (!node || typeof node !== 'object' || !('props' in node)) return [];
  const element = node as ReactElement<any>;
  return [element, ...elements(element.props.children)];
}
/** Capture the elements generated under React's server dispatcher, so command
 * handlers can be exercised without mounting a browser or DOM. */
function capture(render: () => ReactElement | null) {
  let tree: ReactElement | null = null;
  function Captured() { tree = render(); return tree; }
  const html = renderToStaticMarkup(<Captured />);
  return { html, elements: elements(tree) };
}
function capturedEditor(p: FoodPolicyPanelProps) {
  const outer = capture(() => FoodPolicyPanel(p));
  const editor = outer.elements.find(element => typeof element.type === 'function' && element.props.policy)!;
  return capture(() => (editor.type as (props: any) => ReactElement)(editor.props));
}
function button(html: string, label: string) {
  return html.match(new RegExp(`<button[^>]*>${label}</button>`))?.[0];
}
function twoPolicies(): FoodPoliciesState {
  const policies = createDefaultFoodPolicies();
  policies.policies.push({ id: 2, name: '储备口粮', allowedResources: ['food'] }); policies.nextId = 3;
  return policies;
}

describe('shared food policy controls rendered without a browser', () => {
  it('offers all seven physical food types and a shared editor without mutating the snapshot', () => {
    const p = pawn(), policies = createDefaultFoodPolicies(), before = structuredClone({ p, policies });
    const html = panel(p, policies);
    expect(html).toContain('aria-label="林禾 的饮食政策"');
    expect(html).toContain('<option value="1" selected="">不限制</option>');
    expect(html).toContain('aria-label="饮食政策名称"'); expect(html).toContain('maxLength="40"');
    expect(html).toContain('保存后影响使用者：林禾');
    expect(html).toContain('克隆为新饮食政策'); expect(html).toContain('保存饮食政策');
    expect(html.match(/type="checkbox"/g)).toHaveLength(7);
    expect(html.match(/checked=""/g)).toHaveLength(7);
    for (const resource of FOOD_POLICY_RESOURCES) expect(html).toContain(RESOURCE_NAMES[resource]);
    expect({ p, policies }).toEqual(before); expect(command).not.toHaveBeenCalled();
  });

  it('distinguishes an unrestricted pawn from a pawn using a shared unrestricted policy', () => {
    const html = panel(pawn({ foodPolicyId: null }));
    expect(html).toContain('<option value="" selected="">不限制（无共享政策）</option>');
    expect(html).toContain('不使用共享政策，允许所有食物类型');
    expect(html).not.toContain('按共享饮食政策选择食物');
    expect(panel()).toContain('按共享饮食政策选择食物');
  });

  it('explains eater policy, hunger, mental-state exceptions and meal ingredient limits', () => {
    const html = panel();
    expect(html).toContain('自行进食和同伴喂食遵守本人政策');
    expect(html).toContain('即使饥荒也不会解除限制'); expect(html).toContain('精神崩溃时忽略政策');
    expect(html).toContain('简餐不区分制作食材');
    expect(html).toContain('更改政策会取消不符合政策的取食或喂食安排，已携带的食物仍保留');
    expect(html).not.toContain('素食'); expect(html).not.toContain('禁肉成分');
  });

  it('lets prisoners use shared policies and explains the distinction between warden food and self feeding', () => {
    const p = pawn({ faction: 'prisoner', downed: true }), html = panel(p);
    expect(html).toContain('food-policy-controls');
    expect(html).toContain('狱卒供餐遵守囚犯政策；囚犯自己吃牢房食物时不受政策限制');
    expect(html).not.toContain('自行进食和同伴喂食遵守本人政策');
    expect(html.match(/<select aria-label="林禾 的饮食政策"[^>]*>/)?.[0]).not.toContain('disabled');
    expect(button(html, '保存饮食政策')).not.toContain('disabled');
    for (const faction of ['raider', 'trader'] as const) expect(panel(pawn({ faction }))).toBe('');
  });

  it('dispatches pawn assignment and cloning separately, preserving the original policy', () => {
    const p = pawn({ foodPolicyId: 2 }), policies = twoPolicies(), before = structuredClone({ p, policies });
    const tree = capture(() => FoodPolicyPanel(props(p, policies))).elements;
    const select = tree.find(e => e.props['aria-label'] === '林禾 的饮食政策')!;
    select.props.onChange({ target: { value: '' } });
    expect(command).toHaveBeenLastCalledWith({ type: 'pawnFoodPolicy', pawnId: p.id, policyId: null });
    select.props.onChange({ target: { value: '1' } });
    expect(command).toHaveBeenLastCalledWith({ type: 'pawnFoodPolicy', pawnId: p.id, policyId: 1 });
    command.mockClear();
    tree.find(e => e.props.children === '克隆为新饮食政策')!.props.onClick();
    expect(command).toHaveBeenCalledExactlyOnceWith({ type: 'foodPolicyCreate', sourceId: 2 });
    expect({ p, policies }).toEqual(before);
  });

  it('submits a normalized independent policy value and supports a deliberately empty allowed list', () => {
    const policies = createDefaultFoodPolicies(); policies.policies[0].name = '  保存口粮  '; policies.policies[0].allowedResources = [];
    const p = pawn(), before = structuredClone({ p, policies }), captured = capturedEditor(props(p, policies));
    expect(captured.html).toContain('此政策未允许任何食物');
    expect(captured.html).toContain('即使饥荒也不会解除限制');
    expect(button(captured.html, '保存饮食政策')).not.toContain('disabled');
    const preventDefault = vi.fn();
    captured.elements.find(e => e.type === 'form')!.props.onSubmit({ preventDefault });
    expect(preventDefault).toHaveBeenCalledOnce();
    expect(command).toHaveBeenCalledExactlyOnceWith({ type: 'foodPolicyUpdate', policy: { id: 1, name: '保存口粮', allowedResources: [] } });
    const saved = command.mock.calls[0][0];
    if (saved.type !== 'foodPolicyUpdate') throw new Error('wrong command');
    saved.policy.allowedResources.push('meal');
    expect({ p, policies }).toEqual(before);
  });

  it('blocks deleting the last policy and any referenced policy, including references from dead or foreign pawns', () => {
    const p = pawn({ foodPolicyId: null });
    expect(button(panel(p), '删除饮食政策')).toContain('disabled=""');
    const policies = twoPolicies();
    expect(button(panel(p, policies), '删除饮食政策')).not.toContain('disabled');
    for (const extra of [{}, { dead: true }, { faction: 'prisoner' as const }, { faction: 'trader' as const }]) {
      const other = pawn({ id: p.id + 1, name: '陈序', ...extra });
      const html = panel(p, policies, [p, other]);
      expect(button(html, '删除饮食政策')).toContain('disabled=""');
      expect(html).toContain(other.dead ? '陈序（已死亡，保留引用）' : '保存后影响使用者：陈序');
    }
    const tree = capturedEditor(props(p, policies)).elements;
    tree.find(e => e.props.children === '删除饮食政策')!.props.onClick();
    expect(command).toHaveBeenCalledExactlyOnceWith({ type: 'foodPolicyDelete', policyId: 1 });
  });

  it('keeps dead pawn policy information visible while preventing all policy changes', () => {
    for (const faction of ['colony', 'prisoner'] as const) {
      const p = pawn({ dead: true, faction }), html = panel(p);
      expect(html).toContain('aria-label="林禾 的饮食政策" disabled=""');
      expect(button(html, '克隆为新饮食政策')).toContain('disabled=""');
      expect(button(html, '保存饮食政策')).toContain('disabled=""');
      expect(button(html, '删除饮食政策')).toContain('disabled=""');
      capturedEditor(props(p)).elements.find(e => e.type === 'form')!.props.onSubmit({ preventDefault() {} });
    }
    expect(command).not.toHaveBeenCalled();
    for (const extra of [{ downed: true }, { drafted: true }, { carriedBy: 20 }]) {
      expect(button(panel(pawn(extra)), '保存饮食政策')).not.toContain('disabled');
    }
  });

  it('validates draft names before offering or dispatching a save', () => {
    for (const name of ['', '   ', 'a'.repeat(41), '不\n允许']) {
      const policies = createDefaultFoodPolicies(); policies.policies[0].name = name;
      const { html, elements: tree } = capturedEditor(props(pawn(), policies));
      expect(button(html, '保存饮食政策')).toContain('disabled=""');
      expect(html).toContain('请输入 1～40 个字符的政策名称');
      tree.find(e => e.type === 'form')!.props.onSubmit({ preventDefault() {} });
    }
    expect(command).not.toHaveBeenCalled();
  });

  it('renders selected allowed types and prevents cloning at the sixteen-policy limit', () => {
    const policies: FoodPoliciesState = { nextId: 17, policies: Array.from({ length: 16 }, (_, i) => ({ id: i + 1, name: `饮食 ${i + 1}`, allowedResources: ['meal', 'milk'] })) };
    const html = panel(pawn(), policies);
    expect(html.match(/type="checkbox"/g)).toHaveLength(7);
    expect(html.match(/checked=""/g)).toHaveLength(2);
    expect(button(html, '克隆为新饮食政策')).toContain('disabled=""');
    expect(html).toContain('最多保留 16 份饮食政策');
  });

  it('shows the current manual food order separately from the shared policy assignment', () => {
    const p = pawn({ manualFoodOrder: { sourceId: 72, resource: 'meal' } }), html = panel(p);
    expect(html).toContain('data-testid="manual-food-order"');
    expect(html).toContain(`手动食用中：${RESOURCE_NAMES.meal}`);
    expect(html).toContain('本次指令覆盖饮食政策，政策本身保持不变');
    expect(html).toContain('<option value="1" selected="">不限制</option>');
    delete p.manualFoodOrder;
    expect(panel(p)).not.toContain('data-testid="manual-food-order"');
  });
});

describe('ordered eating controls for physical ground food without a browser', () => {
  function food(extra: Partial<Stack> = {}): Stack {
    return { id: 72, x: 10, y: 10, z: 8, resource: 'meal', amount: 2, forbidden: false, ...extra };
  }

  it('offers an order for all seven food types, including forbidden stacks, without adding food or changing policies on render', () => {
    const p = pawn(), before = structuredClone(p);
    for (const resource of FOOD_POLICY_RESOURCES) {
      const item = food({ resource, forbidden: true }), oldItem = structuredClone(item);
      const html = renderToStaticMarkup(<FoodOrder item={item} pawns={[p]} tick={100} command={command} />);
      expect(html).toContain('food-order-controls');
      expect(button(html, '前往食用')).not.toContain('disabled');
      expect(html).toContain('本次指令覆盖饮食政策，并解除这堆食物的禁止取用');
      expect(html).toContain('居民会实际前往取食；饮食政策保持不变');
      expect(item).toEqual(oldItem);
    }
    expect(p).toEqual(before); expect(command).not.toHaveBeenCalled();
    for (const item of [food({ resource: 'wood' }), food({ resource: 'carcass' }), food({ amount: 0 })]) {
      expect(renderToStaticMarkup(<FoodOrder item={item} pawns={[p]} tick={100} command={command} />)).toBe('');
    }
  });

  it('sends exactly one ingest command for the chosen resident and original physical stack', () => {
    const p = pawn(), chosen = pawn({ id: p.id + 1, name: '陈序', foodPolicyId: 2 }), item = food({ forbidden: true });
    const before = structuredClone({ p, chosen, item });
    const captured = capture(() => FoodOrder({ item, pawns: [p, chosen], tick: 100, preferredPawnId: chosen.id, command }));
    expect(captured.html).toContain(`<option value="${chosen.id}" selected="">陈序</option>`);
    captured.elements.find(e => e.props.children === '前往食用')!.props.onClick();
    expect(command).toHaveBeenCalledExactlyOnceWith({ type: 'ingest', pawnId: chosen.id, stackId: item.id });
    expect({ p, chosen, item }).toEqual(before);
  });

  it('only lists available colony residents and falls back from an unavailable preferred resident', () => {
    const p = pawn(), item = food();
    const excluded = [
      pawn({ faction: 'prisoner' }), pawn({ faction: 'raider' }), pawn({ faction: 'trader' }),
      pawn({ dead: true }), pawn({ downed: true }), pawn({ drafted: true }), pawn({ carriedBy: 50 }),
      pawn({ psyche: { ...structuredClone(p.psyche), breakUntil: 101 } }), pawn({ phase: 'mental' }),
    ].map((other, i) => ({ ...other, id: p.id + i + 1, name: `不可行动 ${i}` }));
    const captured = capture(() => FoodOrder({ item, pawns: [...excluded, p], tick: 100, preferredPawnId: excluded[0].id, command }));
    expect(captured.html).toContain(`<option value="${p.id}" selected="">林禾</option>`);
    for (const other of excluded) expect(captured.html).not.toContain(other.name);
    captured.elements.find(e => e.props.children === '前往食用')!.props.onClick();
    expect(command).toHaveBeenCalledExactlyOnceWith({ type: 'ingest', pawnId: p.id, stackId: item.id });
    command.mockClear();
    const empty = capture(() => FoodOrder({ item, pawns: excluded, tick: 100, command }));
    expect(empty.html).toContain('暂无可行动同伴');
    expect(empty.html).toContain('aria-label="食用者" disabled=""');
    expect(button(empty.html, '前往食用')).toContain('disabled=""');
    empty.elements.find(e => e.props.children === '前往食用')!.props.onClick();
    expect(command).not.toHaveBeenCalled();
  });
});
