"""Bundled MuQ-MuLan inference worker. JSON lines on stdin/stdout."""
import base64
import json
import os
import sys
from pathlib import Path
import shutil

os.environ['HF_HUB_OFFLINE'] = '1'
os.environ['TRANSFORMERS_OFFLINE'] = '1'

import numpy as np
import torch
from safetensors import safe_open
from safetensors.torch import load_file, save_file
from muq import MuQMuLan
from transformers import AutoTokenizer


def expand_weights(source, target):
    if target.is_file() and target.stat().st_size > source.stat().st_size:
        return
    with safe_open(str(source), framework='pt', device='cpu') as reader:
        metadata = reader.metadata() or {}
    if metadata.get('muq_quantization') != 'int8-output-channel-v4':
        raise RuntimeError('Unsupported MuQ weight format')
    quantized = load_file(str(source), device='cpu')
    restored = {}
    for key, tensor in quantized.items():
        if key.endswith('.__scale'):
            continue
        scale = quantized.get(key + '.__scale')
        if scale is not None:
            view = scale.reshape((-1,) + (1,) * (tensor.ndim - 1)) if tensor.ndim >= 2 else scale
            restored[key] = (tensor.float() * view).half().contiguous()
        else:
            restored[key] = tensor.contiguous()
    target.parent.mkdir(parents=True, exist_ok=True)
    temporary = target.with_name(target.name + '.tmp')
    save_file(restored, str(temporary), metadata={'format': 'pt'})
    os.replace(temporary, target)


def prepare_model(asset_model_dir):
    asset_root = asset_model_dir.parent
    expanded_root = Path(os.environ.get('MINERADIO_MUQ_EXPANDED_ROOT') or (asset_root / 'expanded')).resolve()
    expanded_model = expanded_root / 'model'
    expanded_cache = expanded_root / 'hf-cache'
    expanded_model.mkdir(parents=True, exist_ok=True)
    shutil.copy2(asset_model_dir / 'config.json', expanded_model / 'config.json')
    if (asset_model_dir / 'model.q8.safetensors').is_file():
        expand_weights(asset_model_dir / 'model.q8.safetensors', expanded_model / 'model.safetensors')
    else:
        source_weights = asset_model_dir / 'model.safetensors'
        target_weights = expanded_model / 'model.safetensors'
        if not target_weights.is_file() or target_weights.stat().st_size != source_weights.stat().st_size:
            shutil.copy2(source_weights, target_weights)
    for repo, files in {
        'models--OpenMuQ--MuQ-large-msd-iter': ['config.json'],
        'models--xlm-roberta-base': ['config.json', 'tokenizer.json', 'tokenizer_config.json', 'sentencepiece.bpe.model'],
    }.items():
        source_repo = asset_root / 'hf-cache' / repo
        revision = (source_repo / 'refs' / 'main').read_text(encoding='utf-8').strip()
        if not revision or '/' in revision or '\\' in revision:
            raise RuntimeError('Invalid bundled model revision')
        target_repo = expanded_cache / repo
        (target_repo / 'refs').mkdir(parents=True, exist_ok=True)
        (target_repo / 'refs' / 'main').write_text(revision, encoding='utf-8')
        for name in files:
            destination = target_repo / 'snapshots' / revision / name
            destination.parent.mkdir(parents=True, exist_ok=True)
            shutil.copy2(source_repo / 'snapshots' / revision / name, destination)
        quantized = source_repo / 'snapshots' / revision / 'model.q8.safetensors'
        destination = target_repo / 'snapshots' / revision / 'model.safetensors'
        if quantized.is_file():
            expand_weights(quantized, destination)
        else:
            shutil.copy2(source_repo / 'snapshots' / revision / 'model.safetensors', destination)
    return expanded_model, expanded_cache


def main():
    asset_model_dir = Path(sys.argv[1]).resolve()
    if not (asset_model_dir / 'config.json').is_file():
        raise RuntimeError('Bundled MuQ model is missing')
    model_dir, cache_dir = prepare_model(asset_model_dir)
    model = MuQMuLan.from_pretrained(str(model_dir), cache_dir=str(cache_dir)).to('cpu').eval()
    text_model = model.mulan_module.text
    text_model._tokenizer = AutoTokenizer.from_pretrained(
        'xlm-roberta-base', use_fast=False, cache_dir=str(cache_dir)
    )
    for line in sys.stdin:
        request = None
        try:
            request = json.loads(line)
            with torch.inference_mode():
                if request['kind'] == 'audio':
                    pcm = np.frombuffer(base64.b64decode(request['pcm']), dtype='<f4').copy()
                    if not 24000 <= len(pcm) <= 240000 or not np.isfinite(pcm).all():
                        raise ValueError('INVALID_AUDIO_SAMPLE')
                    vector = model(wavs=torch.from_numpy(pcm).unsqueeze(0))
                elif request['kind'] == 'text':
                    value = str(request['text'])[:200]
                    if not value:
                        raise ValueError('EMPTY_TEXT')
                    try:
                        vector = model(texts=[value])
                    except TypeError as exc:
                        if 'TextEncodeInput' not in str(exc) and 'TextInputSequence' not in str(exc):
                            raise
                        # Recreate the slow tokenizer before a bounded retry.
                        text_model._tokenizer = AutoTokenizer.from_pretrained(
                            'xlm-roberta-base', use_fast=False, cache_dir=str(cache_dir)
                        )
                        vector = model(texts=[value])
                else:
                    raise ValueError('INVALID_REQUEST')
            vector = vector.squeeze().float().cpu().numpy()
            norm = np.linalg.norm(vector)
            if not np.isfinite(norm) or norm == 0:
                raise ValueError('INVALID_EMBEDDING')
            answer = {'id': request['id'], 'vector': (vector / norm).tolist()}
        except Exception as exc:
            answer = {'id': request.get('id') if isinstance(request, dict) else None, 'error': str(exc)[:200]}
        sys.stdout.write(json.dumps(answer, ensure_ascii=False) + '\n')
        sys.stdout.flush()


if __name__ == '__main__':
    main()
