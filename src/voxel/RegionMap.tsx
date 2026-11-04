import { useEffect, useRef, useState } from 'react';
import type { RegionMap as RegionalWorld, RegionTile } from './regions';

const COLORS = { ocean: '#386a7d', temperate: '#78965e', boreal: '#497b6e', desert: '#c5a66a' };
const biomeName = { ocean: '海洋', temperate: '温带森林', boreal: '寒带森林', desert: '沙漠' };
const hillName = { flat: '平原', small: '小丘陵', large: '大丘陵', mountainous: '山地', impassable: '不可通行山峰' };
export const regionLabel = (tile: RegionTile) => `${biomeName[tile.biome]} · ${hillName[tile.hilliness]}`;

export function RegionMap({ map, selectedId, choose }: {
  map: RegionalWorld; selectedId: number | null; choose: (tile: RegionTile) => void;
}) {
  const svg = useRef<SVGSVGElement>(null);
  const [cursorId, setCursorId] = useState(selectedId ?? map.tiles[0].id);
  useEffect(() => { if (selectedId !== null) setCursorId(selectedId); }, [selectedId]);
  const cursor = map.tiles.find(t => t.id === cursorId) ?? map.tiles[0];
  const select = (tile: RegionTile) => { setCursorId(tile.id); choose(tile); svg.current?.focus({ preventScroll: true }); };
  return <div className="voxel-region-map-wrap">
    <svg ref={svg} viewBox={`0 0 ${map.width * 12} ${map.height * 12}`} className="voxel-region-map"
      role="grid" aria-label="区域世界地图" aria-rowcount={map.height} aria-colcount={map.width}
      aria-activedescendant={`region-cell-${map.seed}-${cursor.id}`} aria-describedby="region-keyboard-help"
      tabIndex={0} data-testid="region-map" data-world-seed={map.seed}
      onKeyDown={event => {
        const delta: Record<string, [number, number]> = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] };
        if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); event.stopPropagation(); select(cursor); return; }
        if (!delta[event.key] && !['Home', 'End'].includes(event.key)) return;
        event.preventDefault(); event.stopPropagation();
        const [dx, dy] = delta[event.key] ?? [0, 0];
        const x = event.key === 'Home' ? 0 : event.key === 'End' ? map.width - 1 : Math.max(0, Math.min(map.width - 1, cursor.x + dx));
        const y = Math.max(0, Math.min(map.height - 1, cursor.y + dy));
        const next = map.tiles.find(t => t.x === x && t.y === y); if (next) setCursorId(next.id);
      }}>
      <defs><pattern id="region-peaks" width="6" height="6" patternUnits="userSpaceOnUse"><rect width="6" height="6" fill="#aaa99e"/><path d="M0 6L6 0" stroke="#6d726c" strokeWidth="2"/></pattern></defs>
      {Array.from({ length: map.height }, (_, y) => <g role="row" aria-rowindex={y + 1} key={y}>
        {map.tiles.filter(t => t.y === y).map(tile => <rect key={tile.id} id={`region-cell-${map.seed}-${tile.id}`}
          role="gridcell" aria-colindex={tile.x + 1} aria-selected={tile.id === selectedId}
          aria-label={`地区 ${tile.id}，坐标 ${tile.x}, ${tile.y}，${regionLabel(tile)}，${tile.temperature}摄氏度，${tile.rainfall}毫米，${tile.settleable ? '可以建立营地' : tile.reason}`}
          x={tile.x * 12} y={tile.y * 12} width={12} height={12}
          fill={tile.hilliness === 'impassable' ? 'url(#region-peaks)' : COLORS[tile.biome]}
          fillOpacity={tile.hilliness === 'mountainous' ? .72 : tile.hilliness === 'large' ? .86 : 1}
          stroke="#172b2c" strokeWidth=".35" data-testid="region-tile" data-region-id={tile.id}
          data-settleable={tile.settleable} data-biome={tile.biome} data-hilliness={tile.hilliness}
          onClick={() => select(tile)}>
          <title>地区 {tile.id} · {regionLabel(tile)} · {tile.temperature}°C · {tile.rainfall} mm{tile.reason ? ` · ${tile.reason}` : ''}</title>
        </rect>)}
      </g>)}
      {map.tiles.filter(t => t.id === selectedId).map(t => <rect key={t.id} className="voxel-region-selected" x={t.x * 12 + .7} y={t.y * 12 + .7} width="10.6" height="10.6" fill="none" stroke="#fff1b6" strokeWidth="2" pointerEvents="none" />)}
      <rect className="voxel-region-cursor" x={cursor.x * 12 + 1.5} y={cursor.y * 12 + 1.5} width="9" height="9" fill="none" stroke="white" strokeWidth="1.3" strokeDasharray="2 1" pointerEvents="none" />
    </svg>
    <div className="voxel-region-legend">{Object.entries(biomeName).map(([id, name]) => <span key={id}><i style={{ background: COLORS[id as keyof typeof COLORS] }} />{name}</span>)}<span><i className="voxel-region-peak-key"/>不可通行山峰</span></div>
    <small id="region-keyboard-help">点选地区；键盘方向键移动光标，Enter 或空格确认。深浅表示地形起伏，白框是当前选址。</small>
    <small className="voxel-region-cursor-label" aria-live="polite">光标：地区 {cursor.id} · ({cursor.x}, {cursor.y}) · {regionLabel(cursor)}</small>
    <small>海洋用于世界选址背景，不能建立营地；本地营地地图暂不生成海水或河流。</small>
  </div>;
}
