import { useState } from 'react';
import type { VoxelCommand, VoxelSnapshot } from './types';

export function StockpileZonePanel({ zone, command, expand }: {
  zone: VoxelSnapshot['stockpileZones'][number];
  command: (command: VoxelCommand) => void; expand: (zoneId: string) => void;
}) {
  const [name, setName] = useState(zone.name);
  const nextName = name.trim();
  return <section className="voxel-stockpile-zone" data-testid="stockpile-zone" data-zone-id={zone.id}>
    <div className="voxel-info-row"><b data-testid="stockpile-zone-name">{zone.name}</b><span>{zone.cells.length} 格</span></div>
    <form className="voxel-stockpile-zone-name" onSubmit={event => {
      event.preventDefault();
      if (nextName && nextName !== zone.name) command({ type: 'stockpileZoneRename', zoneId: zone.id, name: nextName });
    }}>
      <label>仓库区名称<input aria-label="仓库区名称" maxLength={40} required value={name}
        onChange={event => setName(event.target.value)} /></label>
      <button type="submit" data-testid="stockpile-zone-rename" disabled={!nextName || nextName === zone.name}>保存区名</button>
    </form>
    <button type="button" data-testid="stockpile-zone-expand" onClick={() => expand(zone.id)}>扩展此区</button>
    <small>拖绘新格会加入这个仓库区，生产账单仍指向同一区域。也可用仓储工具从本区内开始拖动扩展。</small>
    <small data-testid="stockpile-zone-filter-note">区名用于指定生产去向；下方规则仍按单格或同层连片修改。连片修改可跨越相邻区域，命名不会统一各格的筛选。</small>
  </section>;
}
