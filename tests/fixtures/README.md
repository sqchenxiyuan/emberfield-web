# Persisted gameplay fixtures

`voxel-v5-cold-store.json` is an Emberfield save produced by the normal farming,
mining, cooking and power campaign published in commit
`632042ea7a5b8a1ba1d08ebf310a0606d056a7af`. It is not a RimWorld save.
The recorded checkpoint is `cold-stock` at tick 114985; its provenance is in
`docs/research/rimworld/evidence/voxel-preservation-validation.json`.

Keep these original v5 bytes. They intentionally contain the older unlimited
stacks and overlapping ground containers. The finite-logistics campaign imports
them through the public save loader, checks quantities and quantity-weighted
food age, and then advances the migrated game. Do not regenerate this fixture
from the current simulation or weaken it into a hand-edited v6 save.

`voxel-v6-logistics.json` is the unchanged `final` checkpoint at tick 1826 from
the normal finite-logistics campaign published in commit
`0b7c10912f3c9e5ee8a60516470851d337825a01`. Provenance is in
`docs/research/rimworld/evidence/voxel-logistics-validation.json`.
SHA256: `8063226ef027897139f295a02e8b53963c94f1c48853c2c83e36edf1d628d36d`.
The v7 stonecutting campaign verifies that its existing 15 stone remain processed
blocks, warehouse filters remain unchanged, and no raw chunks are invented.

`voxel-v7-start.json` is the unchanged tick-zero seed 73129 colony exported
from the published v7 / generator-1 simulation in commit
`1e65ab00cf6b5b6f753bffa0154f7049f313bc1d`, before generator-2 implementation.
SHA256: `203b82e8cf07279f2090a9576131dc47182a2c8fdce838542ed05b6480969076`.
Keep these bytes. Old coordinate-based gameplay campaigns load this fixture
through the normal public loader; they verify continued play in a legacy world,
not generation-2 terrain. New-world generation has separate campaigns that find
their work sites from actual generated terrain.
