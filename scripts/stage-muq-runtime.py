"""Stage only the files needed by the offline Windows worker."""
from pathlib import Path
import shutil
import sys
import torch
from safetensors import safe_open
from safetensors.torch import load_file, save_file

source = Path(sys.argv[1]).resolve()
target = Path(sys.argv[2]).resolve()
target.mkdir(parents=True, exist_ok=True)

def copy_file(relative):
    origin = source / relative
    if not origin.is_file() or origin.stat().st_size == 0:
        raise RuntimeError(f'Missing MuQ resource: {relative}')
    destination = target / relative
    destination.parent.mkdir(parents=True, exist_ok=True)
    shutil.copy2(origin, destination)

def stage_weights(relative, quantize=True, placeholder=False):
    origin = source / relative
    if not origin.is_file():
        raise RuntimeError(f'Missing MuQ weights: {relative}')
    destination = target / (relative.with_name(relative.stem + '.q8.safetensors') if quantize else relative)
    destination.parent.mkdir(parents=True, exist_ok=True)
    with safe_open(str(origin), framework='pt', device='cpu') as reader:
        metadata = reader.metadata() or {}
    weights = load_file(str(origin), device='cpu')
    quantized = {}
    for key, value in weights.items():
        if torch.is_floating_point(value):
            if not quantize:
                quantized[key] = value.half().contiguous()
                continue
            if placeholder:
                scale = torch.ones(value.shape[0], dtype=torch.float32) if value.ndim >= 2 else torch.ones((), dtype=torch.float32)
                quantized[key] = torch.zeros_like(value, dtype=torch.int8).contiguous()
                quantized[key + '.__scale'] = scale.contiguous()
                continue
            if value.ndim >= 2:
                scale = (value.abs().flatten(1).amax(dim=1) / 127).clamp_min(1e-12)
                view = scale.reshape((-1,) + (1,) * (value.ndim - 1))
            else:
                scale = (value.abs().max() / 127).clamp_min(1e-12)
                view = scale
            quantized[key] = torch.clamp(torch.round(value / view), -127, 127).to(torch.int8).contiguous()
            quantized[key + '.__scale'] = scale.float().contiguous()
        else:
            quantized[key] = value.contiguous()
    if quantize:
        metadata['muq_quantization'] = 'int8-output-channel-v4'
    save_file(quantized, str(destination), metadata=metadata)

copy_file(Path('muq-worker.exe'))
if not (source / '_internal').is_dir():
    raise RuntimeError('PyInstaller support directory is missing')
shutil.copytree(source / '_internal', target / '_internal', dirs_exist_ok=True)
copy_file(Path('model/config.json'))
stage_weights(Path('model/model.safetensors'), quantize=False)

repos = {
    'models--OpenMuQ--MuQ-large-msd-iter': ['config.json', 'model.safetensors'],
    'models--xlm-roberta-base': ['config.json', 'model.safetensors', 'tokenizer.json', 'tokenizer_config.json', 'sentencepiece.bpe.model'],
}
for repo, names in repos.items():
    ref = Path('hf-cache') / repo / 'refs/main'
    copy_file(ref)
    revision = (source / ref).read_text(encoding='utf-8').strip()
    if not revision or '/' in revision or '\\' in revision:
        raise RuntimeError(f'Invalid HF revision for {repo}')
    for name in names:
        relative = Path('hf-cache') / repo / 'snapshots' / revision / name
        if name.endswith('.safetensors'):
            stage_weights(relative, placeholder=True)
        else:
            copy_file(relative)

print(f'MuQ offline bundle ready: {target}')
