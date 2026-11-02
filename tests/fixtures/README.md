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
