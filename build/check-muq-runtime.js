'use strict';
const fs = require('fs');
const path = require('path');

module.exports = async context => {
  if (context.electronPlatformName !== 'win32') return;
  const root = path.join(context.packager.projectDir, 'build', 'muq-placeholder-bundle');
  for (const relative of ['muq-worker.exe', 'model/config.json', 'model/model.safetensors', 'hf-cache/models--OpenMuQ--MuQ-large-msd-iter', 'hf-cache/models--xlm-roberta-base']) {
    if (!fs.existsSync(path.join(root, relative))) throw new Error(`MuQ runtime missing: ${relative}. Run scripts/build-muq-runtime.ps1 before packaging.`);
  }
  if (fs.statSync(path.join(root, 'model', 'model.safetensors')).size < 1200000000) throw new Error('MuQ-MuLan weights are incomplete.');
  for (const [repo, minSize] of [['models--OpenMuQ--MuQ-large-msd-iter', 300000000], ['models--xlm-roberta-base', 250000000]]) {
    const repoRoot = path.join(root, 'hf-cache', repo);
    const revision = fs.readFileSync(path.join(repoRoot, 'refs', 'main'), 'utf8').trim();
    const weights = path.join(repoRoot, 'snapshots', revision, 'model.q8.safetensors');
    if (!fs.existsSync(weights) || fs.statSync(weights).size < minSize) throw new Error(`MuQ backbone weights are incomplete: ${repo}`);
  }
};
