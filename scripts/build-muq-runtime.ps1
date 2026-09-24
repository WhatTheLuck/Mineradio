param([string]$Python = 'py', [string]$PythonVersion = '3.11')
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$runtime = Join-Path $root 'build/muq-runtime'
$venv = Join-Path $root 'build/.muq-venv'
if (-not (Test-Path (Join-Path $venv 'Scripts/python.exe'))) {
  if ($Python -eq 'py') { & py "-$PythonVersion" -m venv $venv }
  else { & $Python -m venv $venv }
  if ($LASTEXITCODE -ne 0) { throw 'Python 3.11 is required for the MuQ build.' }
}
$pip = Join-Path $venv 'Scripts/pip.exe'
$pythonExe = Join-Path $venv 'Scripts/python.exe'
& $pip install 'torch==2.5.1' 'torchaudio==2.5.1' 'torchvision==0.20.1' 'transformers==4.46.3' 'huggingface_hub>=0.26,<1' 'hf_xet>=1,<2' 'muq==0.1.0' 'sentencepiece>=0.2,<0.3' 'pyinstaller>=6,<7' 'numpy<2'
if ($LASTEXITCODE -ne 0) { throw 'MuQ Python dependencies failed to install.' }
New-Item -ItemType Directory -Force -Path $runtime | Out-Null
$download = @'
from huggingface_hub import snapshot_download
import os
root = os.environ['MINERADIO_MUQ_RUNTIME']
cache = os.path.join(root, 'hf-cache')
snapshot_download('OpenMuQ/MuQ-MuLan-large', local_dir=os.path.join(root, 'model'), cache_dir=cache)
snapshot_download('OpenMuQ/MuQ-large-msd-iter', cache_dir=cache, allow_patterns=['config.json', 'model.safetensors'])
snapshot_download('xlm-roberta-base', cache_dir=cache, allow_patterns=['config.json', 'model.safetensors', 'tokenizer.json', 'tokenizer_config.json', 'sentencepiece.bpe.model', 'special_tokens_map.json'])
'@
$env:MINERADIO_MUQ_RUNTIME = $runtime
& $pythonExe -c $download
if ($LASTEXITCODE -ne 0) { throw 'MuQ model download failed.' }
$convert = @'
import os, torch
from safetensors.torch import save_file
root = os.environ['MINERADIO_MUQ_RUNTIME']
source = os.path.join(root, 'model', 'pytorch_model.bin')
target = os.path.join(root, 'model', 'model.safetensors')
if not os.path.isfile(target):
    save_file(torch.load(source, map_location='cpu', weights_only=True), target)
'@
& $pythonExe -c $convert
if ($LASTEXITCODE -ne 0) { throw 'MuQ model conversion failed.' }
$pyOut = Join-Path $root 'build/muq-pyinstaller'
& $pythonExe -m PyInstaller --noconfirm --clean --onedir --name muq-worker --distpath $pyOut --workpath (Join-Path $pyOut 'work') --specpath $pyOut --collect-all muq --collect-all transformers --collect-all nnAudio --collect-all x_clip --collect-all sentencepiece (Join-Path $root 'desktop/muq-worker.py')
if ($LASTEXITCODE -ne 0) { throw 'MuQ worker packaging failed.' }
Copy-Item -Path (Join-Path $pyOut 'muq-worker/*') -Destination $runtime -Recurse -Force
$bundle = Join-Path $root 'build/muq-placeholder-bundle'
& $pythonExe (Join-Path $root 'scripts/stage-muq-runtime.py') $runtime $bundle
if ($LASTEXITCODE -ne 0) { throw 'MuQ offline bundle staging failed.' }
Write-Host "MuQ runtime ready: $bundle"
