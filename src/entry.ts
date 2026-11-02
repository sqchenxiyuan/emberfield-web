if (new URLSearchParams(location.search).get('world') === 'voxel') {
  void import('./voxel/main');
} else {
  void import('./main');
}
